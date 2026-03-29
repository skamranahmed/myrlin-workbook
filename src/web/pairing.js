/**
 * Pairing module for mobile device authentication.
 *
 * Implements a two-step QR code pairing flow:
 *   1. GET /api/auth/pairing-code (auth required) - generates a short-lived pairing token
 *   2. POST /api/auth/pair (public, rate-limited) - exchanges pairing token for Bearer token
 *
 * Pairing tokens are single-use, expire after 5 minutes, and stored in memory.
 * The QR payload contains the server URL, pairing token, server name, and version.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const crypto = require('crypto');
const path = require('path');

// ─── Configuration ─────────────────────────────────────────

/** How long a pairing token remains valid (5 minutes) */
const PAIRING_TTL_MS = 5 * 60 * 1000;

/** Byte length for pairing tokens (32 bytes = 64 hex characters) */
const PAIRING_TOKEN_BYTES = 32;

/** In-memory store for active pairing tokens. Map of token -> { createdAt, used } */
const pairingTokens = new Map();

// Clean up expired or used pairing tokens every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of pairingTokens) {
    if (entry.used || now - entry.createdAt > PAIRING_TTL_MS) {
      pairingTokens.delete(token);
    }
  }
}, 2 * 60 * 1000).unref();

// ─── Route Setup ───────────────────────────────────────────

/**
 * Read the server name and version from package.json.
 * @returns {{ name: string, version: string }}
 */
function getServerInfo() {
  try {
    const pkg = require(path.join(__dirname, '..', '..', 'package.json'));
    return { name: pkg.name || 'myrlin-workbook', version: pkg.version || '0.0.0' };
  } catch (_) {
    return { name: 'myrlin-workbook', version: '0.0.0' };
  }
}

/**
 * Mount pairing routes on the Express app.
 *
 * @param {import('express').Express} app - The Express application
 * @param {Object} deps - Injected dependencies from auth module
 * @param {Function} deps.requireAuth - Express middleware for Bearer token auth
 * @param {Function} deps.addToken - Registers a new token in the active set
 * @param {Function} deps.generateToken - Creates a cryptographically random hex token
 * @param {Function} deps.isRateLimited - Checks if an IP is rate-limited
 */
function setupPairing(app, { requireAuth, addToken, generateToken, isRateLimited, getStore }) {
  const serverInfo = getServerInfo();

  /**
   * GET /api/auth/pairing-code
   * Requires Bearer auth. Generates a short-lived pairing token and
   * returns a QR payload that the mobile app scans.
   *
   * Query params:
   *   url (optional) - Override the server URL in the QR payload
   *
   * Response: { pairingToken, expiresAt, qrPayload }
   */
  app.get('/api/auth/pairing-code', requireAuth, (req, res) => {
    const pairingToken = crypto.randomBytes(PAIRING_TOKEN_BYTES).toString('hex');

    pairingTokens.set(pairingToken, {
      createdAt: Date.now(),
      used: false,
    });

    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();
    const serverUrl = req.query.url || (req.protocol + '://' + req.get('host'));

    const qrPayload = JSON.stringify({
      url: serverUrl,
      pairingToken,
      serverName: serverInfo.name,
      version: serverInfo.version,
    });

    return res.json({ pairingToken, expiresAt, qrPayload });
  });

  /**
   * POST /api/auth/pair
   * Public endpoint (no auth required). Rate-limited.
   * Exchanges a valid pairing token for a long-lived Bearer token.
   *
   * Body: { pairingToken, deviceName?, platform? }
   * Response: { success: true, token, serverName, serverVersion }
   */
  app.post('/api/auth/pair', (req, res) => {
    // Rate limiting
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    if (isRateLimited(clientIp)) {
      return res.status(429).json({
        success: false,
        error: 'Too many pairing attempts. Try again in 1 minute.',
      });
    }

    const { pairingToken } = req.body || {};

    if (!pairingToken || typeof pairingToken !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid pairingToken field in request body.',
      });
    }

    const entry = pairingTokens.get(pairingToken);

    // Token not found
    if (!entry) {
      return res.status(403).json({
        success: false,
        error: 'Invalid pairing token.',
      });
    }

    // Token already used
    if (entry.used) {
      pairingTokens.delete(pairingToken);
      return res.status(403).json({
        success: false,
        error: 'Pairing token has already been used.',
      });
    }

    // Token expired
    if (Date.now() - entry.createdAt > PAIRING_TTL_MS) {
      pairingTokens.delete(pairingToken);
      return res.status(403).json({
        success: false,
        error: 'Pairing token has expired.',
      });
    }

    // Consume the token (single-use)
    pairingTokens.delete(pairingToken);

    // Generate a long-lived Bearer token and register it
    const token = generateToken();
    addToken(token);

    // Extract device metadata from request body
    const { deviceName, platform, appVersion } = req.body || {};
    const deviceId = crypto.randomUUID();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

    // Build device record and persist via store
    const deviceRecord = {
      deviceId,
      token,
      deviceName: deviceName || 'Unknown Device',
      platform: platform || 'unknown',
      appVersion: appVersion || '0.0.0',
      pairedAt: now,
      lastSeenAt: now,
      expiresAt,
      pushToken: null,
      pushPreferences: {
        sessionComplete: true,
        sessionNeedsInput: true,
        fileConflicts: true,
        taskReview: true,
        serverOnline: false,
      },
    };

    // Persist device to store (survives server restart)
    if (getStore) {
      try {
        getStore().addPairedDevice(deviceRecord);
      } catch (err) {
        console.error('[Pairing] Failed to persist device record:', err.message);
      }
    }

    return res.json({
      success: true,
      token,
      deviceId,
      serverName: serverInfo.name,
      serverVersion: serverInfo.version,
      capabilities: {
        push: true,
        sse: true,
        terminal: true,
        search: true,
        costTracking: true,
      },
    });
  });
}

// ─── Exports ───────────────────────────────────────────────

module.exports = {
  setupPairing,
  _pairingTokens: pairingTokens,
  _PAIRING_TTL_MS: PAIRING_TTL_MS,
};
