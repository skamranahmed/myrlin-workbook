#!/usr/bin/env node
/**
 * test/migration.test.js
 *
 * Tests for the v1 -> v2 state schema migration. Covers MIG-01..MIG-06
 * plus a settings-preservation case and an unconditional-backup-walk case.
 *
 * Runs standalone via `node test/migration.test.js`. Wired into the main
 * runner through test/run.js standaloneTests array.
 *
 * Why this file matters: the existing 109 tests use freshStore() which
 * DELETES state files, so migration logic is never exercised by the main
 * suite. PITFALLS#1 (state migration silent loss) is preventable only with
 * a real-fixture-backed test like this one.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

// ─── Tiny test harness ──────────────────────────────────────
let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log('  PASS  ' + name);
  } else {
    failed++;
    console.log('  FAIL  ' + name + (detail ? '  - ' + detail : ''));
  }
}
function expectThrow(fn, name, detail) {
  let threw = false;
  let err = null;
  try { fn(); } catch (e) { threw = true; err = e; }
  check(name, threw, detail || (err ? '' : 'expected throw, none observed'));
  return err;
}
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ─── Module under test ──────────────────────────────────────
// Force CWM_DATA_DIR into a temp dir for THIS process so loading the store
// module does not touch the operator's real ~/.myrlin/.
const harnessDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwm-mig-host-'));
process.env.CWM_DATA_DIR = harnessDataDir;

// Pure migration function should be exported alongside Store + getStore.
const storeModule = require(path.join(__dirname, '..', 'src', 'state', 'store'));
const { migrateStateV1toV2 } = storeModule;

console.log('\n  State migration v1 -> v2');
console.log('  ' + '-'.repeat(40));

// ─── Test 1 (MIG-01): every session in v1 fixture gains provider:'claude' ──
{
  const fixturePath = path.join(__dirname, 'fixtures', 'migration-v1-state.json');
  const v1 = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  const migrated = migrateStateV1toV2(v1);

  check('MIG-01: migrated state.version === 2',
    migrated.version === 2,
    'got ' + migrated.version);

  const sessionIds = Object.keys(migrated.sessions);
  const allTagged = sessionIds.every(sid => migrated.sessions[sid].provider === 'claude');
  check('MIG-01: every session has provider: claude', allTagged,
    sessionIds.length + ' sessions checked');
}

// ─── Test 2 (MIG-02): _tryLoadFile defensively defaults missing provider ──
{
  // Set up a temp dir, drop a v1 state in it, force the singleton to reload
  // by clearing require.cache, point CWM_DATA_DIR at the temp dir.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwm-mig-load-'));
  const stateFile = path.join(tempDir, 'workspaces.json');
  // Pre-v1 shape: a single session with no provider field at all.
  const v1Body = {
    version: 1,
    workspaces: { wsA: { id: 'wsA', name: 'WS-A', sessions: ['abc'], createdAt: 't', lastActive: 't' } },
    sessions: { abc: { id: 'abc', workspaceId: 'wsA', name: 'S-1', status: 'stopped', createdAt: 't', lastActive: 't' } },
  };
  fs.writeFileSync(stateFile, JSON.stringify(v1Body), 'utf-8');

  // Spawn a child to load against this temp dir; child verifies provider tagging.
  const probe = `
    process.env.CWM_DATA_DIR = ${JSON.stringify(tempDir)};
    const { Store } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'state', 'store'))});
    const s = new Store().init();
    const sess = s.state.sessions.abc;
    if (!sess) { console.error('SESSION_MISSING'); process.exit(2); }
    if (sess.provider !== 'claude') { console.error('NO_PROVIDER:' + JSON.stringify(sess)); process.exit(3); }
    console.log('OK');
  `;
  const result = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf-8' });
  check('MIG-02: missing provider field is defaulted to claude on load',
    result.status === 0,
    'exit=' + result.status + ' stderr=' + (result.stderr || '').slice(0, 200));

  fs.rmSync(tempDir, { recursive: true, force: true });
}

// ─── Test 3 (MIG-03): live + backup + timestamped backup all migrate ────
{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwm-mig-mig3-'));
  const backupsDir = path.join(tempDir, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });

  const v1Body = {
    version: 1,
    workspaces: { w1: { id: 'w1', name: 'W', sessions: ['s1'], createdAt: 't', lastActive: 't' } },
    sessions: { s1: { id: 's1', workspaceId: 'w1', name: 'S', status: 'stopped', createdAt: 't', lastActive: 't' } },
  };
  const live = path.join(tempDir, 'workspaces.json');
  const rolling = path.join(tempDir, 'workspaces.backup.json');
  const ts = path.join(backupsDir, 'workspaces-2026-01-01T00-00-00-000Z.json');
  fs.writeFileSync(live, JSON.stringify(v1Body), 'utf-8');
  fs.writeFileSync(rolling, JSON.stringify(v1Body), 'utf-8');
  fs.writeFileSync(ts, JSON.stringify(v1Body), 'utf-8');

  const probe = `
    process.env.CWM_DATA_DIR = ${JSON.stringify(tempDir)};
    const { Store } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'state', 'store'))});
    new Store().init();
    console.log('OK');
  `;
  const result = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf-8' });

  if (result.status !== 0) {
    check('MIG-03: Store.init() succeeded against temp dir', false,
      'exit=' + result.status + ' stderr=' + (result.stderr || '').slice(0, 300));
  } else {
    check('MIG-03: Store.init() succeeded against temp dir', true);
    const liveAfter = JSON.parse(fs.readFileSync(live, 'utf-8'));
    const rollingAfter = JSON.parse(fs.readFileSync(rolling, 'utf-8'));
    const tsAfter = JSON.parse(fs.readFileSync(ts, 'utf-8'));
    check('MIG-03: live state migrated to v2', liveAfter.version === 2,
      'got ' + liveAfter.version);
    check('MIG-03: rolling backup migrated to v2', rollingAfter.version === 2,
      'got ' + rollingAfter.version);
    check('MIG-03: timestamped backup migrated to v2', tsAfter.version === 2,
      'got ' + tsAfter.version);
  }

  fs.rmSync(tempDir, { recursive: true, force: true });
}

// ─── Test 4 (MIG-04): real fixture migrates with zero session loss ──────
{
  const fixturePath = path.join(__dirname, 'fixtures', 'migration-v1-state.json');
  const v1 = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  const beforeSessCount = Object.keys(v1.sessions).length;
  const beforeWsCount = Object.keys(v1.workspaces).length;

  const migrated = migrateStateV1toV2(v1);
  const afterSessCount = Object.keys(migrated.sessions).length;
  const afterWsCount = Object.keys(migrated.workspaces).length;

  check('MIG-04: zero session loss',
    beforeSessCount === afterSessCount,
    'before=' + beforeSessCount + ' after=' + afterSessCount);
  check('MIG-04: zero workspace loss',
    beforeWsCount === afterWsCount,
    'before=' + beforeWsCount + ' after=' + afterWsCount);
  check('MIG-04: production-realistic fixture (>= 20 sessions)',
    beforeSessCount >= 20,
    'fixture has ' + beforeSessCount + ' sessions');
  check('MIG-04: every migrated session has provider: claude',
    Object.values(migrated.sessions).every(s => s.provider === 'claude'),
    'some session missing provider');
  check('MIG-04: state.version === 2', migrated.version === 2);
  check('MIG-04: state.settings.providers === { claude: true, codex: false }',
    deepEqual(migrated.settings.providers, { claude: true, codex: false }),
    'got ' + JSON.stringify(migrated.settings.providers));
}

// ─── Test 5 (MIG-05): idempotent ────────────────────────────────────────
{
  const fixturePath = path.join(__dirname, 'fixtures', 'migration-v1-state.json');
  const v1 = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  const once = migrateStateV1toV2(v1);
  const twice = migrateStateV1toV2(once);
  check('MIG-05: migrating twice deep-equals migrating once',
    deepEqual(once, twice));
}

// ─── Test 6 (MIG-06): corrupt fixture causes refuse-to-start ────────────
{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwm-mig-corrupt-'));
  const corruptSrc = path.join(__dirname, 'fixtures', 'migration-v1-state-corrupt.json');
  const corruptDest = path.join(tempDir, 'workspaces.json');
  fs.copyFileSync(corruptSrc, corruptDest);

  const probe = `
    process.env.CWM_DATA_DIR = ${JSON.stringify(tempDir)};
    const { Store } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'state', 'store'))});
    try { new Store().init(); } catch (e) {
      // expected throw with the file path in the message
      console.error(e.message);
      process.exit(7);
    }
    process.exit(0);
  `;
  const child = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf-8' });

  check('MIG-06: Store.init() refuses to start (non-zero exit)',
    child.status !== 0,
    'exit=' + child.status);
  // The error message must contain the failing file path so the operator
  // knows which file to inspect.
  const haystack = (child.stderr || '') + '\n' + (child.stdout || '');
  check('MIG-06: error mentions the failing file path',
    haystack.includes(corruptDest),
    'stderr/stdout did not include ' + corruptDest);

  fs.rmSync(tempDir, { recursive: true, force: true });
}

// ─── Test 7: settings.providers default and preservation ────────────────
{
  // Case A: no providers block in source -> ends up with default { claude: true, codex: false }
  const noProviders = {
    version: 1,
    workspaces: {},
    sessions: {},
    settings: { autoRecover: true, theme: 'dark' },
  };
  const a = migrateStateV1toV2(noProviders);
  check('Test 7a: missing providers block gets default',
    deepEqual(a.settings.providers, { claude: true, codex: false }),
    'got ' + JSON.stringify(a.settings.providers));

  // Case B: existing providers block preserved (input wins on conflict)
  const withProviders = {
    version: 1,
    workspaces: {},
    sessions: {},
    settings: {
      autoRecover: true,
      providers: { claude: true, codex: true, gemini: true },
    },
  };
  const b = migrateStateV1toV2(withProviders);
  check('Test 7b: existing providers block is preserved',
    b.settings.providers.codex === true && b.settings.providers.gemini === true,
    'got ' + JSON.stringify(b.settings.providers));
}

// ─── Test 8: _migrateBackupFiles runs UNCONDITIONALLY ───────────────────
{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwm-mig-always-'));
  const backupsDir = path.join(tempDir, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });

  // Live file already at v2 (so the live-file migration path is a no-op).
  const v2Body = {
    version: 2,
    workspaces: { w1: { id: 'w1', name: 'W', sessions: [], createdAt: 't', lastActive: 't' } },
    sessions: {},
    settings: { providers: { claude: true, codex: false } },
  };
  // But a v1 backup is left around (e.g. partial-launch from a previous boot).
  const v1Body = {
    version: 1,
    workspaces: { w1: { id: 'w1', name: 'W', sessions: ['s1'], createdAt: 't', lastActive: 't' } },
    sessions: { s1: { id: 's1', workspaceId: 'w1', name: 'S', status: 'stopped', createdAt: 't', lastActive: 't' } },
  };
  const live = path.join(tempDir, 'workspaces.json');
  const oldBackup = path.join(backupsDir, 'workspaces-2026-01-01T00-00-00-000Z.json');
  fs.writeFileSync(live, JSON.stringify(v2Body), 'utf-8');
  fs.writeFileSync(oldBackup, JSON.stringify(v1Body), 'utf-8');

  const probe = `
    process.env.CWM_DATA_DIR = ${JSON.stringify(tempDir)};
    const { Store } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'state', 'store'))});
    new Store().init();
    console.log('OK');
  `;
  const result = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf-8' });
  if (result.status !== 0) {
    check('Test 8: Store.init() succeeded with live=v2 + backup=v1', false,
      'exit=' + result.status + ' stderr=' + (result.stderr || '').slice(0, 300));
  } else {
    check('Test 8: Store.init() succeeded with live=v2 + backup=v1', true);
    const backupAfter = JSON.parse(fs.readFileSync(oldBackup, 'utf-8'));
    check('Test 8: v1 backup migrated to v2 even though live was already v2',
      backupAfter.version === 2,
      'got ' + backupAfter.version);
  }

  fs.rmSync(tempDir, { recursive: true, force: true });
}

// ─── Cleanup ────────────────────────────────────────────────────────────
try { fs.rmSync(harnessDataDir, { recursive: true, force: true }); } catch (_) {}

// ─── Results ────────────────────────────────────────────────────────────
console.log('\n  ' + '-'.repeat(40));
console.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
console.log('  ' + '-'.repeat(40) + '\n');

process.exit(failed > 0 ? 1 : 0);
