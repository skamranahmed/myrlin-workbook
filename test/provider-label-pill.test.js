#!/usr/bin/env node
/**
 * Plan 22-02 gate: provider label pill + sidebar entry stripes.
 *
 * Locks the shape of:
 *   1. The new .pane-provider-pill selector + per-provider ::before dot.
 *   2. The sidebar stripes on .ws-session-item and .project-session-item.
 *   3. Existing .project-accordion stripes still present (bumped to 3px).
 *   4. Pane markup carries a .pane-provider-pill element.
 *   5. openTerminalInPane wires the pill text + visibility.
 *
 * Pure string-match over styles.css and index.html and app.js. No DOM.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'public', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'public', 'app.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  catch (e) { failed++; console.log('  \x1b[31m✗\x1b[0m ' + name); console.log('    ' + e.message); }
}

console.log('\n  Plan 22-02: provider pill + sidebar stripes');
console.log('  ' + '─'.repeat(48));

check('.pane-provider-pill base selector exists', () => {
  assert.ok(css.includes('.pane-provider-pill'), 'expected .pane-provider-pill in styles.css');
});
check('Claude pill dot uses --provider-claude-accent', () => {
  assert.ok(
    /\.pane-provider-pill\[data-provider="claude"\]::before[\s\S]*?--provider-claude-accent/.test(css),
    'expected the claude pill ::before to reference --provider-claude-accent'
  );
});
check('Codex pill dot uses --provider-codex-accent', () => {
  assert.ok(
    /\.pane-provider-pill\[data-provider="codex"\]::before[\s\S]*?--provider-codex-accent/.test(css),
    'expected the codex pill ::before to reference --provider-codex-accent'
  );
});
check('Pane HTML markup includes pane-provider-pill', () => {
  assert.ok(html.includes('pane-provider-pill'),
    'expected pane-provider-pill span in index.html pane templates');
});
check('openTerminalInPane sets pill text + visibility', () => {
  assert.ok(/pillEl\.textContent/.test(app), 'expected pillEl.textContent assignment in app.js');
  assert.ok(/pillEl\.hidden\s*=/.test(app), 'expected pillEl.hidden assignment in app.js');
});
check('Sidebar .ws-session-item carries provider stripe', () => {
  assert.ok(
    /\.ws-session-item\[data-provider="claude"\][\s\S]*?--provider-claude-accent/.test(css),
    'claude ws-session-item must reference --provider-claude-accent'
  );
  assert.ok(
    /\.ws-session-item\[data-provider="codex"\][\s\S]*?--provider-codex-accent/.test(css),
    'codex ws-session-item must reference --provider-codex-accent'
  );
});
check('.project-session-item carries provider stripe', () => {
  assert.ok(
    /\.project-session-item\[data-provider="codex"\][\s\S]*?--provider-codex-accent/.test(css),
    'codex project-session-item must reference --provider-codex-accent'
  );
});
check('.project-accordion still carries provider stripe', () => {
  assert.ok(
    /\.project-accordion\[data-provider="codex"\][\s\S]*?--provider-codex-accent/.test(css),
    'project-accordion codex must reference --provider-codex-accent'
  );
});
check('Pane top accent bumped to 4px', () => {
  // Both claude and codex should be `border-top: 4px solid var(--provider-*-accent)`.
  assert.ok(
    /\.terminal-pane\[data-provider="claude"\][\s\S]*?border-top:\s*4px solid var\(--provider-claude-accent\)/.test(css),
    'claude pane top accent must be 4px'
  );
  assert.ok(
    /\.terminal-pane\[data-provider="codex"\][\s\S]*?border-top:\s*4px solid var\(--provider-codex-accent\)/.test(css),
    'codex pane top accent must be 4px'
  );
});
check('Whole-pane tint bumped to 8%', () => {
  assert.ok(
    /color-mix\(in srgb, var\(--mauve\) 8%, var\(--bg-primary\)\)/.test(css),
    'claude whole-pane tint must be 8%'
  );
  assert.ok(
    /color-mix\(in srgb, var\(--green\) 8%, var\(--bg-primary\)\)/.test(css),
    'codex whole-pane tint must be 8%'
  );
});

console.log('  ' + '─'.repeat(48));
console.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
