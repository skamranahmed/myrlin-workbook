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

      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (_) {
        // Corrupt or partial line; skip silently.
        continue;
      }

      // Detect pre-wrap bare-JSON for the once-per-file warning. We check
      // BEFORE wrapEnvelope so we know whether the line was natively
      // enveloped or had to be synthesized.
      const wasBareJson =
        parsed &&
        typeof parsed === 'object' &&
        !(typeof parsed.type === 'string' && parsed.payload && typeof parsed.payload === 'object');

      const envelope = wrapEnvelope(parsed);
      if (!envelope) continue;

      if (wasBareJson && !bareJsonWarned) {
        // eslint-disable-next-line no-console
        console.warn(
          '[codex-parse] bare-JSON line detected in ' +
            filePath +
            '; assuming pre-0.45 format'
        );
        bareJsonWarned = true;
      }

      const ts = typeof envelope.timestamp === 'string' ? envelope.timestamp : null;

      switch (envelope.type) {
        case 'session_meta':
        case 'turn_context':
          // Metadata; not a turn. Skip.
          continue;

        case 'event_msg':
          // De-dup: response_item.message lines carry the same content with
          // a richer shape, so we always prefer those and skip ALL event_msg
          // subtypes (user_message, agent_message, task_started, etc.).
          continue;

        case 'response_item': {
          const payload = envelope.payload;
          if (!payload || typeof payload !== 'object') continue;
          switch (payload.type) {
            case 'message': {
              const text = extractMessageText(payload.content);
              messages.push({
                role: normalizeRole(payload.role),
                text: text,
                timestamp: ts,
                model: null,
              });
              break;
            }
            case 'function_call': {
              const name = typeof payload.name === 'string' ? payload.name : '';
              const args = typeof payload.arguments === 'string' ? payload.arguments : '';
              messages.push({
                role: 'tool',
                text: (name + ' ' + args).trim(),
                timestamp: ts,
                model: null,
              });
              break;
            }
            case 'function_call_output': {
              const out = typeof payload.output === 'string' ? payload.output : '';
              messages.push({
                role: 'tool',
                text: out,
                timestamp: ts,
                model: null,
              });
              break;
            }
            case 'reasoning':
              // Encrypted blob; not user-readable. Skip.
              continue;
            default:
              // Unknown response_item subtype; defensive skip.
              continue;
          }
          break;
        }

        case 'compacted':
          messages.push({
            role: 'system',
            text: COMPACTED_PLACEHOLDER,
            timestamp: ts,
            model: null,
          });
          break;

        default:
          // Unknown envelope type; defensive skip. The schema fixture test
          // (test/codex-schema.test.js) catches drift between the parser
          // and the canonical schema before unknown variants land here.
          continue;
      }
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
