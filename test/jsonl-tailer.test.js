#!/usr/bin/env node
/**
 * Tests for src/web/jsonl-tailer.js (issue #10 Tier 1, Phase 1).
 *
 * Coverage:
 *   1. append detection via the POLL path (watch disabled; no fs.watch timing)
 *   2. partial-line carry across two appends (no premature delivery)
 *   3. 4-byte emoji split mid-codepoint across two appends (no mojibake)
 *   4. truncation reset (onTruncate + re-delivery from reset offset)
 *   5. oversized-line drop + sentinel + resync on next newline
 *   6. startOffset honored on a 10MB file (never reads from byte 0)
 *   7. stop() idempotence (twice, before start, no delivery after stop)
 *   8. onGone fires after ENOENT persists across two poll checks
 *   9. readTailWindow offsets close the history/tail race (trailing partial)
 *  10. oversized sentinel is exported and can never be valid JSON
 *
 * Standalone-test convention: owns its assertion helpers, exits 0 on green,
 * 1 on any failure. NOT yet registered in test/run.js (that file is owned by
 * the alpha.11 wave; a later wiring task registers this suite).
 */

'use strict';

// MANDATORY sandbox: keeps CWM_DATA_DIR off the production ./state/ dir
// (see the 2026-05-11 prod-wipe incident documented in _test-data-dir.js).
require('./_test-data-dir');

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  JsonlTailer,
  readTailWindow,
  OVERSIZED_LINE_SENTINEL,
  MIRROR_HISTORY_TAIL_BYTES,
} = require('../src/web/jsonl-tailer');

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
 * @param {*} cond - Condition to assert.
 * @param {string} msg - Failure message.
 */
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

/**
 * Throw unless actual === expected, with a readable diff message.
 * @param {*} actual
 * @param {*} expected
 * @param {string} [msg]
 */
function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || 'assertEqual') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

// --- Async helpers ----------------------------------------------------------

/**
 * Resolve when predicate() returns truthy, polling every 20ms; reject after
 * timeoutMs. Predicate exceptions count as "not yet".
 * @param {() => boolean} predicate
 * @param {number} timeoutMs
 * @param {string} label - Used in the timeout error message.
 * @returns {Promise<void>}
 */
function waitFor(predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      let ok = false;
      try { ok = !!predicate(); } catch (_) { ok = false; }
      if (ok) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error('timeout waiting for: ' + label));
      }
    }, 20);
  });
}

/**
 * Plain promise delay.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Fixture helpers --------------------------------------------------------

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'cwm-tailer-test-'));
let fileCounter = 0;

/**
 * Create a fresh fixture file path (and the file itself) inside the tmp root.
 * @param {string} [initialContent=''] - Content written at creation.
 * @returns {string} Absolute file path.
 */
function makeFixture(initialContent) {
  const p = path.join(TMP_ROOT, 'fixture-' + (fileCounter++) + '.jsonl');
  fs.writeFileSync(p, initialContent || '', 'utf8');
  return p;
}

/**
 * Build a tailer with fast test timings, poll-path only (watch disabled so
 * no assertion ever depends on fs.watch timing), recording events into the
 * returned collector.
 * @param {string} filePath
 * @param {object} [extra] - Extra constructor opts (startOffset, maxLineBytes...).
 * @returns {{tailer: JsonlTailer, batches: Array<{lines: string[], offset: number}>, truncates: number[], gone: {count: number}, allLines: () => string[]}}
 */
function makeTailer(filePath, extra) {
  const batches = [];
  const truncates = [];
  const gone = { count: 0 };
  const tailer = new JsonlTailer(filePath, Object.assign({
    watch: false,
    pollMs: 40,
    debounceMs: 10,
    onLines: (lines, offset) => batches.push({ lines: lines, offset: offset }),
    onTruncate: (newSize) => truncates.push(newSize),
    onGone: () => { gone.count++; },
  }, extra || {}));
  return {
    tailer: tailer,
    batches: batches,
    truncates: truncates,
    gone: gone,
    allLines: () => batches.reduce((acc, b) => acc.concat(b.lines), []),
  };
}

const WAIT_MS = 5000;
const ACTIVE_TAILERS = [];

// --- Suite ------------------------------------------------------------------

console.log('\n  issue #10 Phase 1: src/web/jsonl-tailer.js');
console.log('  ' + '-'.repeat(70));

(async () => {
  try {
    // --- 1. append detection via the POLL path -----------------------------
    {
      const file = makeFixture('seed-line\n');
      const t = makeTailer(file);
      ACTIVE_TAILERS.push(t.tailer);
      t.tailer.start();
      await waitFor(() => t.allLines().includes('seed-line'), WAIT_MS, 'initial catch-up read');
      const sizeBefore = fs.statSync(file).size;
      fs.appendFileSync(file, 'appended-line\n');
      await waitFor(() => t.allLines().includes('appended-line'), WAIT_MS, 'poll-path append delivery');
      test('append detected via poll path (watch disabled)', () => {
        assertEqual(t.allLines().join('|'), 'seed-line|appended-line', 'exactly the two lines, in order');
        const last = t.batches[t.batches.length - 1];
        assertEqual(last.offset, sizeBefore + Buffer.byteLength('appended-line\n'), 'newOffset is byte after last newline');
      });
      t.tailer.stop();
    }

    // --- 2. partial-line carry across two appends ---------------------------
    {
      const file = makeFixture('');
      const t = makeTailer(file);
      ACTIVE_TAILERS.push(t.tailer);
      t.tailer.start();
      fs.appendFileSync(file, '{"half":');
      await delay(200); // several poll cycles; nothing complete yet
      const premature = t.allLines().length;
      fs.appendFileSync(file, '"done"}\n');
      await waitFor(() => t.allLines().length > 0, WAIT_MS, 'carry completion delivery');
      test('partial-line carry across two appends', () => {
        assertEqual(premature, 0, 'no delivery while the line is incomplete');
        assertEqual(t.allLines().join('|'), '{"half":"done"}', 'carried halves reassembled');
      });
      t.tailer.stop();
    }

    // --- 3. emoji split mid-codepoint across two appends --------------------
    {
      const file = makeFixture('');
      const t = makeTailer(file);
      ACTIVE_TAILERS.push(t.tailer);
      t.tailer.start();
      const line = '{"e":"\u{1F600}"}'; // 4-byte emoji U+1F600
      const bytes = Buffer.from(line + '\n', 'utf8');
      // '{"e":"' is 6 bytes; the emoji occupies bytes 6..9. Split at byte 8,
      // right through the middle of the codepoint.
      fs.appendFileSync(file, bytes.subarray(0, 8));
      await delay(200); // let several polls observe the torn codepoint
      fs.appendFileSync(file, bytes.subarray(8));
      await waitFor(() => t.allLines().length > 0, WAIT_MS, 'emoji line delivery');
      test('4-byte emoji split mid-codepoint reassembles without mojibake', () => {
        const got = t.allLines()[0];
        assertEqual(got, line, 'delivered line matches original exactly');
        assert(!got.includes('�'), 'no replacement characters (mojibake)');
        assertEqual(JSON.parse(got).e, '\u{1F600}', 'emoji survives JSON round-trip');
      });
      t.tailer.stop();
    }

    // --- 4. truncation reset -------------------------------------------------
    {
      const file = makeFixture('one\ntwo\nthree\n');
      const t = makeTailer(file);
      ACTIVE_TAILERS.push(t.tailer);
      t.tailer.start();
      await waitFor(() => t.allLines().length === 3, WAIT_MS, 'pre-truncate lines');
      fs.writeFileSync(file, 'after\n'); // shrink: 14 bytes -> 6 bytes
      await waitFor(() => t.truncates.length > 0, WAIT_MS, 'onTruncate callback');
      await waitFor(() => t.allLines().includes('after'), WAIT_MS, 'post-truncate re-read');
      test('truncation fires onTruncate and re-reads from reset offset', () => {
        assertEqual(t.truncates[0], 6, 'onTruncate reports the new size');
        assertEqual(t.allLines().join('|'), 'one|two|three|after', 'reset offset re-delivered the new content');
      });
      t.tailer.stop();
    }

    // --- 5. oversized-line drop + sentinel + resync --------------------------
    {
      const file = makeFixture('');
      const t = makeTailer(file, { maxLineBytes: 64 });
      ACTIVE_TAILERS.push(t.tailer);
      t.tailer.start();
      fs.appendFileSync(file, 'x'.repeat(200)); // no newline; carry blows the 64B cap
      await waitFor(() => t.allLines().includes(OVERSIZED_LINE_SENTINEL), WAIT_MS, 'oversized sentinel');
      fs.appendFileSync(file, 'yyy\nrecovered\n'); // 'yyy' is the tail of the dropped line
      await waitFor(() => t.allLines().includes('recovered'), WAIT_MS, 'post-drop resync');
      test('oversized line dropped with sentinel, stream resyncs at next newline', () => {
        const lines = t.allLines();
        assert(lines.includes(OVERSIZED_LINE_SENTINEL), 'sentinel delivered');
        assert(!lines.some((l) => l.includes('xxx')), 'dropped line content never delivered');
        assert(!lines.some((l) => l.includes('yyy')), 'dropped line remainder never delivered');
        assertEqual(lines[lines.length - 1], 'recovered', 'first line after resync is complete and correct');
      });
      t.tailer.stop();
    }

    // --- 6. startOffset honored on a 10MB file --------------------------------
    {
      const file = makeFixture('');
      // ~100 bytes per line x 110000 lines = ~10.5MB, written in one shot.
      const pad = 'p'.repeat(80);
      const chunks = [];
      for (let i = 0; i < 110000; i++) chunks.push('{"n":' + i + ',"pad":"' + pad + '"}');
      fs.writeFileSync(file, chunks.join('\n') + '\n', 'utf8');
      const size = fs.statSync(file).size;
      assert(size > 10 * 1024 * 1024, 'fixture must exceed 10MB, got ' + size);

      const tw = await readTailWindow(file);
      test('readTailWindow on 10MB file stays inside the 2MB tail window', () => {
        assertEqual(tw.fileSize, size, 'fileSize reported');
        assertEqual(tw.truncatedHead, true, 'head is truncated');
        assert(tw.startOffset >= size - MIRROR_HISTORY_TAIL_BYTES, 'startOffset >= size - 2MB (got ' + tw.startOffset + ' for size ' + size + ')');
        assertEqual(tw.endOffset, size, 'file ends with newline so endOffset === size');
        assert(tw.lines.length > 0, 'window contains complete lines');
        assertEqual(tw.lines[tw.lines.length - 1], chunks[chunks.length - 1], 'last window line matches last file line');
      });

      const t = makeTailer(file, { startOffset: tw.endOffset });
      ACTIVE_TAILERS.push(t.tailer);
      t.tailer.start();
      await delay(200); // several polls; nothing new to read
      const preAppend = t.allLines().length;
      fs.appendFileSync(file, '{"fresh":true}\n');
      await waitFor(() => t.allLines().length > 0, WAIT_MS, 'fresh append after tail window');
      test('tailer honors startOffset and never re-reads history', () => {
        assertEqual(preAppend, 0, 'no delivery before the fresh append');
        assertEqual(t.allLines().join('|'), '{"fresh":true}', 'only the fresh line delivered');
        assertEqual(t.batches[0].offset, size + Buffer.byteLength('{"fresh":true}\n'), 'first read began at startOffset, not byte 0');
      });
      t.tailer.stop();
    }

    // --- 7. stop() idempotence ------------------------------------------------
    {
      const file = makeFixture('a\n');
      const t = makeTailer(file);
      ACTIVE_TAILERS.push(t.tailer);
      test('stop() is safe before start and twice in a row', () => {
        t.tailer.stop(); // before start: must not throw
        t.tailer.start();
        t.tailer.stop();
        t.tailer.stop(); // second stop: must not throw
      });
      fs.appendFileSync(file, 'b\n');
      await delay(250); // > 5 poll periods
      test('no delivery after stop()', () => {
        assert(!t.allLines().includes('b'), 'stopped tailer must not deliver');
      });
    }

    // --- 8. onGone after persistent ENOENT ------------------------------------
    {
      const file = makeFixture('here\n');
      const t = makeTailer(file);
      ACTIVE_TAILERS.push(t.tailer);
      t.tailer.start();
      await waitFor(() => t.allLines().length === 1, WAIT_MS, 'pre-delete read');
      fs.unlinkSync(file);
      await waitFor(() => t.gone.count > 0, WAIT_MS, 'onGone after persistent ENOENT');
      await delay(200); // more polls; must not re-fire
      test('onGone fires exactly once per disappearance episode', () => {
        assertEqual(t.gone.count, 1, 'single onGone');
      });
      t.tailer.stop();
    }

    // --- 9. readTailWindow closes the history/tail race ------------------------
    {
      const file = makeFixture('a-line\n{"partial":');
      const tw = await readTailWindow(file);
      test('readTailWindow excludes the trailing partial line', () => {
        assertEqual(tw.truncatedHead, false, 'small file: whole-file window');
        assertEqual(tw.startOffset, 0, 'window starts at byte 0');
        assertEqual(tw.lines.join('|'), 'a-line', 'only the complete line parsed');
        assertEqual(tw.endOffset, Buffer.byteLength('a-line\n'), 'endOffset is byte after last complete newline');
      });
      const t = makeTailer(file, { startOffset: tw.endOffset });
      ACTIVE_TAILERS.push(t.tailer);
      t.tailer.start();
      fs.appendFileSync(file, '1}\n');
      await waitFor(() => t.allLines().length > 0, WAIT_MS, 'partial-line completion via tailer');
      test('tailer started at endOffset picks up the completed partial line', () => {
        assertEqual(t.allLines().join('|'), '{"partial":1}', 'no gap, no overlap');
      });
      t.tailer.stop();

      // Empty-file degenerate case while we are here.
      const empty = makeFixture('');
      const twEmpty = await readTailWindow(empty);
      test('readTailWindow on empty file returns zeroed window', () => {
        assertEqual(twEmpty.lines.length, 0, 'no lines');
        assertEqual(twEmpty.startOffset, 0, 'startOffset 0');
        assertEqual(twEmpty.endOffset, 0, 'endOffset 0');
        assertEqual(twEmpty.fileSize, 0, 'fileSize 0');
        assertEqual(twEmpty.truncatedHead, false, 'no head truncation');
      });
    }

    // --- 10. sentinel contract --------------------------------------------------
    test('oversized sentinel can never be a valid JSONL line', () => {
      assert(typeof OVERSIZED_LINE_SENTINEL === 'string' && OVERSIZED_LINE_SENTINEL.length > 0, 'sentinel exported');
      assertEqual(OVERSIZED_LINE_SENTINEL.charCodeAt(0), 0, 'NUL-framed (JSON forbids raw NUL)');
      let threw = false;
      try { JSON.parse(OVERSIZED_LINE_SENTINEL); } catch (_) { threw = true; }
      assert(threw, 'JSON.parse must throw on the sentinel');
    });
  } finally {
    // Belt and braces: stop every tailer and remove the tmp tree even when
    // an await above rejected.
    for (const t of ACTIVE_TAILERS) {
      try { t.stop(); } catch (_) { /* already stopped */ }
    }
    try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }

  console.log('  ' + '-'.repeat(70));
  console.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
