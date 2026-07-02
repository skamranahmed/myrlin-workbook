#!/usr/bin/env node
/**
 * Tests for src/providers/codex/discover.js (Phase 17 Plan 17-01).
 *
 * Coverage:
 *   1. discover honors process.env.CODEX_HOME (CDX-07)
 *   2. discover fast-path resolves all index entries to ProviderSession[] (CDX-02)
 *   3. discover walk-fallback when session_index.jsonl is missing (CDX-02)
 *   4. discover merges stale index entries via walk-fallback recovery (CDX-02)
 *   5. discover returns [] when $CODEX_HOME does not exist (CDX-01 no-throw)
 *   6. discover returns [] when $CODEX_HOME/sessions/ does not exist (CDX-01)
 *   7. discover tolerates corrupt session_index.jsonl lines
 *   8. discover sorts results by lastActive descending
 *
 * Each test stages a unique CODEX_HOME tempdir, populates the date-bucketed
 * sessions tree (and optionally session_index.jsonl), runs discover(),
 * asserts the result, and cleans up. CODEX_HOME is restored after each
 * test so suite ordering is irrelevant.
 *
 * Standalone-test convention: this file owns its own assertion helpers and
 * exits 0 on green / 1 on any failure. Mirrors test/codex-parse.test.js.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// ─── Assertion helpers ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

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

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(msg || ('Expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual)));
  }
}

// ─── Module require ────────────────────────────────────────────────────────

let discover;
try {
  discover = require('../src/providers/codex/discover');
} catch (err) {
  console.error('FATAL: could not require src/providers/codex/discover.js: ' + err.message);
  process.exit(1);
}

// ─── Staging helpers ───────────────────────────────────────────────────────

const PROJECT_ROOT = path.join(__dirname, '..');
const MODERN_FIXTURE = path.join(PROJECT_ROOT, 'test', 'fixtures', 'codex-rollouts', 'modern.jsonl');
const SESSION_INDEX_FIXTURE = path.join(PROJECT_ROOT, 'test', 'fixtures', 'codex-rollouts', 'session-index.jsonl');

/**
 * Build a fresh CODEX_HOME tempdir. Returns the abs path.
 */
function makeCodexHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cwm-codex-discover-'));
}

/**
 * Stage one rollout file under sessions/<date>/. The fixture contents come
 * from MODERN_FIXTURE (provides a session_meta first line so cwd resolves).
 *
 * @param {string} codexHome
 * @param {string} dateDir - e.g. '2026/04/26'
 * @param {string} id - UUID embedded in filename
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
 * Write a session_index.jsonl with the provided entries.
 *
 * @param {string} codexHome
 * @param {Array<{id:string, thread_name?:string, updated_at:string}>} entries
 */
function stageSessionIndex(codexHome, entries) {
  const lines = entries.map((e) => JSON.stringify({
    id: e.id,
    thread_name: e.thread_name || '',
    updated_at: e.updated_at,
  }));
  fs.writeFileSync(path.join(codexHome, 'session_index.jsonl'), lines.join('\n') + '\n', 'utf-8');
}

/**
 * Run an async test body with CODEX_HOME pointed at `tmp`. Restores the
 * previous env value on exit.
 */
async function withCodexHome(tmp, fn) {
  const prev = process.env.CODEX_HOME;
  process.env.CODEX_HOME = tmp;
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prev;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
}

// Suppress noisy console.debug from the discover module during walk-fallback
// runs; restore after each test.
const realDebug = console.debug;

// ─── Run tests ─────────────────────────────────────────────────────────────

console.log('\n  Plan 17-01: codex/discover.js');
console.log('  ' + '-'.repeat(70));

(async () => {
  // ─── Test 1: discover honors CODEX_HOME (CDX-07) ────────────────────────
  {
    const tmp = makeCodexHome();
    const id = '019dc872-a308-7111-ba78-068f9294120c';
    stageRollout(tmp, '2026/04/26', id);
    stageSessionIndex(tmp, [{ id: id, thread_name: 'Test', updated_at: '2026-04-26T06:25:00.000Z' }]);
    await withCodexHome(tmp, async () => {
      console.debug = () => {};
      const results = await discover();
      console.debug = realDebug;
      test('discover honors process.env.CODEX_HOME', () => {
        assertEqual(results.length, 1, 'expected exactly 1 result, got ' + results.length);
        assertEqual(results[0].providerSessionId, id, 'expected staged id');
        assertEqual(results[0].provider, 'codex', 'expected provider tag');
        assertEqual(results[0].title, 'Test', 'expected title from index');
      });
    });
  }

  // ─── Test 2: fast-path resolves all index entries (CDX-02) ──────────────
  {
    const tmp = makeCodexHome();
    const id1 = '019dc872-a308-7111-ba78-068f9294120c';
    const id2 = '019dcac8-f459-7fa0-83e8-3c3112d0fe0e';
    const id3 = '019dbc37-4284-71c2-b216-8f9b6c431001';
    stageRollout(tmp, '2026/04/26', id1);
    stageRollout(tmp, '2026/04/26', id2);
    stageRollout(tmp, '2026/04/23', id3);
    stageSessionIndex(tmp, [
      { id: id1, thread_name: 'Title One', updated_at: '2026-04-26T06:25:00.000Z' },
      { id: id2, thread_name: 'Title Two', updated_at: '2026-04-26T13:14:20.000Z' },
      { id: id3, thread_name: 'Title Three', updated_at: '2026-04-23T21:20:39.287Z' },
    ]);
    await withCodexHome(tmp, async () => {
      console.debug = () => {};
      const results = await discover();
      console.debug = realDebug;
      test('discover fast-path resolves all index entries with titles', () => {
        assertEqual(results.length, 3, 'expected 3 results, got ' + results.length);
        const titles = new Set(results.map((r) => r.title));
        assert(titles.has('Title One'), 'Title One missing');
        assert(titles.has('Title Two'), 'Title Two missing');
        assert(titles.has('Title Three'), 'Title Three missing');
        // Every result has a projectPath from the fixture's session_meta.
        for (const r of results) {
          assertEqual(r.projectPath, '/home/user/project', 'projectPath should match fixture session_meta cwd');
        }
      });
    });
  }

  // ─── Test 3: walk-fallback when session_index missing (CDX-02) ──────────
  {
    const tmp = makeCodexHome();
    const id1 = '019dc872-a308-7111-ba78-068f9294120c';
    const id2 = '019dcac8-f459-7fa0-83e8-3c3112d0fe0e';
    stageRollout(tmp, '2026/04/26', id1);
    stageRollout(tmp, '2026/04/26', id2);
    // No session_index.jsonl on purpose.
    await withCodexHome(tmp, async () => {
      console.debug = () => {};
      const results = await discover();
      console.debug = realDebug;
      test('discover walk-fallback runs when session_index.jsonl is missing', () => {
        assertEqual(results.length, 2, 'expected 2 walk-discovered results, got ' + results.length);
        for (const r of results) {
          assertEqual(r.title, null, 'walk-fallback has no title source; expected null');
          assertEqual(r.provider, 'codex', 'expected provider tag');
        }
      });
    });
  }

  // ─── Test 4: stale index merge via walk-fallback (CDX-02) ───────────────
  {
    const tmp = makeCodexHome();
    const id1 = '019dc872-a308-7111-ba78-068f9294120c'; // valid index + file
    const id2 = '019dcac8-f459-7fa0-83e8-3c3112d0fe0e'; // valid index + file
    const idStale = '019d0000-0000-7000-8000-000000000099'; // index entry, no file
    const idExtra = '019dbc37-4284-71c2-b216-8f9b6c431001'; // file only (no index entry)
    stageRollout(tmp, '2026/04/26', id1);
    stageRollout(tmp, '2026/04/26', id2);
    stageRollout(tmp, '2026/04/23', idExtra);
    stageSessionIndex(tmp, [
      { id: id1, thread_name: 'Valid One', updated_at: '2026-04-26T06:25:00.000Z' },
      { id: id2, thread_name: 'Valid Two', updated_at: '2026-04-26T13:14:20.000Z' },
      { id: idStale, thread_name: 'Stale', updated_at: '2026-04-26T14:00:00.000Z' },
    ]);
    await withCodexHome(tmp, async () => {
      console.debug = () => {};
      const results = await discover();
      console.debug = realDebug;
      test('discover recovers stale index entries via walk-fallback', () => {
        // Expected: id1 (fast-path), id2 (fast-path), idExtra (walk).
        // Stale entry (idStale) has no file, so it must NOT appear.
        assertEqual(results.length, 3, 'expected 3 results, got ' + results.length);
        const ids = new Set(results.map((r) => r.providerSessionId));
        assert(ids.has(id1), 'id1 missing');
        assert(ids.has(id2), 'id2 missing');
        assert(ids.has(idExtra), 'extra file (walk recovery) missing');
        assert(!ids.has(idStale), 'stale id (no file) must be dropped');
      });
    });
  }

  // ─── Test 5: missing $CODEX_HOME returns [] (CDX-01) ────────────────────
  {
    const tmp = path.join(os.tmpdir(), 'cwm-codex-nonexistent-' + Date.now() + '-' + process.pid);
    // Do NOT create the directory.
    const prev = process.env.CODEX_HOME;
    process.env.CODEX_HOME = tmp;
    try {
      const results = await discover();
      test('discover returns [] when $CODEX_HOME does not exist', () => {
        assert(Array.isArray(results), 'expected an array');
        assertEqual(results.length, 0, 'expected empty array');
      });
    } finally {
      if (prev === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = prev;
    }
  }

  // ─── Test 6: missing $CODEX_HOME/sessions/ returns [] (CDX-01) ──────────
  {
    const tmp = makeCodexHome();
    // Create CODEX_HOME but NOT sessions/.
    await withCodexHome(tmp, async () => {
      const results = await discover();
      test('discover returns [] when $CODEX_HOME/sessions/ does not exist', () => {
        assert(Array.isArray(results), 'expected an array');
        assertEqual(results.length, 0, 'expected empty array');
      });
    });
  }

  // ─── Test 7: corrupt session_index lines tolerated ──────────────────────
  {
    const tmp = makeCodexHome();
    const id1 = '019dc872-a308-7111-ba78-068f9294120c';
    const id2 = '019dcac8-f459-7fa0-83e8-3c3112d0fe0e';
    stageRollout(tmp, '2026/04/26', id1);
    stageRollout(tmp, '2026/04/26', id2);
    // Mix valid + corrupt + valid in the index.
    fs.writeFileSync(path.join(tmp, 'session_index.jsonl'),
      JSON.stringify({ id: id1, thread_name: 'A', updated_at: '2026-04-26T06:25:00.000Z' }) + '\n' +
      '{this is not json}\n' +
      JSON.stringify({ id: id2, thread_name: 'B', updated_at: '2026-04-26T13:14:20.000Z' }) + '\n',
      'utf-8'
    );
    await withCodexHome(tmp, async () => {
      console.debug = () => {};
      const results = await discover();
      console.debug = realDebug;
      test('discover tolerates corrupt session_index.jsonl lines', () => {
        assertEqual(results.length, 2, 'expected 2 valid results despite corrupt line, got ' + results.length);
        const titles = new Set(results.map((r) => r.title));
        assert(titles.has('A'), 'title A missing');
        assert(titles.has('B'), 'title B missing');
      });
    });
  }

  // ─── Test 8: results sorted by lastActive descending ────────────────────
  {
    const tmp = makeCodexHome();
    const id1 = '019dc872-a308-7111-ba78-068f9294120c'; // staged earliest
    const id2 = '019dcac8-f459-7fa0-83e8-3c3112d0fe0e'; // middle
    const id3 = '019dbc37-4284-71c2-b216-8f9b6c431001'; // latest
    const fp1 = stageRollout(tmp, '2026/04/26', id1);
    const fp2 = stageRollout(tmp, '2026/04/26', id2);
    const fp3 = stageRollout(tmp, '2026/04/23', id3);
    // Set explicit, well-spread mtimes so the sort assertion is unambiguous.
    fs.utimesSync(fp1, new Date('2026-04-20T00:00:00Z'), new Date('2026-04-20T00:00:00Z'));
    fs.utimesSync(fp2, new Date('2026-04-22T00:00:00Z'), new Date('2026-04-22T00:00:00Z'));
    fs.utimesSync(fp3, new Date('2026-04-25T00:00:00Z'), new Date('2026-04-25T00:00:00Z'));
    // No index: walk-fallback uses mtime as lastActive directly.
    await withCodexHome(tmp, async () => {
      console.debug = () => {};
      const results = await discover();
      console.debug = realDebug;
      test('discover sorts results by lastActive descending', () => {
        assertEqual(results.length, 3, 'expected 3 results');
        // Newest first: id3, id2, id1.
        assertEqual(results[0].providerSessionId, id3, 'newest (id3) should be first');
        assertEqual(results[1].providerSessionId, id2, 'middle (id2) should be second');
        assertEqual(results[2].providerSessionId, id1, 'oldest (id1) should be last');
      });
    });
  }

  // ─── Test 9: subagent-spawned threads are filtered out ──────────────────
  {
    const tmp = makeCodexHome();
    const dayDir = path.join(tmp, 'sessions', '2026', '05', '11');
    fs.mkdirSync(dayDir, { recursive: true });
    const userId = '019eaaaa-1111-7000-8000-aaaaaaaaaaaa';
    const subAId = '019eaaaa-2222-7000-8000-bbbbbbbbbbbb';
    const subBId = '019eaaaa-3333-7000-8000-cccccccccccc';
    // Top-level user thread (source: 'vscode')
    fs.writeFileSync(path.join(dayDir, 'rollout-2026-05-11T00-00-00-' + userId + '.jsonl'),
      JSON.stringify({type:'session_meta', timestamp:'2026-05-11T00:00:00Z', payload:{id:userId, timestamp:'2026-05-11T00:00:00Z', cwd:'/anon/user', source:'vscode', cli_version:'0.125.0', originator:'Codex Desktop'}}) + '\n');
    // Two explorer-role subagent spawns from the user thread
    fs.writeFileSync(path.join(dayDir, 'rollout-2026-05-11T00-00-01-' + subAId + '.jsonl'),
      JSON.stringify({type:'session_meta', timestamp:'2026-05-11T00:00:01Z', payload:{id:subAId, timestamp:'2026-05-11T00:00:01Z', cwd:'/anon/user', source:{subagent:{thread_spawn:{parent_thread_id:userId, depth:1, agent_role:'explorer', agent_nickname:'Pascal'}}}, cli_version:'0.125.0', originator:'Codex Desktop'}}) + '\n');
    fs.writeFileSync(path.join(dayDir, 'rollout-2026-05-11T00-00-02-' + subBId + '.jsonl'),
      JSON.stringify({type:'session_meta', timestamp:'2026-05-11T00:00:02Z', payload:{id:subBId, timestamp:'2026-05-11T00:00:02Z', cwd:'/anon/user', source:{subagent:{thread_spawn:{parent_thread_id:userId, depth:1, agent_role:'explorer', agent_nickname:'Linnaeus'}}}, cli_version:'0.125.0', originator:'Codex Desktop'}}) + '\n');
    stageSessionIndex(tmp, [
      { id: userId, thread_name: 'Real user thread', updated_at: '2026-05-11T00:00:00.000Z' },
      { id: subAId, thread_name: 'Pascal explorer', updated_at: '2026-05-11T00:00:01.000Z' },
      { id: subBId, thread_name: 'Linnaeus explorer', updated_at: '2026-05-11T00:00:02.000Z' },
    ]);
    await withCodexHome(tmp, async () => {
      console.debug = () => {};
      const results = await discover();
      console.debug = realDebug;
      test('discover filters out subagent-spawned threads (Pascal/Linnaeus/etc.)', () => {
        assertEqual(results.length, 1, 'expected only 1 user-initiated thread, got ' + results.length + ' (subagent filter failed)');
        assertEqual(results[0].providerSessionId, userId, 'remaining thread should be the user-initiated one');
        const ids = results.map(r => r.providerSessionId);
        assert(!ids.includes(subAId), 'subagent A (Pascal) should be filtered out');
        assert(!ids.includes(subBId), 'subagent B (Linnaeus) should be filtered out');
      });
    });
  }

  // ─── Test 10: archived_sessions/ discovered with archived: true ─────────
  {
    const tmp = makeCodexHome();
    const liveId = '019dc872-a308-7111-ba78-068f9294120c';
    const archivedId = '019dbc37-4284-71c2-b216-8f9b6c431001';
    stageRollout(tmp, '2026/04/26', liveId);
    // Stage an archived rollout flat under archived_sessions/ (the real
    // on-disk layout Codex uses for ended threads).
    const archDir = path.join(tmp, 'archived_sessions');
    fs.mkdirSync(archDir, { recursive: true });
    fs.copyFileSync(MODERN_FIXTURE, path.join(archDir, 'rollout-2026-04-23T17-20-31-' + archivedId + '.jsonl'));
    await withCodexHome(tmp, async () => {
      console.debug = () => {};
      const results = await discover();
      console.debug = realDebug;
      test('discover surfaces archived_sessions/ entries tagged archived: true', () => {
        assertEqual(results.length, 2, 'expected live + archived, got ' + results.length);
        const archived = results.find((r) => r.providerSessionId === archivedId);
        const live = results.find((r) => r.providerSessionId === liveId);
        assert(archived, 'archived session missing from discovery');
        assert(live, 'live session missing from discovery');
        assertEqual(archived.archived, true, 'archived entry must carry archived: true');
        assert(live.archived !== true, 'live entry must NOT be tagged archived');
        assertEqual(archived.projectPath, '/home/user/project', 'archived cwd extracted from session_meta');
      });
    });
  }

  // ─── Test 11: live sessions/ record wins over an archived duplicate ─────
  {
    const tmp = makeCodexHome();
    const dupId = '019dcac8-f459-7fa0-83e8-3c3112d0fe0e';
    stageRollout(tmp, '2026/04/26', dupId);
    const archDir = path.join(tmp, 'archived_sessions');
    fs.mkdirSync(archDir, { recursive: true });
    fs.copyFileSync(MODERN_FIXTURE, path.join(archDir, 'rollout-2026-04-23T17-20-31-' + dupId + '.jsonl'));
    await withCodexHome(tmp, async () => {
      console.debug = () => {};
      const results = await discover();
      console.debug = realDebug;
      test('discover dedupes: live sessions/ record wins over archived duplicate of the same id', () => {
        assertEqual(results.length, 1, 'expected one deduped record, got ' + results.length);
        assertEqual(results[0].providerSessionId, dupId);
        assert(results[0].archived !== true, 'deduped record must be the live (non-archived) one');
      });
    });
  }

  // ─── Test 12: archived-only CODEX_HOME (no sessions/ dir) still discovers ─
  {
    const tmp = makeCodexHome();
    const onlyId = '019dbc37-4284-71c2-b216-8f9b6c431001';
    // Deliberately NO sessions/ directory: only archived threads exist. The
    // old guard returned [] here, silently hiding archived history.
    const archDir = path.join(tmp, 'archived_sessions');
    fs.mkdirSync(archDir, { recursive: true });
    fs.copyFileSync(MODERN_FIXTURE, path.join(archDir, 'rollout-2026-04-23T17-20-31-' + onlyId + '.jsonl'));
    await withCodexHome(tmp, async () => {
      console.debug = () => {};
      const results = await discover();
      console.debug = realDebug;
      test('discover works when only archived_sessions/ exists (no sessions/ dir)', () => {
        assertEqual(results.length, 1, 'expected the archived-only record, got ' + results.length);
        assertEqual(results[0].providerSessionId, onlyId);
        assertEqual(results[0].archived, true);
      });
    });
  }

  // ─── Summary + exit ─────────────────────────────────────────────────────
  console.log('  ' + '-'.repeat(70));
  console.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
