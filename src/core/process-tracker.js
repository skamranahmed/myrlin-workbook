/**
 * Process Tracker - Tracks running session processes
 * Maintains a map of sessionId -> process info, performs periodic health checks,
 * and updates the store when processes die unexpectedly.
 */

const { getStore } = require('../state/store');

/** @type {Map<string, { pid: number, process: object|null, startTime: Date }>} */
const tracked = new Map();

/** @type {NodeJS.Timeout|null} */
let healthCheckInterval = null;

/**
 * Start tracking a session's process.
 * @param {string} sessionId - Session ID
 * @param {number} pid - Process ID
 * @param {object|null} childProcess - The child_process instance (may be null for recovered sessions)
 */
function track(sessionId, pid, childProcess = null) {
  tracked.set(sessionId, {
    pid,
    process: childProcess,
    startTime: new Date(),
  });
}

/**
 * Stop tracking a session.
 * @param {string} sessionId - Session ID to untrack
 */
function untrack(sessionId) {
  tracked.delete(sessionId);
}

/**
 * Check if a tracked session's process is still alive.
 * Uses signal 0 which doesn't kill the process but throws if it doesn't exist.
 * @param {string} sessionId - Session ID to check
 * @returns {boolean} True if process is alive
 */
function isAlive(sessionId) {
  const entry = tracked.get(sessionId);
  if (!entry || !entry.pid) {
    return false;
  }

  try {
    process.kill(entry.pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Check all tracked processes and update the store for any that have died.
 * Removes dead processes from tracking and marks their sessions as 'stopped'.
 * @returns {{ alive: string[], dead: string[] }}
 */
function checkAll() {
  const store = getStore();
  const alive = [];
  const dead = [];

  for (const [sessionId, entry] of tracked.entries()) {
    if (isAlive(sessionId)) {
      alive.push(sessionId);
    } else {
      dead.push(sessionId);
      // Update store - session process died unexpectedly
      const session = store.getSession(sessionId);
      if (session && session.status === 'running') {
        store.updateSessionStatus(sessionId, 'stopped', null);
        store.addSessionLog(sessionId, `Process (PID ${entry.pid}) exited unexpectedly`);
      }
      tracked.delete(sessionId);
    }
  }

  return { alive, dead };
}

/**
 * Get tracking statistics.
 * @returns {{ tracked: number, alive: number, dead: number }}
 */
function getStats() {
  let aliveCount = 0;
  let deadCount = 0;

  for (const sessionId of tracked.keys()) {
    if (isAlive(sessionId)) {
      aliveCount++;
    } else {
      deadCount++;
    }
  }

  return {
    tracked: tracked.size,
    alive: aliveCount,
    dead: deadCount,
  };
}

/**
 * Start the periodic health check (every 5 seconds).
 * Safe to call multiple times - only one interval runs at a time.
 */
function startHealthCheck() {
  if (healthCheckInterval) return;
  healthCheckInterval = setInterval(() => {
    checkAll();
  }, 5000);
  // Don't keep the process alive just for health checks
  if (healthCheckInterval.unref) {
    healthCheckInterval.unref();
  }
}

/**
 * Stop the periodic health check.
 */
function stopHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

/**
 * Get all currently tracked session IDs.
 * @returns {string[]}
 */
function getTrackedSessions() {
  return Array.from(tracked.keys());
}

module.exports = {
  track,
  untrack,
  isAlive,
  checkAll,
  getStats,
  startHealthCheck,
  stopHealthCheck,
  getTrackedSessions,
};
