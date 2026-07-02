#!/usr/bin/env node
/**
 * Integration tests for the credential switcher routes (design section 4).
 *
 * Boots the REAL Express app (src/web/server) with fixture HOME dirs and
 * local endpoint stubs injected via env BEFORE the server module loads
 * (CWM_CLAUDE_DIR, CWM_CLAUDE_JSON, CWM_CRED_USAGE_URL, CWM_CRED_TOKEN_URL,
 * CWM_CRED_SEED_DIR, CWM_CRED_DISABLE_MAC). Boot pattern copied from
 * test/codex-settings-route.test.js (require cache reset, auth.addToken,
 * ephemeral port). Hermetic: no real network, no real HOME writes, no SSH.
 *
 * The load-bearing security case: NO raw response body ever contains an
 * access token, a refresh token, or those key names.
 *
 * Exits 0 green, 1 red.
 */

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

// Sandbox CWM_DATA_DIR into a tmpdir before any module loads the store.
require('./_test-data-dir');

// ─── Fixture layout (must exist before the server module loads) ────────────
const fixtureRoot = path.join(process.env.CWM_DATA_DIR, 'route-fixtures');
const claudeDir = path.join(fixtureRoot, 'dot-claude');
const claudeJsonPath = path.join(fixtureRoot, 'dot-claude.json');
const seedRoot = path.join(fixtureRoot, 'seed');
const seedPcDir = path.join(seedRoot, 'profiles', 'pc');
fs.mkdirSync(claudeDir, { recursive: true });
fs.mkdirSync(seedPcDir, { recursive: true });
const credPath = path.join(claudeDir, '.credentials.json');
const accountsDir = path.join(process.env.CWM_DATA_DIR, 'claude-accounts');

const UUID_A = 'aaaaaaaa-1111-2222-3333-555555555501'; // active on the fixture PC
const UUID_B = 'bbbbbbbb-1111-2222-3333-555555555502'; // apply target
const UUID_C = 'cccccccc-1111-2222-3333-555555555503'; // needs_login row
const UUID_D = 'dddddddd-1111-2222-3333-555555555504'; // incomplete row
const UUID_S = 'eeeeeeee-1111-2222-3333-555555555505'; // claude-swap seed row
const EMAIL_A = 'route.a@example.com';
const EMAIL_B = 'route.b@example.com';
const HOUR_MS = 60 * 60 * 1000;

/**
 * Build a claudeAiOauth fixture object with distinctive token values.
 * @param {string} tag @param {number} expiresAt @returns {object}
 */
function makeOauth(tag, expiresAt) {
  return {
    accessToken: 'at-ROUTEFIX-' + tag,
    refreshToken: 'rt-ROUTEFIX-' + tag,
    expiresAt,
    scopes: ['user:inference'],
    subscriptionType: 'max',
    rateLimitTier: 'default_claude_max_20x',
  };
}

/**
 * Build an oauthAccount identity fixture.
 * @param {string} uuid @param {string} email @returns {object}
 */
function makeIdentity(uuid, email) {
  return {
    accountUuid: uuid,
    emailAddress: email,
    organizationUuid: 'ffffffff-0000-0000-0000-000000000002',
    organizationType: 'claude_max',
    displayName: 'Route Fixture',
    organizationName: 'Route Org',
  };
}

// Live PC state: account A logged in, token valid for 12h.
fs.writeFileSync(credPath, JSON.stringify({ claudeAiOauth: makeOauth('LIVE-A', Date.now() + 12 * HOUR_MS) }), 'utf-8');
fs.writeFileSync(claudeJsonPath, JSON.stringify({ numStartups: 3, oauthAccount: makeIdentity(UUID_A, EMAIL_A) }, null, 2), 'utf-8');

// One claude-swap seed profile flagged tokenDead by the old buggy tool; the
// first GET must import it as UNVERIFIED (flag ignored).
fs.writeFileSync(path.join(seedPcDir, 'seed@example.com.json'), JSON.stringify({
  email: 'seed@example.com',
  label: 'Seeded',
  capturedAt: '2026-06-23T00:00:00Z',
  credentialsFileText: JSON.stringify({ claudeAiOauth: makeOauth('SEED', Date.now() - 24 * HOUR_MS) }),
  oauthAccountJson: JSON.stringify(makeIdentity(UUID_S, 'seed@example.com')),
  usageCache: null,
  tokenDead: true,
}), 'utf-8');

// ─── Endpoint stubs (usage + token), started before the server loads ───────
const stub = { usageHits: 0, tokenHits: 0 };
const stubServer = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/usage') {
    stub.usageHits += 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      five_hour: { utilization: 42, resets_at: '2026-07-02T21:00:00+00:00' },
      seven_day: { utilization: 77, resets_at: '2026-07-08T07:00:00+00:00' },
      limits: [],
    }));
    return;
  }
  if (req.method === 'POST' && req.url === '/token') {
    stub.tokenHits += 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ access_token: 'at-ROUTEROTATED', refresh_token: 'rt-ROUTEROTATED', expires_in: 43200 }));
    return;
  }
  res.writeHead(404);
  res.end();
});

let passed = 0;
let failed = 0;

/**
 * Async test harness matching the standalone-test convention.
 * @param {string} name @param {Function} fn @returns {Promise<void>}
 */
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log('  \x1b[32m✓\x1b[0m ' + name);
    })
    .catch((err) => {
      failed += 1;
      console.log('  \x1b[31m✗\x1b[0m ' + name);
      console.log('    \x1b[31m' + ((err && err.message) || err) + '\x1b[0m');
    });
}

/** Assert a condition. @param {*} cond @param {string} [msg] */
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

/** Assert strict equality. @param {*} a @param {*} e @param {string} [msg] */
function assertEqual(a, e, msg) {
  if (a !== e) throw new Error(msg || ('Expected ' + JSON.stringify(e) + ', got ' + JSON.stringify(a)));
}

/** Sleep helper. @param {number} ms @returns {Promise<void>} */
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const TEST_TOKEN = 'test-token-credential-routes-t1';

/**
 * Issue one HTTP request against the booted app; parses JSON bodies but
 * always keeps the raw text for the token-leak assertions.
 *
 * @param {import('http').Server} server - Listening app server.
 * @param {string} method @param {string} urlPath
 * @param {{body?: object, skipAuth?: boolean, token?: string}} [opts]
 * @returns {Promise<{status: number, body: *, raw: string}>}
 */
function req(server, method, urlPath, opts) {
  opts = opts || {};
  const token = opts.skipAuth ? null : (opts.token || TEST_TOKEN);
  const data = opts.body == null ? null : JSON.stringify(opts.body);
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const r = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: urlPath,
      method,
      headers,
    }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        let body = buf;
        try { body = buf ? JSON.parse(buf) : null; } catch (_) { /* keep raw */ }
        resolve({ status: res.statusCode, body, raw: buf });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

/**
 * Assert a raw response body contains no token material: neither the
 * distinctive fixture values nor the credential key names may ever appear.
 * The load-bearing security check from design section 7.
 *
 * @param {string} raw - Raw response body text.
 * @param {string} where - Label for the failure message.
 * @returns {void}
 */
function assertNoTokenMaterial(raw, where) {
  assert(raw.indexOf('at-ROUTEFIX') === -1, where + ': access token VALUE leaked');
  assert(raw.indexOf('rt-ROUTEFIX') === -1, where + ': refresh token VALUE leaked');
  assert(raw.indexOf('at-ROUTEROTATED') === -1, where + ': rotated access token leaked');
  assert(raw.indexOf('rt-ROUTEROTATED') === -1, where + ': rotated refresh token leaked');
  assert(raw.indexOf('accessToken') === -1, where + ': accessToken key leaked');
  assert(raw.indexOf('refreshToken') === -1, where + ': refreshToken key leaked');
}

/**
 * Open a raw SSE client against /api/events and collect parsed events.
 *
 * @param {import('http').Server} server - Listening app server.
 * @returns {Promise<{events: object[], close: Function}>}
 */
function openSSE(server) {
  return new Promise((resolve, reject) => {
    const r = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: '/api/events?token=' + TEST_TOKEN,
      method: 'GET',
    }, (res) => {
      const events = [];
      let buf = '';
      res.on('data', (d) => {
        buf += d.toString();
        let idx = buf.indexOf('\n\n');
        while (idx !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of chunk.split('\n')) {
            if (line.startsWith('data: ')) {
              try { events.push(JSON.parse(line.slice(6))); } catch (_) { /* comment or partial */ }
            }
          }
          idx = buf.indexOf('\n\n');
        }
      });
      resolve({ events, close: () => r.destroy() });
    });
    r.on('error', reject);
    r.end();
  });
}

(async function main() {
  // Start the endpoint stub FIRST so the env URLs are known before the
  // server module (and its manager) loads.
  await new Promise((resolve) => stubServer.listen(0, '127.0.0.1', resolve));
  const stubBase = 'http://127.0.0.1:' + stubServer.address().port;
  process.env.CWM_CLAUDE_DIR = claudeDir;
  process.env.CWM_CLAUDE_JSON = claudeJsonPath;
  process.env.CWM_CRED_USAGE_URL = stubBase + '/usage';
  process.env.CWM_CRED_TOKEN_URL = stubBase + '/token';
  process.env.CWM_CRED_SEED_DIR = seedRoot;
  process.env.CWM_CRED_DISABLE_MAC = '1';

  // Reset module cache so each run starts clean (codex test convention).
  delete require.cache[require.resolve('../src/providers')];
  delete require.cache[require.resolve('../src/providers/claude')];
  delete require.cache[require.resolve('../src/state/store')];
  delete require.cache[require.resolve('../src/web/server')];

  const registry = require('../src/providers');
  const { getStore } = require('../src/state/store');
  const store = getStore();
  await registry.initRegistry(store);
  const server = require('../src/web/server');
  const app = server.app;
  const auth = require('../src/web/auth');
  auth.addToken(TEST_TOKEN);
  const listener = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => listener.once('listening', resolve));
  const sse = await openSSE(listener);

  console.log('\n  credential-routes integration tests');
  console.log('  ' + '─'.repeat(70));

  // ─── Auth wall ────────────────────────────────────────────────────────
  await test('401 without a token on every credential route', async () => {
    const cases = [
      ['GET', '/api/credentials'],
      ['POST', '/api/credentials/refresh-usage'],
      ['POST', '/api/credentials/apply'],
      ['POST', '/api/credentials/capture'],
      ['PUT', '/api/credentials/' + UUID_A + '/label'],
      ['DELETE', '/api/credentials/' + UUID_A],
      ['GET', '/api/credentials/mac-config'],
      ['PUT', '/api/credentials/mac-config'],
    ];
    for (const [method, url] of cases) {
      const r = await req(listener, method, url, { body: {}, skipAuth: true });
      assertEqual(r.status, 401, method + ' ' + url + ' must 401 without auth, got ' + r.status);
    }
  });

  // ─── GET list: seed + self-capture + safe rows only ───────────────────
  await test('GET /api/credentials seeds from claude-swap, self-captures, leaks nothing', async () => {
    const r = await req(listener, 'GET', '/api/credentials');
    assertEqual(r.status, 200, 'body=' + r.raw);
    assertNoTokenMaterial(r.raw, 'GET list');
    assertEqual(r.body.activeProfileId, UUID_A, 'active account detected from fixture identity');
    const rowA = r.body.profiles.find((p) => p.profileId === UUID_A);
    assert(rowA, 'active account self-captured on first list');
    assertEqual(rowA.isActive, true);
    assertEqual(rowA.displayName, EMAIL_A, 'unnamed capture falls back to email');
    assertEqual(rowA.health, 'healthy');
    const rowS = r.body.profiles.find((p) => p.profileId === UUID_S);
    assert(rowS, 'claude-swap profile seeded');
    assertEqual(rowS.tokenState, 'unverified', 'seed IGNORES the old tokenDead flag');
    assertEqual(rowS.tokenDead, false, 'unverified is not dead');
    assertEqual(rowS.health, 'needs-attention');
    assertEqual(rowS.label, 'Seeded', 'seed label carried');
    assert(r.body.mac && r.body.mac.configured === true && r.body.mac.enabled === false, 'mac summary present with defaults');
  });

  // ─── Capture with label ───────────────────────────────────────────────
  await test('POST capture applies an optional label to the active account', async () => {
    const r = await req(listener, 'POST', '/api/credentials/capture', { body: { label: 'Primary' } });
    assertEqual(r.status, 200, 'body=' + r.raw);
    assertNoTokenMaterial(r.raw, 'capture');
    const rowA = r.body.profiles.find((p) => p.profileId === UUID_A);
    assertEqual(rowA.label, 'Primary');
    assertEqual(rowA.displayName, 'Primary');
  });

  // ─── Label round trip + broadcast ─────────────────────────────────────
  await test('PUT label: set, clear, cap at 60, 404 unknown, SSE broadcast', async () => {
    const sseBefore = sse.events.length;
    const r1 = await req(listener, 'PUT', '/api/credentials/' + UUID_A + '/label', { body: { label: 'Renamed' } });
    assertEqual(r1.status, 200);
    assertEqual(r1.body.profiles.find((p) => p.profileId === UUID_A).displayName, 'Renamed');
    await sleep(150);
    const renamedEvent = sse.events.slice(sseBefore).find((e) => e.type === 'credentials:changed' && e.data && e.data.renamed === true);
    assert(renamedEvent, 'credentials:changed broadcast with renamed:true');
    assertEqual(renamedEvent.data.profileId, UUID_A, 'payload uses profileId, never a bare id');
    const r2 = await req(listener, 'PUT', '/api/credentials/' + UUID_A + '/label', { body: { label: '' } });
    assertEqual(r2.status, 200);
    assertEqual(r2.body.profiles.find((p) => p.profileId === UUID_A).displayName, EMAIL_A, 'clear falls back to email');
    const r3 = await req(listener, 'PUT', '/api/credentials/' + UUID_A + '/label', { body: { label: 'x'.repeat(61) } });
    assertEqual(r3.status, 400);
    assertEqual(r3.body.error, 'VALIDATION');
    assertEqual(r3.body.code, 400, 'structuredError shape');
    const r4 = await req(listener, 'PUT', '/api/credentials/' + UUID_B + '/label', { body: { label: 'nope' } });
    assertEqual(r4.status, 404);
    assertEqual(r4.body.error, 'CRED_NOT_FOUND');
  });

  // ─── Apply: swaps both fixture files in order, broadcasts ─────────────
  await test('POST apply swaps the fixture pair, verifies, and broadcasts', async () => {
    // Stage the target snapshot directly in the store dir (unexpired, ok).
    fs.writeFileSync(path.join(accountsDir, UUID_B + '.json'), JSON.stringify({
      accountUuid: UUID_B,
      email: EMAIL_B,
      label: 'Target',
      savedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      credentials: makeOauth('B', Date.now() + 6 * HOUR_MS),
      identity: makeIdentity(UUID_B, EMAIL_B),
      usage: null,
      tokenState: 'ok',
      lastRefreshError: null,
    }, null, 2), 'utf-8');
    const sseBefore = sse.events.length;
    const r = await req(listener, 'POST', '/api/credentials/apply', { body: { profileId: UUID_B, mirrorToMac: false } });
    assertEqual(r.status, 200, 'body=' + r.raw);
    assertNoTokenMaterial(r.raw, 'apply');
    assertEqual(r.body.applied, true);
    assertEqual(r.body.alreadyActive, false);
    assertEqual(r.body.activeProfileId, UUID_B);
    assert(typeof r.body.restartNote === 'string' && r.body.restartNote.length > 0, 'restart note present');
    assertEqual(r.body.mac.attempted, false, 'mac mirror not attempted (disabled)');
    const liveCred = JSON.parse(fs.readFileSync(credPath, 'utf-8')).claudeAiOauth;
    assertEqual(liveCred.accessToken, 'at-ROUTEFIX-B', 'live token file swapped to the target');
    const liveJson = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'));
    assertEqual(liveJson.oauthAccount.accountUuid, UUID_B, 'live identity swapped to the target');
    assertEqual(liveJson.numStartups, 3, 'surgical edit: unrelated keys survive');
    await sleep(150);
    const changed = sse.events.slice(sseBefore).find((e) => e.type === 'credentials:changed' && e.data && e.data.activeProfileId === UUID_B);
    assert(changed, 'credentials:changed broadcast after the PC commit');
    const list = await req(listener, 'GET', '/api/credentials');
    assertEqual(list.body.activeProfileId, UUID_B, 'list reflects the new active account');
    // Applying the already-active account is a 200 no-op.
    const again = await req(listener, 'POST', '/api/credentials/apply', { body: { profileId: UUID_B } });
    assertEqual(again.status, 200);
    assertEqual(again.body.alreadyActive, true);
    assertEqual(again.body.applied, false);
  });

  // ─── Apply error taxonomy through structuredError ─────────────────────
  await test('apply errors: 400 VALIDATION, 404 CRED_NOT_FOUND, 409 CRED_TOKEN_DEAD, 422 CRED_INCOMPLETE', async () => {
    const bad = await req(listener, 'POST', '/api/credentials/apply', { body: { profileId: 'not$valid' } });
    assertEqual(bad.status, 400);
    assertEqual(bad.body.error, 'VALIDATION');
    assert(typeof bad.body.message === 'string' && typeof bad.body.retryable === 'boolean', 'structuredError shape');
    const missing = await req(listener, 'POST', '/api/credentials/apply', { body: { profileId: 'abcdef00-0000-0000-0000-000000000000' } });
    assertEqual(missing.status, 404);
    assertEqual(missing.body.error, 'CRED_NOT_FOUND');
    fs.writeFileSync(path.join(accountsDir, UUID_C + '.json'), JSON.stringify({
      accountUuid: UUID_C,
      email: 'dead@example.com',
      label: '',
      credentials: makeOauth('C', Date.now() + HOUR_MS),
      identity: makeIdentity(UUID_C, 'dead@example.com'),
      usage: null,
      tokenState: 'needs_login',
      lastRefreshError: null,
    }), 'utf-8');
    const dead = await req(listener, 'POST', '/api/credentials/apply', { body: { profileId: UUID_C } });
    assertEqual(dead.status, 409);
    assertEqual(dead.body.error, 'CRED_TOKEN_DEAD');
    assert(dead.body.message.indexOf('/login') !== -1, 'actionable message');
    fs.writeFileSync(path.join(accountsDir, UUID_D + '.json'), JSON.stringify({
      accountUuid: UUID_D,
      email: 'half@example.com',
      label: '',
      credentials: makeOauth('D', Date.now() + HOUR_MS),
      identity: null,
      usage: null,
      tokenState: 'ok',
      lastRefreshError: null,
    }), 'utf-8');
    const incomplete = await req(listener, 'POST', '/api/credentials/apply', { body: { profileId: UUID_D } });
    assertEqual(incomplete.status, 422);
    assertEqual(incomplete.body.error, 'CRED_INCOMPLETE');
  });

  // ─── Refresh usage against the stubs ──────────────────────────────────
  await test('POST refresh-usage updates usage from the stub and broadcasts credentials:usage', async () => {
    const sseBefore = sse.events.length;
    const r = await req(listener, 'POST', '/api/credentials/refresh-usage', { body: { profileId: UUID_B } });
    assertEqual(r.status, 200, 'body=' + r.raw);
    assertNoTokenMaterial(r.raw, 'refresh-usage');
    const rowB = r.body.profiles.find((p) => p.profileId === UUID_B);
    assert(rowB.usage, 'usage present after refresh');
    assertEqual(rowB.usage.five_hour.utilization, 42);
    assertEqual(rowB.usage.seven_day.utilization, 77);
    assert(rowB.usage.fetchedAt, 'fetchedAt stamped');
    assert(stub.usageHits >= 1, 'stub usage endpoint hit');
    await sleep(150);
    const usageEvent = sse.events.slice(sseBefore).find((e) => e.type === 'credentials:usage');
    assert(usageEvent, 'credentials:usage broadcast');
    assert(Array.isArray(usageEvent.data.profiles), 'payload carries safe rows');
    assertNoTokenMaterial(JSON.stringify(usageEvent.data), 'credentials:usage SSE payload');
    const r404 = await req(listener, 'POST', '/api/credentials/refresh-usage', { body: { profileId: 'abcdef00-0000-0000-0000-00000000ffff' } });
    assertEqual(r404.status, 404);
    assertEqual(r404.body.error, 'CRED_NOT_FOUND');
    const rBad = await req(listener, 'POST', '/api/credentials/refresh-usage', { body: { profileId: 42 } });
    assertEqual(rBad.status, 400);
  });

  // ─── Mac config round trip ────────────────────────────────────────────
  await test('mac-config: GET defaults, PUT validates charset, persists via the store', async () => {
    const g1 = await req(listener, 'GET', '/api/credentials/mac-config');
    assertEqual(g1.status, 200);
    assertEqual(g1.body.enabled, false, 'mac disabled by default');
    assertEqual(g1.body.host, 'arthurs-mac-mini');
    assertEqual(g1.body.user, 'arthur');
    const badHost = await req(listener, 'PUT', '/api/credentials/mac-config', { body: { host: 'bad host!' } });
    assertEqual(badHost.status, 400);
    assertEqual(badHost.body.error, 'VALIDATION');
    const dashHost = await req(listener, 'PUT', '/api/credentials/mac-config', { body: { host: '-oProxyCommand=evil' } });
    assertEqual(dashHost.status, 400, 'leading-dash host rejected (ssh option injection)');
    const badUser = await req(listener, 'PUT', '/api/credentials/mac-config', { body: { user: 'evil user' } });
    assertEqual(badUser.status, 400);
    const ok = await req(listener, 'PUT', '/api/credentials/mac-config', { body: { host: 'alloy', user: 'arthur', enabled: true, postSwapCommand: 'true' } });
    assertEqual(ok.status, 200, 'body=' + ok.raw);
    assertEqual(ok.body.host, 'alloy');
    assertEqual(ok.body.enabled, true);
    const g2 = await req(listener, 'GET', '/api/credentials/mac-config');
    assertEqual(g2.body.host, 'alloy', 'persisted through the store');
    assertEqual(g2.body.enabled, true);
    assertEqual(g2.body.postSwapCommand, 'true');
    // Store-level persistence check.
    assert(store.settings.credentialSwitcher && store.settings.credentialSwitcher.mac.host === 'alloy', 'settings.credentialSwitcher.mac persisted');
  });

  // ─── Delete ───────────────────────────────────────────────────────────
  await test('DELETE removes the snapshot file only; second delete 404s', async () => {
    const sseBefore = sse.events.length;
    const r = await req(listener, 'DELETE', '/api/credentials/' + UUID_C);
    assertEqual(r.status, 200);
    assert(!fs.existsSync(path.join(accountsDir, UUID_C + '.json')), 'snapshot file removed');
    assert(fs.existsSync(credPath), 'live token file untouched');
    assert(fs.existsSync(claudeJsonPath), 'live identity file untouched');
    await sleep(150);
    const deletedEvent = sse.events.slice(sseBefore).find((e) => e.type === 'credentials:changed' && e.data && e.data.deleted === true && e.data.profileId === UUID_C);
    assert(deletedEvent, 'credentials:changed broadcast with deleted:true');
    const again = await req(listener, 'DELETE', '/api/credentials/' + UUID_C);
    assertEqual(again.status, 404);
    assertEqual(again.body.error, 'CRED_NOT_FOUND');
  });

  // ─── Full-stream token-material sweep ─────────────────────────────────
  await test('no SSE event ever carried token material', async () => {
    assertNoTokenMaterial(JSON.stringify(sse.events), 'entire SSE stream');
  });

  // Cleanup
  sse.close();
  listener.close();
  stubServer.close();

  console.log('  ' + '─'.repeat(70));
  console.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error('FATAL: ' + ((err && err.stack) || err));
  process.exit(1);
});
