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
 * Send a push notification to all registered devices via the Expo Push API.
 * This is best-effort: errors are logged but never thrown.
 * Automatically cleans up stale device tokens on DeviceNotRegistered errors.
 *
 * @param {import('../state/store').Store} store - Store instance for device registry
 * @param {{ title: string, body: string, data?: Object }} notification - Notification payload
 */
async function sendPush(store, notification) {
  try {
    const state = store.state;
    const devices = state.pushDevices || [];

    if (devices.length === 0) return;

    // Build Expo push messages
    const messages = devices.map(device => ({
      to: device.token,
      title: notification.title,
      body: notification.body,
      data: notification.data || {},
      sound: 'default',
    }));

    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      console.error(`[Push] Expo API returned ${response.status}: ${response.statusText}`);
      return;
    }

    const result = await response.json();

    // Auto-clean stale tokens: remove devices that Expo reports as unregistered
    if (result.data && Array.isArray(result.data)) {
      result.data.forEach((ticket, index) => {
        if (
          ticket.status === 'error' &&
          ticket.details &&
          ticket.details.error === 'DeviceNotRegistered'
        ) {
          const staleToken = devices[index] && devices[index].token;
          if (staleToken) {
            console.warn(`[Push] Removing stale token: ${staleToken.slice(0, 20)}...`);
            store.removePushDevice(staleToken);
          }
        }
      });
    }
  } catch (err) {
    // Push is best-effort; log and continue
    console.error('[Push] Failed to send notification:', err.message);
  }
}

// ─── Exports ─────────────────────────────────────────────────

module.exports = {
  setupPushRoutes,
  setupPushListeners,
  sendPush,
};
