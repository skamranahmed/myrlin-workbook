/**
 * Codex transcript parser.
 *
 * Phase 17 Plan 17-01 (CDX-03, CDX-04, CDX-05 parser-half, CDX-08).
 *
 * Reads a Codex rollout file at $CODEX_HOME/sessions/YYYY/MM/DD/rollout-*-<id>.jsonl
 * and normalizes each line into ProviderMessage[] for the Provider contract
 * established in Plan 14-03.
 *
 * Every Codex line is one of two shapes:
 *
 *   Modern (>= 0.45): {type, timestamp, payload}
 *     - type=session_meta: file header (skipped from output)
 *     - type=turn_context: per-turn config snapshot (skipped)
 *     - type=event_msg: lifecycle event (skipped; user_message/agent_message
 *       are de-duplicated against response_item.message)
 *     - type=response_item: the meat (message, function_call, function_call_output,
 *       reasoning); reasoning is skipped, the rest emit a ProviderMessage
 *     - type=compacted: auto-compacted older turns; emits ONE
 *       ProviderMessage{role:'system', text:'[history fold]'}
 *
 *   Legacy (pre-0.45): bare-JSON top-level shapes (no type+payload envelope)
 *     - bare SessionMeta: top-level id+cwd+cli_version
 *     - bare ResponseItem: top-level role+content
 *
 * Per-line bare-JSON detection (NOT per-file) handles the case where a
 * pre-0.45 session was resumed under 0.45+ and has mixed shapes on disk.
 *
 * The function NEVER throws on malformed JSONL: bad lines are skipped
 * silently, file IO errors return [], and the whole body is wrapped in
 * try/catch as a final defensive guard. This matches the contract that
 * claudeProvider.parseTranscript already obeys.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * @module src/providers/codex/parse
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// Module-private constants
// ---------------------------------------------------------------------------

/**
 * Placeholder text emitted for every `compacted` envelope. Phase 18 renders
 * this with a distinct visual treatment; the parser only ships the right shape.
 * Contract-frozen as the literal '[history fold]' (lowercase, single space).
 */
const COMPACTED_PLACEHOLDER = '[history fold]';

/**
 * The five envelope `type` values observed on disk on Codex >= 0.45. The
 * schema fixture (test/fixtures/codex-rollout-schema.json) enumerates the
 * same set; test/codex-schema.test.js asserts they match (drift gate).
 */
const KNOWN_ENVELOPE_TYPES = [
  'session_meta',
  'turn_context',
  'event_msg',
  'response_item',
  'compacted',
];

/**
 * Maximum characters of text carried by one MirrorMessage (issue #10 Tier 1).
 * Applied by parseLine when called with default options (the mirror path);
 * parseTranscript opts out via {maxTextChars: Infinity} so the whole-file
 * transcript view keeps its historical uncapped behavior.
 */
const MIRROR_MAX_TEXT_CHARS = 8192;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a parsed JSONL line into a canonical envelope, detecting pre-0.45
 * bare-JSON shapes and synthesizing the matching envelope.
 *
 * Decision tree:
 *   1. parsed has both .type (string) and .payload (object) -> already an
 *      envelope; return as-is.
 *   2. parsed has top-level .id + .cwd + .cli_version -> bare SessionMeta;
 *      wrap in synthetic session_meta envelope.
 *   3. parsed has top-level .role + .content (array) -> bare ResponseItem;
 *      wrap in synthetic response_item.message envelope.
 *   4. otherwise -> return null (caller skips).
 *
 * Per-line classification is intentional: a 0.45-upgraded session may mix
 * bare and enveloped lines, and per-file detection would mis-route the
 * minority shape.
 *
 * @param {any} parsed - Result of JSON.parse on a single JSONL line.
 * @returns {{type:string, timestamp:string|null, payload:object}|null}
 */
function wrapEnvelope(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;

  // Case 1: modern envelope.
  if (typeof parsed.type === 'string' && parsed.payload && typeof parsed.payload === 'object') {
    return parsed;
  }

  // Case 2: bare SessionMeta (pre-0.45 first line).
  if (
    typeof parsed.id === 'string' &&
    typeof parsed.cwd === 'string' &&
    typeof parsed.cli_version === 'string'
  ) {
    return {
      type: 'session_meta',
      timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : null,
      payload: parsed,
    };
  }

  // Case 3: bare ResponseItem (pre-0.45 message line).
  if (typeof parsed.role === 'string' && Array.isArray(parsed.content)) {
    return {
      type: 'response_item',
      timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : null,
      // Synthesize the response_item.message shape downstream code expects.
      payload: { type: 'message', role: parsed.role, content: parsed.content },
    };
  }

  // Unknown shape; let caller skip silently.
  return null;
}

/**
 * Extract the joined text from a response_item.message content array.
 * Codex content parts have type in {input_text, output_text}; other parts
 * (image, tool result, etc.) are filtered out. Mirrors how
 * claude/parse.js#parseTranscript handles its content array.
 *
 * @param {Array} content - response_item.message.content array.
 * @returns {string} Joined text, possibly empty when no input/output parts exist.
 */
function extractMessageText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (c) =>
        c &&
        typeof c === 'object' &&
        (c.type === 'input_text' || c.type === 'output_text') &&
        typeof c.text === 'string'
    )
    .map((c) => c.text)
    .join('');
}

/**
 * Map a Codex message role to the ProviderMessage role enum. Codex's
 * 'developer' role is the moral equivalent of Claude's 'system'; user and
 * assistant pass through unchanged. Anything unexpected falls through to
 * 'system' as a defensive default (so we never drop content silently).
 *
 * @param {string} role
 * @returns {'user'|'assistant'|'system'|'tool'}
 */
function normalizeRole(role) {
  if (role === 'user') return 'user';
  if (role === 'assistant') return 'assistant';
  // Codex 'developer' messages carry permission instructions; treat as system.
  return 'system';
}

/**
 * Resolve a Codex providerSessionId to its on-disk rollout file path.
 *
 * Walks $CODEX_HOME/sessions/YYYY/MM/DD/ for a file whose name ends with
 * '-<id>.jsonl'. Reads process.env.CODEX_HOME at call time (NOT module
 * load) so a user can change the env between calls; falls back to ~/.codex
 * when unset.
 *
 * Returns null on any IO error or when no matching file exists.
 *
 * @param {string} providerSessionId - Codex session UUID.
 * @returns {string|null} Absolute path to the rollout file, or null.
 */
function resolveRolloutPath(providerSessionId) {
  if (!providerSessionId || typeof providerSessionId !== 'string') return null;

  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'); // gsd:provider-literal-allowed
  const sessionsRoot = path.join(codexHome, 'sessions');
  if (!fs.existsSync(sessionsRoot)) return null;

  // The id-suffixed pattern: rollout-<...>-<id>.jsonl.
  const idLower = providerSessionId.toLowerCase();
  const suffix = '-' + idLower + '.jsonl';

  // Walk YYYY/MM/DD/ tree. Recursive readdir is faster than three nested
  // loops and matches the discover.js walk-fallback strategy.
  let entries;
  try {
    entries = fs.readdirSync(sessionsRoot, { recursive: true, withFileTypes: true });
  } catch (_) {
    // Older Node fallback: manual three-level walk.
    return resolveRolloutPathManual(sessionsRoot, suffix);
  }

  for (const e of entries) {
    if (!e.isFile()) continue;
    const name = e.name.toLowerCase();
    if (name.startsWith('rollout-') && name.endsWith(suffix)) {
      // Node 20+ Dirent under recursive readdir exposes parentPath; older
      // Node 18 exposes path. Fall back to sessionsRoot if neither is
      // available (which would only happen on a very stripped-down runtime).
      const parent = e.parentPath || e.path || sessionsRoot;
      return path.join(parent, e.name);
    }
  }
  return null;
}

/**
 * Manual three-level YYYY/MM/DD walk used when fs.readdirSync(...,{recursive})
 * is unavailable. Defensive fallback only; primary path uses the recursive
 * Node API.
 *
 * @param {string} sessionsRoot
 * @param {string} suffix - lowercased '-<id>.jsonl' suffix to match.
 * @returns {string|null}
 */
function resolveRolloutPathManual(sessionsRoot, suffix) {
  let years;
  try {
    years = fs.readdirSync(sessionsRoot, { withFileTypes: true });
  } catch (_) {
    return null;
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
          if (lower.startsWith('rollout-') && lower.endsWith(suffix)) {
            return path.join(dayDir, f);
          }
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public: parseLine (issue #10 Tier 1, provider mirror capability)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} MirrorMessage
 * @property {'user'|'assistant'|'system'|'tool'} role  Who the entry belongs to.
 * @property {string} text                              Display text (capped on the mirror path).
 * @property {string|null} timestamp                    ISO timestamp when present on the line.
 * @property {string|null} model                        Always null for Codex (rollouts do not record per-message models).
 * @property {'text'|'tool_use'|'tool_result'|'system'} [kind]  Fine-grained rendering hint.
 * @property {string} [toolName]                        Function name, present when kind === 'tool_use'.
 * @property {boolean} [truncated]                      True when text was capped (only set when true).
 */

/**
 * Apply the mirror text cap. Central choke point shared by every parseLine
 * emit path so capping semantics stay identical across message kinds.
 *
 * @param {string} text - Uncapped text (may be empty).
 * @param {number} maxChars - Cap in characters; Infinity disables capping.
 * @returns {{text: string, truncated: boolean}}
 */
function capMirrorText(text, maxChars) {
  const raw = typeof text === 'string' ? text : '';
  if (maxChars !== Infinity && raw.length > maxChars) {
    return { text: raw.slice(0, maxChars), truncated: true };
  }
  return { text: raw, truncated: false };
}

/**
 * Assemble a MirrorMessage from its parts, setting the optional fields only
 * when meaningful (toolName when present, truncated only when true).
 *
 * @param {'user'|'assistant'|'system'|'tool'} role
 * @param {'text'|'tool_use'|'tool_result'|'system'} kind
 * @param {string} text - Uncapped text.
 * @param {string|null} timestamp
 * @param {string|null} toolName - Only for kind 'tool_use'.
 * @param {number} maxChars - Text cap (Infinity disables).
 * @returns {MirrorMessage}
 */
function buildMirrorMessage(role, kind, text, timestamp, toolName, maxChars) {
  const capped = capMirrorText(text, maxChars);
  const msg = {
    role: role,
    text: capped.text,
    timestamp: timestamp,
    model: null,
    kind: kind,
  };
  if (toolName) msg.toolName = toolName;
  if (capped.truncated) msg.truncated = true;
  return msg;
}

/**
 * Parse ONE raw Codex rollout JSONL line into a MirrorMessage.
 *
 * Extraction of the per-line switch that previously lived inline in
 * parseTranscript's loop (wrapEnvelope + the envelope switch); parseTranscript
 * now delegates here per line so the two views can never drift. The emit set
 * is UNCHANGED from the historical loop:
 *
 *   response_item.message              -> {role: normalizeRole(role), kind:'text'}
 *   response_item.function_call        -> {role:'tool', kind:'tool_use', toolName,
 *                                          text:'<name> <arguments>'}
 *   response_item.function_call_output -> {role:'tool', kind:'tool_result', text:<output>}
 *   compacted                          -> {role:'system', kind:'system', text:'[history fold]'}
 *
 * Skip set (returns null): session_meta, turn_context, event_msg (all
 * subtypes), response_item.reasoning, unknown shapes, corrupt JSON, and the
 * tailer's oversized-line sentinel (NUL-framed, never valid JSON).
 *
 * Pure, synchronous, never throws.
 *
 * @param {string} line - One raw JSONL line (no trailing newline).
 * @param {Object} [opts]
 * @param {number} [opts.maxTextChars=MIRROR_MAX_TEXT_CHARS] - Text cap per
 *   message; pass Infinity to disable (parseTranscript does, to preserve its
 *   historical uncapped output).
 * @param {Object} [opts.meta] - Optional out-param. When the line was a
 *   pre-0.45 bare-JSON shape that wrapped successfully, parseLine sets
 *   meta.bareJson = true so parseTranscript can keep its once-per-file
 *   warning without re-parsing the line.
 * @returns {MirrorMessage|null}
 */
function parseLine(line, opts) {
  try {
    if (typeof line !== 'string' || line.length === 0) return null;
    const options = opts && typeof opts === 'object' ? opts : {};
    const meta = options.meta && typeof options.meta === 'object' ? options.meta : null;
    let maxChars = MIRROR_MAX_TEXT_CHARS;
    if (options.maxTextChars === Infinity) {
      maxChars = Infinity;
    } else if (Number.isFinite(options.maxTextChars) && options.maxTextChars > 0) {
      maxChars = Math.floor(options.maxTextChars);
    }

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (_) {
      return null; // Corrupt or partial line.
    }

    // Bare-JSON detection mirrors the historical inline check EXACTLY: it is
    // computed pre-wrap, but only surfaced when the envelope wraps (the old
    // loop `continue`d on a null envelope before warning).
    const wasBareJson =
      parsed &&
      typeof parsed === 'object' &&
      !(typeof parsed.type === 'string' && parsed.payload && typeof parsed.payload === 'object');

    const envelope = wrapEnvelope(parsed);
    if (!envelope) return null;

    if (wasBareJson && meta) meta.bareJson = true;

    const ts = typeof envelope.timestamp === 'string' ? envelope.timestamp : null;

    switch (envelope.type) {
      case 'session_meta':
      case 'turn_context':
        // Metadata; not a turn. Skip.
        return null;

      case 'event_msg':
        // De-dup: response_item.message lines carry the same content with a
        // richer shape, so ALL event_msg subtypes are skipped.
        return null;

      case 'response_item': {
        const payload = envelope.payload;
        if (!payload || typeof payload !== 'object') return null;
        switch (payload.type) {
          case 'message':
            return buildMirrorMessage(
              normalizeRole(payload.role),
              'text',
              extractMessageText(payload.content),
              ts,
              null,
              maxChars
            );
          case 'function_call': {
            const name = typeof payload.name === 'string' ? payload.name : '';
            const args = typeof payload.arguments === 'string' ? payload.arguments : '';
            return buildMirrorMessage(
              'tool',
              'tool_use',
              (name + ' ' + args).trim(),
              ts,
              name.length > 0 ? name : null,
              maxChars
            );
          }
          case 'function_call_output': {
            const out = typeof payload.output === 'string' ? payload.output : '';
            return buildMirrorMessage('tool', 'tool_result', out, ts, null, maxChars);
          }
          case 'reasoning':
            // Encrypted blob; not user-readable. Skip.
            return null;
          default:
            // Unknown response_item subtype; defensive skip.
            return null;
        }
      }

      case 'compacted':
        return buildMirrorMessage('system', 'system', COMPACTED_PLACEHOLDER, ts, null, maxChars);

      default:
        // Unknown envelope type; defensive skip (schema drift gate catches
        // new variants before they land here).
        return null;
    }
  } catch (_) {
    return null; // Never throws, by contract.
  }
}

// ---------------------------------------------------------------------------
// Public: parseTranscript
// ---------------------------------------------------------------------------

/**
 * Load and normalize a Codex transcript by providerSessionId.
 * Returns ProviderMessage[]: [{role, text, timestamp, model}].
 * Returns [] for missing/empty/malformed input. NEVER throws.
 *
 * Skip set:
 *   - session_meta (file header, not a turn)
 *   - turn_context (per-turn config metadata)
 *   - event_msg (ALL subtypes; user_message/agent_message are duplicated
 *     by sibling response_item.message lines, and lifecycle events like
 *     task_started/task_complete/token_count carry no transcript content)
 *   - response_item.reasoning (encrypted blob, not user-readable)
 *
 * Emit set:
 *   - response_item.message (developer -> system, user -> user,
 *     assistant -> assistant)
 *   - response_item.function_call (role:'tool', text='<name> <arguments>')
 *   - response_item.function_call_output (role:'tool', text=<output>)
 *   - compacted (one '[history fold]' placeholder per envelope)
 *
 * De-duplication note: Codex frequently writes BOTH an event_msg and a
 * response_item for the same user/assistant turn. The parser ALWAYS prefers
 * response_item (richer structure) and ALWAYS skips the event_msg version.
 * This is the safe default; if a future Codex version writes ONLY event_msg
 * for a turn, the parser drops it, which is the same failure mode as not
 * recognizing an unknown variant.
 *
 * @param {string} providerSessionId - Codex session UUID.
 * @returns {Promise<Array<{role:string,text:string,timestamp:string|null,model:string|null}>>}
 */
async function parseTranscript(providerSessionId) {
  try {
    if (!providerSessionId || typeof providerSessionId !== 'string') return [];

    const filePath = resolveRolloutPath(providerSessionId);
    if (!filePath) return [];

    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch (_) {
      return [];
    }

    const lines = raw.split('\n');
    const messages = [];
    let bareJsonWarned = false;

    for (const line of lines) {
      if (!line || line.length === 0) continue;

      // Issue #10 Tier 1: the per-line normalization (JSON.parse +
      // wrapEnvelope + envelope switch) now lives in parseLine so the live
      // mirror and this whole-file view can never drift. Behavior is
      // preserved exactly:
      //   - maxTextChars: Infinity keeps the historical uncapped text.
      //   - meta.bareJson carries the pre-0.45 detection out of parseLine
      //     so the once-per-file warning (with filePath, which parseLine
      //     does not know) still fires on the same lines it always did.
      //   - The projection below strips the mirror-only fields (kind,
      //     toolName, truncated) so the returned ProviderMessage shape is
      //     byte-identical to what this function always returned.
      const meta = {};
      const mirrorMsg = parseLine(line, { maxTextChars: Infinity, meta: meta });

      if (meta.bareJson && !bareJsonWarned) {
        // eslint-disable-next-line no-console
        console.warn(
          '[codex-parse] bare-JSON line detected in ' +
            filePath +
            '; assuming pre-0.45 format'
        );
        bareJsonWarned = true;
      }

      if (!mirrorMsg) continue;

      messages.push({
        role: mirrorMsg.role,
        text: mirrorMsg.text,
        timestamp: mirrorMsg.timestamp,
        model: mirrorMsg.model,
      });
    }

    return messages;
  } catch (_) {
    // Catastrophic guard: never throw.
    return [];
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  parseTranscript,
  // Issue #10 Tier 1: per-line mirror parser. Exported both for the provider
  // mirror capability (src/providers/codex/index.js re-exports it under
  // provider.mirror.parseLine) and for direct tests. Called with default
  // options it caps text at MIRROR_MAX_TEXT_CHARS; parseTranscript calls it
  // with {maxTextChars: Infinity} to preserve its historical output.
  parseLine,
  MIRROR_MAX_TEXT_CHARS,
  // Exported for test introspection. test/codex-schema.test.js asserts the
  // KNOWN_ENVELOPE_TYPES list matches the schema fixture's enum (drift gate).
  // discover.js consumes wrapEnvelope to handle bare-JSON first lines when
  // reading session_meta off disk.
  _internal: {
    wrapEnvelope: wrapEnvelope,
    extractMessageText: extractMessageText,
    normalizeRole: normalizeRole,
    resolveRolloutPath: resolveRolloutPath,
    COMPACTED_PLACEHOLDER: COMPACTED_PLACEHOLDER,
    KNOWN_ENVELOPE_TYPES: KNOWN_ENVELOPE_TYPES,
  },
};
