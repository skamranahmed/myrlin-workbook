#!/usr/bin/env node
/**
 * Tests for src/providers/codex/spawn.js (Phase 17 Plan 17-02).
 *
 * Coverage:
 *   1. spawnCommand with providerSessionId returns ['resume', id] args
 *   2. spawnCommand without providerSessionId returns empty args
 *   3. spawnCommand throws on unsafe providerSessionId (shell metacharacters)
 *   4. spawnCommand env scopes CODEX_HOME when process.env.CODEX_HOME is set
 *   5. spawnCommand env carries undefined CODEX_HOME when process.env.CODEX_HOME is unset
 *      (pty-manager DELETE-this-key semantic)
 *   6. spawnCommand cwd passes through unchanged
 *   7. spawnCommand is pure (no env mutation, no fs touches)
 *   8. spawnCommand returns cmd === 'codex' (the CLI binary name) - gsd:provider-literal-allowed
 *
 * Standalone-test convention: this file owns its own assertion helpers and
 * exits 0 on green / 1 on any failure with offender list. Mirrors
 * test/codex-parse.test.js scaffolding.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

'use strict';

// ─── Assertion helpers ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(msg || ('Expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual)));
  }
}

function assertDeepEqual(actual, expected, msg) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(msg || ('Expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual)));
  }
}

function assertThrows(fn, msg) {
  let threw = false;
  try { fn(); } catch (_) { threw = true; }
  if (!threw) throw new Error(msg || 'Expected function to throw, but it did not');
}

// ─── Module under test ─────────────────────────────────────────────────────

let spawn;
try {
  spawn = require('../src/providers/codex/spawn');
} catch (err) {
  console.error('FATAL: could not require src/providers/codex/spawn.js: ' + err.message);
  process.exit(1);
}
const { spawnCommand } = spawn;

// ─── Env scrub helper ──────────────────────────────────────────────────────

/**
 * Snapshot the keys we touch in tests and provide a restore function. Used
 * inside each test that mutates process.env.CODEX_HOME so a failure mid-test
 * does not leak env state into other tests.
 *
 * @returns {() => void} Restore function.
 */
function snapshotCodexHome() {
  const prev = Object.prototype.hasOwnProperty.call(process.env, 'CODEX_HOME')
    ? process.env.CODEX_HOME
    : undefined;
  const wasSet = Object.prototype.hasOwnProperty.call(process.env, 'CODEX_HOME');
  return function restore() {
    if (wasSet) {
      process.env.CODEX_HOME = prev;
    } else {
      delete process.env.CODEX_HOME;
    }
  };
}

// ─── Run tests ─────────────────────────────────────────────────────────────

console.log('\n  Plan 17-02: codex/spawn.js');
console.log('  ' + '-'.repeat(70));

// Test 1: resume args
test('spawnCommand with providerSessionId returns [resume, id]', () => {
  const restore = snapshotCodexHome();
  try {
    const desc = spawnCommand({ providerSessionId: 'abc-123' });
    // The cmd literal must be 'codex'; we compare via fixture variable below
    // to keep this file free of bare provider-name literals.
    assertEqual(desc.cmd, 'codex', 'cmd should be codex CLI binary'); // gsd:provider-literal-allowed
    assertDeepEqual(desc.args, ['resume', 'abc-123'], 'args should be [resume, id]');
  } finally {
    restore();
  }
});

// Test 2: fresh session args
test('spawnCommand without providerSessionId returns empty args', () => {
  const restore = snapshotCodexHome();
  try {
    const desc = spawnCommand({});
    assertDeepEqual(desc.args, [], 'args should be empty for fresh session');
    const descNoArg = spawnCommand();
    assertDeepEqual(descNoArg.args, [], 'args should be empty for no-init call');
    const descNullId = spawnCommand({ providerSessionId: null });
    assertDeepEqual(descNullId.args, [], 'args should be empty for null id');
  } finally {
    restore();
  }
});

// Test 3: unsafe id rejection
test('spawnCommand throws on unsafe providerSessionId', () => {
  assertThrows(() => spawnCommand({ providerSessionId: 'a; rm -rf /' }), 'semicolon should throw');
  assertThrows(() => spawnCommand({ providerSessionId: 'has spaces' }), 'spaces should throw');
  assertThrows(() => spawnCommand({ providerSessionId: '`echo evil`' }), 'backticks should throw');
  assertThrows(() => spawnCommand({ providerSessionId: 'inj$VAR' }), 'dollar sign should throw');
  assertThrows(() => spawnCommand({ providerSessionId: 'has/slashes' }), 'slashes should throw');
  assertThrows(() => spawnCommand({ providerSessionId: 'pipe|cmd' }), 'pipe should throw');
});

// Test 4: CODEX_HOME scoped in env when set
test('spawnCommand env scopes CODEX_HOME when process.env.CODEX_HOME is set', () => {
  const restore = snapshotCodexHome();
  try {
    process.env.CODEX_HOME = '/tmp/custom-codex';
    const desc = spawnCommand({ providerSessionId: 'abc-123' });
    assertEqual(desc.env.CODEX_HOME, '/tmp/custom-codex', 'CODEX_HOME should propagate');
    // Independently when no providerSessionId.
    const desc2 = spawnCommand({});
    assertEqual(desc2.env.CODEX_HOME, '/tmp/custom-codex', 'CODEX_HOME should propagate on fresh session too');
  } finally {
    restore();
  }
});

// Test 5: CODEX_HOME deletion semantic when unset
test('spawnCommand env carries undefined CODEX_HOME when env is unset (DELETE-this-key)', () => {
  const restore = snapshotCodexHome();
  try {
    delete process.env.CODEX_HOME;
    const desc = spawnCommand({});
    // The contract: env.CODEX_HOME is explicitly undefined so pty-manager
    // can DELETE the key from the spawn env (matches the Claude CLAUDECODE
    // pattern). The key MUST be present in env to advertise the contract.
    assert('CODEX_HOME' in desc.env, 'CODEX_HOME key must be present in env');
    assertEqual(desc.env.CODEX_HOME, undefined, 'CODEX_HOME must be undefined when unset');
  } finally {
    restore();
  }
});

// Test 6: cwd passthrough
test('spawnCommand cwd passes through unchanged', () => {
  const restore = snapshotCodexHome();
  try {
    const desc = spawnCommand({ cwd: '/home/user/project' });
    assertEqual(desc.cwd, '/home/user/project', 'cwd should pass through');

    const descNullCwd = spawnCommand({ cwd: null });
    assertEqual(descNullCwd.cwd, null, 'null cwd should pass through');

    const descNoCwd = spawnCommand({});
    assertEqual(descNoCwd.cwd, null, 'missing cwd should default to null');
  } finally {
    restore();
  }
});

// Test 7: purity (no env mutation, no fs side-effects)
test('spawnCommand is pure (no env mutation)', () => {
  const restore = snapshotCodexHome();
  try {
    process.env.CODEX_HOME = '/tmp/start-value';
    const envKeysBefore = Object.keys(process.env).sort();
    const envSnapshotBefore = JSON.stringify(process.env);

    spawnCommand({ providerSessionId: 'abc-123', cwd: '/tmp' });
    spawnCommand({});
    spawnCommand({ providerSessionId: null });

    const envKeysAfter = Object.keys(process.env).sort();
    const envSnapshotAfter = JSON.stringify(process.env);

    assertDeepEqual(envKeysAfter, envKeysBefore, 'no env keys should be added or removed');
    assertEqual(envSnapshotAfter, envSnapshotBefore, 'env values should be unchanged');
  } finally {
    restore();
  }
});

// Test 8: cmd literal
test('spawnCommand returns descriptor with all four required fields', () => {
  const restore = snapshotCodexHome();
  try {
    const desc = spawnCommand({ providerSessionId: 'abc-123', cwd: '/tmp' });
    assert('cmd' in desc, 'desc must have cmd field');
    assert('args' in desc, 'desc must have args field');
    assert('cwd' in desc, 'desc must have cwd field');
    assert('env' in desc, 'desc must have env field');
    assert(Array.isArray(desc.args), 'args must be an array');
    assert(typeof desc.env === 'object' && desc.env !== null, 'env must be an object');
  } finally {
    restore();
  }
});

// ─── Phase 21 Plan 21-01: providerSettings -> CLI flag translation ─────────

// Test 9: model -> -m
test('providerSettings.model produces -m model token pair', () => {
  const desc = spawnCommand({ providerSettings: { model: 'gpt-5-codex' } });
  const i = desc.args.indexOf('-m');
  assert(i !== -1, '-m flag should be present');
  assertEqual(desc.args[i + 1], 'gpt-5-codex', 'value should follow -m');
});

// Test 10: sandbox -> -s
test('providerSettings.sandbox produces -s sandbox token pair', () => {
  const desc = spawnCommand({ providerSettings: { sandbox: 'workspace-write' } });
  const i = desc.args.indexOf('-s');
  assert(i !== -1, '-s flag should be present');
  assertEqual(desc.args[i + 1], 'workspace-write', 'value should follow -s');
});

// Test 11: approvalPolicy -> -a
test('providerSettings.approvalPolicy produces -a policy token pair', () => {
  const desc = spawnCommand({ providerSettings: { approvalPolicy: 'on-request' } });
  const i = desc.args.indexOf('-a');
  assert(i !== -1, '-a flag should be present');
  assertEqual(desc.args[i + 1], 'on-request', 'value should follow -a');
});

// Test 12: reasoningEffort -> -c model_reasoning_effort=...
test('providerSettings.reasoningEffort produces -c key=value', () => {
  const desc = spawnCommand({ providerSettings: { reasoningEffort: 'high' } });
  const i = desc.args.indexOf('-c');
  assert(i !== -1, '-c flag should be present');
  const val = desc.args[i + 1] || '';
  assert(val.indexOf('model_reasoning_effort=') === 0, 'value should be key=value form');
  assert(val.indexOf('high') !== -1, 'value should embed effort');
});

// Test 13: bypassApprovalsAndSandbox -> --dangerously-bypass-...
test('providerSettings.bypassApprovalsAndSandbox=true produces bypass flag', () => {
  const desc = spawnCommand({ providerSettings: { bypassApprovalsAndSandbox: true } });
  assert(
    desc.args.includes('--dangerously-bypass-approvals-and-sandbox'),
    'bypass flag should be present'
  );
});

// Test 14: features array -> multiple --enable pairs
test('providerSettings.features array produces --enable pairs', () => {
  const desc = spawnCommand({ providerSettings: { features: ['web_search', 'view_image'] } });
  const enables = desc.args.reduce((acc, tok, i, arr) => {
    if (tok === '--enable' && i + 1 < arr.length) acc.push(arr[i + 1]);
    return acc;
  }, []);
  assertDeepEqual(enables, ['web_search', 'view_image'], 'two --enable pairs should appear');
});

// Test 15: unknown enum values are dropped (no throw)
test('providerSettings with unknown values are dropped silently', () => {
  const restoreWarn = console.warn;
  console.warn = () => {}; // swallow during test
  try {
    const desc = spawnCommand({ providerSettings: {
      sandbox: 'neverexists',
      approvalPolicy: 'totally-bogus',
      reasoningEffort: 'glacial',
      model: 'has spaces and ; semicolons',
      features: ['bad name!', 'good_name'],
    } });
    assert(!desc.args.includes('-s'), '-s should not be present for unknown sandbox');
    assert(!desc.args.includes('-a'), '-a should not be present for unknown approval');
    assert(!desc.args.includes('-c'), '-c should not be present for unknown effort');
    assert(!desc.args.includes('-m'), '-m should not be present for unsafe model');
    const enables = desc.args.reduce((acc, tok, i, arr) => {
      if (tok === '--enable' && i + 1 < arr.length) acc.push(arr[i + 1]);
      return acc;
    }, []);
    assertDeepEqual(enables, ['good_name'], 'only safe feature name should pass');
  } finally {
    console.warn = restoreWarn;
  }
});

// Test 16: positional resume <id> stays LAST after flags
test('resume id stays last after provider-settings flags', () => {
  const desc = spawnCommand({
    providerSessionId: 'abc-123',
    providerSettings: { model: 'gpt-5-codex', sandbox: 'workspace-write' },
  });
  assertEqual(desc.args[desc.args.length - 2], 'resume', 'penultimate should be resume keyword');
  assertEqual(desc.args[desc.args.length - 1], 'abc-123', 'last should be the id');
});

// Test 17: null/missing providerSettings is a no-op (no extra flags)
test('null providerSettings produces no extra flags', () => {
  const desc = spawnCommand({ providerSettings: null });
  assertDeepEqual(desc.args, [], 'args should be empty when settings is null');
  const desc2 = spawnCommand({});
  assertDeepEqual(desc2.args, [], 'args should be empty when settings is omitted');
});

// ─── Summary + exit ────────────────────────────────────────────────────────

console.log('  ' + '-'.repeat(70));
console.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
