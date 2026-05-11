/**
 * Frontend mirror of per-provider runtime behavior for terminal panes.
 *
 * Idle regexes and key bindings live here because they operate on the
 * xterm.js buffer (a frontend-only concern). The backend's isIdleSignal
 * and getKeyBindings are the source of truth; this file MUST stay in
 * parity with src/providers/<id>/index.js. CI test
 * test/idle-signal-parity.test.js enforces agreement across a fixture
 * set of lines, so any future regex tweak on either side that breaks
 * agreement will fail the build.
 *
 * Architecture:
 *   - CWMProviderSpecLocals carries the frontend-only data (regex arrays,
 *     escape sequences). It is set as a global on window so terminal.js
 *     and app.js can read it without a module-resolution dance (the rest
 *     of the public/ frontend is vanilla, no bundler).
 *   - app.js fetchProviderSpecs() then fetches /api/providers and merges
 *     server-side metadata (cliBinary, displayName, accentToken) onto
 *     each local spec, building CWMProviderSpecs (the runtime map).
 *   - terminal.js reads CWMProviderSpecs[providerId] at mount time to
 *     dispatch idle detection and Shift+Enter through the active pane's
 *     provider.
 *
 * Drift protection:
 *   - test/idle-signal-parity.test.js runs backend's isIdleSignal vs the
 *     regex arrays below across a fixture and fails on any disagreement.
 *   - test/keybindings-dispatch.test.js does the equivalent for the
 *     shiftEnter values.
 *   - test/grep-gate.test.js walks src/ for bare provider-name literals
 *     outside src/providers/; the per-line markers below are the exemption
 *     that lets this frontend-mirror file live in src/web/public/. See
 *     test/grep-gate.test.js for the marker syntax.
 *
 * Plan 19-02 (PTY-04, PTY-05, PTY-06).
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

'use strict';

// Provider id literals below are the frontend mirror of the backend
// registry. Agents that maintain this file must also update
// src/providers/<id>/index.js to keep the parity test green.
window.CWMProviderSpecLocals = {
  claude: { // gsd:provider-literal-allowed (frontend mirror of backend registry)
    // Mirror of src/providers/claude/index.js isIdleSignal predicate:
    //   /[❯$>]\s*$/.test(text) || /^(Human:|Type.*message)/.test(text)
    // Two regexes are tested in OR; matches the inline literal that lived
    // at terminal.js:1213 before Plan 19-02.
    idleRegexes: [/[❯$>]\s*$/, /^(Human:|Type.*message)/],
    // Ink-correct ESC+CR for Shift+Enter. Plain \r submits the Claude Code
    // prompt (Ink treats \r and \n as submit); ESC+CR is the documented
    // "newline in input" sequence. Reconciles src/providers/claude/index.js
    // getKeyBindings() which previously returned '\r' (incorrect for Ink).
    shiftEnter: '\x1b\r',
  },
  codex: { // gsd:provider-literal-allowed (frontend mirror of backend registry)
    // Mirror of src/providers/codex/index.js isIdleSignal predicate:
    //   /^codex>\s*$/.test(text) || /[❯$>]\s*$/.test(text)
    // The explicit codex prompt takes precedence; the generic shell prompt
    // catches the default case where the Codex CLI has not yet rendered
    // its branded prompt (cold start, error recovery).
    idleRegexes: [/^codex>\s*$/, /[❯$>]\s*$/],
    // Plain CR for now; Codex CLI is Rust-based (crossterm) and does not
    // need the Ink ESC+CR workaround. Phase 19 manual smoke will confirm
    // and Phase 20 may diverge if real testing reveals otherwise.
    shiftEnter: '\r',
  },
};
