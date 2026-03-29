/**
 * Device management module for paired mobile devices.
 *
 * Provides CRUD endpoints for managing paired devices:
 *   GET    /api/devices              - List all paired devices with online status
 *   GET    /api/devices/:deviceId    - Get single device details
 *   PUT    /api/devices/:deviceId    - Update device (name, push prefs)
 *   DELETE /api/devices/:deviceId    - Revoke device (invalidate token, close connections)
 *   POST   /api/devices/:deviceId/test-push - Send test notification to device
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Known push preference keys and their expected types (all boolean)
const VALID_PUSH_PREF_KEYS = [
  'sessionComplete',
  'sessionNeedsInput',
  'fileConflicts',
  'taskReview',
  'serverOnline',
];

const MAX_DEVICE_NAME_LENGTH = 100;

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Return a shallow copy of a device object with the token field removed.
 * Prevents bearer tokens from leaking through API responses.
 * @param {Object} device - Device record from the store
 * @returns {Object} Device without the token field
 */
function stripToken(device) {
  const { token, ...rest } = device;
  return rest;
}

/**
 * Check if a paired device has an active SSE connection.
 * Iterates the SSE clients map looking for a matching auth token.
 * @param {Object} device - Device record (must have .token)
 * @param {Map} sseClients - Map of clientId -> { res, token }
 * @returns {boolean} True if device has at least one active SSE connection
 */
function isDeviceOnline(device, sseClients) {
  if (!device || !device.token) return false;
  for (const [, client] of sseClients) {
    if (client.token === device.token) {
      return true;
    }
  }
  return false;
}

/**
 * Validate and sanitize a deviceName string.
 * Returns the trimmed name or null if invalid.
 * @param {*} name - Raw input
 * @returns {string|null} Sanitized name or null
 */
function validateDeviceName(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_DEVICE_NAME_LENGTH) return null;
  return trimmed;
}

/**
 * Validate push preferences object.
 * Only known keys with boolean values are allowed.
 * Returns sanitized object or null if any key/value is invalid.
 * @param {*} prefs - Raw input
 * @returns {Object|null} Validated prefs or null
 */
function validatePushPreferences(prefs) {
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return null;
  const result = {};
  for (const key of Object.keys(prefs)) {
    if (!VALID_PUSH_PREF_KEYS.includes(key)) return null;
    if (typeof prefs[key] !== 'boolean') return null;
    result[key] = prefs[key];
  }
  return result;
}

/**
 * Send a test push notification to a single device via the Expo Push API.
 * Best-effort: logs errors but never throws.
 * @param {string} pushToken - Expo push token for the device
 * @param {string} deviceName - Human-readable device name for the message body
 */
async function sendTestPush(pushToken, deviceName) {
  const message = {
    to: pushToken,
    title: 'Test notification',
    body: `Push notifications are working for ${deviceName}`,
    data: { type: 'test' },
    sound: 'default',
  };

  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify([message]),
  });

  if (!response.ok) {
    throw new Error(`Expo API returned ${response.status}: ${response.statusText}`);
  }
}

// ─── Route Setup ──────────────────────────────────────────────

/**
 * Mount device management routes on the Express app.
 * All routes require authentication via the requireAuth middleware.
 *
 * @param {import('express').Express} app - Express application
 * @param {Object} deps - Injected dependencies
 * @param {Function} deps.requireAuth - Auth middleware
 * @param {Function} deps.getStore - Returns the initialized Store instance
 * @param {Function} deps.removeToken - Removes a token from activeTokens set
 * @param {Function} deps.sendPush - Sends push to all registered devices
 * @param {Function} deps.getSSEClients - Returns the SSE clients Map
 */
function setupDeviceRoutes(app, { requireAuth, getStore, removeToken, sendPush, getSSEClients }) {

  /**
   * GET /api/devices
   * List all paired devices with online status.
   * Token field is stripped from each device for security.
   * Returns: { devices: Array }
   */
  app.get('/api/devices', requireAuth, (req, res) => {
    const store = getStore();
    const devices = store.getPairedDevices();
    const sseClients = getSSEClients();

    const result = devices.map(device => ({
      ...stripToken(device),
      isOnline: isDeviceOnline(device, sseClients),
    }));

    return res.json({ devices: result });
  });

  /**
   * GET /api/devices/:deviceId
   * Get a single device by its deviceId.
   * Returns the device object (token stripped) with online status.
   */
  app.get('/api/devices/:deviceId', requireAuth, (req, res) => {
    const store = getStore();
    const device = store.findDevice(req.params.deviceId);

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const sseClients = getSSEClients();
    return res.json({
      ...stripToken(device),
      isOnline: isDeviceOnline(device, sseClients),
    });
  });

  /**
   * PUT /api/devices/:deviceId
   * Update a device's name and/or push preferences.
   * Body: { deviceName?: string, pushPreferences?: Object }
   * Returns the updated device (token stripped) with online status.
   */
  app.put('/api/devices/:deviceId', requireAuth, (req, res) => {
    const store = getStore();
    const device = store.findDevice(req.params.deviceId);

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const updates = {};
    const body = req.body || {};

    // Validate deviceName if provided
    if (body.deviceName !== undefined) {
      const name = validateDeviceName(body.deviceName);
      if (name === null) {
        return res.status(400).json({
          error: `deviceName must be a non-empty string, max ${MAX_DEVICE_NAME_LENGTH} characters`,
        });
      }
      updates.deviceName = name;
    }

    // Validate pushPreferences if provided
    if (body.pushPreferences !== undefined) {
      const prefs = validatePushPreferences(body.pushPreferences);
      if (prefs === null) {
        return res.status(400).json({
          error: 'pushPreferences must be an object with known keys and boolean values. ' +
            `Valid keys: ${VALID_PUSH_PREF_KEYS.join(', ')}`,
        });
      }
      // Merge with existing preferences (partial update)
      updates.pushPreferences = { ...device.pushPreferences, ...prefs };
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update. Allowed: deviceName, pushPreferences' });
    }

    store.updatePairedDevice(req.params.deviceId, updates);

    // Re-fetch updated device
    const updated = store.findDevice(req.params.deviceId);
    const sseClients = getSSEClients();
    return res.json({
      ...stripToken(updated),
      isOnline: isDeviceOnline(updated, sseClients),
    });
  });

  /**
   * DELETE /api/devices/:deviceId
   * Revoke a paired device. Invalidates its auth token, closes any
   * active SSE connections, and removes the device record from the store.
   * Returns: { success: true }
   */
  app.delete('/api/devices/:deviceId', requireAuth, (req, res) => {
    const store = getStore();
    const device = store.findDevice(req.params.deviceId);

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // 1. Invalidate the device token so future requests are rejected
    if (device.token) {
      removeToken(device.token);
    }

    // 2. Close any active SSE connections for this device
    const sseClients = getSSEClients();
    for (const [clientId, client] of sseClients) {
      if (client.token === device.token) {
        try {
          client.res.end();
        } catch (_) {
          // Connection may already be closed
        }
        sseClients.delete(clientId);
      }
    }

    // 3. Remove the device record from persistent storage
    store.removePairedDevice(req.params.deviceId);

    return res.json({ success: true });
  });

  /**
   * POST /api/devices/:deviceId/test-push
   * Send a test push notification to a specific device.
   * Requires the device to have a registered push token.
   * Returns: { success: true }
   */
  app.post('/api/devices/:deviceId/test-push', requireAuth, async (req, res) => {
    const store = getStore();
    const device = store.findDevice(req.params.deviceId);

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    if (!device.pushToken) {
      return res.status(400).json({
        error: 'Device has no push token registered. Open the mobile app to register for push notifications.',
      });
    }

    try {
      await sendTestPush(device.pushToken, device.deviceName || 'this device');
      return res.json({ success: true });
    } catch (err) {
      console.error(`[DeviceManager] Test push failed for ${req.params.deviceId}:`, err.message);
      return res.status(502).json({
        error: 'Failed to send test push notification',
        detail: err.message,
      });
    }
  });
}

// ─── Exports ──────────────────────────────────────────────────

module.exports = {
  setupDeviceRoutes,
};
