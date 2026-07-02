#!/usr/bin/env node
/**
 * Tests for codexProvider.findArtifactPath / findArtifactByWorkingDir
 * (session-lifecycle fix: Codex parity with claudeProvider artifact lookup).
 *
 * Why this exists: any codex-tagged store session with a resumeSessionId made
 * GET /api/cost/batch throw "provider.findArtifactPath is not a function"
 * (the provider object exported neither method), 500ing the whole batch so
 * cost badges broke for EVERY session. These tests pin the parity contract:
 *
 *   1. findArtifactPath resolves a rollout under sessions/YYYY/MM/DD
 *   2. findArtifactPath resolves a rollout under archived_sessions/ (flat)
 *   3. findArtifactPath prefers the live sessions/ copy over an archived
 *      duplicate of the same id
 *   4. findArtifactPath returns null on miss and on bad input (never throws)
 *   5. findArtifactPath is SYNCHRONOUS (returns a string/null, not a Promise),
 *      matching how server.js route handlers consume it
 *   6. findArtifactByWorkingDir returns {jsonlPath, claudeSessionId} for a
 *      cwd match, picking the most recent file by mtime
 *   7. findArtifactByWorkingDir returns null when nothing matches
 *   8. Provider-shape parity gate: codexProvider exports both methods with
 *      the same typeof as claudeProvider
 *
 * Fixture strategy mirrors test/codex-discover.test.js: each test stages a
 * unique CODEX_HOME tempdir, copies test/fixtures/codex-rollouts/modern.jsonl
 * (session_meta first line, cwd "/home/user/project"), runs the lookup, and
 * restores CODEX_HOME afterwards.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// ─── Assertion helpers ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

/**
 * Run one named test; tally pass/fail without aborting the suite.
 * @param {string} name Test description.
 * @param {() => void} fn Body that throws on failure.
 */
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

/** Throw when the condition is falsy. */
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

/** Strict-equality assert with actual/expected in the default message. */
function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(msg || ('Expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual)));
  }
}

// ─── Module require ────────────────────────────────────────────────────────

let codexProvider;
let claudeProvider;
try {
  codexProvider = require('../src/providers/codex');
  claudeProvider = require('../src/providers/claude');
} catch (err) {
  console.error('FATAL: could not require provider modules: ' + err.message);
  process.exit(1);
}

// ─── Staging helpers ───────────────────────────────────────────────────────

const PROJECT_ROOT = path.join(__dirname, '..');
const MODERN_FIXTURE = path.join(PROJECT_ROOT, 'test', 'fixtures', 'codex-rollouts', 'modern.jsonl');

/**
 * Build a fresh CODEX_HOME tempdir. Returns the abs path.
 */
function makeCodexHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cwm-codex-artifact-'));
}

/**
 * Stage one rollout file under sessions/<date>/ using the modern fixture.
 * @param {string} codexHome
 * @param {string} dateDir e.g. '2026/04/26'
 * @param {string} id UUID embedded in filename
 * @returns {string} absolute path of the staged file
 */
function stageRollout(codexHome, dateDir, id) {
  const dayDir = path.join(codexHome, 'sessions', ...dateDir.split('/'));
  fs.mkdirSync(dayDir, { recursive: true });
  const fp = path.join(dayDir, 'rollout-' + dateDir.replace(/\//g, '-') + 'T00-00-00-' + id + '.jsonl');
  fs.copyFileSync(MODERN_FIXTURE, fp);
  return fp;
}

/**
 * Stage one rollout file flat under archived_sessions/ (real on-disk layout).
 * @param {string} codexHome
 * @param {string} id UUID embedded in filename
 * @returns {string} absolute path of the staged file
 */
function stageArchivedRollout(codexHome, id) {
  const dir = path.join(codexHome, 'archived_sessions');
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, 'rollout-2026-04-23T17-20-31-' + id + '.jsonl');
  fs.copyFileSync(MODERN_FIXTURE, fp);
  return fp;
}

/**
 * Run a test body with CODEX_HOME pointed at `tmp`; restore + rm afterwards.
 */
function withCodexHome(tmp, fn) {
  const prev = process.env.CODEX_HOME;
  process.env.CODEX_HOME = tmp;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prev;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
}

// ─── Run tests ─────────────────────────────────────────────────────────────

console.log('\n  session-lifecycle: codexProvider.findArtifactPath / findArtifactByWorkingDir');
console.log('  ' + '-'.repeat(74));

// ─── Test 1: live sessions/ lookup ─────────────────────────────────────────
{
  const tmp = makeCodexHome();
  const id = '019dc872-a308-7111-ba78-068f9294120c';
  const staged = stageRollout(tmp, '2026/04/26', id);
  withCodexHome(tmp, () => {
    test('findArtifactPath resolves a rollout under sessions/YYYY/MM/DD', () => {
      const result = codexProvider.findArtifactPath(id);
      assertEqual(result, staged, 'expected staged sessions/ path');
    });
  });
}

// ─── Test 2: archived_sessions/ lookup ─────────────────────────────────────
{
  const tmp = makeCodexHome();
  const id = '019dbc37-4284-71c2-b216-8f9b6c431001';
  const staged = stageArchivedRollout(tmp, id);
  withCodexHome(tmp, () => {
    test('findArtifactPath resolves a rollout under archived_sessions/ (flat)', () => {
      const result = codexProvider.findArtifactPath(id);
      assertEqual(result, staged, 'expected staged archived path');
    });
  });
}

// ─── Test 3: live copy preferred over archived duplicate ───────────────────
{
  const tmp = makeCodexHome();
  const id = '019dcac8-f459-7fa0-83e8-3c3112d0fe0e';
  const live = stageRollout(tmp, '2026/04/26', id);
  stageArchivedRollout(tmp, id);
  withCodexHome(tmp, () => {
    test('findArtifactPath prefers the live sessions/ copy over an archived duplicate', () => {
      const result = codexProvider.findArtifactPath(id);
      assertEqual(result, live, 'sessions/ path must win over archived_sessions/');
    });
  });
}

// ─── Test 4: miss + bad input return null, never throw ─────────────────────
{
  const tmp = makeCodexHome();
  stageRollout(tmp, '2026/04/26', '019dc872-a308-7111-ba78-068f9294120c');
  withCodexHome(tmp, () => {
    test('findArtifactPath returns null on miss and on bad input (never throws)', () => {
      assertEqual(codexProvider.findArtifactPath('00000000-0000-7000-8000-000000000000'), null, 'unknown id');
      assertEqual(codexProvider.findArtifactPath(null), null, 'null input');
      assertEqual(codexProvider.findArtifactPath(''), null, 'empty input');
      assertEqual(codexProvider.findArtifactPath(42), null, 'non-string input');
    });
  });
}

// ─── Test 5: synchronous return shape (server.js consumes it sync) ─────────
{
  const tmp = makeCodexHome();
  const id = '019dc872-a308-7111-ba78-068f9294120c';
  stageRollout(tmp, '2026/04/26', id);
  withCodexHome(tmp, () => {
    test('findArtifactPath is synchronous (string|null, not a Promise)', () => {
      const hit = codexProvider.findArtifactPath(id);
      const miss = codexProvider.findArtifactPath('00000000-0000-7000-8000-000000000000');
      assert(typeof hit === 'string', 'hit must be a plain string, got ' + typeof hit);
      assert(!(hit instanceof Promise), 'hit must not be a Promise');
      assertEqual(miss, null, 'miss must be a plain null');
    });
  });
}

// ─── Test 6: findArtifactByWorkingDir matches cwd, newest wins ──────────────
{
  const tmp = makeCodexHome();
  const idOld = '019dc872-a308-7111-ba78-068f9294120c';
  const idNew = '019dcac8-f459-7fa0-83e8-3c3112d0fe0e';
  const fpOld = stageRollout(tmp, '2026/04/24', idOld);
  const fpNew = stageRollout(tmp, '2026/04/26', idNew);
  // Both fixtures share cwd "/home/user/project"; make idNew clearly newer.
  fs.utimesSync(fpOld, new Date('2026-04-20T00:00:00Z'), new Date('2026-04-20T00:00:00Z'));
  fs.utimesSync(fpNew, new Date('2026-04-26T00:00:00Z'), new Date('2026-04-26T00:00:00Z'));
  withCodexHome(tmp, () => {
    test('findArtifactByWorkingDir returns most recent match with the claude-shaped keys', () => {
      const result = codexProvider.findArtifactByWorkingDir('/home/user/project');
      assert(result && typeof result === 'object', 'expected an object result');
      assertEqual(result.jsonlPath, fpNew, 'newest matching rollout wins');
      // Key name intentionally mirrors claudeProvider's return shape; it is the
      // cross-provider contract server.js reads (result.claudeSessionId).
      assertEqual(result.claudeSessionId, idNew, 'claudeSessionId carries the codex UUID');
    });
  });
}

// ─── Test 7: findArtifactByWorkingDir null on no match / bad input ──────────
{
  const tmp = makeCodexHome();
  stageRollout(tmp, '2026/04/26', '019dc872-a308-7111-ba78-068f9294120c');
  withCodexHome(tmp, () => {
    test('findArtifactByWorkingDir returns null when nothing matches (never throws)', () => {
      assertEqual(codexProvider.findArtifactByWorkingDir('/does/not/exist/anywhere'), null, 'unknown cwd');
      assertEqual(codexProvider.findArtifactByWorkingDir(null), null, 'null input');
      assertEqual(codexProvider.findArtifactByWorkingDir(''), null, 'empty input');
    });
  });
}

// ─── Test 8: parity gate with claudeProvider ────────────────────────────────
test('provider-shape parity: codexProvider exports both artifact methods like claudeProvider', () => {
  assertEqual(typeof claudeProvider.findArtifactPath, 'function', 'claude findArtifactPath');
  assertEqual(typeof claudeProvider.findArtifactByWorkingDir, 'function', 'claude findArtifactByWorkingDir');
  assertEqual(typeof codexProvider.findArtifactPath, 'function', 'codex findArtifactPath');
  assertEqual(typeof codexProvider.findArtifactByWorkingDir, 'function', 'codex findArtifactByWorkingDir');
});

// ─── Summary + exit ─────────────────────────────────────────────────────────
console.log('  ' + '-'.repeat(74));
console.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
