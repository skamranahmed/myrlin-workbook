#!/usr/bin/env node
/**
 * Tests for src/providers/codex/parse.js (Phase 17 Plan 17-01).
 *
 * Coverage:
 *   1. parseTranscript handles modern envelope-shaped fixture end-to-end (CDX-03)
 *   2. parseTranscript emits compacted as a single '[history fold]' placeholder (CDX-05)
 *   3. parseTranscript skips session_meta, turn_context, event_msg, reasoning
 *   4. parseTranscript handles legacy bare-JSON via synthetic envelope (CDX-04, CDX-08)
 *   5. parseTranscript returns [] for missing session id
 *   6. parseTranscript returns [] for null/undefined/empty input
 *   7. parseTranscript skips corrupt JSONL lines without throwing
 *   8. _internal.wrapEnvelope correctly classifies all four shapes
 *   9. _internal.extractMessageText filters non-text content parts
 *  10. function_call payload emits role:'tool' with name+arguments text
 *
 * Standalone-test convention: this file owns its own assertion helpers and
 * exits 0 on green / 1 on any failure with offender list. Mirrors
 * test/find-jsonl-refactor.test.js scaffolding.
 *
 * Each test stages CODEX_HOME into a unique temp directory, copies the
 * fixture into the date-bucketed sessions/YYYY/MM/DD/ path, runs
 * parseTranscript, asserts the result, and cleans up. All env mutations
 * are reverted in finally blocks so test ordering is irrelevant.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// ─── Assertion helpers ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + name);
  } catch (err) {
    failed++;
    failures.push({ name, err });
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

// ─── Fixture staging helpers ───────────────────────────────────────────────

const PROJECT_ROOT = path.join(__dirname, '..');
const MODERN_FIXTURE = path.join(PROJECT_ROOT, 'test', 'fixtures', 'codex-rollouts', 'modern.jsonl');
const LEGACY_FIXTURE = path.join(PROJECT_ROOT, 'test', 'fixtures', 'codex-rollouts', 'legacy-bare.jsonl');

/**
 * Stage a CODEX_HOME tempdir, copy `fixturePath` into
 * sessions/<dateDir>/rollout-...-<id>.jsonl, set process.env.CODEX_HOME,
 * and return the cleanup function plus the staged path.
 *
 * @param {string} fixturePath - source fixture file
 * @param {string} dateDir - 'YYYY/MM/DD' date bucket
 * @param {string} id - UUID to embed in filename
 * @returns {{ tmp: string, stagedPath: string, cleanup: () => void }}
 */
function stageFixture(fixturePath, dateDir, id) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cwm-codex-parse-'));
  const dayDir = path.join(tmp, 'sessions', ...dateDir.split('/'));
  fs.mkdirSync(dayDir, { recursive: true });
  // Use a synthetic ISO timestamp prefix to mimic real Codex filenames.
  const stagedPath = path.join(dayDir, 'rollout-' + dateDir.replace(/\//g, '-') + 'T00-00-00-' + id + '.jsonl');
  fs.copyFileSync(fixturePath, stagedPath);
  const prevEnv = process.env.CODEX_HOME;
  process.env.CODEX_HOME = tmp;
  return {
    tmp: tmp,
    stagedPath: stagedPath,
    cleanup: () => {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch (_) { /* ignore */ }
      if (prevEnv === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = prevEnv;
      }
    },
  };
}

/**
 * Run `fn(staged)` synchronously with a staged fixture. Returns a Promise
 * because parseTranscript is async.
 *
 * @param {string} fixturePath
 * @param {string} dateDir
 * @param {string} id
 * @param {Function} fn - async (staged) => Promise<void>
 */
async function withStagedFixture(fixturePath, dateDir, id, fn) {
  const staged = stageFixture(fixturePath, dateDir, id);
  try {
    await fn(staged);
  } finally {
    staged.cleanup();
  }
}

// ─── Parser require (after helpers, so failures here mark us non-zero) ─────

let parse;
try {
  parse = require('../src/providers/codex/parse');
} catch (err) {
  console.error('FATAL: could not require src/providers/codex/parse.js: ' + err.message);
  process.exit(1);
}

const { parseTranscript, _internal } = parse;

// Suppress noisy stderr warnings from the parser's bare-JSON detection
// during the legacy-bare test run; we re-attach the real warner immediately
// after each test so unrelated assertion-failure logs are not swallowed.
const realWarn = console.warn;

// ─── Run tests ─────────────────────────────────────────────────────────────

console.log('\n  Plan 17-01: codex/parse.js');
console.log('  ' + '-'.repeat(70));

(async () => {
  // ─── Test 1: modern envelope end-to-end (CDX-03) ────────────────────────
  await withStagedFixture(MODERN_FIXTURE, '2026/04/26', '019dc872-a308-7111-ba78-068f9294120c', async () => {
    const messages = await parseTranscript('019dc872-a308-7111-ba78-068f9294120c');
    test('parseTranscript handles modern envelope-shaped fixture end-to-end', () => {
      assert(Array.isArray(messages), 'expected an array');
      assert(messages.length >= 5, 'expected at least 5 messages, got ' + messages.length);
      for (const m of messages) {
        assert(typeof m === 'object', 'message must be an object');
        assert(typeof m.role === 'string', 'message.role must be string');
        assert(typeof m.text === 'string', 'message.text must be string');
        assert(m.timestamp === null || typeof m.timestamp === 'string', 'message.timestamp must be string|null');
        assertEqual(m.model, null, 'message.model must be null per parser contract');
      }
    });

    // ─── Test 2: compacted placeholder (CDX-05 parser half) ────────────────
    test('parseTranscript emits compacted as a single [history fold] placeholder', () => {
      const folds = messages.filter((m) => m.text === '[history fold]');
      assertEqual(folds.length, 1, 'expected exactly one [history fold]');
      assertEqual(folds[0].role, 'system', 'fold message role must be system');
    });

    // ─── Test 3: skip set is honored ───────────────────────────────────────
    test('parseTranscript skips session_meta, turn_context, event_msg, reasoning', () => {
      // session_meta would leak base_instructions text; not present.
      // turn_context would leak summary='auto'; not present.
      // event_msg user_message would leak the duplicate string; not present.
      // reasoning would leak encrypted_content; not present.
      for (const m of messages) {
        assert(!m.text.includes('You are Codex'), 'session_meta base_instructions leaked: ' + m.text);
        assert(!m.text.includes('gAAAAABp7a'), 'reasoning encrypted_content leaked: ' + m.text);
        assert(!m.text.includes('This event_msg duplicate'), 'event_msg user_message duplicate leaked: ' + m.text);
        assert(!m.text.includes('task_started'), 'event_msg task_started leaked: ' + m.text);
      }
    });

    // ─── Test 10: function_call payload shape ──────────────────────────────
    test('function_call emits role:tool with name+arguments text', () => {
      const toolCalls = messages.filter((m) => m.role === 'tool' && m.text.startsWith('shell_command'));
      assertEqual(toolCalls.length, 1, 'expected exactly one shell_command tool call');
      assert(toolCalls[0].text.includes('"command":"ls"'), 'expected arguments JSON in tool text');
    });
  });

  // ─── Test 4: legacy bare-JSON wrap (CDX-04, CDX-08) ──────────────────────
  await withStagedFixture(LEGACY_FIXTURE, '2026/04/23', '019dbc37-4284-71c2-b216-8f9b6c431001', async () => {
    // Suppress the once-per-file bare-JSON warning during this test only.
    let warnCount = 0;
    console.warn = (msg) => { warnCount++; void msg; };
    let messages;
    try {
      messages = await parseTranscript('019dbc37-4284-71c2-b216-8f9b6c431001');
    } finally {
      console.warn = realWarn;
    }
    test('parseTranscript handles legacy bare-JSON via synthetic envelope', () => {
      assert(Array.isArray(messages), 'expected an array');
      assert(messages.length >= 2, 'expected at least 2 messages, got ' + messages.length);
      const userMsgs = messages.filter((m) => m.role === 'user');
      const asstMsgs = messages.filter((m) => m.role === 'assistant');
      assert(userMsgs.length >= 1, 'expected at least 1 user message');
      assert(asstMsgs.length >= 1, 'expected at least 1 assistant message');
      assert(userMsgs[0].text.includes('Legacy bare-JSON user message'), 'user text content extracted');
      assert(asstMsgs[0].text.includes('Legacy bare-JSON assistant reply'), 'assistant text content extracted');
      assert(warnCount >= 1, 'expected at least one once-per-file bare-JSON warning');
    });
  });

  // ─── Test 5: missing session id returns [] ───────────────────────────────
  await withStagedFixture(MODERN_FIXTURE, '2026/04/26', '019dc872-a308-7111-ba78-068f9294120c', async () => {
    test('parseTranscript returns [] for unknown providerSessionId in staged dir', async () => {
      const messages = await parseTranscript('00000000-0000-0000-0000-000000000000');
      assert(Array.isArray(messages), 'expected array');
      assertEqual(messages.length, 0, 'expected empty array for missing id');
    });
  });

  // ─── Test 6: null/undefined/empty input ──────────────────────────────────
  test('parseTranscript returns [] for null/undefined/empty input', async () => {
    const a = await parseTranscript();
    const b = await parseTranscript(null);
    const c = await parseTranscript('');
    assertEqual(a.length, 0, 'undefined input must return []');
    assertEqual(b.length, 0, 'null input must return []');
    assertEqual(c.length, 0, 'empty string input must return []');
  });

  // ─── Test 7: corrupt JSONL ──────────────────────────────────────────────
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cwm-codex-corrupt-'));
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0001';
    const dayDir = path.join(tmp, 'sessions', '2026', '04', '26');
    fs.mkdirSync(dayDir, { recursive: true });
    const fp = path.join(dayDir, 'rollout-2026-04-26T00-00-00-' + id + '.jsonl');
    const validUserLine = '{"timestamp":"2026-04-26T00:00:00.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"valid"}]}}';
    const validAsstLine = '{"timestamp":"2026-04-26T00:00:01.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"reply"}]}}';
    fs.writeFileSync(fp, validUserLine + '\n{this is not json}\n' + validAsstLine + '\n', 'utf-8');
    const prevEnv = process.env.CODEX_HOME;
    process.env.CODEX_HOME = tmp;
    let messages;
    try {
      messages = await parseTranscript(id);
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
      if (prevEnv === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = prevEnv;
    }
    test('parseTranscript skips corrupt JSONL lines without throwing', () => {
      assertEqual(messages.length, 2, 'expected 2 valid messages, got ' + messages.length);
      assertEqual(messages[0].role, 'user', 'first message must be user');
      assertEqual(messages[1].role, 'assistant', 'second message must be assistant');
    });
  }

  // ─── Test 8: _internal.wrapEnvelope shape classification ────────────────
  test('_internal.wrapEnvelope correctly classifies all four shapes', () => {
    // Shape 1: modern envelope passes through.
    const env1 = _internal.wrapEnvelope({ type: 'response_item', timestamp: 't', payload: { type: 'message' } });
    assertEqual(env1.type, 'response_item', 'modern envelope should pass through');
    assertEqual(env1.timestamp, 't', 'timestamp preserved');

    // Shape 2: bare SessionMeta wraps.
    const env2 = _internal.wrapEnvelope({ id: 'abc', cwd: '/tmp', cli_version: '0.42.0', timestamp: 'ts2' });
    assertEqual(env2.type, 'session_meta', 'bare SessionMeta wraps to session_meta');
    assertEqual(env2.timestamp, 'ts2', 'timestamp lifted');
    assertEqual(env2.payload.id, 'abc', 'original payload preserved');

    // Shape 3: bare ResponseItem wraps.
    const env3 = _internal.wrapEnvelope({ role: 'user', content: [{ type: 'input_text', text: 'hi' }] });
    assertEqual(env3.type, 'response_item', 'bare ResponseItem wraps to response_item');
    assertEqual(env3.payload.type, 'message', 'synthesized payload.type is message');
    assertEqual(env3.payload.role, 'user', 'role preserved');

    // Shape 4: garbage returns null.
    assertEqual(_internal.wrapEnvelope(null), null, 'null returns null');
    assertEqual(_internal.wrapEnvelope(undefined), null, 'undefined returns null');
    assertEqual(_internal.wrapEnvelope({}), null, 'empty object returns null');
    assertEqual(_internal.wrapEnvelope({ random: 'shape' }), null, 'unknown shape returns null');
    assertEqual(_internal.wrapEnvelope('string'), null, 'string returns null');
  });

  // ─── Test 9: _internal.extractMessageText filtering ─────────────────────
  test('_internal.extractMessageText filters non-text content parts', () => {
    const text = _internal.extractMessageText([
      { type: 'input_text', text: 'hello ' },
      { type: 'image', url: 'ignored' },
      { type: 'output_text', text: 'world' },
      null,
      { type: 'input_text' }, // no text field
    ]);
    assertEqual(text, 'hello world', 'expected only text parts joined');
    assertEqual(_internal.extractMessageText(null), '', 'null content returns empty string');
    assertEqual(_internal.extractMessageText('not array'), '', 'non-array returns empty string');
  });

  // ─── Summary + exit ─────────────────────────────────────────────────────
  console.log('  ' + '-'.repeat(70));
  console.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
