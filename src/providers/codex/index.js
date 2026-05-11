/**
 * ChatGPT Codex Provider object.
 *
 * Implements the Provider contract defined in src/providers/index.js
 * (and mirrored in docs/PROVIDER-INTERFACE.md). Aggregates the four
 * single-purpose modules (discover, parse, spawn, search) into a single
 * object the registry can register and downstream code can call.
 *
 * Phase 17 Plan 17-02 (CDX-05/06/07/10 wiring half). The discover and
 * parseTranscript implementations were shipped by Plan 17-01; spawn and
 * search are shipped by this plan. This file is the bind-it-all-together
 * step that makes register(codexProvider) work in src/providers/index.js.
 *
 * Capability flags:
 *   - supportsCost: false. Codex cost tracking is deferred to v1.3
 *     (CROSS-COST-01). No token usage shape is locked in yet; returning
 *     false prevents misleading $0 stubs from showing up in /api/cost.
 *   - isIdleSignal: defensive default until Phase 19 (Codex Live PTY)
 *     refines against real terminal output. The default detects both an
 *     explicit `codex>` prompt and the generic shell prompt shape Claude
 *     also uses (`[❯$>]\s*$`). False positives are acceptable here
 *     because the frontend idle detection only treats this as a hint;
 *     mis-classifying a non-idle line as idle just triggers an early
 *     check that proves the session is still active.
 *   - getKeyBindings: returns Claude's defaults ({shiftEnter:'\r'}).
 *     Phase 19 may diverge if Codex CLI handles Shift+Enter differently.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * @module src/providers/codex
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const discover = require('./discover');
const { parseTranscript } = require('./parse');
const { spawnCommand } = require('./spawn');
const { search } = require('./search');

// ---------------------------------------------------------------------------
// Idle signal detection
// ---------------------------------------------------------------------------

/**
 * Match an explicit `codex>` prompt. The trailing optional whitespace
 * tolerates terminal output that may pad the prompt with trailing spaces.
 * The literal `codex` is the Codex CLI prompt; this file is inside
 * src/providers/codex/ so the grep gate (Plan 14-05) ignores the literal,
 * but we mark it for future readers.
 */
const CODEX_PROMPT_RE = /^codex>\s*$/; // gsd:provider-literal-allowed

/**
 * Match a generic shell prompt shape. Mirrors the predicate Claude uses for
 * fallback idle detection. Covers POSIX `$` prompts, modern arrow `❯`
 * (oh-my-zsh, starship, etc.), and explicit `>` prompts that appear in
 * various REPLs.
 */
const GENERIC_PROMPT_RE = /[❯$>]\s*$/;

/**
 * Detect whether a line of terminal output looks like a Codex idle prompt.
 * Phase 19 will refine this regex against real Codex terminal output once
 * the live PTY pipeline is wired up; until then, the defensive default is
 * "any prompt-shaped line ending the buffer".
 *
 * @param {string} line - A single line of terminal text (caller may trim).
 * @returns {boolean} True when the line looks like a Codex idle prompt.
 */
function isIdleSignal(line) {
  if (line == null) return false;
  const text = String(line).trim();
  if (text.length === 0) return false;
  return CODEX_PROMPT_RE.test(text) || GENERIC_PROMPT_RE.test(text);
}

// ---------------------------------------------------------------------------
// Key bindings
// ---------------------------------------------------------------------------

/**
 * Per-provider key bindings. Codex behaves like Claude for Shift+Enter
 * (literal newline so multi-line prompts can be composed). Phase 19 may
 * diverge once we observe real Codex CLI key handling.
 *
 * @returns {{shiftEnter:string}}
 */
function getKeyBindings() {
  return { shiftEnter: '\r' };
}

// ---------------------------------------------------------------------------
// Capability flags
// ---------------------------------------------------------------------------

/**
 * supportsCost capability flag. Codex returns false in v1.2 because no
 * token usage shape is locked in yet (the cost worker would emit
 * misleading $0 entries). Cost tracking is deferred to v1.3 (CROSS-COST-01).
 *
 * @returns {boolean}
 */
function supportsCost() {
  return false;
}

// ---------------------------------------------------------------------------
// Lifecycle hooks (no-ops in Phase 17)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Filesystem watcher (Plan 22-03)
// ---------------------------------------------------------------------------

let _watcher = null;
let _pollTimer = null;
let _debounceTimer = null;
let _onChange = null;
const DEBOUNCE_MS = 500;
const POLL_MS = 5 * 60 * 1000; // 5 minutes
const ROLLOUT_RE = /rollout-[a-f0-9-]+\.jsonl$/i;

/**
 * Resolve the Codex sessions directory from process.env at call time.
 * Mirrors the resolution discover.js does so the watcher and discover
 * always agree on what to watch / scan.
 *
 * @returns {string}
 */
function _sessionsDir() {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return path.join(codexHome, 'sessions');
}

/**
 * Fire the registered onChange callback inside a try/catch so a thrower
 * does not crash the watcher.
 */
function _fire() {
  if (typeof _onChange !== 'function') return;
  try { _onChange(); }
  catch (err) { console.warn('[codex/watch] onChange threw: ' + err.message); }
}

/**
 * Start the rollout-file watcher + the 5-minute fallback poll. Idempotent:
 * a second call replaces the registered onChange but does not double-start
 * the watch handle. Exposed via init(onChange) for normal use and via
 * _startWatcherForTesting for unit tests.
 *
 * fs.watch on Windows is well-known to miss events on some filesystem
 * operations (atomic renames, network drives, paused notify queues). The
 * fallback poll catches anything the watch misses. Together they give
 * a "new Codex session shows up in the sidebar within ~1s" UX.
 *
 * @param {() => void} onChange - Callback fired after debounce / on poll.
 */
function _startWatcher(onChange) {
  _onChange = onChange;
  const sessionsDir = _sessionsDir();
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  if (_watcher) { try { _watcher.close(); } catch (_) {} _watcher = null; }
  if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
  if (!fs.existsSync(sessionsDir)) {
    console.warn('[codex/watch] sessions dir missing: ' + sessionsDir + ' (poll fallback active)');
  } else {
    try {
      _watcher = fs.watch(sessionsDir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        if (!ROLLOUT_RE.test(String(filename))) return;
        if (_debounceTimer) clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(_fire, DEBOUNCE_MS);
      });
      _watcher.on('error', (err) => {
        console.warn('[codex/watch] watcher error: ' + err.message + ' (poll fallback active)');
      });
    } catch (err) {
      console.warn('[codex/watch] could not start watcher: ' + err.message);
    }
  }
  _pollTimer = setInterval(_fire, POLL_MS);
}

/**
 * Stop the watcher + fallback poll. Idempotent.
 */
function _stopWatcher() {
  if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  if (_watcher) { try { _watcher.close(); } catch (_) {} _watcher = null; }
  _onChange = null;
}

/**
 * Provider lifecycle hook. Plan 22-03: optionally starts the watcher when
 * the registry passes an onChange callback. Plan 14 callers that pass no
 * arg still get the no-op behavior.
 *
 * @param {{onChange?: () => void}} [opts]
 * @returns {Promise<void>}
 */
async function init(opts) {
  if (opts && typeof opts.onChange === 'function') {
    _startWatcher(opts.onChange);
  }
}

/**
 * Provider lifecycle hook. Closes the watcher + fallback poll if active.
 *
 * @returns {Promise<void>}
 */
async function dispose() {
  _stopWatcher();
}

// ---------------------------------------------------------------------------
// Provider object (the public contract)
// ---------------------------------------------------------------------------

module.exports = {
  id: 'codex',                      // gsd:provider-literal-allowed
  displayName: 'ChatGPT Codex',
  // Catppuccin green token. Architecture Section 7 reserved this slot for
  // Codex so the sidebar accent and tab strip stay distinct from Claude's
  // mauve. Phase 18 will wire the actual CSS variables.
  accentToken: 'green',
  cliBinary: 'codex',               // gsd:provider-literal-allowed
  discover: discover,
  parseTranscript: parseTranscript,
  spawnCommand: spawnCommand,
  search: search,
  init: init,
  dispose: dispose,
  supportsCost: supportsCost,
  isIdleSignal: isIdleSignal,
  getKeyBindings: getKeyBindings,
  // Test-only: lets the watcher test set its own onChange without
  // going through the registry. Production code must use init().
  _startWatcherForTesting: _startWatcher,
  _stopWatcherForTesting: _stopWatcher,
};
