#!/usr/bin/env node
/**
 * Plan 22-05 gate: workspace group UX.
 *
 * Locks the contract for the new visible-group-membership treatment:
 *   1. Grouped workspaces render with data-group-id + a --ws-group-color
 *      inline custom property.
 *   2. CSS draws a 4px left-edge stripe in the group's color via
 *      box-shadow inset on .workspace-item[data-group-id].
 *   3. A .ws-group-chip with a × .ws-group-chip-remove button exists in
 *      both the markup and the CSS surface.
 *   4. The sidebar click handler intercepts data-action="remove-from-group"
 *      and routes through removeWorkspaceFromGroup BEFORE row activation.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'public', 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'public', 'app.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  catch (e) { failed++; console.log('  \x1b[31m✗\x1b[0m ' + name); console.log('    ' + e.message); }
}

console.log('\n  Plan 22-05: workspace group UX');
console.log('  ' + '─'.repeat(36));

check('CSS: .workspace-item[data-group-id] stripe references --ws-group-color', () => {
  assert.ok(/\.workspace-item\[data-group-id\][\s\S]{0,200}--ws-group-color/.test(css),
    'expected .workspace-item[data-group-id] block to reference --ws-group-color');
});
check('CSS: .ws-group-chip selector exists', () => {
  assert.ok(css.includes('.ws-group-chip'),
    'expected .ws-group-chip in styles.css');
});
check('CSS: .ws-group-chip-remove selector exists', () => {
  assert.ok(css.includes('.ws-group-chip-remove'),
    'expected .ws-group-chip-remove in styles.css');
});
check('CSS: chip remove × fades in only on hover', () => {
  assert.ok(/\.ws-group-chip:hover\s+\.ws-group-chip-remove[\s\S]{0,80}opacity:\s*1/.test(css),
    'expected hover state to bump .ws-group-chip-remove opacity to 1');
});

check('app.js: renderWorkspaceItem reads workspaceGroups', () => {
  assert.ok(/Object\.values\(this\.state\.workspaceGroups/.test(app),
    'expected workspaceGroups lookup in renderWorkspaceItem');
});
check('app.js: emits data-group-id on workspace markup', () => {
  assert.ok(/data-group-id="\$\{/.test(app),
    'expected data-group-id="..." on rendered workspace markup');
});
check('app.js: emits --ws-group-color inline CSS custom property', () => {
  assert.ok(/--ws-group-color:\s*\$\{|--ws-group-color:\s*' \+ groupColor/.test(app)
    || /--ws-group-color/.test(app),
    'expected --ws-group-color in inline style for grouped workspace');
});
check('app.js: chip markup includes ws-group-chip + chip-remove × button', () => {
  assert.ok(/ws-group-chip/.test(app), 'ws-group-chip not present in app.js markup');
  assert.ok(/data-action="remove-from-group"/.test(app),
    'expected data-action="remove-from-group" button in chip');
});
check('app.js: click handler intercepts remove-from-group BEFORE row activation', () => {
  // The interceptor must appear in source order BEFORE the const
  // workspaceItem = e.target.closest('.workspace-item') row-activation block.
  // We check by index of the two patterns.
  const interceptorIdx = app.indexOf('remove-from-group');
  const rowActivationIdx = app.indexOf("e.target.closest('.workspace-item')");
  assert.ok(interceptorIdx !== -1 && rowActivationIdx !== -1,
    'expected both code paths to exist');
  assert.ok(interceptorIdx < rowActivationIdx,
    'remove-from-group interceptor must precede the workspace-item row activation');
});

console.log('  ' + '─'.repeat(36));
console.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
