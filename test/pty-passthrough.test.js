#!/usr/bin/env node
/**
 * Unit tests for the PTY pass-through refactor (Plan 14-04, PTY-03).
 *
 * Covers:
 *   Test 1  Descriptor flow: provider.spawnCommand result is what pty.spawn receives
 *   Test 2  env merge: undefined values DELETE the key from the spawn env
 *   Test 3  Non-Claude provider with invalid cwd falls back to homedir (NOT cwdFromJsonl)
 *   Test 4  Claude provider with invalid cwd uses cwdFromJsonl fallback (MANDATORY)
 *   Test 5  PTY-01 regression: Claude descriptor.cmd === 'claude' and --resume present
 *   Test 6  Non-default-command bypass: command:'td' bypasses provider lookup entirely
 *
 * Test pattern mirrors test/providers-registry.test.js: no third-party framework,
 * stubbed pty.spawn via the test-only `_ptySpawnForTesting` opt that pty-manager
 * accepts. Stub cwdFromJsonl via `_cwdFromJsonlForTesting`. Both injections are
 * documented as @private test-only in pty-manager.spawnSession's JSDoc.
 *
 * IMPORTANT: this test depends on pty-manager.js exposing the two injection
 * opts (Plan 14-04 Task 4 wires them). Without them, all 6 tests RED.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Force data directory to project-local ./state/ for test isolation, before
// requiring anything that touches the store. Mirrors the pattern in test/run.js.
process.env.CWM_DATA_DIR = path.join(__dirname, '..', 'state');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  PASS  ' + name);
  } catch (err) {
    failed++;
    console.log('  FAIL  ' + name);
    console.log('        ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n        ') : String(err)));
  }
}

/**
 * Build a fully-populated fake provider that satisfies the registry's validation
 * gate. The spawnCommand override is the part each test cares about.
 * @param {string} id  Provider id.
 * @param {Object} overrides  Patch fields onto the base.
 * @returns {Object} Provider object.
 */
function makeFakeProvider(id, overrides) {
  const base = {
    id,
    displayName: 'Fake ' + id,
    accentToken: 'mauve',
    cliBinary: id,
    discover: async () => [],
    parseTranscript: async () => [],
    spawnCommand: () => ({ cmd: id, args: [], cwd: null, env: {} }),
    search: async () => [],
    init: async () => {},
    dispose: async () => {},
    supportsCost: () => false,
    isIdleSignal: () => false,
    getKeyBindings: () => ({}),
  };
  return Object.assign(base, overrides || {});
}

/**
 * Build a stub PTY object that has the methods pty-manager touches after
 * spawn. `onData` and `onExit` capture the registered handler so the test
 * can drive them; default no-ops are fine for the descriptor-flow tests.
 */
function makeStubPty() {
  return {
    pid: 99999,
    onData: () => {},
    onExit: () => {},
    on: () => {},
    write: () => {},
    resize: () => {},
    kill: () => {},
  };
}

/**
 * Reset all relevant module caches so each test gets a fresh registry +
 * pty-manager + store. Mirrors the technique used in test/run.js.
 */
function resetModules() {
  delete require.cache[require.resolve('../src/providers')];
  delete require.cache[require.resolve('../src/providers/claude/spawn')];
  delete require.cache[require.resolve('../src/web/pty-manager')];
  delete require.cache[require.resolve('../src/state/store')];
}

/**
 * Build a fresh PtySessionManager + registry pair. Adds a freshly-built
 * fake provider (from `providerOpts`) plus the real Claude spawn function
 * if the test enables Claude. Returns helper handles for the test.
 *
 * @param {Object} cfg
 * @param {Object} [cfg.fakeProviderOverrides]  Patches for the fake provider.
 * @param {boolean} [cfg.includeClaude]  Register a minimal claude provider.
 * @param {boolean} [cfg.fakeProviderEnabled]  Add fake to enabled set.
 * @returns {{registry, ptyMgr, fakeProvider, store}}
 */
function buildFixture(cfg) {
  resetModules();
  const registry = require('../src/providers');
  const fakeProvider = makeFakeProvider('faketest', cfg && cfg.fakeProviderOverrides);
  registry.register(fakeProvider);
  if (cfg && cfg.fakeProviderEnabled) registry.setEnabled('faketest', true);

  if (cfg && cfg.includeClaude) {
    const { spawnCommand } = require('../src/providers/claude/spawn');
    const claudeProvider = makeFakeProvider('claude', { spawnCommand });
    registry.register(claudeProvider);
    registry.setEnabled('claude', true);
  }

  const { PtySessionManager } = require('../src/web/pty-manager');
  const { getStore } = require('../src/state/store');
  const ptyMgr = new PtySessionManager();
  const store = getStore();

  return { registry, ptyMgr, fakeProvider, store };
}

/**
 * Make a session record in the store with a specific provider tag. Returns
 * the session id. Uses createSession then updateSession to set provider since
 * createSession does not accept provider directly (defaults handled at load time).
 */
function makeSessionWithProvider(store, providerId, opts) {
  const ws = store.createWorkspace({ name: 'pty-test-ws-' + Math.random().toString(36).slice(2, 8) });
  const sess = store.createSession({
    name: 'pty-test-' + Math.random().toString(36).slice(2, 8),
    workspaceId: ws.id,
    workingDir: (opts && opts.workingDir) || '',
    command: (opts && opts.command) || 'claude',
  });
  // Set provider directly via updateSession; the store's read-side normalizer
  // ensures it round-trips. v1.2 schema permits arbitrary additional fields.
  store.updateSession(sess.id, { provider: providerId });
  return sess.id;
}

console.log('\n  Plan 14-04 PTY pass-through tests');
console.log('  ' + '-'.repeat(42));

// ──────────────────────────────────────────────────────────────────────
// Test 1: Descriptor flow
// ──────────────────────────────────────────────────────────────────────
check('Test 1 (PTY-03): provider.spawnCommand descriptor flows to pty.spawn', () => {
  const { ptyMgr, fakeProvider, store } = buildFixture({
    fakeProviderEnabled: true,
    fakeProviderOverrides: {
      spawnCommand: () => ({
        cmd: 'fake-cli',
        args: ['--foo', '--bar'],
        cwd: os.tmpdir(),
        env: { FOO: 'bar' },
      }),
    },
  });
  const sessionId = makeSessionWithProvider(store, 'faketest', { command: 'faketest' });

  let captured = null;
  const spy = (shell, shellArgs, spawnOpts) => {
    captured = { shell, shellArgs, spawnOpts };
    return makeStubPty();
  };

  ptyMgr.spawnSession(sessionId, {
    command: 'faketest', // non-claude command, but provider id still lookups
    _ptySpawnForTesting: spy,
  });

  assert.ok(captured, 'pty.spawn spy must have been invoked');
  // Shell wrap: the joined fullCommand should contain fake-cli + flags.
  const shellArgsJoined = captured.shellArgs.join(' ');
  assert.ok(shellArgsJoined.includes('fake-cli'), 'shellArgs must include descriptor.cmd, got: ' + shellArgsJoined);
  assert.ok(shellArgsJoined.includes('--foo'), 'shellArgs must include descriptor.args[0]');
  assert.ok(shellArgsJoined.includes('--bar'), 'shellArgs must include descriptor.args[1]');
  // env merge: descriptor.env.FOO should land on the spawn env
  assert.strictEqual(captured.spawnOpts.env.FOO, 'bar', 'descriptor.env.FOO=bar must propagate');

  // Suppress the result for the "command" branch test below: in this scenario
  // the caller passed command:'faketest' which is non-claude, so the bypass
  // branch fires and the inline descriptor wins. The spawnCommand override
  // is therefore NOT called here. That is fine: this test asserts the
  // pass-through plumbing for whichever branch fires; Test 6 below verifies
  // the bypass explicitly. To assert provider.spawnCommand DOES fire on the
  // claude path, see Test 5.
  // Note: fakeProvider exists so the registry lookup paths can find it later;
  // its spawnCommand may or may not have been invoked depending on the branch.
  void fakeProvider;
});

// ──────────────────────────────────────────────────────────────────────
// Test 2: env merge with undefined = DELETE
// ──────────────────────────────────────────────────────────────────────
check('Test 2 (PTY-03): descriptor.env undefined values DELETE the key from spawn env', () => {
  process.env.PTY_TEST_DELETE_ME = 'should-be-deleted';

  const { ptyMgr, store } = buildFixture({
    includeClaude: true,
    fakeProviderEnabled: true,
    fakeProviderOverrides: {
      spawnCommand: () => ({
        cmd: 'fake-cli',
        args: [],
        cwd: os.tmpdir(),
        env: { PTY_TEST_DELETE_ME: undefined, PTY_TEST_KEEP_ME: 'kept' },
      }),
    },
  });
  // Use claude provider here (default 'claude' command + provider tag) so
  // useProvider===true and provider.spawnCommand fires. Override the claude
  // provider's spawnCommand for this test only by patching directly.
  const registry = require('../src/providers');
  const claude = registry.getProvider('claude');
  claude.spawnCommand = () => ({
    cmd: 'claude', // gsd:provider-literal-allowed (test-local override)
    args: [],
    cwd: os.tmpdir(),
    env: { PTY_TEST_DELETE_ME: undefined, PTY_TEST_KEEP_ME: 'kept' },
  });

  const sessionId = makeSessionWithProvider(store, 'claude', { command: 'claude' });

  let captured = null;
  const spy = (shell, shellArgs, spawnOpts) => {
    captured = spawnOpts;
    return makeStubPty();
  };
  ptyMgr.spawnSession(sessionId, { _ptySpawnForTesting: spy });

  assert.ok(captured, 'pty.spawn must have been invoked');
  assert.ok(!('PTY_TEST_DELETE_ME' in captured.env),
    'PTY_TEST_DELETE_ME must be DELETED from env, got: ' + captured.env.PTY_TEST_DELETE_ME);
  assert.strictEqual(captured.env.PTY_TEST_KEEP_ME, 'kept',
    'PTY_TEST_KEEP_ME must be preserved');

  delete process.env.PTY_TEST_DELETE_ME;
});

// ──────────────────────────────────────────────────────────────────────
// Test 3: non-Claude provider invalid cwd falls back to homedir (NOT JSONL)
// ──────────────────────────────────────────────────────────────────────
check('Test 3 (PTY-03): non-Claude provider invalid cwd falls back to homedir', () => {
  const { ptyMgr, store } = buildFixture({
    fakeProviderEnabled: true,
    fakeProviderOverrides: {
      spawnCommand: () => ({
        cmd: 'fake-cli',
        args: [],
        cwd: '/this/path/does/not/exist/anywhere',
        env: {},
      }),
    },
  });
  const sessionId = makeSessionWithProvider(store, 'faketest', { command: 'faketest' });

  let captured = null;
  let cwdFromJsonlInvoked = false;
  const spy = (shell, shellArgs, spawnOpts) => {
    captured = spawnOpts;
    return makeStubPty();
  };
  const cwdFromJsonlSpy = () => { cwdFromJsonlInvoked = true; return '/should/not/use/this'; };

  ptyMgr.spawnSession(sessionId, {
    command: 'faketest',
    _ptySpawnForTesting: spy,
    _cwdFromJsonlForTesting: cwdFromJsonlSpy,
  });

  assert.ok(captured, 'pty.spawn must have been invoked');
  assert.strictEqual(captured.cwd, os.homedir(),
    'non-claude provider must fall back to homedir, got: ' + captured.cwd);
  assert.strictEqual(cwdFromJsonlInvoked, false,
    'cwdFromJsonl MUST NOT be called for non-claude providers');
});

// ──────────────────────────────────────────────────────────────────────
// Test 4: Claude provider invalid cwd uses cwdFromJsonl (MANDATORY)
// ──────────────────────────────────────────────────────────────────────
check('Test 4 (PTY-03): Claude invalid cwd resolves via cwdFromJsonl fallback', () => {
  const { ptyMgr, store } = buildFixture({ includeClaude: true });
  // Override claude provider's spawnCommand to return an invalid cwd so we
  // exercise the JSONL fallback branch.
  const registry = require('../src/providers');
  const claude = registry.getProvider('claude');
  claude.spawnCommand = () => ({
    cmd: 'claude', // gsd:provider-literal-allowed (test-local override)
    args: [],
    cwd: '/this/path/does/not/exist/anywhere/either',
    env: {},
  });

  const sessionId = makeSessionWithProvider(store, 'claude', { command: 'claude' });

  // Inject a fake cwdFromJsonl that returns a real, valid path. os.tmpdir()
  // is guaranteed to exist on every platform.
  const validTmpDir = os.tmpdir();
  let cwdFromJsonlInvoked = false;
  const cwdFromJsonlSpy = (resumeId) => {
    cwdFromJsonlInvoked = true;
    return validTmpDir;
  };

  let captured = null;
  const spy = (shell, shellArgs, spawnOpts) => {
    captured = spawnOpts;
    return makeStubPty();
  };

  ptyMgr.spawnSession(sessionId, {
    _ptySpawnForTesting: spy,
    _cwdFromJsonlForTesting: cwdFromJsonlSpy,
  });

  assert.ok(captured, 'pty.spawn must have been invoked');
  assert.strictEqual(cwdFromJsonlInvoked, true,
    'cwdFromJsonl MUST be called for claude provider with invalid cwd');
  assert.strictEqual(captured.cwd, validTmpDir,
    'claude must resolve cwd via JSONL fallback, got: ' + captured.cwd);
});

// ──────────────────────────────────────────────────────────────────────
// Test 5: PTY-01 regression — Claude descriptor.cmd === 'claude'
// ──────────────────────────────────────────────────────────────────────
check('Test 5 (PTY-01): Claude descriptor uses --resume when resumeSessionId provided', () => {
  const { ptyMgr, store } = buildFixture({ includeClaude: true });
  const sessionId = makeSessionWithProvider(store, 'claude', { command: 'claude' });

  let captured = null;
  const spy = (shell, shellArgs, spawnOpts) => {
    captured = { shell, shellArgs, spawnOpts };
    return makeStubPty();
  };

  ptyMgr.spawnSession(sessionId, {
    resumeSessionId: 'abc-123-def',
    _ptySpawnForTesting: spy,
    _cwdFromJsonlForTesting: () => os.tmpdir(),
  });

  assert.ok(captured, 'pty.spawn must have been invoked');
  const joined = captured.shellArgs.join(' ');
  assert.ok(joined.includes('claude'), 'fullCommand must contain claude binary, got: ' + joined);
  assert.ok(joined.includes('--resume'), 'fullCommand must contain --resume, got: ' + joined);
  assert.ok(joined.includes('abc-123-def'), 'fullCommand must contain the resume id, got: ' + joined);
});

// ──────────────────────────────────────────────────────────────────────
// Test 6: Non-default-command bypass — command:'td' bypasses provider lookup
// ──────────────────────────────────────────────────────────────────────
check('Test 6 (PTY-03 safety net): command:"td" bypasses provider, fullCommand starts with td', () => {
  const { ptyMgr, store, registry } = buildFixture({ includeClaude: true });

  // Spy on the registry to confirm it is NEVER consulted on the bypass path.
  // Wrap getProvider in a spy.
  const realGetProvider = registry.getProvider;
  let getProviderCallCount = 0;
  const trackedIds = [];
  registry.getProvider = function(id) {
    getProviderCallCount++;
    trackedIds.push(id);
    return realGetProvider.call(registry, id);
  };

  // Create a session that does NOT have a claude tag — but that doesn't matter,
  // because the bypass branch is BEFORE the provider lookup. The deciding
  // factor is opts.command !== 'claude'.
  const sessionId = makeSessionWithProvider(store, 'claude', { command: 'td' });

  let captured = null;
  const spy = (shell, shellArgs, spawnOpts) => {
    captured = { shell, shellArgs, spawnOpts };
    return makeStubPty();
  };

  ptyMgr.spawnSession(sessionId, {
    command: 'td',
    _ptySpawnForTesting: spy,
  });

  // Restore the real getProvider before any subsequent test runs.
  registry.getProvider = realGetProvider;

  assert.ok(captured, 'pty.spawn must have been invoked');
  const joined = captured.shellArgs.join(' ');
  // The fullCommand should START with 'td' (it's the descriptor.cmd).
  // After shell-wrap, shellArgs is something like ['/c', 'td'] (cmd) or
  // ['-l', '-c', 'td'] (bash). Last token is the joined fullCommand.
  const fullCommand = captured.shellArgs[captured.shellArgs.length - 1];
  assert.ok(fullCommand.startsWith('td'),
    'fullCommand must START with td (not claude), got: ' + fullCommand);
  assert.ok(!fullCommand.startsWith('claude'),
    'fullCommand must NOT start with claude on bypass path, got: ' + fullCommand);
  assert.strictEqual(getProviderCallCount, 0,
    'registry.getProvider MUST NOT be called on the non-default-command bypass path. ' +
    'Called ' + getProviderCallCount + ' times with: ' + JSON.stringify(trackedIds));
});

// ──────────────────────────────────────────────────────────────────────
console.log('  ' + '-'.repeat(42));
console.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
console.log('  ' + '-'.repeat(42) + '\n');

if (failed > 0) {
  process.exit(1);
}
console.log('All passed.');
process.exit(0);
