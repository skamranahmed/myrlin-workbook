/**
 * Recovery - Auto-recovery on startup
 * Detects sessions that were marked 'running' but whose processes have died,
 * marks them as stale, and optionally re-launches them.
 */

const { getStore } = require('../state/store');

/**
 * Check if a PID is alive on the system.
 * @param {number} pid - Process ID to check
 * @returns {boolean}
 */
function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Check for sessions that need recovery.
 * Finds all sessions marked 'running' and checks whether their PIDs are still alive.
 * @returns {{ healthy: object[], stale: object[], total: number }}
 */
function checkForRecovery() {
  const store = getStore();
  const allSessions = store.getAllSessionsList();

  const healthy = [];
  const stale = [];

  for (const session of allSessions) {
    if (session.status === 'running') {
      if (session.pid && isPidAlive(session.pid)) {
        healthy.push(session);
      } else {
        stale.push(session);
      }
    }
  }

  return {
    healthy,
    stale,
    total: allSessions.length,
  };
}

/**
 * Mark all stale sessions (running but with dead/missing PID) as 'stopped'.
 * @returns {string[]} List of session IDs that were marked stopped
 */
function markStaleSessionsStopped() {
  const store = getStore();
  const { stale } = checkForRecovery();
  const markedIds = [];

  for (const session of stale) {
    store.updateSessionStatus(session.id, 'stopped', null);
    store.addSessionLog(session.id, 'Marked stopped during recovery (process no longer alive)');
    markedIds.push(session.id);
  }

  return markedIds;
}

/**
 * Recover sessions that were previously running.
 * If autoRecover is enabled in settings, re-launches stopped sessions
 * that were marked stale.
 * @param {object} sessionManager - Session manager with launchSession(id)
 * @returns {{ recovered: string[], failed: string[] }}
 */
function recoverSessions(sessionManager) {
  const store = getStore();

  if (!store.settings.autoRecover) {
    return { recovered: [], failed: [] };
  }

  // First, identify and mark stale sessions
  const staleIds = markStaleSessionsStopped();
  const recovered = [];
  const failed = [];

  // Re-launch each session that was previously running
  for (const sessionId of staleIds) {
    const session = store.getSession(sessionId);
    if (!session) continue;

    store.addSessionLog(sessionId, 'Auto-recovering session...');
    const result = sessionManager.launchSession(sessionId);

    if (result.success) {
      recovered.push(sessionId);
      store.addSessionLog(sessionId, `Auto-recovered successfully (new PID: ${result.pid})`);
    } else {
      failed.push(sessionId);
      store.addSessionLog(sessionId, `Auto-recovery failed: ${result.error}`);
    }
  }

  return { recovered, failed };
}

/**
 * Get a full recovery report - useful for displaying to the user on startup.
 * @returns {{ recovered: object[], stale: object[], healthy: object[] }}
 */
function getRecoveryReport() {
  const store = getStore();
  const allSessions = store.getAllSessionsList();

  const recovered = [];
  const stale = [];
  const healthy = [];

  for (const session of allSessions) {
    if (session.status === 'running') {
      if (session.pid && isPidAlive(session.pid)) {
        healthy.push(session);
      } else {
        stale.push(session);
      }
    }
  }

  // Sessions that were recently recovered have 'running' status + alive PID
  // and a log entry containing 'Auto-recovered'
  for (const session of healthy) {
    const logs = session.logs || [];
    const hasRecoveryLog = logs.some(l => l.message && l.message.includes('Auto-recovered'));
    if (hasRecoveryLog) {
      recovered.push(session);
    }
  }

  return { recovered, stale, healthy };
}

module.exports = {
  checkForRecovery,
  markStaleSessionsStopped,
  recoverSessions,
  getRecoveryReport,
};
