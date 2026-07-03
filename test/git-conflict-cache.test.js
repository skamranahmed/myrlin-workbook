#!/usr/bin/env node
/**
 * chore/windowshide-sweep: unit coverage for src/web/git-status-cache.js.
 *
 * Hermetic: the clock is injected (options.now) and the "git spawn" is a
 * counting stub, so zero real processes run. Locks the behaviors the
 * conflict endpoint depends on:
 *   - hit: two get() calls inside the TTL share ONE runStatus invocation
 *   - expiry: a get() after the TTL re-runs runStatus
 *   - eager invalidation: a mutating git argv drops the entry, read-only
 *     argv does not
 *   - key normalization: trailing-separator spellings share one entry,
 *     different paths do not
 *   - failure caching: a rejected runStatus is shared for the TTL (by
 *     design, see the module header) and both callers see the rejection
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

'use strict';

const assert = require('assert');
const {
  createGitStatusCache,
  GIT_CONFLICT_CACHE_TTL_MS,
  MUTATING_GIT_SUBCOMMANDS,
} = require('../src/web/git-status-cache');

let passed = 0;
let failed = 0;

/** Minimal async-aware pass/fail runner matching the other standalone tests. */
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  \x1b[32mPASS\x1b[0m ' + name);
  } catch (err) {
    failed++;
    console.log('  \x1b[31mFAIL\x1b[0m ' + name);
    console.log('       ' + (err && err.message ? err.message : String(err)));
  }
}

/**
 * Build a cache with a controllable clock plus a counting status stub.
 * @param {number} ttlMs - TTL to use for this cache instance.
 * @returns {{ cache: object, clock: { advance: (ms: number) => void },
 *             runStatus: Function, calls: () => number }}
 */
function makeFixture(ttlMs) {
  let nowMs = 1000000;
  let calls = 0;
  const cache = createGitStatusCache({ ttlMs, now: () => nowMs });
  const runStatus = (dir) => {
    calls++;
    return Promise.resolve('M file-' + calls + ' in ' + dir);
  };
  return {
    cache,
    clock: { advance: (ms) => { nowMs += ms; } },
    runStatus,
    calls: () => calls,
  };
}

async function main() {
  console.log('\n  chore/windowshide-sweep: git status conflict cache');
  console.log('  ' + '-'.repeat(58));

  await check('named TTL constant is exported and sane', () => {
    assert.strictEqual(GIT_CONFLICT_CACHE_TTL_MS, 15000);
    assert.ok(MUTATING_GIT_SUBCOMMANDS.has('commit'));
    assert.ok(!MUTATING_GIT_SUBCOMMANDS.has('status'));
  });

  await check('hit: two gets inside the TTL spawn once and share the result', async () => {
    const f = makeFixture(15000);
    const a = await f.cache.get('/repo/one', f.runStatus);
    const b = await f.cache.get('/repo/one', f.runStatus);
    assert.strictEqual(f.calls(), 1, 'expected one spawn, got ' + f.calls());
    assert.strictEqual(a, b);
  });

  await check('concurrent gets share the in-flight promise (single spawn)', async () => {
    const f = makeFixture(15000);
    // No await between the two gets: both must ride the same promise.
    const p1 = f.cache.get('/repo/one', f.runStatus);
    const p2 = f.cache.get('/repo/one', f.runStatus);
    assert.strictEqual(p1, p2, 'expected the identical promise instance');
    await Promise.all([p1, p2]);
    assert.strictEqual(f.calls(), 1);
  });

  await check('expiry: a get after the TTL re-runs the status spawn', async () => {
    const f = makeFixture(15000);
    await f.cache.get('/repo/one', f.runStatus);
    f.clock.advance(14999);
    await f.cache.get('/repo/one', f.runStatus);
    assert.strictEqual(f.calls(), 1, 'still fresh at ttl-1ms');
    f.clock.advance(2); // now past the TTL boundary
    await f.cache.get('/repo/one', f.runStatus);
    assert.strictEqual(f.calls(), 2, 'expired entry must re-spawn');
  });

  await check('mutating git argv eagerly invalidates only its own path', async () => {
    const f = makeFixture(15000);
    await f.cache.get('/repo/one', f.runStatus);
    await f.cache.get('/repo/two', f.runStatus);
    assert.strictEqual(f.calls(), 2);
    f.cache.invalidateIfMutating(['commit', '-m', 'x'], '/repo/one');
    await f.cache.get('/repo/one', f.runStatus); // dropped, re-spawns
    await f.cache.get('/repo/two', f.runStatus); // untouched, cached
    assert.strictEqual(f.calls(), 3);
  });

  await check('read-only git argv never invalidates', async () => {
    const f = makeFixture(15000);
    await f.cache.get('/repo/one', f.runStatus);
    f.cache.invalidateIfMutating(['status', '--porcelain'], '/repo/one');
    f.cache.invalidateIfMutating(['rev-parse', '--abbrev-ref', 'HEAD'], '/repo/one');
    f.cache.invalidateIfMutating(['log', '--oneline'], '/repo/one');
    f.cache.invalidateIfMutating(null, '/repo/one'); // hostile input: no throw
    await f.cache.get('/repo/one', f.runStatus);
    assert.strictEqual(f.calls(), 1, 'read-only commands must not drop the entry');
  });

  await check('leading flags are skipped when finding the subcommand', async () => {
    const f = makeFixture(15000);
    await f.cache.get('/repo/one', f.runStatus);
    // Argv shaped like ['--no-pager', 'checkout', ...]: subcommand is the
    // first non-flag token and IS mutating.
    f.cache.invalidateIfMutating(['--no-pager', 'checkout', 'main'], '/repo/one');
    await f.cache.get('/repo/one', f.runStatus);
    assert.strictEqual(f.calls(), 2);
  });

  await check('key normalization: trailing separator lands on the same entry', async () => {
    const f = makeFixture(15000);
    await f.cache.get('/repo/one', f.runStatus);
    await f.cache.get('/repo/one/', f.runStatus);
    assert.strictEqual(f.calls(), 1, 'both spellings must share one entry');
    assert.strictEqual(f.cache.size(), 1);
  });

  await check('failure caching: a rejection is shared for the TTL by design', async () => {
    let nowMs = 5000000;
    let calls = 0;
    const cache = createGitStatusCache({ ttlMs: 15000, now: () => nowMs });
    const failing = () => { calls++; return Promise.reject(new Error('not a git repo')); };
    await assert.rejects(() => cache.get('/not-a-repo', failing), /not a git repo/);
    await assert.rejects(() => cache.get('/not-a-repo', failing), /not a git repo/);
    assert.strictEqual(calls, 1, 'failure must be served from cache inside the TTL');
    nowMs += 15001;
    await assert.rejects(() => cache.get('/not-a-repo', failing), /not a git repo/);
    assert.strictEqual(calls, 2, 'expired failure must retry');
  });

  await check('synchronous throw inside runStatus becomes a rejection, not an escape', async () => {
    const f = makeFixture(15000);
    const throwing = () => { throw new Error('sync boom'); };
    await assert.rejects(() => f.cache.get('/repo/one', throwing), /sync boom/);
  });

  await check('clear() empties the cache', async () => {
    const f = makeFixture(15000);
    await f.cache.get('/repo/one', f.runStatus);
    f.cache.clear();
    assert.strictEqual(f.cache.size(), 0);
    await f.cache.get('/repo/one', f.runStatus);
    assert.strictEqual(f.calls(), 2);
  });

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
