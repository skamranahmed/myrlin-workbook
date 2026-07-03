#!/usr/bin/env node
/**
 * Tests for the codex parseLine extraction (issue #10 Tier 1, Phase 2).
 *
 * Coverage:
 *   1. PARITY: mapping parseLine over the modern fixture rollout equals
 *      parseTranscript's output on the same staged file (projection to the
 *      ProviderMessage shape), so the mirror view and the transcript view
 *      can never drift.
 *   2. PARITY on the legacy bare-JSON fixture (bare-shape wrap path).
 *   3. Direct parseLine cases: message roles, function_call (kind tool_use +
 *      toolName), function_call_output (kind tool_result), compacted (kind
 *      system, '[history fold]'), skip set, garbage, meta.bareJson out-param,
 *      default text cap sets truncated, Infinity disables the cap.
 *   4. Provider capability surface: codexProvider.mirror.parseLine wired,
 *      supportsForkResume() === false.
 *
 * Standalone-test convention: owns its assertion helpers, exits 0 on green,
 * 1 on any failure. NOT yet registered in test/run.js (owned by the alpha.11
 * wave; a later wiring task registers this suite).
 */

'use strict';

// MANDATORY sandbox (see _test-data-dir.js header for the 2026-05-11
// prod-wipe incident).
require('./_test-data-dir');

const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseTranscript, parseLine, MIRROR_MAX_TEXT_CHARS } = require('../src/providers/codex/parse');
const codexProvider = require('../src/providers/codex');

// --- Assertion helpers ------------------------------------------------------

let passed = 0;
let failed = 0;

/**
 * Run one named test body, tallying pass/fail without aborting the suite.
 * @param {string} name - Human-readable test label.
 * @param {Function} fn - Synchronous assertion body.
 */
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  \x1b[32mok\x1b[0m ' + name);
  } catch (err) {
    failed++;
    console.log('  \x1b[31mFAIL\x1b[0m ' + name);
    console.log('    \x1b[31m' + err.message + '\x1b[0m');
  }
}

/**
 * Throw unless cond is truthy.
 * @param {*} cond
 * @param {string} msg
 */
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

/**
 * Throw unless actual === expected.
 * @param {*} actual
 * @param {*} expected
 * @param {string} [msg]
 */
function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || 'assertEqual') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

// --- Fixture staging (mirrors test/codex-parse.test.js) ----------------------

const PROJECT_ROOT = path.join(__dirname, '..');
const MODERN_FIXTURE = path.join(PROJECT_ROOT, 'test', 'fixtures', 'codex-rollouts', 'modern.jsonl');
const LEGACY_FIXTURE = path.join(PROJECT_ROOT, 'test', 'fixtures', 'codex-rollouts', 'legacy-bare.jsonl');

/**
 * Stage a fixture rollout under a temp CODEX_HOME so parseTranscript can
 * resolve it by session id. Returns staged path + cleanup that restores env.
 * @param {string} fixturePath - Source fixture file.
 * @param {string} dateDir - 'YYYY/MM/DD' bucket.
 * @param {string} id - Session UUID embedded in the filename.
 * @returns {{stagedPath: string, cleanup: () => void}}
 */
function stageFixture(fixturePath, dateDir, id) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cwm-codex-mirror-'));
  const dayDir = path.join(tmp, 'sessions', ...dateDir.split('/'));
  fs.mkdirSync(dayDir, { recursive: true });
  const stagedPath = path.join(dayDir, 'rollout-' + dateDir.replace(/\//g, '-') + 'T00-00-00-' + id + '.jsonl');
  fs.copyFileSync(fixturePath, stagedPath);
  const prevEnv = process.env.CODEX_HOME;
  process.env.CODEX_HOME = tmp;
  return {
    stagedPath: stagedPath,
    cleanup: () => {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
      if (prevEnv === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = prevEnv;
    },
  };
}

/**
 * Project a MirrorMessage down to the ProviderMessage shape parseTranscript
 * returns, so the two can be deep-compared.
 * @param {Object} m - MirrorMessage.
 * @returns {{role: string, text: string, timestamp: string|null, model: string|null}}
 */
function toProviderShape(m) {
  return { role: m.role, text: m.text, timestamp: m.timestamp, model: m.model };
}

/**
 * Map parseLine over every line of a rollout file with the same options
 * parseTranscript uses internally (uncapped), keeping non-null results.
 * @param {string} filePath - Rollout file to read.
 * @returns {Array<Object>} MirrorMessages in file order.
 */
function parseLinesOfFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line || line.length === 0) continue;
    const m = parseLine(line, { maxTextChars: Infinity });
    if (m) out.push(m);
  }
  return out;
}

/**
 * Run a parity check: parseTranscript(id) versus mapped parseLine over the
 * staged file, compared as JSON.
 * @param {string} fixturePath
 * @param {string} dateDir
 * @param {string} id
 * @param {string} label - Test label.
 * @returns {Promise<void>}
 */
async function parityCheck(fixturePath, dateDir, id, label) {
  const staged = stageFixture(fixturePath, dateDir, id);
  const realWarn = console.warn;
  console.warn = () => {}; // legacy fixture emits the once-per-file bare-JSON warning
  let transcript;
  try {
    transcript = await parseTranscript(id);
  } finally {
    console.warn = realWarn;
    staged.cleanup();
  }
  // Read the fixture directly for the parseLine mapping; identical content.
  const mirrored = parseLinesOfFile(fixturePath).map(toProviderShape);
  test(label, () => {
    assert(transcript.length > 0, 'fixture must produce messages');
    assertEqual(JSON.stringify(mirrored), JSON.stringify(transcript), 'parseLine mapping must equal parseTranscript output');
  });
}

// --- Suite ------------------------------------------------------------------

console.log('\n  issue #10 Phase 2: codex parseLine extraction');
console.log('  ' + '-'.repeat(70));

(async () => {
  // 1 + 2. Parity on both fixtures.
  await parityCheck(MODERN_FIXTURE, '2026/04/26', '019dc872-a308-7111-ba78-068f9294120c',
    'PARITY: parseLine mapping equals parseTranscript on the modern fixture');
  await parityCheck(LEGACY_FIXTURE, '2026/04/23', '019dbc37-4284-71c2-b216-8f9b6c431001',
    'PARITY: parseLine mapping equals parseTranscript on the legacy bare-JSON fixture');

  // 3. Direct parseLine cases.
  const TS = '2026-07-02T12:00:00.000Z';

  test('response_item.message user -> {role:user, kind:text}', () => {
    const m = parseLine(JSON.stringify({
      timestamp: TS, type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi codex' }] },
    }));
    assert(m, 'message expected');
    assertEqual(m.role, 'user');
    assertEqual(m.kind, 'text');
    assertEqual(m.text, 'hi codex');
    assertEqual(m.timestamp, TS);
    assertEqual(m.model, null);
  });

  test('response_item.message developer -> role system', () => {
    const m = parseLine(JSON.stringify({
      timestamp: TS, type: 'response_item',
      payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'policy' }] },
    }));
    assert(m, 'message expected');
    assertEqual(m.role, 'system');
    assertEqual(m.kind, 'text');
  });

  test('function_call -> {role:tool, kind:tool_use, toolName, name+args text}', () => {
    const m = parseLine(JSON.stringify({
      timestamp: TS, type: 'response_item',
      payload: { type: 'function_call', name: 'shell_command', arguments: '{"command":"ls"}' },
    }));
    assert(m, 'message expected');
    assertEqual(m.role, 'tool');
    assertEqual(m.kind, 'tool_use');
    assertEqual(m.toolName, 'shell_command');
    assertEqual(m.text, 'shell_command {"command":"ls"}');
  });

  test('function_call_output -> {role:tool, kind:tool_result, output text}', () => {
    const m = parseLine(JSON.stringify({
      timestamp: TS, type: 'response_item',
      payload: { type: 'function_call_output', output: 'total 42' },
    }));
    assert(m, 'message expected');
    assertEqual(m.role, 'tool');
    assertEqual(m.kind, 'tool_result');
    assertEqual(m.text, 'total 42');
    assertEqual(m.toolName, undefined, 'no toolName on results');
  });

  test('compacted -> {role:system, kind:system, [history fold]}', () => {
    const m = parseLine(JSON.stringify({ timestamp: TS, type: 'compacted', payload: { message: 'folded' } }));
    assert(m, 'message expected');
    assertEqual(m.role, 'system');
    assertEqual(m.kind, 'system');
    assertEqual(m.text, '[history fold]');
  });

  test('skip set returns null (session_meta, turn_context, event_msg, reasoning)', () => {
    assertEqual(parseLine(JSON.stringify({ type: 'session_meta', payload: { id: 'x', cwd: '/tmp', cli_version: '0.45.0' } })), null, 'session_meta');
    assertEqual(parseLine(JSON.stringify({ type: 'turn_context', payload: { summary: 'auto' } })), null, 'turn_context');
    assertEqual(parseLine(JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'dupe' } })), null, 'event_msg');
    assertEqual(parseLine(JSON.stringify({ type: 'response_item', payload: { type: 'reasoning', encrypted_content: 'gAAAA' } })), null, 'reasoning');
  });

  test('garbage and hostile input return null, never throws', () => {
    assertEqual(parseLine('{not json}'), null, 'corrupt JSON');
    assertEqual(parseLine(''), null, 'empty string');
    assertEqual(parseLine(null), null, 'null input');
    assertEqual(parseLine(undefined), null, 'undefined input');
    assertEqual(parseLine('42'), null, 'JSON number');
    assertEqual(parseLine(JSON.stringify({ random: 'shape' })), null, 'unknown bare shape');
    assertEqual(parseLine(JSON.stringify({ type: 'response_item', payload: { type: 'mystery_subtype' } })), null, 'unknown response_item subtype');
  });

  test('bare pre-0.45 line wraps and sets meta.bareJson', () => {
    const meta = {};
    const m = parseLine(JSON.stringify({ role: 'user', content: [{ type: 'input_text', text: 'legacy hello' }] }), { meta: meta });
    assert(m, 'message expected');
    assertEqual(m.role, 'user');
    assertEqual(m.text, 'legacy hello');
    assertEqual(meta.bareJson, true, 'meta.bareJson out-param set');
    // Modern envelope must NOT set the flag.
    const meta2 = {};
    parseLine(JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [] } }), { meta: meta2 });
    assertEqual(meta2.bareJson, undefined, 'modern envelope leaves meta untouched');
  });

  test('default cap truncates at MIRROR_MAX_TEXT_CHARS; Infinity disables it', () => {
    const big = 'q'.repeat(MIRROR_MAX_TEXT_CHARS + 100);
    const line = JSON.stringify({
      timestamp: TS, type: 'response_item',
      payload: { type: 'function_call_output', output: big },
    });
    const capped = parseLine(line);
    assertEqual(capped.text.length, MIRROR_MAX_TEXT_CHARS, 'capped by default');
    assertEqual(capped.truncated, true, 'truncated flag set');
    const uncapped = parseLine(line, { maxTextChars: Infinity });
    assertEqual(uncapped.text.length, big.length, 'Infinity disables the cap');
    assertEqual(uncapped.truncated, undefined, 'no flag when uncapped');
  });

  // 4. Provider capability surface.
  test('codexProvider exposes mirror.parseLine and supportsForkResume:false', () => {
    assert(codexProvider.mirror && typeof codexProvider.mirror.parseLine === 'function', 'mirror.parseLine wired');
    assertEqual(codexProvider.mirror.parseLine, parseLine, 'same function object as the parse module export');
    assertEqual(typeof codexProvider.supportsForkResume, 'function', 'supportsForkResume exported');
    assertEqual(codexProvider.supportsForkResume(), false, 'Codex has no fork/resume affordance');
  });

  console.log('  ' + '-'.repeat(70));
  console.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
