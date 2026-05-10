/**
 * Claude search adapter (Phase 16 implementation, replaces the Phase 14 stub).
 *
 * Walks the cached list of ~/.claude/projects/<encoded>/<uuid>.jsonl files,
 * JSON-parses each line, indexes into entry.message.content (string or array
 * shapes), and builds approximately +/-100 char snippets around the first match
 * in each matching line. The result records carry provider: 'claude' so the
 * dispatcher in src/web/server.js (GET /api/search) can ship a merged ranked
 * list to the frontend without re-tagging.
 *
 * Behavior contract (consumed by src/web/server.js GET /api/search):
 *   - Returns {results, timedOut, searchedFiles}; results is ALWAYS an array.
 *   - timedOut is true when Date.now() - startTime > timeBudgetMs at any
 *     in-loop checkpoint and the loop broke early.
 *   - searchedFiles is the count of files inspected (diagnostic).
 *
 * Snippet shape contract: +/-100 chars around the match, normalized whitespace
 * (CR/LF collapsed to single spaces, runs of whitespace collapsed), ellipsis
 * prepended/appended on truncation. Phase 17 (Codex) MUST mirror this shape.
 *
 * Phase 16 (Plan 16-01). Requirements SRCH-01..04, SRCH-06.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * @module src/providers/claude/search
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { resolveProjectPath, getProjectDisplayName } = require('./path-decode');
const { extractSessionName } = require('./parse');

// ─── Module-scoped file-list cache (moved from src/web/server.js:7203-7205) ──
// Cache is Claude-specific; Codex (Phase 17) gets its own cache inside
// src/providers/codex/search.js so per-provider invalidation stays independent.
let _searchFileCache = null;
let _searchFileCacheTime = 0;
const SEARCH_FILE_CACHE_TTL = 30000; // 30 seconds, unchanged from v1.1

/**
 * Build the cached list of all JSONL session files under ~/.claude/projects/.
 * 30s TTL. Moved verbatim from src/web/server.js:7212-7258 in Plan 16-01.
 *
 * Returns an array of file descriptors used by the inner search loop. Each
 * descriptor carries the resolved real-filesystem project path and a human
 * display name so the result records can name the project without the
 * dispatcher re-resolving paths.
 *
 * @returns {Array<{filePath: string, sessionId: string, projectDir: string, encodedName: string, realPath: (string|null), projectName: string}>}
 */
function getSearchableFiles() {
  const now = Date.now();
  if (_searchFileCache && (now - _searchFileCacheTime) < SEARCH_FILE_CACHE_TTL) {
    return _searchFileCache;
  }

  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(claudeDir)) {
    _searchFileCache = [];
    _searchFileCacheTime = now;
    return _searchFileCache;
  }

  const files = [];
  try {
    const entries = fs.readdirSync(claudeDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const projectDir = path.join(claudeDir, entry.name);
      let realPath = null;
      try { realPath = resolveProjectPath(projectDir, entry.name); } catch (_) { /* best-effort */ }
      const projectName = getProjectDisplayName(entry.name, realPath);

      try {
        const dirFiles = fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));
        for (const f of dirFiles) {
          files.push({
            filePath: path.join(projectDir, f),
            sessionId: f.replace('.jsonl', ''),
            projectDir,
            encodedName: entry.name,
            realPath,
            projectName,
          });
        }
      } catch (_) {
        // Unreadable subdir; skip.
      }
    }
  } catch (_) {
    // Top-level read failed; cache empty list to avoid hammering FS each call.
  }

  _searchFileCache = files;
  _searchFileCacheTime = now;
  return files;
}

/**
 * Search Claude transcripts for matches against a query.
 *
 * Self-checks Date.now() - startTime > timeBudgetMs at the SAME two checkpoints
 * as the v1.1 inline loop (top of outer file-loop AND inside the inner line
 * loop) to preserve early-termination behavior. The dispatcher in server.js
 * wraps this call in a Promise.race against a hard timeBudgetMs + grace timer
 * as a second-line defense; this function's own self-check is the primary
 * mechanism.
 *
 * @param {Object} args
 * @param {string} args.query        - Free-text query; case-insensitive substring match. Returns empty on < 2 chars.
 * @param {number} args.limit        - Max number of result records to collect (1..200).
 * @param {number} args.timeBudgetMs - Per-call wall-clock budget; loop breaks when exceeded.
 * @returns {Promise<{results: Array, timedOut: boolean, searchedFiles: number}>}
 */
async function search({ query, limit, timeBudgetMs } = {}) {
  // Defensive validation. The dispatcher already validates, but the provider
  // contract says the function MUST NOT throw on bad inputs (returns an empty
  // result set instead). This protects test stubs and any future direct caller.
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return { results: [], timedOut: false, searchedFiles: 0 };
  }
  if (!Number.isFinite(timeBudgetMs) || timeBudgetMs <= 0) {
    return { results: [], timedOut: false, searchedFiles: 0 };
  }
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);

  const searchQuery = query.trim().toLowerCase();
  const startTime = Date.now();
  const files = getSearchableFiles();
  const results = [];
  let searchedFiles = 0;
  let timedOut = false;

  for (const fileInfo of files) {
    if (Date.now() - startTime > timeBudgetMs) { timedOut = true; break; }
    searchedFiles++;

    let content;
    try {
      content = fs.readFileSync(fileInfo.filePath, 'utf-8');
    } catch (_) {
      continue; // Skip files that can't be read
    }

    const lines = content.split('\n');
    let sessionName = null; // Lazy: computed on first match in this file

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      if (Date.now() - startTime > timeBudgetMs) { timedOut = true; break; }
      const line = lines[lineIdx];
      if (!line.trim()) continue;

      let entry;
      try {
        entry = JSON.parse(line);
      } catch (_) {
        continue; // Skip corrupt/binary lines
      }

      const inner = entry.message || entry;
      const role = entry.type || inner.role;
      if (role !== 'user' && role !== 'human' && role !== 'assistant') continue;

      const c = inner.content;
      let text = '';
      if (typeof c === 'string') {
        text = c;
      } else if (Array.isArray(c)) {
        const textBlocks = c.filter((b) => b.type === 'text' && b.text);
        text = textBlocks.map((b) => b.text).join('');
      }
      if (!text) continue;

      const lowerText = text.toLowerCase();
      const matchIndex = lowerText.indexOf(searchQuery);
      if (matchIndex === -1) continue;

      // Only collect up to safeLimit result objects; but keep scanning lines
      // so the caller can know whether truncation occurred. The v1.1 route
      // tracked totalMatches separately; the dispatcher computes that from
      // the merged sum, so we do not bother counting unrecorded matches here.
      if (results.length < safeLimit) {
        if (sessionName === null) {
          try {
            sessionName = extractSessionName(fileInfo.filePath, fileInfo.sessionId);
          } catch (_) {
            sessionName = fileInfo.sessionId;
          }
        }

        // Build ~200 char snippet around the match (radius 100 each side).
        const snippetRadius = 100;
        const snippetStart = Math.max(0, matchIndex - snippetRadius);
        const snippetEnd = Math.min(text.length, matchIndex + searchQuery.length + snippetRadius);
        let snippet = text.substring(snippetStart, snippetEnd)
          .replace(/[\r\n]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (snippetStart > 0) snippet = '...' + snippet;
        if (snippetEnd < text.length) snippet = snippet + '...';

        results.push({
          provider: 'claude', // gsd:provider-literal-allowed (provider tags its own results)
          sessionId: fileInfo.sessionId,
          sessionName,
          projectPath: fileInfo.realPath,
          projectName: fileInfo.projectName,
          timestamp: entry.timestamp || null,
          role: (role === 'human') ? 'user' : role,
          snippet,
          lineNumber: lineIdx + 1, // 1-based to match v1.1 wire format
        });
      }
    }

    if (timedOut) break;
  }

  return { results, timedOut, searchedFiles };
}

module.exports = { search };
