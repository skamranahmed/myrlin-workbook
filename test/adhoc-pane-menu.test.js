#!/usr/bin/env node
/**
 * Plan 22-04 gate: right-click on an ad-hoc pane shows the reduced menu.
 *
 * Symptom that drove this work: right-clicking a Codex Desktop pane opened
 * via "Open in Terminal" produced an almost-empty menu because
 * _buildSessionContextItems returned null for any sessionId not in the
 * Myrlin store. The fix routes that branch into a new factory,
 * _buildAdHocSessionContextItems, that builds items from the pane's
 * spawnOpts instead.
 *
 * This gate is a pure source scan over app.js. We don't try to spin up the
 * DOM; we just lock the contract so the factory can't silently regress.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const APP_PATH = path.join(__dirname, '..', 'src', 'web', 'public', 'app.js');
const src = fs.readFileSync(APP_PATH, 'utf8');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  catch (e) { failed++; console.log('  \x1b[31m✗\x1b[0m ' + name); console.log('    ' + e.message); }
}

console.log('\n  Plan 22-04: ad-hoc pane right-click menu');
console.log('  ' + '─'.repeat(46));

check('_buildAdHocSessionContextItems factory exists', () => {
  assert.ok(/_buildAdHocSessionContextItems\s*\(/.test(src),
    'expected _buildAdHocSessionContextItems(sessionId, tp) method');
});

check('_buildSessionContextItems accepts tp parameter', () => {
  assert.ok(/_buildSessionContextItems\s*\([^)]*\btp\b/.test(src),
    'signature must include tp so the ad-hoc fallback can fire');
});

check('null-session branch routes through ad-hoc factory', () => {
  // Scope to the function body so we don't false-positive on other
  // ad-hoc references elsewhere.
  const m = src.match(/_buildSessionContextItems\s*\([^)]*\)\s*\{[\s\S]{0,800}?return this\._buildAdHocSessionContextItems/);
  assert.ok(m, 'expected `return this._buildAdHocSessionContextItems(...)` inside the null branch');
});

check('pane right-click caller passes tp through', () => {
  // The terminal-pane right-click handler passes tp so the factory has
  // spawnOpts available for the cwd/provider lookups.
  assert.ok(/_buildSessionContextItems\s*\(\s*tp\.sessionId\s*,\s*tp\s*\)/.test(src),
    'pane right-click must call _buildSessionContextItems(tp.sessionId, tp)');
});

// Body-content assertions: the four core items the factory must emit.
function findFactoryBody() {
  const m = src.match(/_buildAdHocSessionContextItems\s*\([^)]*\)\s*\{[\s\S]{0,5000}/);
  return m ? m[0] : '';
}

check('factory emits Naming submenu (Rename + Auto Title)', () => {
  const body = findFactoryBody();
  assert.ok(/label:\s*['"]Naming['"]/.test(body), 'Naming label missing');
  assert.ok(/Rename Pane/.test(body), 'Rename Pane action missing');
  assert.ok(/Auto Title/.test(body), 'Auto Title action missing');
});

check('factory emits Insights submenu (Summarize + Copy ID + Copy Path)', () => {
  const body = findFactoryBody();
  assert.ok(/label:\s*['"]Insights['"]/.test(body), 'Insights label missing');
  assert.ok(/Summarize/.test(body), 'Summarize action missing');
  assert.ok(/Copy Session ID/.test(body), 'Copy Session ID action missing');
  assert.ok(/Copy Path/.test(body), 'Copy Path action missing (cwd branch)');
});

check('factory emits "Add to <workspace>" adoption item', () => {
  const body = findFactoryBody();
  assert.ok(/Add to ['"\s+]+this\.state\.activeWorkspace\.name/.test(body)
    || /'Add to ' \+ this\.state\.activeWorkspace\.name/.test(body),
    'Add to <workspace> label missing');
  // The adopter must POST /api/sessions with the resumed session id.
  assert.ok(/'\/api\/sessions'/.test(body) && /resumeSessionId/.test(body),
    'adopter must POST /api/sessions with resumeSessionId');
});

check('factory reads provider + cwd from tp.spawnOpts', () => {
  const body = findFactoryBody();
  assert.ok(/tp\.spawnOpts/.test(body),
    'factory must source provider/cwd from tp.spawnOpts');
});

console.log('  ' + '─'.repeat(46));
console.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
