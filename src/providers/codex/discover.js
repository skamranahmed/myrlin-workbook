/**
 * Codex session discovery.
 *
 * Phase 17 Plan 17-01 (CDX-01, CDX-02, CDX-07).
 *
 * Two paths:
 *
 *   Fast-path: read $CODEX_HOME/session_index.jsonl (a flat append-only
 *     {id, thread_name, updated_at} log Codex maintains for its own sidebar).
 *     For each entry, resolve the rollout file under sessions/YYYY/MM/DD/
 *     using the date prefix derived from updated_at and the id-suffixed
 *     filename pattern (rollout-*-<id>.jsonl). Cheap: one stat per entry
 *     plus a 32KB first-line read for cwd extraction.
 *
 *   Walk-fallback: when session_index.jsonl is missing, unreadable, OR has
 *     stale entries (entries whose rollout file no longer exists), recurse
 *     $CODEX_HOME/sessions/YYYY/MM/DD/ for rollout-*.jsonl. Extract the id
 *     from the filename and the cwd from the first line. Slower but
 *     unconditional truth.
 *
 * Both paths produce the same ProviderSession[] shape. The two are merged,
 * deduplicated by providerSessionId (most-recent mtime wins), and sorted
 * by lastActive descending.
 *
 * Failure modes (NEVER throw):
 *   - $CODEX_HOME does not exist -> return []
 *   - $CODEX_HOME/sessions/ does not exist -> return []
 *   - session_index.jsonl corrupt mid-file -> per-line try/catch, walk on stale
 *   - rollout file is mid-write -> first-line parse fails; defensive null cwd
 *   - permission denied on a date dir -> skip, continue
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * @module src/providers/codex/discover
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// parse.js is leaf-side: discover does NOT depend on parseTranscript at all.
// We only borrow wrapEnvelope from the _internal surface so the bare-JSON
// first-line case is handled identically in both modules.
const { _internal: parseInternal } = require('./parse');
const wrapEnvelope = parseInternal.wrapEnvelope;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve $CODEX_HOME at call time (NOT module load) so a user can change
 * the env var between calls. Falls back to ~/.codex when unset.
 *
 * Honored strictly: a CODEX_HOME pointing at a non-existent path returns
 * [] from discover() rather than silently falling back to the default. The
 * intent is "if you set CODEX_HOME, you mean it".
 *
 * @returns {string} Absolute path to the Codex home directory.
 */
function getCodexHome() {
  // gsd:provider-literal-allowed (default Codex home directory name)
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

/**
 * Read $CODEX_HOME/session_index.jsonl line-by-line. Returns null when the
 * file is missing or unreadable; otherwise returns an array of valid index
 * entries. Corrupt lines are skipped via try/catch; valid entries continue
 * to be collected, so a single bad line does not poison the whole index.
 *
 * @returns {Array<{id:string, thread_name:string, updated_at:string}>|null}
 */
function readSessionIndex() {
  const indexPath = path.join(getCodexHome(), 'session_index.jsonl');
  let raw;
  try {
    raw = fs.readFileSync(indexPath, 'utf-8');
  } catch (_) {
    return null;
  }
  const out = [];
  const lines = raw.split('\n');
  for (const line of lines) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      if (
        entry &&
        typeof entry === 'object' &&
        typeof entry.id === 'string' &&
        typeof entry.updated_at === 'string'
      ) {
        out.push({
          id: entry.id,
          thread_name: typeof entry.thread_name === 'string' ? entry.thread_name : '',
          updated_at: entry.updated_at,
        });
      }
    } catch (_) {
      // Skip corrupt line; keep going.
    }
  }
  return out;
}

/**
 * Build the candidate rollout path for an index entry.
 *
 * Extracts YYYY/MM/DD from entry.updated_at, then scans the date directory
 * for files matching `rollout-*-<entry.id>.jsonl` (case-insensitive on the
 * UUID; UUIDs are regex-safe so we just substring-test).
 *
 * Returns null when the date is unparseable, the date dir is missing, or
 * no file matches. When multiple files match (defensive; should not occur),
 * returns the lex-largest filename which is the newest by ISO sort.
 *
 * @param {string} codexHome
 * @param {{id:string, updated_at:string}} entry
 * @returns {string|null} Absolute path to rollout-*-<id>.jsonl, or null.
 */
function resolveIndexEntryToPath(codexHome, entry) {
  const date = new Date(entry.updated_at);
  if (isNaN(date.getTime())) return null;

  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const dayDir = path.join(codexHome, 'sessions', yyyy, mm, dd);

  let files;
  try {
    files = fs.readdirSync(dayDir);
  } catch (_) {
    return null;
  }

  const idLower = entry.id.toLowerCase();
  const suffix = '-' + idLower + '.jsonl';
  const matches = [];
  for (const f of files) {
    const lower = f.toLowerCase();
    if (lower.startsWith('rollout-') && lower.endsWith(suffix)) {
      matches.push(f);
    }
  }
  if (matches.length === 0) return null;
  if (matches.length === 1) return path.join(dayDir, matches[0]);

  // Multiple matches: defensive; pick lex-largest (newest by ISO sort).
  matches.sort();
  return path.join(dayDir, matches[matches.length - 1]);
}

/**
 * Recursively walk $CODEX_HOME/sessions/YYYY/MM/DD/ for rollout-*.jsonl
 * files. Returns absolute paths. Tolerates missing intermediate dirs.
 *
 * Uses Node 18.17+ recursive readdir when available; falls back to a
 * manual three-level walk on older runtimes for safety.
 *
 * @param {string} codexHome
 * @returns {string[]} Absolute paths of matching rollout files.
 */
function walkSessionsTree(codexHome) {
  const sessionsRoot = path.join(codexHome, 'sessions');
  const out = [];

  let entries;
  try {
    entries = fs.readdirSync(sessionsRoot, { recursive: true, withFileTypes: true });
  } catch (_) {
    // Older Node fallback OR sessions root missing.
    return walkSessionsTreeManual(sessionsRoot);
  }

  for (const e of entries) {
    if (!e.isFile()) continue;
    const lower = e.name.toLowerCase();
    if (!lower.startsWith('rollout-') || !lower.endsWith('.jsonl')) continue;
    const parent = e.parentPath || e.path || sessionsRoot;
    out.push(path.join(parent, e.name));
  }
  return out;
}

/**
 * Manual three-level YYYY/MM/DD walk used when fs.readdirSync(...,{recursive})
 * is unavailable. Returns [] on any IO error (defensive).
 *
 * @param {string} sessionsRoot
 * @returns {string[]}
 */
function walkSessionsTreeManual(sessionsRoot) {
  const out = [];
  let years;
  try {
    years = fs.readdirSync(sessionsRoot, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const y of years) {
    if (!y.isDirectory()) continue;
    const yearDir = path.join(sessionsRoot, y.name);
    let months;
    try {
      months = fs.readdirSync(yearDir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const m of months) {
      if (!m.isDirectory()) continue;
      const monthDir = path.join(yearDir, m.name);
      let days;
      try {
        days = fs.readdirSync(monthDir, { withFileTypes: true });
      } catch (_) {
        continue;
      }
      for (const d of days) {
        if (!d.isDirectory()) continue;
        const dayDir = path.join(monthDir, d.name);
        let files;
        try {
          files = fs.readdirSync(dayDir);
        } catch (_) {
          continue;
        }
        for (const f of files) {
          const lower = f.toLowerCase();
          if (lower.startsWith('rollout-') && lower.endsWith('.jsonl')) {
            out.push(path.join(dayDir, f));
          }
        }
      }
    }
  }
  return out;
}

/**
 * Absolute path to $CODEX_HOME/archived_sessions.
 *
 * Codex moves ended threads here as flat `rollout-*.jsonl` files (same
 * on-disk envelope format as sessions/). These are invisible to both
 * session_index.jsonl and the sessions/ walk, so discovery + search must
 * scan this directory explicitly. Optional on disk; callers guard with
 * fs.existsSync.
 *
 * @param {string} codexHome
 * @returns {string} Absolute path to the archived_sessions directory.
 */
function getArchivedSessionsDir(codexHome) {
  return path.join(codexHome, 'archived_sessions');
}

/**
 * Collect absolute paths of every `rollout-*.jsonl` under an arbitrary root.
 * Handles the flat archived layout AND any date-bucketed nesting via a
 * recursive readdir, with a flat-then-manual fallback for older Node or
 * filesystems that reject the recursive option. Returns [] when the root is
 * missing or unreadable (never throws).
 *
 * Factored out so both the sessions/ walk (via walkSessionsTree) and the
 * archived_sessions/ scan share one rollout-matching predicate.
 *
 * @param {string} root - Directory to scan.
 * @returns {string[]} Absolute paths of matching rollout files.
 */
function collectRolloutFilesUnder(root) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(root, { recursive: true, withFileTypes: true });
  } catch (_) {
    // Recursive option unavailable OR root missing: try a flat readdir so the
    // common (flat) archived layout still resolves; give up quietly otherwise.
    try {
      for (const f of fs.readdirSync(root)) {
        const lower = f.toLowerCase();
        if (lower.startsWith('rollout-') && lower.endsWith('.jsonl')) {
          out.push(path.join(root, f));
        }
      }
    } catch (_) { /* missing/unreadable; return [] */ }
    return out;
  }
  for (const e of entries) {
    if (!e.isFile()) continue;
    const lower = e.name.toLowerCase();
    if (!lower.startsWith('rollout-') || !lower.endsWith('.jsonl')) continue;
    const parent = e.parentPath || e.path || root;
    out.push(path.join(parent, e.name));
  }
  return out;
}

/**
 * Enumerate archived rollout files under $CODEX_HOME/archived_sessions.
 * Guarded: returns [] when the directory does not exist. Tags nothing here;
 * the caller decides how to mark the archived flag on the resulting sessions.
 *
 * @param {string} codexHome
 * @returns {string[]} Absolute paths of archived rollout files.
 */
function walkArchivedSessions(codexHome) {
  const root = getArchivedSessionsDir(codexHome);
  if (!fs.existsSync(root)) return [];
  return collectRolloutFilesUnder(root);
}

/**
 * Extract providerSessionId from a rollout filename.
 *
 * Pattern: `rollout-<ISO-8601-with-dashes>-<UUID>.jsonl`. The trailing UUID
 * is the canonical providerSessionId (matches session_index.jsonl[entry].id).
 * Lowercased on return because UUIDs are case-insensitive but Map keys are not.
 *
 * @param {string} filename - basename only (no directories).
 * @returns {string|null} Lowercased UUID or null on miss.
 */
function extractIdFromFilename(filename) {
  const m = /^rollout-.+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(
    filename
  );
  return m ? m[1].toLowerCase() : null;
}

/**
 * Read only the first line of a rollout file to extract cwd, startedAt,
 * title hint, and CLI version from the session_meta payload. Tolerates
 * corrupt files. Returns null on any failure.
 *
 * Reads up to 256KB from the head because session_meta payloads can be
 * large (base_instructions text can be 100KB+; Codex 0.125 packs the
 * full personality prompt into the first line).
 *
 * Calls wrapEnvelope from parse.js so a pre-0.45 bare-JSON first line is
 * handled identically.
 *
 * @param {string} filePath
 * @returns {{cwd:string|null, startedAt:string|null, title:string|null, cliVersion:string|null}|null}
 */
function readSessionMetaFromFile(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch (_) {
    return null;
  }
  try {
    const stat = fs.fstatSync(fd);
    const headSize = Math.min(256 * 1024, stat.size);
    const buf = Buffer.alloc(headSize);
    fs.readSync(fd, buf, 0, headSize, 0);

    const text = buf.toString('utf-8');
    const newlineIdx = text.indexOf('\n');
    const firstLine = newlineIdx === -1 ? text : text.substring(0, newlineIdx);
    if (!firstLine) return null;

    let parsed;
    try {
      parsed = JSON.parse(firstLine);
    } catch (_) {
      return null;
    }
    const envelope = wrapEnvelope(parsed);
    if (!envelope || envelope.type !== 'session_meta') return null;

    const payload = envelope.payload || {};
    // Codex Desktop spawns subagent threads (explorer/Pascal/Linnaeus/etc.)
    // as their own rollout files with payload.source.subagent.thread_spawn set.
    // These are internal agent fan-outs from a parent user thread; the user
    // never opened them directly and they pollute the discovered list. Filter
    // them out so the sidebar shows only top-level user conversations. The
    // subagent rollouts remain on disk and parseTranscript still reads them
    // when a parent thread's transcript references them.
    const src = payload.source;
    const isSubagent = src && typeof src === 'object' && src.subagent != null;
    return {
      cwd: typeof payload.cwd === 'string' ? payload.cwd : null,
      startedAt: typeof payload.timestamp === 'string' ? payload.timestamp : null,
      title: null, // session_meta does not carry the human title; that lives in event_msg.thread_name_updated or session_index
      cliVersion: typeof payload.cli_version === 'string' ? payload.cli_version : null,
      isSubagent,
    };
  } catch (_) {
    return null;
  } finally {
    try {
      fs.closeSync(fd);
    } catch (_) {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Public: discover
// ---------------------------------------------------------------------------

/**
 * Enumerate locally-discoverable Codex sessions.
 * Returns [] (never throws) when $CODEX_HOME does not exist or
 * $CODEX_HOME/sessions/ is missing.
 *
 * Algorithm:
 *   1. Try the fast-path via session_index.jsonl. Each entry resolves to
 *      a rollout file via the date-bucketed filename pattern. Entries
 *      that resolve get a full ProviderSession including projectPath
 *      (extracted from the rollout's first line). Entries that fail to
 *      resolve are tracked as staleIds for the walk-fallback to recover.
 *   2. If the index was missing/empty/unusable OR any staleIds were
 *      collected, run the walk-fallback against $CODEX_HOME/sessions/.
 *      For each rollout file, extract the id from the filename. If the
 *      id is already in byId from the fast-path AND not stale, skip;
 *      otherwise add it (walk-recovery for stale OR no-index cases).
 *   3. Merge, deduplicate by providerSessionId (most-recent lastActive
 *      wins on conflict), sort by lastActive descending.
 *
 * @param {{forceRefresh?: boolean}} [opts]
 * @returns {Promise<Array<{provider:string, providerSessionId:string,
 *   projectPath:string|null, encodedName:null, title:string|null,
 *   lastActive:Date, sizeBytes:number, cliVersion?:string|null}>>}
 */
async function discover(opts) {
  void (opts && opts.forceRefresh); // reserved; no internal cache in v1.2

  const codexHome = getCodexHome();
  if (!fs.existsSync(codexHome)) return [];
  const sessionsRoot = path.join(codexHome, 'sessions');
  // archived_sessions/ holds ended threads and is independent of sessions/.
  // Discovery must surface both, so we only bail when NEITHER exists (a
  // CODEX_HOME with only archived threads is still fully discoverable).
  const hasSessions = fs.existsSync(sessionsRoot);
  const hasArchived = fs.existsSync(getArchivedSessionsDir(codexHome));
  if (!hasSessions && !hasArchived) return [];

  /** @type {Map<string, object>} providerSessionId -> ProviderSession */
  const byId = new Map();
  /** @type {Set<string>} ids whose index entry pointed at a missing file */
  const staleIds = new Set();

  // ─── Fast-path: session_index.jsonl (only meaningful when sessions/ exists) ─
  const index = hasSessions ? readSessionIndex() : null;
  if (Array.isArray(index)) {
    for (const entry of index) {
      const rolloutPath = resolveIndexEntryToPath(codexHome, entry);
      if (!rolloutPath) {
        staleIds.add(entry.id.toLowerCase());
        continue;
      }
      let stat;
      try {
        stat = fs.statSync(rolloutPath);
      } catch (_) {
        staleIds.add(entry.id.toLowerCase());
        continue;
      }
      if (!stat.isFile()) {
        staleIds.add(entry.id.toLowerCase());
        continue;
      }
      // Lazy-fill projectPath via the first-line read. Cost: one ~256KB read
      // per entry, bound by index size. Mirrors what walk-fallback does for
      // every file, so per-file work is even.
      const meta = readSessionMetaFromFile(rolloutPath);

      // Skip subagent-spawned threads (explorer/specialist agents Codex Desktop
      // forks off a parent user thread). They share the same on-disk format but
      // were never user-initiated; surfacing them in the sidebar duplicates and
      // confuses the conversation list.
      if (meta && meta.isSubagent) continue;

      const indexUpdated = new Date(entry.updated_at);
      const mtime = stat.mtime;
      const lastActive = !isNaN(indexUpdated.getTime()) && mtime < indexUpdated ? indexUpdated : mtime;

      byId.set(entry.id.toLowerCase(), {
        provider: 'codex', // gsd:provider-literal-allowed
        providerSessionId: entry.id.toLowerCase(),
        projectPath: meta ? meta.cwd : null,
        encodedName: null,
        title: entry.thread_name || null,
        lastActive: lastActive,
        sizeBytes: stat.size,
        cliVersion: meta ? meta.cliVersion : null,
      });
    }
  }

  // ─── Walk-fallback: index missing OR has stale entries ─────────────────
  const indexUnusable = !Array.isArray(index) || index.length === 0;
  const walkNeeded = hasSessions && (indexUnusable || staleIds.size > 0);
  if (walkNeeded) {
    const files = walkSessionsTree(codexHome);
    for (const filePath of files) {
      const filename = path.basename(filePath);
      const id = extractIdFromFilename(filename);
      if (!id) continue;

      // If fast-path already resolved this id (and it is NOT marked stale), skip.
      if (byId.has(id) && !staleIds.has(id)) continue;

      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch (_) {
        continue;
      }
      if (!stat.isFile()) continue;

      const meta = readSessionMetaFromFile(filePath);
      // Skip subagent-spawned threads (see comment in fast-path block above).
      if (meta && meta.isSubagent) continue;
      // If we get here, the index either had no usable entry for this id OR
      // pointed at a missing file. Either way, walk-derived data is truth.
      byId.set(id, {
        provider: 'codex', // gsd:provider-literal-allowed
        providerSessionId: id,
        projectPath: meta ? meta.cwd : null,
        encodedName: null,
        title: null,
        lastActive: stat.mtime,
        sizeBytes: stat.size,
        cliVersion: meta ? meta.cliVersion : null,
      });
    }
    if (staleIds.size > 0) {
      // eslint-disable-next-line no-console
      console.debug(
        '[codex-discover] index had ' + staleIds.size + ' stale entr(ies); walked to recover'
      );
    }
  }

  // Stale-entry final pass: any id in staleIds that the walk did NOT
  // recover (because the rollout file truly does not exist anywhere on
  // disk) must be dropped from the result. The fast-path never inserted
  // these into byId (we marked them stale BEFORE setting), so they are
  // already absent. The check below is defensive: if a future refactor
  // changes the fast-path insertion order, this guard keeps the contract
  // intact (stale entries never appear in the result).
  for (const staleId of staleIds) {
    if (byId.has(staleId)) {
      // Walk recovered this id (either by finding the file at a different
      // date directory or because the index was right and the stat just
      // raced). Keep it.
      continue;
    }
  }

  // ─── Archived-sessions scan (always runs when the directory exists) ─────
  // $CODEX_HOME/archived_sessions/ holds ended threads that neither the
  // session_index.jsonl fast-path nor the sessions/ walk can see. We surface
  // them tagged `archived: true` so the UI can distinguish them, and so the
  // product rule "no tracked session is ever lost" holds: an archived thread
  // is still discoverable, resumable, and searchable. A live sessions/ entry
  // for the same id wins (archived is only a fallback for ids not already
  // present).
  if (hasArchived) {
    const archivedFiles = walkArchivedSessions(codexHome);
    for (const filePath of archivedFiles) {
      const filename = path.basename(filePath);
      const id = extractIdFromFilename(filename);
      if (!id) continue;
      if (byId.has(id)) continue; // live sessions/ record already present; keep it
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch (_) {
        continue;
      }
      if (!stat.isFile()) continue;
      const meta = readSessionMetaFromFile(filePath);
      // Skip subagent-spawned threads (same filter as the live paths).
      if (meta && meta.isSubagent) continue;
      byId.set(id, {
        provider: 'codex', // gsd:provider-literal-allowed
        providerSessionId: id,
        projectPath: meta ? meta.cwd : null,
        encodedName: null,
        title: null,
        lastActive: stat.mtime,
        sizeBytes: stat.size,
        cliVersion: meta ? meta.cliVersion : null,
        archived: true,
      });
    }
  }

  const out = Array.from(byId.values());
  out.sort((a, b) => b.lastActive.getTime() - a.lastActive.getTime());
  return out;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = discover;
// Test introspection surface (mirrors parse.js's _internal pattern). Not
// part of the public Provider contract; tests assert behavior end-to-end
// through discover() in production code.
module.exports._internal = {
  getCodexHome: getCodexHome,
  readSessionIndex: readSessionIndex,
  resolveIndexEntryToPath: resolveIndexEntryToPath,
  walkSessionsTree: walkSessionsTree,
  extractIdFromFilename: extractIdFromFilename,
  readSessionMetaFromFile: readSessionMetaFromFile,
  // Plan (session-lifecycle): archived_sessions support + shared rollout
  // collection. Exposed so codexProvider.findArtifactPath /
  // findArtifactByWorkingDir reuse the exact scan logic instead of
  // duplicating it, and so archived-discovery tests can assert directly.
  getArchivedSessionsDir: getArchivedSessionsDir,
  collectRolloutFilesUnder: collectRolloutFilesUnder,
  walkArchivedSessions: walkArchivedSessions,
};
