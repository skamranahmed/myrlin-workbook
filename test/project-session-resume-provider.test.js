#!/usr/bin/env node
/**
 * Regression test for the "session id cannot be found" bug
 * (alpha.5 fix for alpha.4 / pre-alpha.4 carryover).
 *
 * Symptom: right-clicking a Codex Desktop session in Discovered Projects
 * and choosing "Open in Terminal" spawned `claude resume <codex-uuid>`,
 * which threw "session id cannot be found" because that UUID lives in
 * ~/.codex/sessions/ and Claude has no idea about it.
 *
 * Root cause: showProjectSessionContextMenu hardcoded the Claude cliBinary
 * for both its "Open in Terminal" action and its "Add to Project" POST.
 * The contextmenu dispatcher also wasn't passing data-provider through.
 *
 * Fix: contextmenu dispatcher reads sessionItem.dataset.provider and
 * passes it as the fifth arg to showProjectSessionContextMenu, which uses
 * this.getProviderCliBinary(provider) to pick the right CLI.
 *
 * Pure source-scan gate. Cheap insurance against the same hardcoded
 * literal sneaking back in.
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

console.log('\n  \x1b[1mAlpha.5: project-session resume routes by provider\x1b[0m');
console.log('  ' + '─'.repeat(58));

check('showProjectSessionContextMenu signature accepts provider arg', () => {
  assert.ok(
    /showProjectSessionContextMenu\s*\([^)]*\bprovider\b[^)]*\)/.test(src),
    'expected showProjectSessionContextMenu(sessionName, projectPath, x, y, provider) signature'
  );
});

check('contextmenu dispatcher forwards sessionItem.dataset.provider', () => {
  // The dispatcher must read data-provider from the clicked session item
  // and pass it as the fifth positional arg to the menu factory.
  const re = /sessionItem\.dataset\.sessionName,\s*sessionItem\.dataset\.projectPath,\s*[^,]+,\s*[^,]+,\s*\w+Provider/;
  assert.ok(
    re.test(src),
    'expected dispatcher to forward an *Provider local to showProjectSessionContextMenu'
  );
});

// Locate the showProjectSessionContextMenu function body (definition line
// to next top-level method). Used by the next two checks.
function findMenuFnBody() {
  const defRe = /showProjectSessionContextMenu\s*\([^)]*\)\s*\{/;
  const m = defRe.exec(src);
  if (!m) return '';
  const start = m.index;
  // 8000-char window comfortably contains the whole method (it's ~3 KB).
  return src.substr(start, 8000);
}

check('Open in Terminal action uses getProviderCliBinary, not literal CLI', () => {
  const body = findMenuFnBody();
  assert.ok(body.length > 0, 'menu function body not found');
  // getProviderCliBinary call with any identifier argument.
  assert.ok(
    /getProviderCliBinary\s*\(\s*\w+\s*\)/.test(body),
    'expected getProviderCliBinary(<identifier>) inside the function body'
  );
  // openTerminalInPane call forwards provider: <identifier> in opts so the
  // pane is tagged correctly downstream.
  assert.ok(
    /openTerminalInPane[\s\S]{0,500}provider:\s*\w+/.test(body),
    'expected openTerminalInPane call to forward provider: <identifier>'
  );
});

check('Add to Project POST includes provider field, not literal CLI', () => {
  const body = findMenuFnBody();
  // POST /api/sessions request body must carry provider as a dynamic
  // identifier, not a hardcoded literal.
  const postIdx = body.indexOf('/api/sessions');
  assert.ok(postIdx !== -1, 'expected POST /api/sessions inside function');
  const postBlock = body.substr(postIdx, 800);
  assert.ok(
    /provider:\s*\w+/.test(postBlock),
    'expected POST body to include provider: <identifier>'
  );
});

console.log('  ' + '─'.repeat(58));
console.log('  [project-session-resume-provider] ' + passed + '/' + (passed + failed) + ' tests passed');
if (failed > 0) process.exit(1);
process.exit(0);
