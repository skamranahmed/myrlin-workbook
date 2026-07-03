/**
 * git-status-cache.js - Short-TTL in-memory cache for `git status --porcelain`.
 *
 * WHY: the workspace conflict endpoint (GET /api/workspaces/:id/conflicts)
 * runs a git status per running session every time the frontend polls (60s
 * timer plus manual refreshes). Each of those is a real child process spawn;
 * caching the result per repo path for a short TTL means rapid repeated
 * calls, and several sessions sharing one workingDir, reuse a single spawn
 * instead of re-spawning git per session per poll.
 *
 * Correctness model:
 *   - Entries expire after GIT_CONFLICT_CACHE_TTL_MS (named constant below).
 *   - Callers can invalidate eagerly: server.js routes every git command
 *     through gitExec and calls invalidateIfMutating(), so a commit /
 *     checkout / merge / etc for a path drops that path's cached status
 *     immediately. Git commands that do NOT flow through gitExec (a user
 *     typing git inside a terminal pane) are covered by the TTL alone; that
 *     is the documented tradeoff of this cache.
 *   - The in-flight promise is cached (not just the settled value), so
 *     concurrent callers within the TTL share ONE spawn.
 *   - Failures are cached for the TTL on purpose: a workingDir that is not a
 *     git repo fails identically on every poll, and re-spawning git just to
 *     fail again is exactly the cost this cache exists to remove.
 *
 * Zero dependencies on server.js so the behavior is unit-testable in
 * isolation (see test/git-conflict-cache.test.js).
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

'use strict';

const path = require('path');

/**
 * How long a cached `git status --porcelain` result stays fresh, in ms.
 * 15s is far shorter than the 60s conflict poll (so a poll after real work
 * still sees fresh state) while collapsing per-session fan-out and bursty
 * repeated calls into a single git spawn per repo path.
 */
const GIT_CONFLICT_CACHE_TTL_MS = 15000;

/**
 * Git subcommands that can change what `git status --porcelain` reports.
 * Used by invalidateIfMutating() to eagerly drop the cache entry for a path.
 * Read-only subcommands (status, log, diff, rev-parse, ...) never invalidate.
 */
const MUTATING_GIT_SUBCOMMANDS = new Set([
  'add', 'am', 'apply', 'checkout', 'cherry-pick', 'clean', 'commit',
  'merge', 'mv', 'pull', 'rebase', 'reset', 'restore', 'revert', 'rm',
  'stash', 'switch', 'worktree',
]);

/**
 * Create an isolated git-status cache instance.
 *
 * @param {object} [options]
 * @param {number} [options.ttlMs] - Freshness window in ms.
 *   Defaults to GIT_CONFLICT_CACHE_TTL_MS.
 * @param {Function} [options.now] - Clock returning epoch ms. Injectable so
 *   tests can advance time deterministically. Defaults to Date.now.
 * @returns {{
 *   get: (dir: string, runStatus: (dir: string) => Promise<string>) => Promise<string>,
 *   invalidate: (dir: string) => void,
 *   invalidateIfMutating: (args: string[], dir: string) => void,
 *   clear: () => void,
 *   size: () => number,
 *   ttlMs: number,
 * }}
 */
function createGitStatusCache(options = {}) {
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : GIT_CONFLICT_CACHE_TTL_MS;
  const now = typeof options.now === 'function' ? options.now : Date.now;

  /** Map<resolvedPath, { time: number, promise: Promise<string> }> */
  const cache = new Map();

  /**
   * Normalize a directory into a stable cache key so 'C:\repo' and
   * 'C:\repo\' (or './x' vs 'x') land on the same entry.
   * @param {string} dir - Working directory as provided by the caller.
   * @returns {string} Absolute, separator-normalized key.
   */
  function normalizeKey(dir) {
    return path.resolve(String(dir || '.'));
  }

  /**
   * Return the cached status promise for a path, running `runStatus` only on
   * a miss or an expired entry. The stored value is the PROMISE, so
   * concurrent callers inside the TTL share one spawn, and a rejection is
   * shared too (see file header for why failures are cached).
   *
   * @param {string} dir - Repo working directory.
   * @param {(dir: string) => Promise<string>} runStatus - Performs the actual
   *   git status spawn (injected: production passes a gitExec closure, tests
   *   pass a counting stub).
   * @returns {Promise<string>} stdout of `git status --porcelain`.
   */
  function get(dir, runStatus) {
    const key = normalizeKey(dir);
    const hit = cache.get(key);
    if (hit && (now() - hit.time) < ttlMs) return hit.promise;
    // Promise.resolve().then(...) so a synchronous throw inside runStatus
    // becomes a rejected promise instead of escaping the cache.
    const promise = Promise.resolve().then(() => runStatus(dir));
    cache.set(key, { time: now(), promise });
    return promise;
  }

  /**
   * Drop the cache entry for one path (no-op when absent).
   * @param {string} dir - Repo working directory to invalidate.
   */
  function invalidate(dir) {
    cache.delete(normalizeKey(dir));
  }

  /**
   * Invalidate the entry for `dir` when a git argv looks mutating.
   * The subcommand is the first argument that does not start with '-';
   * option-shaped prefixes like `-c key=val <subcommand>` are not resolved
   * (gitExec callers always pass subcommand-first argv, and the TTL bounds
   * any miss to GIT_CONFLICT_CACHE_TTL_MS anyway).
   *
   * @param {string[]} args - git argv (subcommand first, e.g. ['commit', ...]).
   * @param {string} dir - Working directory the command runs in.
   */
  function invalidateIfMutating(args, dir) {
    if (!Array.isArray(args)) return;
    const sub = args.find((a) => typeof a === 'string' && a.length > 0 && !a.startsWith('-'));
    if (sub && MUTATING_GIT_SUBCOMMANDS.has(sub)) invalidate(dir);
  }

  /** Drop every entry (used between tests). */
  function clear() {
    cache.clear();
  }

  /**
   * Number of live entries (fresh or expired-but-not-yet-replaced).
   * @returns {number}
   */
  function size() {
    return cache.size;
  }

  return { get, invalidate, invalidateIfMutating, clear, size, ttlMs };
}

module.exports = {
  createGitStatusCache,
  GIT_CONFLICT_CACHE_TTL_MS,
  MUTATING_GIT_SUBCOMMANDS,
};
