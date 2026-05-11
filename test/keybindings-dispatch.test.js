#!/usr/bin/env node
/**
 * Plan 19-02 (PTY-05): frontend Shift+Enter dispatch through per-provider
 * specs + backend-frontend keybinding parity gate.
 *
 * terminal.js previously hardcoded '\x1b\r' for Shift+Enter regardless of
 * the active pane's provider. After 19-02 it dispatches through
 * TerminalPane.prototype._getShiftEnterSequence(), which reads
 * window.CWMProviderSpecs[this._providerId].shiftEnter.
 *
 * This test:
 *   A. Stubs CWMProviderSpecs with Claude+Codex and asserts the helper
 *      returns the spec's shiftEnter byte string for each provider id.
 *   B. Stubs CWMProviderSpecs = undefined and asserts the helper returns
 *      the defensive default '\x1b\r' (preserves pre-19-02 Claude behavior).
 *   C. Backend parity: require()s the Claude and Codex providers, calls
 *      getKeyBindings() on each, and asserts agreement with the frontend
 *      provider-specs.js values. This is the drift gate so future regex /
 *      keybinding tweaks on either side fail CI immediately.
 *
 * Plan 19-02 (PTY-05).
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const TERMINAL_JS_PATH = path.join(__dirname, '..', 'src', 'web', 'public', 'terminal.js');
const PROVIDER_SPECS_PATH = path.join(__dirname, '..', 'src', 'web', 'public', 'provider-specs.js');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  \x1b[32mPASS\x1b[0m ' + name);
  } catch (err) {
    failed++;
    console.log('  \x1b[31mFAIL\x1b[0m ' + name);
    console.log('       ' + (err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n       ') : String(err)));
  }
}

console.log('\n  Plan 19-02 (PTY-05): keybindings dispatch + backend parity');
console.log('  ' + '-'.repeat(58));

/**
 * Load TerminalPane in a sandboxed Function context. Mirrors the loader
 * pattern from test/idle-signal-dispatch.test.js. We never instantiate
 * the class; we read the prototype's _getShiftEnterSequence method and
 * call it with a manufactured `this`.
 *
 * @param {object|null|undefined} customSpecs - null to delete the global,
 *   undefined to use the locals-based default, or an object to override.
 * @returns {{ TerminalPane: Function, window: object }} The class and the
 *   sandbox window so the test can assert on side effects.
 */
function loadTerminalPaneClass(customSpecs) {
  const terminalSrc = fs.readFileSync(TERMINAL_JS_PATH, 'utf8');
  const providerSpecsSrc = fs.readFileSync(PROVIDER_SPECS_PATH, 'utf8');

  const win = {};
  const factory = new Function(
    'window', 'document', 'Terminal', 'FitAddon', 'WebSocket',
    providerSpecsSrc + '\n' + terminalSrc + '\nreturn TerminalPane;'
  );
  const TerminalPane = factory(
    win, { documentElement: { dataset: {} } }, function () {}, { FitAddon: function () {} }, function () {}
  );

  if (customSpecs === undefined) {
    const locals = win.CWMProviderSpecLocals || {};
    const specs = {};
    for (const id of Object.keys(locals)) {
      specs[id] = { id, ...locals[id] };
    }
    win.CWMProviderSpecs = specs;
  } else if (customSpecs === null) {
    delete win.CWMProviderSpecs;
  } else {
    win.CWMProviderSpecs = customSpecs;
  }
  return { TerminalPane, window: win };
}

/**
 * Invoke _getShiftEnterSequence with a manufactured `this` context. Avoids
 * instantiating TerminalPane (which would require xterm.js, DOM, etc.).
 *
 * @param {Function} TerminalPane - The class harvested from the sandbox.
 * @param {string} providerId - The provider id to put on the fake this.
 * @returns {string} The byte sequence the helper would send to the PTY.
 */
function callGetShiftEnter(TerminalPane, providerId) {
  const fakeThis = { _providerId: providerId };
  return TerminalPane.prototype._getShiftEnterSequence.call(fakeThis);
}

// ---------------------------------------------------------------------------
// A. Frontend dispatch
// ---------------------------------------------------------------------------

check('Frontend dispatch (default specs): Claude returns ESC+CR', () => {
  const { TerminalPane } = loadTerminalPaneClass();
  assert.strictEqual(
    callGetShiftEnter(TerminalPane, 'claude'),
    '\x1b\r',
    'Claude pane must send ESC+CR (Ink-correct newline-in-input)'
  );
});

check('Frontend dispatch (default specs): Codex returns plain CR', () => {
  const { TerminalPane } = loadTerminalPaneClass();
  assert.strictEqual(
    callGetShiftEnter(TerminalPane, 'codex'),
    '\r',
    'Codex pane must send plain CR (Rust crossterm, no Ink workaround needed)'
  );
});

check('Frontend dispatch: unknown provider falls back to Claude spec', () => {
  const { TerminalPane } = loadTerminalPaneClass();
  assert.strictEqual(
    callGetShiftEnter(TerminalPane, 'unknown-future-provider'),
    '\x1b\r',
    'Unknown provider must fall back to the Claude spec value'
  );
});

// ---------------------------------------------------------------------------
// B. Defensive default when spec map is missing
// ---------------------------------------------------------------------------

check('Defensive default: missing CWMProviderSpecs returns ESC+CR', () => {
  const { TerminalPane } = loadTerminalPaneClass(null);
  assert.strictEqual(
    callGetShiftEnter(TerminalPane, 'claude'),
    '\x1b\r',
    'Missing spec map must preserve the long-standing Claude behavior'
  );
});

check('Defensive default: empty spec map returns ESC+CR', () => {
  const { TerminalPane } = loadTerminalPaneClass({});
  assert.strictEqual(
    callGetShiftEnter(TerminalPane, 'claude'),
    '\x1b\r',
    'Empty spec map must preserve the long-standing Claude behavior'
  );
});

check('Custom spec override: respects explicit shiftEnter value', () => {
  // A hypothetical future provider with a wildly different sequence.
  const { TerminalPane } = loadTerminalPaneClass({
    futureish: { id: 'futureish', shiftEnter: '\n' },
  });
  assert.strictEqual(
    callGetShiftEnter(TerminalPane, 'futureish'),
    '\n',
    'Custom provider must surface its own shiftEnter value'
  );
});

// ---------------------------------------------------------------------------
// C. Backend-frontend parity gate
// ---------------------------------------------------------------------------

check('Parity: Claude provider getKeyBindings() === frontend spec.shiftEnter', () => {
  const claudeProvider = require('../src/providers/claude');
  const bindings = claudeProvider.getKeyBindings();
  assert.ok(bindings && typeof bindings === 'object', 'getKeyBindings must return an object');
  assert.strictEqual(
    bindings.shiftEnter,
    '\x1b\r',
    'Backend Claude.getKeyBindings().shiftEnter MUST be \\x1b\\r (Ink-correct)'
  );

  // Now load the frontend specs and assert agreement.
  const { window: win } = loadTerminalPaneClass();
  const claudeFrontend = win.CWMProviderSpecLocals && win.CWMProviderSpecLocals.claude;
  assert.ok(claudeFrontend, 'provider-specs.js must define a Claude entry');
  assert.strictEqual(
    claudeFrontend.shiftEnter,
    bindings.shiftEnter,
    'Frontend Claude spec.shiftEnter must equal backend getKeyBindings().shiftEnter'
  );
});

check('Parity: Codex provider getKeyBindings() === frontend spec.shiftEnter', () => {
  const codexProvider = require('../src/providers/codex');
  const bindings = codexProvider.getKeyBindings();
  assert.ok(bindings && typeof bindings === 'object', 'getKeyBindings must return an object');
  assert.strictEqual(
    bindings.shiftEnter,
    '\r',
    'Backend Codex.getKeyBindings().shiftEnter MUST be plain CR'
  );

  const { window: win } = loadTerminalPaneClass();
  const codexFrontend = win.CWMProviderSpecLocals && win.CWMProviderSpecLocals.codex;
  assert.ok(codexFrontend, 'provider-specs.js must define a Codex entry');
  assert.strictEqual(
    codexFrontend.shiftEnter,
    bindings.shiftEnter,
    'Frontend Codex spec.shiftEnter must equal backend getKeyBindings().shiftEnter'
  );
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

console.log('  ' + '-'.repeat(58));
console.log('  [keybindings-dispatch] ' + passed + '/' + (passed + failed) + ' tests passed');

if (failed > 0) {
  process.exit(1);
}
process.exit(0);
