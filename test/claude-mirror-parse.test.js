#!/usr/bin/env node
/**
 * Tests for src/providers/claude/mirror.js (issue #10 Tier 1, Phase 2).
 *
 * Pure string-in / message-out coverage of parseLine:
 *   user text (string + array content), assistant text with model,
 *   tool_use mapping, tool_result mapping (string + array content),
 *   oversized-text cap sets truncated, system lines, garbage -> null,
 *   skipped entry types -> null, never-throws on hostile input.
 *
 * Standalone-test convention: owns its assertion helpers, exits 0 on green,
 * 1 on any failure. NOT yet registered in test/run.js (owned by the alpha.11
 * wave; a later wiring task registers this suite).
 */

'use strict';

// MANDATORY sandbox (see _test-data-dir.js header for the 2026-05-11
// prod-wipe incident). This suite is pure, but the guard is cheap and the
// convention is every test file requires it first.
require('./_test-data-dir');

const { parseLine, MIRROR_MAX_TEXT_CHARS } = require('../src/providers/claude/mirror');
// Cross-contract check: the tailer's oversized-line sentinel must map to
// null here (it is NUL-framed and can never be valid JSON).
const { OVERSIZED_LINE_SENTINEL } = require('../src/web/jsonl-tailer');

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

// --- Suite ------------------------------------------------------------------

console.log('\n  issue #10 Phase 2: claude/mirror.js parseLine');
console.log('  ' + '-'.repeat(70));

const TS = '2026-07-02T12:00:00.000Z';

// 1. user text with string content
test('user line with string content -> {role:user, kind:text}', () => {
  const m = parseLine(JSON.stringify({ type: 'user', timestamp: TS, message: { role: 'user', content: 'hello there' } }));
  assert(m, 'message expected');
  assertEqual(m.role, 'user');
  assertEqual(m.kind, 'text');
  assertEqual(m.text, 'hello there');
  assertEqual(m.timestamp, TS);
  assertEqual(m.model, null);
  assertEqual(m.truncated, undefined, 'truncated only set when capped');
});

// 2. user text with array content (text blocks joined)
test('user line with text blocks -> joined text', () => {
  const m = parseLine(JSON.stringify({
    type: 'user', timestamp: TS,
    message: { role: 'user', content: [{ type: 'text', text: 'part one' }, { type: 'text', text: 'part two' }] },
  }));
  assert(m, 'message expected');
  assertEqual(m.role, 'user');
  assertEqual(m.kind, 'text');
  assertEqual(m.text, 'part one\npart two');
});

// 3. assistant text with model
test('assistant text blocks -> {role:assistant, kind:text, model}', () => {
  const m = parseLine(JSON.stringify({
    type: 'assistant', timestamp: TS,
    message: { role: 'assistant', model: 'claude-opus-4-6', content: [{ type: 'text', text: 'the answer' }] },
  }));
  assert(m, 'message expected');
  assertEqual(m.role, 'assistant');
  assertEqual(m.kind, 'text');
  assertEqual(m.text, 'the answer');
  assertEqual(m.model, 'claude-opus-4-6');
  assertEqual(m.timestamp, TS);
});

// 4. assistant tool_use
test('assistant tool_use block -> {role:tool, kind:tool_use, toolName, input JSON}', () => {
  const m = parseLine(JSON.stringify({
    type: 'assistant', timestamp: TS,
    message: {
      role: 'assistant', model: 'claude-opus-4-6',
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls -la' } }],
    },
  }));
  assert(m, 'message expected');
  assertEqual(m.role, 'tool');
  assertEqual(m.kind, 'tool_use');
  assertEqual(m.toolName, 'Bash');
  assertEqual(m.text, '{"command":"ls -la"}');
  assertEqual(m.model, null, 'model deliberately null on tool frames');
});

// 5. user tool_result with string content
test('user tool_result (string content) -> {role:tool, kind:tool_result}', () => {
  const m = parseLine(JSON.stringify({
    type: 'user', timestamp: TS,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'total 42' }] },
  }));
  assert(m, 'message expected');
  assertEqual(m.role, 'tool');
  assertEqual(m.kind, 'tool_result');
  assertEqual(m.text, 'total 42');
  assertEqual(m.toolName, undefined, 'tool_result blocks carry no tool name');
});

// 6. user tool_result with array-of-text content
test('user tool_result (array content) -> text parts joined', () => {
  const m = parseLine(JSON.stringify({
    type: 'user', timestamp: TS,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: [{ type: 'text', text: 'line A' }, { type: 'text', text: 'line B' }] }],
    },
  }));
  assert(m, 'message expected');
  assertEqual(m.role, 'tool');
  assertEqual(m.kind, 'tool_result');
  assertEqual(m.text, 'line A\nline B');
});

// 7. oversized text is capped with truncated:true
test('oversized text capped at MIRROR_MAX_TEXT_CHARS with truncated:true', () => {
  const big = 'z'.repeat(MIRROR_MAX_TEXT_CHARS + 500);
  const m = parseLine(JSON.stringify({ type: 'user', timestamp: TS, message: { role: 'user', content: big } }));
  assert(m, 'message expected');
  assertEqual(m.text.length, MIRROR_MAX_TEXT_CHARS, 'capped length');
  assertEqual(m.truncated, true, 'truncated flag set');
  // And under-limit text does NOT set the flag.
  const small = parseLine(JSON.stringify({ type: 'user', message: { role: 'user', content: 'tiny' } }));
  assertEqual(small.truncated, undefined, 'no flag when not capped');
});

// 8. system line
test('system line with string content -> {role:system, kind:system}', () => {
  const m = parseLine(JSON.stringify({ type: 'system', timestamp: TS, content: 'hook output banner' }));
  assert(m, 'message expected');
  assertEqual(m.role, 'system');
  assertEqual(m.kind, 'system');
  assertEqual(m.text, 'hook output banner');
});

// 9. skipped types -> null
test('skipped entry types return null', () => {
  const skipped = ['progress', 'file-history-snapshot', 'queue-operation', 'custom-title', 'summary'];
  for (const type of skipped) {
    assertEqual(parseLine(JSON.stringify({ type: type, message: { role: 'user', content: 'should not surface' } })), null, type + ' must be skipped');
  }
});

// 10. garbage and hostile input -> null, never throws
test('garbage lines return null and nothing throws', () => {
  assertEqual(parseLine('{this is not json}'), null, 'corrupt JSON');
  assertEqual(parseLine(''), null, 'empty string');
  assertEqual(parseLine('null'), null, 'JSON null');
  assertEqual(parseLine('[1,2,3]'), null, 'JSON array');
  assertEqual(parseLine('"just a string"'), null, 'JSON string');
  assertEqual(parseLine(JSON.stringify({ type: 'user' })), null, 'user line without message envelope');
  assertEqual(parseLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hidden' }] } })), null, 'thinking-only assistant line');
  assertEqual(parseLine(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'image', source: {} }] } })), null, 'image-only user line');
  assertEqual(parseLine(null), null, 'null input');
  assertEqual(parseLine(undefined), null, 'undefined input');
  assertEqual(parseLine(12345), null, 'number input');
  assertEqual(parseLine(OVERSIZED_LINE_SENTINEL), null, 'tailer sentinel maps to null');
});

// 11. human role normalizes to user
test('legacy human role maps to user', () => {
  const m = parseLine(JSON.stringify({ type: 'user', message: { role: 'human', content: 'old style' } }));
  assert(m, 'message expected');
  assertEqual(m.role, 'user');
  assertEqual(m.text, 'old style');
});

// 12. missing timestamp -> null timestamp (not undefined)
test('missing timestamp maps to null', () => {
  const m = parseLine(JSON.stringify({ type: 'user', message: { role: 'user', content: 'no ts' } }));
  assertEqual(m.timestamp, null, 'timestamp normalized to null');
});

console.log('  ' + '-'.repeat(70));
console.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
