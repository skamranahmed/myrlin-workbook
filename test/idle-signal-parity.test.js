#!/usr/bin/env node
/**
 * Plan 19-02 (PTY-04 drift prevention): backend-frontend idle signal parity.
 *
 * Two regex sources of truth exist for "is this terminal line an idle
 * prompt":
 *
 *   1. Backend: src/providers/<id>/index.js isIdleSignal(line).
 *      The Phase 14 / 17 provider contract; used by future server-side
 *      idle hooks and as the canonical authority for the system.
 *
 *   2. Frontend: src/web/public/provider-specs.js idleRegexes array.
 *      Used by terminal.js _checkForCompletion to fire the in-pane idle
 *      dot without a WS round-trip.
 *
 * Both surfaces must agree on every input line. Without this gate, a
 * future regex refinement on one side (e.g., narrowing Codex's prompt
 * pattern after observing real terminal output) silently drifts the
 * other, leading to false positives or missed completions. Phase 19's
 * Pitfall 19-C calls this out explicitly.
 *
 * This test:
 *   - require()s claudeProvider and codexProvider.
 *   - Loads src/web/public/provider-specs.js as text in a sandbox to
 *     extract CWMProviderSpecLocals (no DOM, no window stub needed for
 *     just the regex arrays).
 *   - Iterates a fixture of representative lines for each provider plus
 *     neutral / edge-case lines and asserts that for every (line, provider)
 *     pair, backend.isIdleSignal(line) === frontendRegexes.some(re => re.test(line.trim()))
 *
 * Plan 19-02 (PTY-04 drift prevention).
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

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
    console.log('       ' + (err && err.stack ? err.stack.split('\n').slice(0, 5).join('\n       ') : String(err)));
  }
}

console.log('\n  Plan 19-02: backend-frontend idle signal parity');
console.log('  ' + '-'.repeat(58));

/**
 * Extract CWMProviderSpecLocals from provider-specs.js by sandboxing the
 * file source in a Function that returns the locals. Avoids depending on
 * jsdom or a global `window` in the test process.
 *
 * @returns {object} The CWMProviderSpecLocals map (provider id -> spec).
 */
function loadFrontendLocals() {
  const src = fs.readFileSync(PROVIDER_SPECS_PATH, 'utf8');
  const win = {};
  const factory = new Function('window', src + '\nreturn window.CWMProviderSpecLocals;');
  return factory(win);
}

/**
 * Predicate equivalent to terminal.js _isIdleLineForProvider with a
 * specific spec. Mirrors the production logic: any regex in idleRegexes
 * that matches the trimmed line counts as idle.
 *
 * @param {object} spec - The frontend spec ({idleRegexes: RegExp[]}).
 * @param {string} line - The raw line (will be trimmed to match the
 *   production logic's `line.translateToString(true).trim()`).
 * @returns {boolean}
 */
function frontendFiresIdle(spec, line) {
  if (!spec || !Array.isArray(spec.idleRegexes)) return false;
  const text = String(line).trim();
  for (const re of spec.idleRegexes) {
    if (re.test(text)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Fixture: lines that probe each provider's prompt surface plus edge cases.
// ---------------------------------------------------------------------------

const FIXTURE = [
  // Claude prompts
  '❯',
  '  ❯',
  'something ❯',
  '$',
  '$ ',
  '>',
  'Human: hello',
  'Human:',
  'Type a message',
  'Type your message and press enter',
  // Codex prompts
  'codex>',
  'codex> ',
  // Neutral / non-prompt lines
  'foo bar',
  'building project...',
  '',
  '   ',
  'Reading file',
  'const x = 42;',
  // Edge cases
  '   ❯   ',     // arrow with surrounding whitespace (trim should rescue)
  'Type. Now message me back', // looser Type.*message; matches Claude
];

// ---------------------------------------------------------------------------
// Test 1: locals shape
// ---------------------------------------------------------------------------

check('provider-specs.js exposes Claude + Codex specs with idleRegexes', () => {
  const locals = loadFrontendLocals();
  assert.ok(locals, 'CWMProviderSpecLocals must exist');
  assert.ok(locals.claude, 'Claude spec must exist');
  assert.ok(locals.codex, 'Codex spec must exist');
  assert.ok(Array.isArray(locals.claude.idleRegexes), 'Claude idleRegexes must be an array');
  assert.ok(Array.isArray(locals.codex.idleRegexes), 'Codex idleRegexes must be an array');
  assert.ok(locals.claude.idleRegexes.length > 0, 'Claude must have >=1 idle regex');
  assert.ok(locals.codex.idleRegexes.length > 0, 'Codex must have >=1 idle regex');
});

// ---------------------------------------------------------------------------
// Test 2: Claude parity across the fixture
// ---------------------------------------------------------------------------

check('Claude: backend.isIdleSignal === frontend regex disjunction (all fixture lines)', () => {
  const claudeProvider = require('../src/providers/claude');
  const locals = loadFrontendLocals();
  const spec = locals.claude;

  const mismatches = [];
  for (const line of FIXTURE) {
    const backend = claudeProvider.isIdleSignal(line);
    const frontend = frontendFiresIdle(spec, line);
    if (backend !== frontend) {
      mismatches.push({
        line: JSON.stringify(line),
        backend,
        frontend,
      });
    }
  }
  if (mismatches.length > 0) {
    const detail = mismatches.map(m =>
      'line=' + m.line + ' backend=' + m.backend + ' frontend=' + m.frontend
    ).join('\n  ');
    assert.fail(
      'Backend/frontend parity broken for Claude on ' + mismatches.length + ' line(s):\n  ' + detail
    );
  }
});

// ---------------------------------------------------------------------------
// Test 3: Codex parity across the fixture
// ---------------------------------------------------------------------------

check('Codex: backend.isIdleSignal === frontend regex disjunction (all fixture lines)', () => {
  const codexProvider = require('../src/providers/codex');
  const locals = loadFrontendLocals();
  const spec = locals.codex;

  const mismatches = [];
  for (const line of FIXTURE) {
    const backend = codexProvider.isIdleSignal(line);
    const frontend = frontendFiresIdle(spec, line);
    if (backend !== frontend) {
      mismatches.push({
        line: JSON.stringify(line),
        backend,
        frontend,
      });
    }
  }
  if (mismatches.length > 0) {
    const detail = mismatches.map(m =>
      'line=' + m.line + ' backend=' + m.backend + ' frontend=' + m.frontend
    ).join('\n  ');
    assert.fail(
      'Backend/frontend parity broken for Codex on ' + mismatches.length + ' line(s):\n  ' + detail
    );
  }
});

// ---------------------------------------------------------------------------
// Test 4: explicit known-good cases (anchor tests so a regex refactor that
// silently makes the fixture iteration agree-on-false does not slip by).
// ---------------------------------------------------------------------------

check('Anchor: Claude fires on "Human: hi" (both sides)', () => {
  const claudeProvider = require('../src/providers/claude');
  const locals = loadFrontendLocals();
  assert.strictEqual(claudeProvider.isIdleSignal('Human: hi'), true, 'Backend must fire');
  assert.strictEqual(frontendFiresIdle(locals.claude, 'Human: hi'), true, 'Frontend must fire');
});

check('Anchor: Codex fires on "codex>" (both sides)', () => {
  const codexProvider = require('../src/providers/codex');
  const locals = loadFrontendLocals();
  assert.strictEqual(codexProvider.isIdleSignal('codex>'), true, 'Backend must fire');
  assert.strictEqual(frontendFiresIdle(locals.codex, 'codex>'), true, 'Frontend must fire');
});

check('Anchor: neither side fires on "foo bar"', () => {
  const claudeProvider = require('../src/providers/claude');
  const codexProvider = require('../src/providers/codex');
  const locals = loadFrontendLocals();
  assert.strictEqual(claudeProvider.isIdleSignal('foo bar'), false);
  assert.strictEqual(frontendFiresIdle(locals.claude, 'foo bar'), false);
  assert.strictEqual(codexProvider.isIdleSignal('foo bar'), false);
  assert.strictEqual(frontendFiresIdle(locals.codex, 'foo bar'), false);
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

console.log('  ' + '-'.repeat(58));
console.log('  [idle-signal-parity] ' + passed + '/' + (passed + failed) + ' tests passed');

if (failed > 0) {
  process.exit(1);
}
process.exit(0);
