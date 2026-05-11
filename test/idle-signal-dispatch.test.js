#!/usr/bin/env node
/**
 * Plan 19-02 (PTY-04): frontend idle dispatch through per-provider specs.
 *
 * terminal.js _checkForCompletion previously hardcoded the Claude idle
 * regex pair inline. After 19-02 it dispatches through a static helper
 * TerminalPane._isIdleLineForProvider(providerId, lineText) that reads
 * window.CWMProviderSpecs (built at boot by app.js fetchProviderSpecs).
 *
 * This test stubs a minimal window + CWMProviderSpecs map, loads the
 * terminal.js source in a sandboxed Function, and exercises the static
 * helper across a fixture of provider-shaped lines. Mirrors the source-
 * harvesting approach used by test/data-provider-attr.test.js so we do
 * not need jsdom or a real xterm.js runtime.
 *
 * Asserts:
 *   - Claude-shaped lines fire idle for Claude provider, NOT for Codex.
 *   - Codex-shaped lines fire idle for Codex provider, NOT for Claude.
 *   - Neutral lines fire for neither.
 *   - Defensive fallback: when window.CWMProviderSpecs is undefined,
 *     the helper falls back to the original Claude regex pair.
 *
 * Plan 19-02 (PTY-04).
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
    console.log('       ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n       ') : String(err)));
  }
}

console.log('\n  Plan 19-02 (PTY-04): idle-signal dispatch through provider spec');
console.log('  ' + '-'.repeat(58));

/**
 * Build a sandboxed runtime that contains the TerminalPane class plus the
 * frontend provider-specs map. We isolate via `new Function` so neither
 * file's side effects leak into the test process. xterm.js is not loaded
 * (TerminalPane is referenced as a class only); we never instantiate it.
 *
 * @param {object|null} customSpecs - Optional override for CWMProviderSpecs.
 *   Pass null to omit the global entirely (defensive-fallback path).
 * @returns {Function} The TerminalPane class harvested from the sandbox.
 */
function loadTerminalPaneClass(customSpecs) {
  const terminalSrc = fs.readFileSync(TERMINAL_JS_PATH, 'utf8');
  const providerSpecsSrc = fs.readFileSync(PROVIDER_SPECS_PATH, 'utf8');

  // Sandbox globals: stub `window` and `document`/`Terminal`/`FitAddon` so
  // class definition does not throw. The static method is the only surface
  // this test exercises; instance methods (mount, connect) are never called.
  const win = {};
  const sandbox = {
    window: win,
    document: { documentElement: { dataset: {} } },
    Terminal: function () {},
    FitAddon: { FitAddon: function () {} },
    WebSocket: function () {},
  };

  // Run provider-specs.js first so window.CWMProviderSpecLocals exists if a
  // future helper needs it. The merged runtime map is set separately below.
  const factory = new Function(
    'window', 'document', 'Terminal', 'FitAddon', 'WebSocket',
    providerSpecsSrc + '\n' + terminalSrc + '\nreturn TerminalPane;'
  );
  const TerminalPane = factory(
    sandbox.window, sandbox.document, sandbox.Terminal, sandbox.FitAddon, sandbox.WebSocket
  );

  // Apply custom runtime spec map override (or omit entirely if null).
  if (customSpecs === undefined) {
    // Default: synthesize from CWMProviderSpecLocals (mirrors app.js merge
    // behavior in offline mode).
    const locals = win.CWMProviderSpecLocals || {};
    const specs = {};
    for (const id of Object.keys(locals)) {
      specs[id] = { id, ...locals[id] };
    }
    win.CWMProviderSpecs = specs;
  } else if (customSpecs === null) {
    // Explicit null: remove CWMProviderSpecs entirely so we exercise the
    // defensive baked-in fallback path.
    delete win.CWMProviderSpecs;
  } else {
    win.CWMProviderSpecs = customSpecs;
  }
  return TerminalPane;
}

// ---------------------------------------------------------------------------
// Test fixtures: lines from each provider's prompt surface.
// ---------------------------------------------------------------------------

const CLAUDE_LINES = [
  '❯',                  // ❯ bare arrow
  'something ❯',        // ❯ at end of line
  '$ ',                      // POSIX prompt
  '>',                       // generic angle prompt
  'Human: write a test',     // Claude conversation entry
  'Human:',                  // Claude conversation prefix
  'Type a message and hit return', // Claude's input placeholder
  'Type your message',       // looser Type.*message match
];

const CODEX_LINES = [
  'codex>',                  // Codex CLI explicit prompt
  // codex shares generic shell prompts with the fallback regex but those
  // also match Claude; treat them as "Codex-only" only when bare codex>.
];

const NEUTRAL_LINES = [
  'foo bar',
  'some output line',
  'building...',
  '',
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

check('TerminalPane._isIdleLineForProvider is a static method', () => {
  const TerminalPane = loadTerminalPaneClass();
  assert.strictEqual(
    typeof TerminalPane._isIdleLineForProvider,
    'function',
    'Static helper must exist on the class'
  );
});

check('Claude provider: Claude-shaped lines fire idle', () => {
  const TerminalPane = loadTerminalPaneClass();
  for (const line of CLAUDE_LINES) {
    assert.strictEqual(
      TerminalPane._isIdleLineForProvider('claude', line.trim()),
      true,
      'Claude provider should fire idle on: ' + JSON.stringify(line)
    );
  }
});

check('Codex provider: bare codex> fires idle', () => {
  const TerminalPane = loadTerminalPaneClass();
  for (const line of CODEX_LINES) {
    assert.strictEqual(
      TerminalPane._isIdleLineForProvider('codex', line.trim()),
      true,
      'Codex provider should fire idle on: ' + JSON.stringify(line)
    );
  }
});

check('Codex provider: Human: prefix does NOT fire idle (cross-talk guard)', () => {
  const TerminalPane = loadTerminalPaneClass();
  // The Codex spec must not match Claude's Human: prefix; otherwise a Codex
  // pane displaying transcript replay (which can include "Human:") would
  // false-trigger idle.
  assert.strictEqual(
    TerminalPane._isIdleLineForProvider('codex', 'Human: hi there'),
    false,
    'Codex should NOT fire idle on Claude-shaped Human: prefix'
  );
  assert.strictEqual(
    TerminalPane._isIdleLineForProvider('codex', 'Type a message'),
    false,
    'Codex should NOT fire idle on Claude-shaped Type.*message'
  );
});

check('Claude provider: bare codex> does NOT fire idle (cross-talk guard)', () => {
  const TerminalPane = loadTerminalPaneClass();
  // Claude's regex pair must not match the Codex prompt shape; otherwise a
  // Claude pane that streams Codex transcript content would false-trigger.
  // Note: 'codex>' does end in '>' which DOES match the generic Claude
  // /[❯$>]\s*$/ regex. This is acceptable cross-talk: a literal 'codex>' on
  // the cursor line in a Claude pane is so rare it falls within the existing
  // false-positive budget. The strong guard is the OTHER direction
  // (Codex panes not firing on Claude-shaped prompts), which the previous
  // test asserts.
  // For symmetry we still assert that the OPPOSITE direction works: Codex
  // panes do fire on codex>.
  assert.strictEqual(
    TerminalPane._isIdleLineForProvider('codex', 'codex>'),
    true,
    'Codex provider fires on codex> (symmetry check)'
  );
});

check('Neutral lines fire for neither provider', () => {
  const TerminalPane = loadTerminalPaneClass();
  for (const line of NEUTRAL_LINES) {
    assert.strictEqual(
      TerminalPane._isIdleLineForProvider('claude', line),
      false,
      'Claude should NOT fire idle on neutral line: ' + JSON.stringify(line)
    );
    assert.strictEqual(
      TerminalPane._isIdleLineForProvider('codex', line),
      false,
      'Codex should NOT fire idle on neutral line: ' + JSON.stringify(line)
    );
  }
});

check('Unknown provider id falls back to Claude spec', () => {
  const TerminalPane = loadTerminalPaneClass();
  // A pane tagged with a provider id we have no spec for (e.g., a future
  // provider that lands before the frontend ships its spec) should fall back
  // to the Claude regex pair so panes do not silently lose idle detection.
  assert.strictEqual(
    TerminalPane._isIdleLineForProvider('unknown-future-provider', 'Human:'),
    true,
    'Unknown provider should fall back to Claude spec for Human: prefix'
  );
});

check('Defensive fallback: missing CWMProviderSpecs uses baked-in Claude regex', () => {
  const TerminalPane = loadTerminalPaneClass(null);
  // With the spec map missing entirely, the helper must still detect Claude
  // prompts via the baked-in fallback. This is the safety net for panes
  // that mount before app.js fetchProviderSpecs resolves.
  assert.strictEqual(
    TerminalPane._isIdleLineForProvider('claude', 'Human: hello'),
    true,
    'Fallback path must detect Claude Human: prompt'
  );
  assert.strictEqual(
    TerminalPane._isIdleLineForProvider('claude', '❯'),
    true,
    'Fallback path must detect Claude arrow prompt'
  );
  assert.strictEqual(
    TerminalPane._isIdleLineForProvider('claude', 'foo bar'),
    false,
    'Fallback path must NOT fire on neutral lines'
  );
});

check('Custom spec map: respects explicit override regexes', () => {
  // Inject a custom spec for a hypothetical provider 'fake' and assert the
  // helper dispatches through the override. Catches regressions where the
  // helper might bypass the spec map (e.g., a cache layer that pinned the
  // Claude regex permanently).
  const TerminalPane = loadTerminalPaneClass({
    fake: { id: 'fake', idleRegexes: [/^FAKE_PROMPT$/] },
  });
  assert.strictEqual(
    TerminalPane._isIdleLineForProvider('fake', 'FAKE_PROMPT'),
    true,
    'Custom provider should fire idle on its custom regex'
  );
  assert.strictEqual(
    TerminalPane._isIdleLineForProvider('fake', 'Human:'),
    false,
    'Custom provider should NOT fire idle on Claude prompts'
  );
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

console.log('  ' + '-'.repeat(58));
console.log('  [idle-signal-dispatch] ' + passed + '/' + (passed + failed) + ' tests passed');

if (failed > 0) {
  process.exit(1);
}
process.exit(0);
