/**
 * HTTP routes for the Claude account switcher (design section 4).
 *
 * Every route requires the workbook's own bearer auth (src/web/auth.js;
 * completely unrelated to the Claude OAuth credentials being managed) and
 * every error goes through structuredError. Responses only ever serialize
 * the manager's safe projection (getSafeList); token material never reaches
 * the browser in any HTTP or SSE payload.
 *
 * SSE payloads use `profileId`, never a bare `id` key, so broadcastSSE's
 * workspace-id extraction cannot misfile them; the event types are also
 * registered in GLOBAL_EVENT_TYPES (server.js) as the second guard.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

'use strict';

// Copy shown after every successful apply (design 4.3): sets restart
// expectations without auto-restarting anything.
const RESTART_NOTE = 'New sessions use this account immediately. Running sessions keep the previous account until restarted.';

/**
 * Register the credential switcher routes on the Express app.
 *
 * @param {import('express').Express} app - The Express app.
 * @param {object} deps
 * @param {Function} deps.requireAuth - Bearer auth middleware.
 * @param {() => object} deps.getStore - Store accessor (settings persistence).
 * @param {(type: string, data: object) => void} deps.broadcast - SSE broadcast.
 * @param {Function} deps.structuredError - The server's error serializer.
 * @param {object} deps.manager - createCredentialManager() instance.
 * @param {object} [deps.macBridge] - mac-bridge module (optional; injectable
 *   for tests, gated by config and CWM_CRED_DISABLE_MAC at request time).
 * @returns {void}
 */
function setupCredentialRoutes(app, { requireAuth, getStore, broadcast, structuredError, manager, macBridge }) {
  /**
   * Broadcast wrapper: an SSE failure must never fail a route.
   *
   * @param {string} type - Event type.
   * @param {object} data - Event payload (profileId keys only, never id).
   * @returns {void}
   */
  function safeBroadcast(type, data) {
    try { broadcast(type, data); } catch (_) { /* SSE must never fail a route */ }
  }

  /**
   * Map a thrown manager error onto structuredError. Errors created via
   * credError carry .status/.code/.retryable; anything else is a 500.
   *
   * @param {import('express').Response} res
   * @param {Error} err
   * @returns {import('express').Response}
   */
  function mapError(res, err) {
    const status = err && Number.isInteger(err.status) ? err.status : 500;
    const code = (err && err.code && typeof err.code === 'string') ? err.code : 'CRED_INTERNAL';
    const message = (err && err.message) ? err.message : 'Internal credential manager error';
    return structuredError(res, status, code, message, !!(err && err.retryable));
  }

  /**
   * Summarize the mac mirror config for list responses (no secrets; host
   * and user are already non-secret connection metadata).
   *
   * @returns {{configured: boolean, enabled: boolean, host: string, user: string}}
   */
  function macSummary() {
    const mac = manager.getSettings().mac;
    return {
      configured: !!(mac.host && mac.user),
      enabled: !!mac.enabled,
      host: mac.host || '',
      user: mac.user || '',
    };
  }

  /**
   * Send the canonical list response (design 4.1): the safe projection plus
   * the mac summary. The ONLY roster shape any route serializes.
   *
   * @param {import('express').Response} res
   * @returns {import('express').Response}
   */
  function sendList(res) {
    const list = manager.getSafeList();
    return res.json({ ...list, mac: macSummary() });
  }

  /**
   * True when the Mac mirror may run for this process: bridge present,
   * config enabled and complete, and not disabled via env (tests set
   * CWM_CRED_DISABLE_MAC=1 so no SSH can ever fire in CI).
   *
   * @returns {boolean}
   */
  function macMirrorAvailable() {
    if (process.env.CWM_CRED_DISABLE_MAC === '1') return false;
    if (!macBridge || typeof macBridge.mirrorToMac !== 'function') return false;
    const mac = manager.getSettings().mac;
    return !!(mac.enabled && mac.host && mac.user);
  }

  // ─── GET /api/credentials ─────────────────────────────────────────────
  // List the roster. Side effects: one-time claude-swap seed when the store
  // is empty, and a cheap guarded sync so the active account always appears.
  // NO network usage calls (pure cache read).
  app.get('/api/credentials', requireAuth, async (req, res) => {
    try {
      try { await manager.seedFromClaudeSwap(); } catch (_) { /* seed is best effort */ }
      try { await manager.syncActiveTokenToProfile(); } catch (_) { /* sync is best effort */ }
      return sendList(res);
    } catch (err) {
      return mapError(res, err);
    }
  });

  // ─── POST /api/credentials/refresh-usage ──────────────────────────────
  // Body { profileId } forces one profile past the TTL; {} refreshes every
  // snapshot whose cache is stale. Per-profile usage failure is NOT a route
  // error (rows keep their stale cache; dead tokens surface in the list).
  app.post('/api/credentials/refresh-usage', requireAuth, async (req, res) => {
    try {
      const body = req.body || {};
      if (body.profileId !== undefined) {
        if (typeof body.profileId !== 'string' || !body.profileId) {
          return structuredError(res, 400, 'VALIDATION', 'profileId must be a non-empty string', false);
        }
        await manager.updateSnapshotUsage(body.profileId, { force: true });
      } else {
        const snaps = manager.listSnapshots();
        for (const snap of snaps) {
          try {
            await manager.updateSnapshotUsage(snap.accountUuid, { force: false });
          } catch (_) { /* per-profile failure never fails the batch */ }
        }
      }
      const list = manager.getSafeList();
      safeBroadcast('credentials:usage', { profiles: list.profiles });
      return res.json({ ...list, mac: macSummary() });
    } catch (err) {
      return mapError(res, err);
    }
  });

  // ─── POST /api/credentials/apply ──────────────────────────────────────
  // The swap. PC apply first (transactional, section 3.2); optional Mac
  // mirror second. Mirror failures NEVER fail the route once the PC apply
  // succeeded; they ride in the `mac` object as a warning.
  app.post('/api/credentials/apply', requireAuth, async (req, res) => {
    const body = req.body || {};
    const profileId = body.profileId;
    if (typeof profileId !== 'string' || !profileId) {
      return structuredError(res, 400, 'VALIDATION', 'profileId must be a non-empty string', false);
    }
    let result;
    try {
      result = await manager.applyCredential(profileId);
    } catch (err) {
      return mapError(res, err);
    }
    let mac = { attempted: false, mirrored: false };
    if (result.applied && body.mirrorToMac === true && macMirrorAvailable()) {
      const settings = manager.getSettings();
      const cfg = { ...settings.mac, sshTimeoutSec: settings.sshTimeoutSec };
      try {
        const m = await macBridge.mirrorToMac(manager, cfg, profileId);
        mac = {
          attempted: true,
          mirrored: !!(m && m.mirrored),
          ...(m && m.error ? { error: m.error } : {}),
          ...(m && m.message ? { message: m.message } : {}),
          ...(m && m.warning ? { warning: m.warning } : {}),
        };
      } catch (err) {
        mac = { attempted: true, mirrored: false, error: 'MAC_UNREACHABLE', message: (err && err.message) || 'mirror failed' };
      }
    } else if (result.applied && body.mirrorToMac === true) {
      mac = { attempted: false, mirrored: false, message: 'Mac mirror is not configured or is disabled.' };
    }
    if (result.applied) {
      // Broadcast AFTER the PC commit, regardless of mirror outcome.
      safeBroadcast('credentials:changed', {
        activeProfileId: profileId,
        email: result.email || '',
        appliedAt: new Date().toISOString(),
        mac: { attempted: mac.attempted, mirrored: mac.mirrored },
      });
    }
    return res.json({
      applied: !!result.applied,
      alreadyActive: !!result.alreadyActive,
      activeProfileId: profileId,
      restartNote: RESTART_NOTE,
      ...(result.warning ? { warning: result.warning } : {}),
      mac,
    });
  });

  // ─── POST /api/credentials/capture ────────────────────────────────────
  // Snapshot the live PC pair with an optional friendly label.
  app.post('/api/credentials/capture', requireAuth, async (req, res) => {
    try {
      const body = req.body || {};
      const snap = await manager.captureCurrent({ label: body.label });
      safeBroadcast('credentials:changed', { captured: true, profileId: snap.accountUuid });
      return sendList(res);
    } catch (err) {
      return mapError(res, err);
    }
  });

  // ─── PUT /api/credentials/:profileId/label ────────────────────────────
  // Rename. Trim, cap 60 (400 beyond), empty clears back to the fallback.
  app.put('/api/credentials/:profileId/label', requireAuth, async (req, res) => {
    try {
      const body = req.body || {};
      const snap = await manager.setLabel(req.params.profileId, body.label != null ? body.label : '');
      safeBroadcast('credentials:changed', { renamed: true, profileId: snap.accountUuid });
      return sendList(res);
    } catch (err) {
      return mapError(res, err);
    }
  });

  // ─── DELETE /api/credentials/:profileId ───────────────────────────────
  // Removes the snapshot file only (never live files, never remote files).
  app.delete('/api/credentials/:profileId', requireAuth, async (req, res) => {
    try {
      const profileId = req.params.profileId;
      await manager.deleteSnapshot(profileId);
      safeBroadcast('credentials:changed', { deleted: true, profileId });
      return sendList(res);
    } catch (err) {
      return mapError(res, err);
    }
  });

  // ─── GET /api/credentials/mac-config ──────────────────────────────────
  // Current Mac mirror config (merged over defaults; no secrets involved).
  app.get('/api/credentials/mac-config', requireAuth, (req, res) => {
    try {
      const mac = manager.getSettings().mac;
      return res.json({
        enabled: !!mac.enabled,
        host: mac.host || '',
        user: mac.user || '',
        profileTool: mac.profileTool || '',
        postSwapCommand: mac.postSwapCommand || '',
      });
    } catch (err) {
      return mapError(res, err);
    }
  });

  // ─── PUT /api/credentials/mac-config ──────────────────────────────────
  // Persist the Mac mirror config. Host/user are charset-validated (ssh
  // option-injection guard). No connectivity probe here; the probe happens
  // naturally at mirror time with a clean MAC_UNREACHABLE.
  app.put('/api/credentials/mac-config', requireAuth, (req, res) => {
    try {
      const body = req.body || {};
      const cur = manager.getSettings().mac;
      const next = {
        enabled: body.enabled !== undefined ? !!body.enabled : !!cur.enabled,
        host: body.host !== undefined ? String(body.host) : cur.host,
        user: body.user !== undefined ? String(body.user) : cur.user,
        profileTool: body.profileTool !== undefined ? String(body.profileTool) : cur.profileTool,
        postSwapCommand: body.postSwapCommand !== undefined ? String(body.postSwapCommand) : cur.postSwapCommand,
      };
      const TARGET_RE = /^[A-Za-z0-9._@-]+$/;
      if (!next.host || !TARGET_RE.test(next.host) || next.host.startsWith('-')) {
        return structuredError(res, 400, 'VALIDATION', 'mac host must match ^[A-Za-z0-9._@-]+$ and must not start with a dash', false);
      }
      if (!next.user || !TARGET_RE.test(next.user) || next.user.startsWith('-')) {
        return structuredError(res, 400, 'VALIDATION', 'mac user must match ^[A-Za-z0-9._@-]+$ and must not start with a dash', false);
      }
      const store = getStore();
      const curAll = (store.settings && store.settings.credentialSwitcher) || {};
      // updateSettings does a shallow Object.assign on settings, so the
      // whole credentialSwitcher object is merged and rewritten here.
      store.updateSettings({ credentialSwitcher: { ...curAll, mac: next } });
      return res.json(next);
    } catch (err) {
      return mapError(res, err);
    }
  });
}

module.exports = { setupCredentialRoutes };
