#!/usr/bin/env node
/**
 * Integration tests for the /api/mirror/* routes and the Phase 0 discovery
 * liveness flags (issue #10 Tier 1, Phases 0 + 3).
 *
 * Coverage:
 *   1. POST /api/mirror/open happy path: 200 with the MirrorService payload.
 *   2. Unsupported provider -> 400 MIRROR_UNSUPPORTED.
 *   3. Missing artifact -> 404 ARTIFACT_NOT_FOUND.
 *   4. Watcher limit -> 409 MIRROR_LIMIT.
 *   5. Input validation -> 400 (provider id shape, session id shape,
 *      deviceId shape, beforeOffset, mirrorKey shape on close).
 *   6. POST /api/mirror/close -> {ok:true}.
 *   7. GET /api/mirror/history pages earlier lines statelessly.
 *   8. SSE deviceId scoping: mirror:message reaches ONLY the device that
 *      opened the mirror; other connected devices receive nothing, and
 *      mirror:* stays out of GLOBAL_EVENT_TYPES semantics.
 *   9. Auth: all three routes reject without a bearer token.
 *  10. Phase 0: groupProviderSessionsForUI stamps live/lastActiveMs
 *      (fresh true, stale false, archived false, missing lastActive null).
 *
 * Boot strategy mirrors test/discover-route.test.js: in-process Express app
 * on an ephemeral port, registry primed with a fake store, stub providers
 * registered directly. Hermetic: CWM_DATA_DIR sandbox, tmpdir fixtures,
 * fast tailer timings via env (read at module load, hence set FIRST).
 */

'use strict';

// Sandbox CWM_DATA_DIR into a tmpdir before any module loads the store.
require('./_test-data-dir');

// Speed up the server's singleton MirrorService: jsonl-tailer reads these
// env knobs at require time, so they must be set before the requires below.
process.env.MIRROR_DEBOUNCE_MS = '15';
process.env.MIRROR_POLL_MS = '60';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

// Fresh module graph: the registry and server have in-process state that
// other suites may have touched.
delete require.cache[require.resolve('../src/providers')];
delete require.cache[require.resolve('../src/providers/claude')];
delete require.cache[require.resolve('../src/state/store')];
try { delete require.cache[require.resolve('../src/web/jsonl-tailer')]; } catch (_) {}
try { delete require.cache[require.resolve('../src/web/mirror-service')]; } catch (_) {}
delete require.cache[require.resolve('../src/web/server')];
delete require.cache[require.resolve('../src/web/auth')];

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

/** Poll until fn() is truthy or timeout. */
function waitFor(fn, timeoutMs = 5000, intervalMs = 20) {
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

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── HTTP helpers ────────────────────────────────────────────────────────────

const TEST_TOKEN = 'test-token-' + Math.random().toString(36).slice(2);
let SERVER_PORT = 0;

/** JSON request against the test server. Resolves {status, body}. */
function req(method, urlPath, body, opts) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const headers = {};
    if (!opts || opts.auth !== false) headers['Authorization'] = 'Bearer ' + TEST_TOKEN;
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    const r = http.request({ hostname: '127.0.0.1', port: SERVER_PORT, path: urlPath, method, headers }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(raw); } catch (_) { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

/**
 * Open a raw SSE stream on /api/events with a deviceId and collect every
 * byte into .buffer. Returns {buffer(), close()} once the connection is
 * established (the initial 'connected' event arrived).
 */
function openSse(deviceId) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const r = http.request({
      hostname: '127.0.0.1',
      port: SERVER_PORT,
      path: '/api/events?token=' + encodeURIComponent(TEST_TOKEN) + '&deviceId=' + encodeURIComponent(deviceId),
      method: 'GET',
    }, (res) => {
      if (res.statusCode !== 200) return reject(new Error('SSE connect failed: ' + res.statusCode));
      res.setEncoding('utf8');
      res.on('data', (chunk) => { buf += chunk; });
      const handle = {
        buffer: () => buf,
        close: () => { try { r.destroy(); } catch (_) {} },
      };
      // Resolve once the server's hello frame lands so ordering is stable.
      waitFor(() => buf.includes('"type":"connected"'), 4000).then(() => resolve(handle), reject);
    });
    r.on('error', reject);
    r.end();
  });
}

// ─── Fixtures + stub providers ───────────────────────────────────────────────

const FIXTURE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cwm-mirror-routes-'));
process.on('exit', () => {
  try { fs.rmSync(FIXTURE_DIR, { recursive: true, force: true }); } catch (_) {}
});

function fixtureLine(role, text) {
  return JSON.stringify({ role, text });
}

function writeFixture(name, lines) {
  const p = path.join(FIXTURE_DIR, name);
  fs.writeFileSync(p, lines.map((l) => l + '\n').join(''), 'utf8');
  return p;
}

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
 * Registry-shaped stub provider satisfying every REQUIRED field/method plus
 * the OPTIONAL mirror capability (unless overridden away).
 */
function buildStubProvider(overrides) {
  const id = (overrides && overrides.id) || ('mirrorstub' + Math.random().toString(36).slice(2, 8));
  return Object.assign({
    id,
    displayName: 'Mirror Stub',
    accentToken: 'lavender',
    cliBinary: 'mirror-stub-bin-' + id,
    discover: async () => [],
    parseTranscript: async () => [],
    spawnCommand: () => ({ cmd: 'true', args: [], cwd: '/', env: {} }),
    search: async () => [],
    init: async () => {},
    dispose: async () => {},
    supportsCost: () => false,
    isIdleSignal: () => false,
    getKeyBindings: () => ({}),
    mirror: { parseLine: trivialParseLine },
    findArtifactPath: () => null,
  }, overrides || {});
}

// ─── Main runner ─────────────────────────────────────────────────────────────

async function main() {
  console.log('\n  Issue #10 Phases 0+3: /api/mirror routes, SSE scoping, discovery liveness');
  console.log('  ' + '-'.repeat(78));

  const registry = require('../src/providers');
  const fakeStore = { state: { settings: { providers: {} } } };
  await registry.initRegistry(fakeStore);

  const server = require('../src/web/server');
  const { app, mirrorService, groupProviderSessionsForUI, LIVE_THRESHOLD_MS } = server;
  assert(app, 'server.app must be exported');
  assert(mirrorService, 'server.mirrorService must be exported');
  assertEqual(typeof LIVE_THRESHOLD_MS, 'number', 'server.LIVE_THRESHOLD_MS must be a number');

  const auth = require('../src/web/auth');
  auth.addToken(TEST_TOKEN);

  // The shared happy-path fixture provider: every session id resolves to
  // its own per-id fixture file (written on demand by the tests).
  const fixtureFiles = new Map(); // providerSessionId -> path
  const goodProvider = buildStubProvider({
    id: 'mirrorstub',
    findArtifactPath: (sessId) => fixtureFiles.get(sessId) || null,
  });
  registry.register(goodProvider);
  const noMirrorProvider = buildStubProvider({ id: 'plainstub', mirror: undefined });
  registry.register(noMirrorProvider);

  const httpServer = http.createServer(app);
  await new Promise((resolve, reject) => {
    httpServer.listen(0, '127.0.0.1', (err) => {
      if (err) return reject(err);
      SERVER_PORT = httpServer.address().port;
      resolve();
    });
  });

  try {
    // ── 1. open happy path ─────────────────────────────────────────────
    await test('POST /api/mirror/open returns 200 with history + offsets', async () => {
      fixtureFiles.set('sess-open', writeFixture('open.jsonl', [
        fixtureLine('user', 'hello'),
        fixtureLine('assistant', 'world'),
      ]));
      const r = await req('POST', '/api/mirror/open', {
        provider: 'mirrorstub', providerSessionId: 'sess-open', deviceId: 'web-open',
      });
      assertEqual(r.status, 200);
      assertEqual(r.body.mirrorKey, 'mirrorstub:sess-open');
      assert(Array.isArray(r.body.history), 'history must be an array');
      assertEqual(r.body.history.length, 2);
      assertEqual(r.body.history[1].text, 'world');
      assertEqual(typeof r.body.endOffset, 'number');
      assertEqual(typeof r.body.live, 'boolean');
      assertEqual(r.body.truncatedHead, false);
      // Cleanup so later tests start from a clean watcher table. close()
      // only SCHEDULES teardown (idle grace period), so force it here; the
      // limit test below assumes an empty watcher table.
      await req('POST', '/api/mirror/close', { mirrorKey: 'mirrorstub:sess-open', deviceId: 'web-open' });
      mirrorService._teardown('mirrorstub:sess-open');
    });

    // ── 2. unsupported provider ────────────────────────────────────────
    await test('open on a provider without mirror capability -> 400 MIRROR_UNSUPPORTED', async () => {
      const r = await req('POST', '/api/mirror/open', {
        provider: 'plainstub', providerSessionId: 'whatever', deviceId: 'web-x',
      });
      assertEqual(r.status, 400);
      assertEqual(r.body.error, 'MIRROR_UNSUPPORTED');
    });

    // ── 3. missing artifact ────────────────────────────────────────────
    await test('open when findArtifactPath returns null -> 404 ARTIFACT_NOT_FOUND', async () => {
      const r = await req('POST', '/api/mirror/open', {
        provider: 'mirrorstub', providerSessionId: 'no-such-session', deviceId: 'web-x',
      });
      assertEqual(r.status, 404);
      assertEqual(r.body.error, 'ARTIFACT_NOT_FOUND');
    });

    // ── 4. watcher limit ───────────────────────────────────────────────
    await test('open past the watcher limit -> 409 MIRROR_LIMIT', async () => {
      // Shrink the singleton's limit for the test, restore in finally.
      const originalLimit = mirrorService._maxWatchers;
      mirrorService._maxWatchers = 1;
      try {
        fixtureFiles.set('lim-a', writeFixture('lim-a.jsonl', [fixtureLine('user', 'a')]));
        fixtureFiles.set('lim-b', writeFixture('lim-b.jsonl', [fixtureLine('user', 'b')]));
        const r1 = await req('POST', '/api/mirror/open', {
          provider: 'mirrorstub', providerSessionId: 'lim-a', deviceId: 'web-lim',
        });
        assertEqual(r1.status, 200);
        const r2 = await req('POST', '/api/mirror/open', {
          provider: 'mirrorstub', providerSessionId: 'lim-b', deviceId: 'web-lim',
        });
        assertEqual(r2.status, 409);
        assertEqual(r2.body.error, 'MIRROR_LIMIT');
      } finally {
        mirrorService._maxWatchers = originalLimit;
        mirrorService._teardown('mirrorstub:lim-a');
      }
    });

    // ── 5. input validation ────────────────────────────────────────────
    await test('malformed provider / session / device / offset inputs -> 400', async () => {
      const badProvider = await req('POST', '/api/mirror/open', {
        provider: 'Bad Provider!', providerSessionId: 'x', deviceId: 'web-x',
      });
      assertEqual(badProvider.status, 400);
      assertEqual(badProvider.body.error, 'INVALID_PROVIDER');

      const badSession = await req('POST', '/api/mirror/open', {
        provider: 'mirrorstub', providerSessionId: '../../etc/passwd', deviceId: 'web-x',
      });
      assertEqual(badSession.status, 400);
      assertEqual(badSession.body.error, 'INVALID_SESSION_ID');

      const badDevice = await req('POST', '/api/mirror/open', {
        provider: 'mirrorstub', providerSessionId: 'ok', deviceId: '',
      });
      assertEqual(badDevice.status, 400);
      assertEqual(badDevice.body.error, 'INVALID_DEVICE_ID');

      const badOffset = await req('GET',
        '/api/mirror/history?provider=mirrorstub&providerSessionId=ok&beforeOffset=-5');
      assertEqual(badOffset.status, 400);
      assertEqual(badOffset.body.error, 'INVALID_OFFSET');

      const badKey = await req('POST', '/api/mirror/close', { mirrorKey: 'no-separator-here!', deviceId: 'web-x' });
      assertEqual(badKey.status, 400);
    });

    // ── 6. close ───────────────────────────────────────────────────────
    await test('POST /api/mirror/close returns {ok:true} (unknown keys too)', async () => {
      const r = await req('POST', '/api/mirror/close', {
        mirrorKey: 'mirrorstub:never-opened', deviceId: 'web-x',
      });
      assertEqual(r.status, 200);
      assertEqual(r.body.ok, true);
    });

    // ── 7. history paging ──────────────────────────────────────────────
    await test('GET /api/mirror/history pages earlier lines before beforeOffset', async () => {
      const lines = [];
      for (let i = 0; i < 30; i++) lines.push(fixtureLine('user', 'h-' + String(i).padStart(2, '0')));
      fixtureFiles.set('sess-hist', writeFixture('hist.jsonl', lines));
      // Shrink the window so open() truncates the head, then page back.
      const originalWindow = mirrorService._historyTailBytes;
      mirrorService._historyTailBytes = 150;
      try {
        const open = await req('POST', '/api/mirror/open', {
          provider: 'mirrorstub', providerSessionId: 'sess-hist', deviceId: 'web-hist',
        });
        assertEqual(open.status, 200);
        assertEqual(open.body.truncatedHead, true);
        const r = await req('GET',
          '/api/mirror/history?provider=mirrorstub&providerSessionId=sess-hist&beforeOffset=' + open.body.startOffset);
        assertEqual(r.status, 200);
        assert(Array.isArray(r.body.messages) && r.body.messages.length > 0, 'earlier page must contain messages');
        assert(r.body.startOffset < open.body.startOffset, 'page must move backwards');
        // Continuity: the page's last message immediately precedes history's first.
        const firstHistoryIdx = parseInt(open.body.history[0].text.slice(2), 10);
        const lastPageIdx = parseInt(r.body.messages[r.body.messages.length - 1].text.slice(2), 10);
        assertEqual(lastPageIdx, firstHistoryIdx - 1, 'no gap and no overlap at the page boundary');
      } finally {
        mirrorService._historyTailBytes = originalWindow;
        mirrorService._teardown('mirrorstub:sess-hist');
      }
    });

    // ── 8. SSE deviceId scoping ────────────────────────────────────────
    await test('mirror:message reaches ONLY the subscribed deviceId over SSE', async () => {
      fixtureFiles.set('sess-sse', writeFixture('sse.jsonl', [fixtureLine('user', 'seed')]));
      const sseA = await openSse('web-sse-A');
      const sseB = await openSse('web-sse-B');
      try {
        const open = await req('POST', '/api/mirror/open', {
          provider: 'mirrorstub', providerSessionId: 'sess-sse', deviceId: 'web-sse-A',
        });
        assertEqual(open.status, 200);
        fs.appendFileSync(fixtureFiles.get('sess-sse'), fixtureLine('assistant', 'scoped-payload') + '\n');
        await waitFor(() => sseA.buffer().includes('scoped-payload'), 6000);
        assert(sseA.buffer().includes('"type":"mirror:message"'), 'device A must receive mirror:message');
        // Device B is connected but never opened this mirror: nothing leaks.
        await sleep(150); // give any (incorrect) broadcast time to arrive
        assert(!sseB.buffer().includes('mirror:message'),
          'device B must NOT receive mirror:message (got: ' + sseB.buffer().slice(-200) + ')');
        assert(!sseB.buffer().includes('scoped-payload'), 'payload text must not leak to device B');
      } finally {
        sseA.close();
        sseB.close();
        await req('POST', '/api/mirror/close', { mirrorKey: 'mirrorstub:sess-sse', deviceId: 'web-sse-A' });
        mirrorService._teardown('mirrorstub:sess-sse');
      }
    });

    // ── 9. auth gate ───────────────────────────────────────────────────
    await test('all /api/mirror routes require auth', async () => {
      const r1 = await req('POST', '/api/mirror/open', { provider: 'mirrorstub', providerSessionId: 'x', deviceId: 'web-x' }, { auth: false });
      const r2 = await req('POST', '/api/mirror/close', { mirrorKey: 'mirrorstub:x', deviceId: 'web-x' }, { auth: false });
      const r3 = await req('GET', '/api/mirror/history?provider=mirrorstub&providerSessionId=x&beforeOffset=0', undefined, { auth: false });
      assertEqual(r1.status, 401);
      assertEqual(r2.status, 401);
      assertEqual(r3.status, 401);
    });

    // ── 10. Phase 0: discovery liveness flags ──────────────────────────
    await test('groupProviderSessionsForUI stamps live/lastActiveMs (fresh/stale/archived/missing)', async () => {
      const now = Date.now();
      const freshIso = new Date(now - 5000).toISOString();
      const staleIso = new Date(now - LIVE_THRESHOLD_MS - 60000).toISOString();
      const sessions = [
        { providerSessionId: 'fresh', projectPath: 'C:\\proj', lastActive: freshIso, sizeBytes: 10 },
        { providerSessionId: 'stale', projectPath: 'C:\\proj', lastActive: staleIso, sizeBytes: 10 },
        { providerSessionId: 'arch', projectPath: 'C:\\proj', lastActive: freshIso, sizeBytes: 10, archived: true },
        { providerSessionId: 'no-mtime', projectPath: 'C:\\proj', lastActive: null, sizeBytes: 10 },
      ];
      const grouped = groupProviderSessionsForUI(sessions, { id: 'mirrorstub' });
      assertEqual(grouped.length, 1, 'one project bucket expected');
      const byId = {};
      for (const s of grouped[0].sessions) byId[s.claudeSessionId] = s;
      assertEqual(byId['fresh'].live, true, 'fresh mtime must be live');
      assertEqual(byId['fresh'].lastActiveMs, new Date(freshIso).getTime());
      assertEqual(byId['stale'].live, false, 'stale mtime must not be live');
      assertEqual(byId['stale'].lastActiveMs, new Date(staleIso).getTime());
      assertEqual(byId['arch'].live, false, 'archived sessions are never live regardless of mtime');
      assertEqual(byId['no-mtime'].live, false, 'missing lastActive must not be live');
      assertEqual(byId['no-mtime'].lastActiveMs, null, 'missing lastActive maps to null, never NaN');
    });

    // ── Summary ──────────────────────────────────────────────────────────
    console.log('  ' + '-'.repeat(78));
    console.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
  } finally {
    // Stop every mirror watcher BEFORE closing the HTTP server: an active
    // fs.watch handle would otherwise keep the test process alive forever
    // (this is exactly the npm-test-hang class the project guards against).
    try { mirrorService.disposeAll(); } catch (_) {}
    await new Promise((resolve) => httpServer.close(resolve));
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\nTest runner crashed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
