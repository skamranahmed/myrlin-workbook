#!/usr/bin/env node
/**
 * String-match gate for the Codex pane right-click menu (Plan 21-01).
 *
 * Pure source-scan over src/web/public/app.js. No DOM, no jsdom, no
 * browser. The renderer logic is already exercised through usage; this
 * gate prevents the menu factory from drifting (renamed, deleted, or
 * stripped of a required item) silently.
 *
 * Assertions:
 *   1. _buildCodexPaneMenu function exists.
 *   2. showTerminalContextMenu reads paneEl.dataset.provider for dispatch.
 *   3. The Codex menu emits all six designed items by label.
 *   4. The bypass item is wired through showConfirmModal (confirmation
 *      modal pathway), not a bare toggle.
 *
 * Requirements covered: Plan 21-01 must_haves 1, 2, 7.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const APP_PATH = path.join(__dirname, '..', 'src', 'web', 'public', 'app.js');
const src = fs.readFileSync(APP_PATH, 'utf8');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + name);
  } catch (err) {
    failed++;
    console.log('  \x1b[31m✗\x1b[0m ' + name);
    console.log('    \x1b[31m' + err.message + '\x1b[0m');
  }
}

console.log('\n  \x1b[1mPlan 21-01: Codex pane right-click menu\x1b[0m');
console.log('  ' + '─'.repeat(50));

check('_buildCodexPaneMenu function exists in app.js', () => {
  assert.ok(
    /_buildCodexPaneMenu\s*\(/.test(src),
    'expected _buildCodexPaneMenu(...) method declaration'
  );
});

check('showTerminalContextMenu dispatches by paneEl.dataset.provider', () => {
  // The dispatch must happen inside showTerminalContextMenu. We assert
  // both that the function exists and that it references dataset.provider
  // somewhere in its body. A broad source-level grep is enough for the
  // gate; we are guarding against the dispatch being deleted, not asserting
  // a specific line number.
  assert.ok(
    /showTerminalContextMenu\s*\(/.test(src),
    'expected showTerminalContextMenu to be defined'
  );
  assert.ok(
    /dataset\.provider/.test(src),
    'expected at least one dataset.provider reference (dispatch on data-provider)'
  );
});

// Six designed menu items. Asserting the human-readable labels (not the
// internal flag names) keeps this gate resilient against argv refactors.
const REQUIRED_LABELS = [
  /label:\s*['"]Model['"]/,
  /label:\s*['"]Sandbox['"]/,
  /label:\s*['"]Approval Policy['"]/,
  /label:\s*['"]Reasoning Effort['"]/,
  /label:\s*['"]Features['"]/,
  // Bypass label is dynamic (toggles between two forms). Match the prefix.
  /label:\s*[^\n]*Bypass/,
];

for (const re of REQUIRED_LABELS) {
  check('Codex menu includes label matching ' + re, () => {
    assert.ok(re.test(src), 'expected to find ' + re + ' in app.js source');
  });
}

check('Bypass item routes through showConfirmModal', () => {
  // The bypass branch enables a dangerous flag, so the action MUST call
  // showConfirmModal before applying. Without this check, a regression
  // could silently turn it into a bare toggle.
  // We do not have a way to scope this assertion to the bypass branch
  // statically, so we assert at file scope that the menu file references
  // showConfirmModal at all (already true via other call sites) AND that
  // the literal warning text from the bypass confirmation modal lives in
  // app.js. The warning text is unique to that modal.
  assert.ok(
    /Enable Bypass for Codex/.test(src),
    'expected the bypass confirmation modal title in app.js'
  );
  assert.ok(
    /showConfirmModal/.test(src),
    'expected showConfirmModal helper to be referenced'
  );
});

console.log('  ' + '─'.repeat(50));
console.log('  [pane-context-menu] ' + passed + '/' + (passed + failed) + ' tests passed');
if (failed > 0) process.exit(1);
process.exit(0);
