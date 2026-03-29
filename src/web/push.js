/**
 * Push notification module for Myrlin Workbook.
 * Handles device token registration, Expo Push API dispatch,
 * and store event listeners that trigger push notifications.
 *
 * Endpoints:
 *   POST /api/push/register   - Register an Expo push token
 *   POST /api/push/unregister - Remove an Expo push token
 *
 * Push triggers (via store event listeners):
 *   - Session completed (running -> stopped)
 *   - Session needs input (last log contains "needs input" or "waiting for")
 *   - Worktree task ready for review (status -> review)
 *   - File conflict detected (conflict:detected event)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Sleep for a given number of milliseconds.
 * Used for exponential backoff between retry attempts.
 *
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Count sessions with status 'running' in the store.
 * Used as the iOS badge count in push notifications.
 *
 * @param {import('../state/store').Store} store - Store instance
 * @returns {number} Number of running sessions
 */
function getRunningSessionCount(store) {
  const sessions = (store.state && store.state.sessions) || {};
  let count = 0;
  for (const id of Object.keys(sessions)) {
    if (sessions[id].status === 'running') count++;
  }
  return count;
}

// ─── Route Setup ─────────────────────────────────────────────

/**
 * Register push notification routes on the Express app.
 * Both routes require authentication via the requireAuth middleware.
 *
 * @param {import('express').Express} app - Express application
 * @param {Function} requireAuth - Auth middleware
 * @param {Function} getStore - Returns the initialized Store instance
 */
function setupPushRoutes(app, requireAuth, getStore) {
  /**
   * POST /api/push/register
   * Body: { deviceToken: string, platform: 'ios' | 'android' }
   * Registers an Expo push token for receiving notifications.
   */
  app.post('/api/push/register', requireAuth, (req, res) => {
    const { deviceToken, platform } = req.body || {};

    // Validate deviceToken is a non-empty string
    if (!deviceToken || typeof deviceToken !== 'string' || !deviceToken.trim()) {
      return res.status(400).json({
        error: 'Missing or invalid deviceToken. Must be a non-empty string.',
      });
    }

    // Validate platform
    if (!platform || !['ios', 'android'].includes(platform)) {
      return res.status(400).json({
        error: 'Missing or invalid platform. Must be "ios" or "android".',
      });
    }

    const store = getStore();
    store.addPushDevice({
      token: deviceToken.trim(),
      platform,
      registeredAt: new Date().toISOString(),
    });

    return res.json({ success: true });
  });

  /**
   * POST /api/push/unregister
   * Body: { deviceToken: string }
   * Removes an Expo push token from the registry.
   */
  app.post('/api/push/unregister', requireAuth, (req, res) => {
    const { deviceToken } = req.body || {};

    if (!deviceToken || typeof deviceToken !== 'string') {
      return res.status(400).json({
        error: 'Missing or invalid deviceToken.',
      });
    }

    const store = getStore();
    store.removePushDevice(deviceToken.trim());

    return res.json({ success: true });
  });
}

// ─── Event Listeners ─────────────────────────────────────────

/**
 * Attach store event listeners that trigger push notifications.
 * Maintains a status cache to detect session state transitions
 * (since store emits the already-updated session object).
 *
 * @param {import('../state/store').Store} store - Initialized store instance
 */
function setupPushListeners(store) {
  // Cache of sessionId -> last known status for detecting transitions
  const statusCache = new Map();

  // Initialize cache from current state
  const state = store.state;
  if (state && state.sessions) {
    for (const [id, session] of Object.entries(state.sessions)) {
      statusCache.set(id, session.status);
    }
  }

  // Listen for session status changes
  store.on('session:updated', (session) => {
    if (!session || !session.id) return;

    const previousStatus = statusCache.get(session.id);
    statusCache.set(session.id, session.status);

    // Session completed: running -> stopped
    if (previousStatus === 'running' && session.status === 'stopped') {
      sendPush(store, {
        title: 'Session completed',
        body: `${session.name || session.id} has finished`,
        data: { type: 'session', sessionId: session.id },
      });
    }

    // Session needs input: check last log entry
    if (session.logs && session.logs.length > 0) {
      const lastLog = session.logs[session.logs.length - 1];
      const logText = (typeof lastLog === 'string' ? lastLog : lastLog.message || '').toLowerCase();
      if (logText.includes('needs input') || logText.includes('waiting for')) {
        sendPush(store, {
          title: 'Input needed',
          body: `${session.name || session.id} needs your input`,
          data: { type: 'session', sessionId: session.id },
        });
      }
    }
  });

  // Track new sessions in the status cache
  store.on('session:created', (session) => {
    if (session && session.id) {
      statusCache.set(session.id, session.status);
    }
  });

  // Clean up deleted sessions from cache
  store.on('session:deleted', ({ id }) => {
    statusCache.delete(id);
  });

  // Worktree task ready for review
  store.on('worktreeTask:updated', (task) => {
    if (!task) return;
    if (task.status === 'review') {
      sendPush(store, {
        title: 'Task ready for review',
        body: task.description || `Task ${task.id}`,
        data: { type: 'task', taskId: task.id },
      });
    }
  });

  // File conflict detected (if the event exists in the system)
  store.on('conflict:detected', (conflict) => {
    const file = (conflict && conflict.file) || 'unknown file';
    sendPush(store, {
      title: 'File conflict',
      body: `Conflict detected in ${file}`,
      data: { type: 'conflict' },
    });
  });
}

// ─── Expo Push API Dispatch ──────────────────────────────────

/**
 * Send a single push message to one device via the Expo Push API with retry.
 * Retries up to maxRetries times with exponential backoff (1s, 2s, 4s).
 * On DeviceNotRegistered, clears the stale pushToken from the paired device record.
 *
 * @param {import('../state/store').Store} store - Store instance (for stale token cleanup)
 * @param {{ to: string, title: string, body: string, data?: Object, sound?: string, badge?: number }} message - Expo push message
 * @param {number} [maxRetries=3] - Maximum number of send attempts
 * @returns {Promise<{ sent: boolean, reason?: string }>} Result of the send attempt
 */
async function sendPushWithRetry(store, message, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify([message]),
      });

      // Non-ok HTTP status is transient; retry with backoff
      if (!response.ok) {
        console.warn(`[Push] Expo API returned ${response.status} (attempt ${attempt + 1}/${maxRetries})`);
        if (attempt < maxRetries - 1) {
          await sleep(1000 * Math.pow(2, attempt));
          continue;
        }
        return { sent: false, reason: 'max_retries' };
      }

      const result = await response.json();
      const ticket = result.data && result.data[0];

      if (!ticket) {
        console.warn('[Push] No ticket in Expo response');
        return { sent: false, reason: 'no_ticket' };
      }

      // Success
      if (ticket.status === 'ok') {
        return { sent: true };
      }

      // DeviceNotRegistered: clear stale pushToken from pairedDevices
      if (ticket.details && ticket.details.error === 'DeviceNotRegistered') {
        const pairedDevices = store.getPairedDevices();
        const staleDevice = pairedDevices.find(d => d.pushToken === message.to);
        if (staleDevice) {
          console.warn(`[Push] Clearing stale pushToken for device ${staleDevice.deviceId}`);
          store.updatePairedDevice(staleDevice.deviceId, { pushToken: null });
        }
        // Also clean legacy pushDevices if applicable
        if (typeof store.removePushDevice === 'function') {
          store.removePushDevice(message.to);
        }
        return { sent: false, reason: 'unregistered' };
      }

      // Other Expo error, treat as transient
      console.warn(`[Push] Expo ticket error: ${ticket.details?.error || ticket.message || 'unknown'} (attempt ${attempt + 1}/${maxRetries})`);
      if (attempt < maxRetries - 1) {
        await sleep(1000 * Math.pow(2, attempt));
        continue;
      }
      return { sent: false, reason: 'max_retries' };

    } catch (err) {
      // Network/fetch error: retry with backoff
      console.warn(`[Push] Network error (attempt ${attempt + 1}/${maxRetries}): ${err.message}`);
      if (attempt < maxRetries - 1) {
        await sleep(1000 * Math.pow(2, attempt));
      } else {
        return { sent: false, reason: 'max_retries' };
      }
    }
  }
  return { sent: false, reason: 'max_retries' };
}

/**
 * Send a push notification to all paired devices with non-null pushTokens.
 * Sources devices from store.getPairedDevices() (not legacy pushDevices).
 * Builds rich payloads with route (deep link) and badge (running session count).
 * Sends to all devices concurrently via Promise.allSettled.
 *
 * @param {import('../state/store').Store} store - Store instance for device registry
 * @param {{ title: string, body: string, data?: Object, route?: string, badge?: number }} notification - Notification payload
 * @returns {Promise<Array<{ sent: boolean, reason?: string }>>} Results per device
 */
async function sendPush(store, notification) {
  try {
    const devices = store.getPairedDevices().filter(d => d.pushToken);

    if (devices.length === 0) return [];

    const badge = notification.badge != null ? notification.badge : getRunningSessionCount(store);

    const results = await Promise.allSettled(
      devices.map(device => {
        const message = {
          to: device.pushToken,
          title: notification.title,
          body: notification.body,
          data: {
            ...(notification.data || {}),
            route: notification.route || null,
          },
          sound: 'default',
          badge,
        };
        return sendPushWithRetry(store, message);
      })
    );

    return results.map(r => r.status === 'fulfilled' ? r.value : { sent: false, reason: 'error' });
  } catch (err) {
    // Push is best-effort; log and continue
    console.error('[Push] Failed to send notification:', err.message);
    return [];
  }
}

/**
 * Placeholder for push queue flush (implemented in Task 2).
 * Exported so callers can import it immediately.
 *
 * @param {import('../state/store').Store} _store - Unused until Task 2
 */
function flushPushQueue(_store) {
  // No-op placeholder; Task 2 replaces this with batching logic
}

// ─── Exports ─────────────────────────────────────────────────

module.exports = {
  setupPushRoutes,
  setupPushListeners,
  sendPush,
  flushPushQueue,
};
