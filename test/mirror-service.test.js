#!/usr/bin/env node
/**
 * Unit tests for src/web/mirror-service.js (issue #10 Tier 1, Phase 3).
 *
 * Coverage:
 *   1. open(): fresh history parsed from the fixture, offsets + shape.
 *   2. open(): MIRROR_UNSUPPORTED for providers without the mirror
 *      capability (no mirror object / no findArtifactPath).
 *   3. open(): ARTIFACT_NOT_FOUND when findArtifactPath returns null.
 *   4. Live append -> batched mirror:message broadcast with contiguous
 *      prevOffset/offset bookkeeping.
 *   5. Idempotent second open: one tailer per key, both devices subscribed,
 *      fresh history returned.
 *   6. close(): refcount decrement, idle-delayed teardown, re-open during
 *      the grace period cancels the teardown.
 *   7. MIRROR_LIMIT on too many DISTINCT keys (attaching more devices to an
 *      existing key stays allowed).
 *   8. Truncate -> mirror:reset broadcast, then re-seeded lines with
 *      prevOffset null.
 *   9. readEarlier(): stateless paging that tiles history with no gap and
 *      no overlap all the way back to byte 0.
 *  10. Text cap: oversized message text truncated with truncated:true.
 *  11. Subscriber GC sweep: a device with no SSE client is unsubscribed and
 *      the tailer idles out (kill-the-tab leak guard).
 *  12. disposeAll(): every watcher stopped, mirror:closed broadcast.
 *
 * Hermetic: CWM_DATA_DIR sandbox first, JSONL fixtures in a private
 * tmpdir, a fake provider registry (no real provider modules), fast
 * ctor-injected timings. Every MirrorService is disposed in finally so
 * fs.watch handles never keep the process (or npm test) alive.
 */

'use strict';

// Sandbox CWM_DATA_DIR before anything touches the store (hermeticity rule).
require('./_test-data-dir');

const fs = require('fs');
const os = require('os');
const path = require('path');

const { MirrorService } = require('../src/web/mirror-service');

// ─── Assertion helpers (standalone-test convention) ─────────────────────────

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + name);
  } catch (err) {
    failed++;
    console.log('  \x1b[31m✗\x1b[0m ' + name);
    console.log('    \x1b[31m' + (err && err.message ? err.message : err) + '\x1b[0m');
    if (err && err.stack) {
      console.log('    ' + err.stack.split('\n').slice(1, 4).join('\n    '));
    }
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

/**
 * Poll until fn() returns truthy or the timeout elapses. The polling
 * interval keeps the event loop alive, which also lets unref'd service
 * timers (idle close, sweep) fire during tests.
 */
function waitFor(fn, timeoutMs = 4000, intervalMs = 15) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      let val;
      try { val = fn(); } catch (err) { return reject(err); }
      if (val) return resolve(val);
      if (Date.now() - started > timeoutMs) return reject(new Error('waitFor timeout after ' + timeoutMs + 'ms'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

/** Plain sleep, used only where a NEGATIVE (nothing happened) is asserted. */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const FIXTURE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cwm-mirror-svc-'));
process.on('exit', () => {
  try { fs.rmSync(FIXTURE_DIR, { recursive: true, force: true }); } catch (_) {}
});

/** Serialize one fixture transcript line (JSONL). */
function fixtureLine(role, text) {
  return JSON.stringify({ role, text });
}

/** Write a JSONL fixture and return its absolute path. */
function writeFixture(name, lines) {
  const p = path.join(FIXTURE_DIR, name);
  fs.writeFileSync(p, lines.map((l) => l + '\n').join(''), 'utf8');
  return p;
}

/**
 * Trivial provider parseLine for tests: JSON.parse the line and map
 * {role, text} straight through. Unparseable lines -> null (contract).
 */
function trivialParseLine(line) {
  try {
    const o = JSON.parse(line);
    if (!o || typeof o !== 'object' || typeof o.text !== 'string') return null;
    return { role: o.role || 'user', text: o.text, timestamp: null, model: null, kind: 'text' };
  } catch (_) {
    return null;
  }
}

/**
 * Build a fake mirror-capable provider whose findArtifactPath maps every
 * session id through the supplied resolver (default: a fixed fixture path).
 */
function fakeProvider(id, resolvePath) {
  return {
    id,
    mirror: { parseLine: trivialParseLine },
    findArtifactPath: resolvePath,
  };
}

/**
 * Construct a MirrorService against an in-test provider map with fast
 * timings. Returns {svc, records, providers} where records collects every
 * broadcast {type, data} in order.
 */
function makeService(providers, overrides) {
  const records = [];
  const svc = new MirrorService(Object.assign({
    getProvider: (id) => providers[id] || null,
    broadcast: (type, data) => records.push({ type, data }),
    debounceMs: 10,
    pollMs: 50,
    idleCloseMs: 80,
    sweepMs: 30,
  }, overrides || {}));
  return { svc, records };
}

// ─── Main runner ─────────────────────────────────────────────────────────────

async function main() {
  console.log('\n  Issue #10 Phase 3: MirrorService (open/close/broadcast/limit/reset/readEarlier)');
  console.log('  ' + '-'.repeat(78));

  // ── 1. open(): history + shape ─────────────────────────────────────────
  await test('open() returns parsed history with offsets and mirrorKey', async () => {
    const file = writeFixture('open-basic.jsonl', [
      fixtureLine('user', 'hello'),
      fixtureLine('assistant', 'hi there'),
      '{not json}',
      fixtureLine('user', 'second'),
    ]);
    const providers = { stubalpha: fakeProvider('stubalpha', () => file) };
    const { svc } = makeService(providers);
    try {
      const res = await svc.open({ provider: 'stubalpha', providerSessionId: 'sess-1', deviceId: 'dev-A' });
      assertEqual(res.mirrorKey, 'stubalpha:sess-1');
      assertEqual(res.history.length, 3, 'unparseable line must be skipped');
      assertEqual(res.history[0].text, 'hello');
      assertEqual(res.history[2].text, 'second');
      assertEqual(res.startOffset, 0);
      assertEqual(res.endOffset, fs.statSync(file).size, 'endOffset must be EOF for a newline-terminated file');
      assertEqual(res.truncatedHead, false);
      assertEqual(typeof res.live, 'boolean');
      assertEqual(res.fileSize, fs.statSync(file).size);
      assertEqual(svc.watcherCount(), 1);
    } finally {
      svc.disposeAll();
    }
  });

  // ── 2. open(): unsupported providers ───────────────────────────────────
  await test('open() throws MIRROR_UNSUPPORTED for providers without mirror capability', async () => {
    const file = writeFixture('unsupported.jsonl', [fixtureLine('user', 'x')]);
    const providers = {
      nomirror: { id: 'nomirror', findArtifactPath: () => file },              // no mirror object
      nofind: { id: 'nofind', mirror: { parseLine: trivialParseLine } },       // no findArtifactPath
      badmirror: { id: 'badmirror', mirror: {}, findArtifactPath: () => file }, // mirror without parseLine
    };
    const { svc } = makeService(providers);
    try {
      for (const id of ['nomirror', 'nofind', 'badmirror', 'ghost-provider']) {
        let code = null;
        try {
          await svc.open({ provider: id, providerSessionId: 's', deviceId: 'dev-A' });
        } catch (err) { code = err.code; }
        assertEqual(code, 'MIRROR_UNSUPPORTED', 'provider ' + id + ' must be rejected');
      }
      assertEqual(svc.watcherCount(), 0, 'no watcher may leak from rejected opens');
    } finally {
      svc.disposeAll();
    }
  });

  // ── 3. open(): missing artifact ────────────────────────────────────────
  await test('open() throws ARTIFACT_NOT_FOUND when findArtifactPath returns null', async () => {
    const providers = { stubalpha: fakeProvider('stubalpha', () => null) };
    const { svc } = makeService(providers);
    try {
      let code = null;
      try {
        await svc.open({ provider: 'stubalpha', providerSessionId: 'gone', deviceId: 'dev-A' });
      } catch (err) { code = err.code; }
      assertEqual(code, 'ARTIFACT_NOT_FOUND');
      assertEqual(svc.watcherCount(), 0);
    } finally {
      svc.disposeAll();
    }
  });

  // ── 4. append -> broadcast ─────────────────────────────────────────────
  await test('appended lines broadcast as batched mirror:message with contiguous offsets', async () => {
    const file = writeFixture('append.jsonl', [fixtureLine('user', 'seed')]);
    const providers = { stubalpha: fakeProvider('stubalpha', () => file) };
    const { svc, records } = makeService(providers);
    try {
      const res = await svc.open({ provider: 'stubalpha', providerSessionId: 'sess-app', deviceId: 'dev-A' });
      fs.appendFileSync(file, fixtureLine('assistant', 'reply-1') + '\n' + fixtureLine('assistant', 'reply-2') + '\n');
      const evt = await waitFor(() => records.find((r) => r.type === 'mirror:message' && r.data.messages.length > 0));
      assertEqual(evt.data.mirrorKey, 'stubalpha:sess-app');
      assertEqual(evt.data.messages.length, 2, 'both appended lines must arrive in one batch');
      assertEqual(evt.data.messages[0].text, 'reply-1');
      assertEqual(evt.data.prevOffset, res.endOffset, 'batch must start where history ended (no gap, no overlap)');
      assertEqual(evt.data.offset, fs.statSync(file).size, 'batch offset must be the new EOF');
    } finally {
      svc.disposeAll();
    }
  });

  // ── 5. idempotent second open ──────────────────────────────────────────
  await test('second open on the same key shares one tailer and adds a subscriber', async () => {
    const file = writeFixture('idem.jsonl', [fixtureLine('user', 'a'), fixtureLine('user', 'b')]);
    const providers = { stubalpha: fakeProvider('stubalpha', () => file) };
    const { svc } = makeService(providers);
    try {
      await svc.open({ provider: 'stubalpha', providerSessionId: 'sess-idem', deviceId: 'dev-A' });
      const res2 = await svc.open({ provider: 'stubalpha', providerSessionId: 'sess-idem', deviceId: 'dev-B' });
      assertEqual(svc.watcherCount(), 1, 'one tailer per key regardless of subscribers');
      assertEqual(res2.history.length, 2, 'second open must return fresh history');
      const subs = svc.subscribersOf('stubalpha:sess-idem');
      assert(subs.has('dev-A') && subs.has('dev-B'), 'both devices must be subscribed');
      assertEqual(subs.size, 2);
      // Unknown key must yield an empty Set, never null.
      assertEqual(svc.subscribersOf('stubalpha:nope').size, 0);
    } finally {
      svc.disposeAll();
    }
  });

  // ── 6. close(): refcount + idle teardown + grace-period rescue ────────
  await test('close() refcounts; last close tears down after idleCloseMs; re-open rescues', async () => {
    const file = writeFixture('close.jsonl', [fixtureLine('user', 'x')]);
    const providers = { stubalpha: fakeProvider('stubalpha', () => file) };
    const { svc, records } = makeService(providers, { idleCloseMs: 60 });
    try {
      await svc.open({ provider: 'stubalpha', providerSessionId: 'sess-close', deviceId: 'dev-A' });
      await svc.open({ provider: 'stubalpha', providerSessionId: 'sess-close', deviceId: 'dev-B' });

      svc.close({ mirrorKey: 'stubalpha:sess-close', deviceId: 'dev-A' });
      await sleep(120); // longer than idleCloseMs: dev-B still holds the mirror
      assertEqual(svc.watcherCount(), 1, 'watcher must survive while a subscriber remains');

      // Grace-period rescue: close the last device, re-open before expiry.
      svc.close({ mirrorKey: 'stubalpha:sess-close', deviceId: 'dev-B' });
      await svc.open({ provider: 'stubalpha', providerSessionId: 'sess-close', deviceId: 'dev-C' });
      await sleep(120);
      assertEqual(svc.watcherCount(), 1, 're-open during the grace period must cancel teardown');

      // Real teardown: last close, wait past idleCloseMs.
      svc.close({ mirrorKey: 'stubalpha:sess-close', deviceId: 'dev-C' });
      await waitFor(() => svc.watcherCount() === 0);
      assert(records.some((r) => r.type === 'mirror:closed' && r.data.reason === 'idle'),
        'idle teardown must broadcast mirror:closed {reason:idle}');
      // Closing an unknown key is a safe no-op.
      const out = svc.close({ mirrorKey: 'stubalpha:never-opened', deviceId: 'dev-A' });
      assertEqual(out.ok, true);
    } finally {
      svc.disposeAll();
    }
  });

  // ── 7. watcher limit ───────────────────────────────────────────────────
  await test('MIRROR_LIMIT rejects new keys past maxWatchers but allows attach to existing', async () => {
    const file = writeFixture('limit.jsonl', [fixtureLine('user', 'x')]);
    const providers = { stubalpha: fakeProvider('stubalpha', () => file) };
    const { svc } = makeService(providers, { maxWatchers: 2 });
    try {
      await svc.open({ provider: 'stubalpha', providerSessionId: 'k1', deviceId: 'dev-A' });
      await svc.open({ provider: 'stubalpha', providerSessionId: 'k2', deviceId: 'dev-A' });
      let code = null;
      try {
        await svc.open({ provider: 'stubalpha', providerSessionId: 'k3', deviceId: 'dev-A' });
      } catch (err) { code = err.code; }
      assertEqual(code, 'MIRROR_LIMIT');
      // Attaching another device to an EXISTING key is not a new watcher.
      const res = await svc.open({ provider: 'stubalpha', providerSessionId: 'k1', deviceId: 'dev-B' });
      assertEqual(res.mirrorKey, 'stubalpha:k1');
      assertEqual(svc.watcherCount(), 2);
    } finally {
      svc.disposeAll();
    }
  });

  // ── 8. truncate -> reset + re-seed ─────────────────────────────────────
  await test('truncation broadcasts mirror:reset then re-seeds with prevOffset null', async () => {
    const file = writeFixture('trunc.jsonl', [
      fixtureLine('user', 'old-1'),
      fixtureLine('user', 'old-2'),
      fixtureLine('user', 'old-3'),
    ]);
    const providers = { stubalpha: fakeProvider('stubalpha', () => file) };
    const { svc, records } = makeService(providers);
    try {
      await svc.open({ provider: 'stubalpha', providerSessionId: 'sess-trunc', deviceId: 'dev-A' });
      // Rewrite the file SHORTER than the tailer's offset (truncate/rotate).
      fs.writeFileSync(file, fixtureLine('user', 'new-1') + '\n', 'utf8');
      const reset = await waitFor(() => records.find((r) => r.type === 'mirror:reset'));
      assertEqual(reset.data.reason, 'truncated');
      const reseed = await waitFor(() => records.find((r) =>
        r.type === 'mirror:message' && r.data.messages.some((m) => m.text === 'new-1')));
      assertEqual(reseed.data.prevOffset, null,
        'first post-reset batch must carry prevOffset null (client accepts unconditionally)');
    } finally {
      svc.disposeAll();
    }
  });

  // ── 9. readEarlier(): gap-free, overlap-free paging ────────────────────
  await test('readEarlier() tiles history back to byte 0 with no gap and no overlap', async () => {
    const total = 40;
    const lines = [];
    for (let i = 0; i < total; i++) lines.push(fixtureLine('user', 'line-' + String(i).padStart(3, '0')));
    const file = writeFixture('earlier.jsonl', lines);
    const providers = { stubalpha: fakeProvider('stubalpha', () => file) };
    // Small window so the initial open truncates the head.
    const { svc } = makeService(providers, { historyTailBytes: 160 });
    try {
      const res = await svc.open({ provider: 'stubalpha', providerSessionId: 'sess-earlier', deviceId: 'dev-A' });
      assertEqual(res.truncatedHead, true, 'window smaller than the file must flag truncatedHead');
      assert(res.history.length > 0 && res.history.length < total);

      // Page backwards to byte 0, collecting texts oldest-window-last.
      const pages = [];
      let before = res.startOffset;
      let guard = 0;
      let truncated = true;
      while (truncated) {
        if (++guard > 50) throw new Error('paging did not terminate');
        const page = await svc.readEarlier({
          provider: 'stubalpha', providerSessionId: 'sess-earlier', beforeOffset: before, maxBytes: 160,
        });
        assert(page.startOffset < before, 'each page must move strictly backwards');
        pages.unshift(page.messages);
        before = page.startOffset;
        truncated = page.truncatedHead;
      }
      assertEqual(before, 0, 'paging must terminate at byte 0');
      const all = pages.flat().concat(res.history).map((m) => m.text);
      assertEqual(all.length, total, 'pages + history must cover every line exactly once');
      for (let i = 0; i < total; i++) {
        assertEqual(all[i], 'line-' + String(i).padStart(3, '0'), 'order and coverage at index ' + i);
      }
      // beforeOffset 0 is a valid no-op.
      const nothing = await svc.readEarlier({ provider: 'stubalpha', providerSessionId: 'sess-earlier', beforeOffset: 0 });
      assertEqual(nothing.messages.length, 0);
      assertEqual(nothing.truncatedHead, false);
    } finally {
      svc.disposeAll();
    }
  });

  // ── 10. text cap ───────────────────────────────────────────────────────
  await test('message text is capped at maxTextChars with truncated:true', async () => {
    const file = writeFixture('cap.jsonl', [fixtureLine('user', 'x'.repeat(500))]);
    const providers = { stubalpha: fakeProvider('stubalpha', () => file) };
    const { svc } = makeService(providers, { maxTextChars: 32 });
    try {
      const res = await svc.open({ provider: 'stubalpha', providerSessionId: 'sess-cap', deviceId: 'dev-A' });
      assertEqual(res.history[0].text.length, 32);
      assertEqual(res.history[0].truncated, true);
    } finally {
      svc.disposeAll();
    }
  });

  // ── 11. subscriber GC sweep (kill-the-tab leak guard) ──────────────────
  await test('sweep unsubscribes devices with no SSE client and idles the watcher out', async () => {
    const file = writeFixture('sweep.jsonl', [fixtureLine('user', 'x')]);
    const providers = { stubalpha: fakeProvider('stubalpha', () => file) };
    const { svc } = makeService(providers, {
      sweepMs: 25,
      idleCloseMs: 40,
      isDeviceConnected: () => false, // every device looks vanished
    });
    try {
      await svc.open({ provider: 'stubalpha', providerSessionId: 'sess-sweep', deviceId: 'dev-gone' });
      assertEqual(svc.watcherCount(), 1);
      // Two sweeps (2 * 25ms) to hit the miss limit, then idleCloseMs.
      await waitFor(() => svc.watcherCount() === 0, 4000);
      assertEqual(svc.subscribersOf('stubalpha:sess-sweep').size, 0);
    } finally {
      svc.disposeAll();
    }
  });

  // ── 12. disposeAll ─────────────────────────────────────────────────────
  await test('disposeAll() stops every watcher and broadcasts mirror:closed', async () => {
    const file = writeFixture('dispose.jsonl', [fixtureLine('user', 'x')]);
    const providers = { stubalpha: fakeProvider('stubalpha', () => file) };
    const { svc, records } = makeService(providers);
    await svc.open({ provider: 'stubalpha', providerSessionId: 'd1', deviceId: 'dev-A' });
    await svc.open({ provider: 'stubalpha', providerSessionId: 'd2', deviceId: 'dev-A' });
    svc.disposeAll();
    assertEqual(svc.watcherCount(), 0);
    const closed = records.filter((r) => r.type === 'mirror:closed' && r.data.reason === 'disposed');
    assertEqual(closed.length, 2, 'every key must broadcast mirror:closed on dispose');
    // Opens after dispose are rejected (server shutting down).
    let code = null;
    try {
      await svc.open({ provider: 'stubalpha', providerSessionId: 'd3', deviceId: 'dev-A' });
    } catch (err) { code = err.code; }
    assertEqual(code, 'MIRROR_DISPOSED');
  });

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('  ' + '-'.repeat(78));
  console.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\nTest runner crashed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
