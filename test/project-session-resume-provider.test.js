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

// ─── session-lifecycle: sidebar workspace drop routes CLI by provider ───
// The wsList drop handler's cwm/project-session and cwm/project branches
// used to hardcode command: 'claude' while forwarding provider: psProvider,
// so a dropped Codex session silently spawned a fresh Claude session.

/**
 * Extract the wsList drop handler region: from the first
 * getData('cwm/project-session') (the workspace drop branch) through the
 * cwm/project branch that follows it.
 * @returns {string} Source window covering both sidebar drop POST payloads.
 */
function findSidebarDropRegion() {
  const start = src.indexOf("getData('cwm/project-session')");
  assert.ok(start > 0, 'sidebar cwm/project-session drop branch must exist');
  // 3500 chars covers both the project-session and project branches.
  return src.slice(start, start + 3500);
}

check('sidebar project-session drop resolves command via getProviderCliBinary(psProvider)', () => {
  const region = findSidebarDropRegion();
  assert.ok(
    /command:\s*this\.getProviderCliBinary\(psProvider\)/.test(region),
    'expected command: this.getProviderCliBinary(psProvider) in the project-session drop POST'
  );
});

check('sidebar project drop resolves command via getProviderCliBinary(projProvider)', () => {
  const region = findSidebarDropRegion();
  assert.ok(
    /command:\s*this\.getProviderCliBinary\(projProvider\)/.test(region),
    'expected command: this.getProviderCliBinary(projProvider) in the project drop POST'
  );
});

check('sidebar drop branches contain no hardcoded CLI literal in the POST payloads', () => {
  const region = findSidebarDropRegion();
  assert.ok(
    !/command:\s*'claude'/.test(region), // gsd:provider-literal-allowed (test asserts ABSENCE of the literal)
    'sidebar drop POST payloads must not hardcode the Claude CLI literal'
  );
});

// ─── session-lifecycle: _openFindResult correctness ───

/**
 * Extract the _openFindResult method body (definition to a fixed window;
 * the method is well under 3000 chars).
 * @returns {string}
 */
function findOpenFindResultBody() {
  const m = /_openFindResult\s*\(card\)\s*\{/.exec(src);
  assert.ok(m, '_openFindResult(card) must exist');
  return src.substr(m.index, 3000);
}

check('_openFindResult no longer passes resumeSessionId for store sessions', () => {
  const body = findOpenFindResultBody();
  // The type === 'session' branch resumes a STORE session whose id is the
  // Myrlin UUID, not the transcript UUID. Passing it as resumeSessionId made
  // the CLI fail with "No conversation found with session ID"; the store
  // spawn path resolves the real resume id server-side.
  assert.ok(
    !/resumeSessionId:\s*id\b/.test(body),
    '_openFindResult must NOT pass resumeSessionId: id (Myrlin store UUID is not a transcript UUID)'
  );
});

check('_openFindResult resolves the CLI from the card provider, not the null default', () => {
  const body = findOpenFindResultBody();
  assert.ok(
    !/getProviderCliBinary\(null\)/.test(body),
    '_openFindResult must not hardcode getProviderCliBinary(null)'
  );
  const uses = (body.match(/getProviderCliBinary\(cardProvider\)/g) || []).length;
  assert.ok(uses >= 2, 'both branches must use getProviderCliBinary(cardProvider); found ' + uses);
});

// ─── session-lifecycle: openConversationResult exists and resumes by provider ───

check('openConversationResult is defined and opens with resume + provider-resolved CLI', () => {
  const m = /openConversationResult\s*\(sessionId,\s*projectPath,\s*provider\)\s*\{/.exec(src);
  assert.ok(m, 'openConversationResult(sessionId, projectPath, provider) must be defined');
  const body = src.substr(m.index, 2000);
  assert.ok(/openTerminalInPane\(/.test(body), 'must open a terminal pane');
  assert.ok(/resumeSessionId:\s*sessionId/.test(body), 'must resume the upstream uuid');
  assert.ok(/getProviderCliBinary\(provider\)/.test(body), 'must resolve CLI from the result provider');
});

check('global search result click forwards data-provider to openConversationResult', () => {
  assert.ok(
    /openConversationResult\(sessionId,\s*projectPath,\s*resultProvider\)/.test(src),
    'search-result click handler must pass the provider from the result element dataset'
  );
});

console.log('  ' + '─'.repeat(58));
console.log('  [project-session-resume-provider] ' + passed + '/' + (passed + failed) + ' tests passed');
if (failed > 0) process.exit(1);
process.exit(0);
