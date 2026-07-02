/**
 * Credential Manager for the Claude account switcher.
 *
 * Owns the per-account credential snapshot store, the rotation write-back
 * watcher, usage fetching, inactive-token refresh, and the PC apply
 * transaction. Ported from the proven primitives in claude-swap.ps1
 * (usage fetch, credentials-file text builder, profile store, Invoke-PcSwap)
 * with one deliberate CORRECTION: the reference tool marks a profile
 * permanently dead on ANY refresh failure (network error, timeout, 429,
 * 5xx, and real auth rejections all collapse to null), which wrongly greys
 * out healthy accounts. This module replaces that binary tokenDead flag
 * with a three-state model:
 *
 *   tokenState: 'ok'          the stored refresh token is believed good
 *               'needs_login' a DEFINITIVE auth rejection (invalid_grant)
 *                             was observed; only /login revives it
 *               'unverified'  imported or migrated without fresh evidence
 *
 * "Access token expired" is NEVER a stored state. OAuth access tokens are
 * supposed to expire (about every 12h) and self-heal via refresh; expiry is
 * derived at read time from expiresAt. Transient failures (network, timeout,
 * 429, 5xx, protocol bugs on our side) never change tokenState; they are
 * recorded in lastRefreshError and the prior state is kept.
 *
 * Design: docs/plans/2026-07-02-credential-switcher-design.md sections 2, 3.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { getDataDir } = require('../utils/data-dir');

// ─── Endpoint and protocol constants (named, never inlined) ────────────────
// Ported from claude-swap.ps1 L554 to 558. The client id is Claude Code's own
// public OAuth client id; refreshes must present the same client.
const ANTHROPIC_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const ANTHROPIC_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const ANTHROPIC_OAUTH_BETA = 'oauth-2025-04-20';
const ANTHROPIC_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

// ─── Token state model constants ────────────────────────────────────────────
const TOKEN_STATE_OK = 'ok';
const TOKEN_STATE_NEEDS_LOGIN = 'needs_login';
const TOKEN_STATE_UNVERIFIED = 'unverified';

// ─── Timing and limit constants ─────────────────────────────────────────────
// Refresh timeout is deliberately generous (15s, not the 5s the reference
// tool used); a slow link must classify as transient, never as a dead token.
const REFRESH_TIMEOUT_MS = 15000;
// Treat an access token as expired 5 minutes early so an apply never hands
// the CLI a token that dies seconds later.
const EXPIRY_SKEW_MS = 5 * 60 * 1000;
// Watcher events within this window after our own apply are ignored.
const SELF_WRITE_GUARD_MS = 3000;
// Atomic rename retry policy (Windows EPERM/EBUSY/EACCES under antivirus
// and concurrent readers; same lesson as store.js save()).
const RENAME_MAX_ATTEMPTS = 5;
const RENAME_BACKOFF_MS = 50;
const LABEL_MAX_LENGTH = 60;
const CREDENTIALS_FILE_NAME = '.credentials.json';

// ─── Default settings (section 2.3 of the design) ───────────────────────────
const DEFAULT_CRED_SETTINGS = Object.freeze({
  mac: Object.freeze({
    enabled: false,
    host: 'arthurs-mac-mini',
    user: 'arthur',
    profileTool: '$HOME/.local/bin/claude-profile',
    postSwapCommand: '',
  }),
  usageCacheMinutes: 10,
  httpTimeoutSec: 5,
  sshTimeoutSec: 8,
  backupKeep: 20,
  claudeSwapSeedDir: '',
});

// ─── Module-level pure helpers (exported for tests and reuse) ───────────────

/**
 * Gate every profileId before it is used in path construction.
 * Accepts only hex digits and dashes, 8 to 64 chars (covers real UUIDs and
 * defends against path separators, dots, and other junk).
 *
 * @param {*} id - Candidate account uuid.
 * @returns {boolean} true when safe to use as a filename component.
 */
function validateAccountUuid(id) {
  return typeof id === 'string' && /^[0-9a-fA-F-]{8,64}$/.test(id);
}

/**
 * Display fallback chain (design section 2.2), the single source of truth:
 * label if non-empty, else email, else the first 8 chars of the uuid plus
 * ' unnamed'. Never returns an empty string for a snapshot with a uuid.
 *
 * @param {{label?: string, email?: string, accountUuid?: string}} snapshot
 * @returns {string} Human-facing display name.
 */
function displayNameFor(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return 'unnamed';
  const label = typeof snapshot.label === 'string' ? snapshot.label.trim() : '';
  if (label) return label;
  const email = typeof snapshot.email === 'string' ? snapshot.email.trim() : '';
  if (email) return email;
  const uuid = typeof snapshot.accountUuid === 'string' ? snapshot.accountUuid : '';
  return (uuid.slice(0, 8) || 'unknown') + ' unnamed';
}

/**
 * Map a tokenState to the UI health string. Expired-but-refreshable renders
 * exactly like healthy (never amber): expiry is normal and self-healing.
 *
 * @param {string} tokenState - One of the TOKEN_STATE_* values.
 * @returns {'healthy'|'needs-attention'|'needs-re-login'}
 */
function healthFor(tokenState) {
  if (tokenState === TOKEN_STATE_OK) return 'healthy';
  if (tokenState === TOKEN_STATE_NEEDS_LOGIN) return 'needs-re-login';
  return 'needs-attention';
}

/**
 * Serialize a credentials object back to .credentials.json file text.
 * Compact JSON shaped {"claudeAiOauth":{...}}, the same shape the reference
 * tool's New-CredentialsFileText writes in production. This is the ONLY
 * writer format for the live token file.
 *
 * @param {object} credentials - Parsed claudeAiOauth object.
 * @returns {string} Compact JSON text.
 */
function serializeCredentialsFile(credentials) {
  return JSON.stringify({ claudeAiOauth: credentials });
}

/**
 * Synchronous sleep used only inside the atomic-write retry loop.
 * Atomics.wait blocks without spinning; the fallback spin loop only runs
 * where SharedArrayBuffer is unavailable (never in stock Node).
 *
 * @param {number} ms - Milliseconds to block.
 * @returns {void}
 */
function _sleepSync(ms) {
  try {
    const sab = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(sab), 0, 0, ms);
  } catch (_) {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* bounded spin fallback */ }
  }
}

/**
 * Write a file atomically: temp file in the same directory (pid + random
 * suffix), verify the temp re-reads non-empty and not zero-filled, then
 * fs.renameSync with a Windows EPERM/EBUSY/EACCES retry (5 attempts, backoff
 * of 50ms times the attempt number). The temp file is unlinked in finally.
 *
 * @param {string} filePath - Destination path (parent dirs are created).
 * @param {string} text - Full file content.
 * @param {{mode?: number}} [opts] - Optional chmod applied best effort after
 *   the rename (pass 0o600 for secret files; ignored errors on Windows).
 * @returns {void} Throws on unrecoverable write or rename failure.
 */
function writeFileAtomic(filePath, text, opts = {}) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = filePath + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  try {
    fs.writeFileSync(tmpPath, text, 'utf-8');
    // Verify before renaming: catch the Windows write-cache zero-fill mode.
    const written = fs.readFileSync(tmpPath, 'utf-8');
    if (!written || !written.trim() || written.charCodeAt(0) === 0) {
      throw new Error('atomic write verification failed: temp file empty or zero-filled');
    }
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        fs.renameSync(tmpPath, filePath);
        break;
      } catch (err) {
        const transient = err && (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES');
        if (!transient || attempt >= RENAME_MAX_ATTEMPTS) throw err;
        _sleepSync(RENAME_BACKOFF_MS * attempt);
      }
    }
    if (opts.mode) {
      try { fs.chmodSync(filePath, opts.mode); } catch (_) { /* best effort */ }
    }
  } finally {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) { /* best effort */ }
  }
}

/**
 * Build an Error carrying an HTTP status and a machine-readable code so the
 * route layer can map it straight through structuredError.
 *
 * @param {number} status - HTTP status code for the route layer.
 * @param {string} code - Machine-readable error code (e.g. CRED_NOT_FOUND).
 * @param {string} message - Human-readable message.
 * @param {boolean} [retryable=false] - Whether the client may retry.
 * @returns {Error} Error with .status, .code, .retryable attached.
 */
function credError(status, code, message, retryable = false) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.retryable = retryable;
  return err;
}

/**
 * Format an epoch-ms timestamp as yyyyMMdd-HHmmss for backup filenames.
 *
 * @param {number} epochMs - Timestamp in epoch milliseconds.
 * @returns {string} Compact local-time stamp.
 */
function _formatStamp(epochMs) {
  const d = new Date(epochMs);
  const pad = (n) => String(n).padStart(2, '0');
  return String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate()) +
    '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

/**
 * Create a credential manager instance. Every dependency is injectable so
 * tests never touch the real HOME or the network.
 *
 * @param {object} [opts]
 * @param {string} [opts.claudeDir] - Dir holding .credentials.json. Default:
 *   CWM_CLAUDE_DIR env, else ~/.claude.
 * @param {string} [opts.claudeJsonPath] - Path to the identity file. Default:
 *   CWM_CLAUDE_JSON env, else ~/.claude.json.
 * @param {string} [opts.accountsDir] - Snapshot store dir. Default:
 *   <dataDir>/claude-accounts.
 * @param {() => object} [opts.settingsProvider] - Returns the raw
 *   settings.credentialSwitcher object (merged over defaults at read time).
 * @param {Function} [opts.fetchImpl] - fetch implementation (global fetch).
 * @param {string} [opts.usageUrl] - Usage endpoint. Default: env
 *   CWM_CRED_USAGE_URL, else the real Anthropic endpoint.
 * @param {string} [opts.tokenUrl] - Token endpoint. Default: env
 *   CWM_CRED_TOKEN_URL, else the real Anthropic endpoint.
 * @param {string} [opts.seedDir] - claude-swap seed dir override. Default:
 *   env CWM_CRED_SEED_DIR, else settings, else <home>/Desktop/claude-swap.
 * @param {() => number} [opts.clock] - Epoch-ms clock. Default Date.now.
 * @param {number} [opts.watchDebounceMs] - Watcher debounce. Default 500.
 * @param {number} [opts.pollIntervalMs] - Fallback poll. Default 30000.
 * @param {number} [opts.refreshTimeoutMs] - Refresh HTTP timeout. Default
 *   REFRESH_TIMEOUT_MS (15000). Injectable for hermetic timeout tests.
 * @param {object} [opts.log] - Logger with warn/error/log. Default console.
 * @returns {object} The manager API (see the design section 3.1 table).
 */
function createCredentialManager(opts = {}) {
  const claudeDir = opts.claudeDir || process.env.CWM_CLAUDE_DIR || path.join(os.homedir(), '.claude');
  const claudeJsonPath = opts.claudeJsonPath || process.env.CWM_CLAUDE_JSON || path.join(os.homedir(), '.claude.json');
  const accountsDir = opts.accountsDir || path.join(getDataDir(), 'claude-accounts');
  const backupsDir = path.join(accountsDir, '..', 'claude-accounts-backups');
  const settingsProvider = typeof opts.settingsProvider === 'function' ? opts.settingsProvider : () => ({});
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const usageUrl = opts.usageUrl || process.env.CWM_CRED_USAGE_URL || ANTHROPIC_USAGE_URL;
  const tokenUrl = opts.tokenUrl || process.env.CWM_CRED_TOKEN_URL || ANTHROPIC_TOKEN_URL;
  const seedDirOverride = opts.seedDir || process.env.CWM_CRED_SEED_DIR || '';
  const clock = opts.clock || Date.now;
  const watchDebounceMs = opts.watchDebounceMs || 500;
  const pollIntervalMs = opts.pollIntervalMs || 30000;
  const refreshTimeoutMs = opts.refreshTimeoutMs || REFRESH_TIMEOUT_MS;
  const log = opts.log || console;

  const credFilePath = path.join(claudeDir, CREDENTIALS_FILE_NAME);

  // Watcher and mutex state, per manager instance.
  let _watcher = null;
  let _debounceTimer = null;
  let _pollTimer = null;
  let _lastPollMtime = null;
  let _selfWriteUntil = 0;
  let _chain = Promise.resolve();

  /**
   * Promise-chain mutex. Serializes every mutating operation so two GUI
   * clients and the watcher can never interleave snapshot or live-file
   * writes. Errors propagate to the caller but never break the chain.
   *
   * @param {() => (Promise<*>|*)} fn - Operation to run exclusively.
   * @returns {Promise<*>} Resolves/rejects with fn's outcome.
   */
  function serialize(fn) {
    const run = _chain.then(() => fn());
    _chain = run.then(() => undefined, () => undefined);
    return run;
  }

  /**
   * Merged settings: defaults overlaid with whatever settingsProvider
   * returns (null-tolerant, never throws).
   *
   * @returns {object} Fully populated settings object.
   */
  function getSettings() {
    let raw = {};
    try { raw = settingsProvider() || {}; } catch (_) { raw = {}; }
    return {
      ...DEFAULT_CRED_SETTINGS,
      ...raw,
      mac: { ...DEFAULT_CRED_SETTINGS.mac, ...(raw.mac || {}) },
    };
  }

  /**
   * Resolve the claude-swap seed directory: explicit override (opts/env)
   * wins, then the settings value, then <home>/Desktop/claude-swap.
   *
   * @returns {string} Directory to probe for profiles/pc/*.json.
   */
  function resolveSeedDir() {
    if (seedDirOverride) return seedDirOverride;
    const cfg = getSettings().claudeSwapSeedDir;
    if (cfg) return cfg;
    return path.join(os.homedir(), 'Desktop', 'claude-swap');
  }

  /**
   * Read the live PC token file: verbatim text plus the parsed claudeAiOauth
   * object. Null-safe; a missing or malformed file degrades to null.
   *
   * @returns {{credText: string, oauth: object}|null}
   */
  function readActiveCredential() {
    try {
      const credText = fs.readFileSync(credFilePath, 'utf-8');
      const parsed = JSON.parse(credText);
      const oauth = parsed && parsed.claudeAiOauth;
      if (!oauth || typeof oauth !== 'object') return null;
      return { credText, oauth };
    } catch (_) {
      return null;
    }
  }

  /**
   * Read the live PC identity file (.claude.json, possibly multiple MB;
   * JSON.parse collapses duplicate keys last-wins, byte-identical behavior
   * to the node -e path claude-swap already uses) and return oauthAccount.
   *
   * @returns {object|null} The oauthAccount object, or null.
   */
  function readActiveIdentity() {
    try {
      const text = fs.readFileSync(claudeJsonPath, 'utf-8');
      const parsed = JSON.parse(text);
      const account = parsed && parsed.oauthAccount;
      if (!account || typeof account !== 'object') return null;
      return account;
    } catch (_) {
      return null;
    }
  }

  /**
   * Convenience: the accountUuid of the account active on this machine.
   *
   * @returns {string|null}
   */
  function getActiveAccountUuid() {
    const identity = readActiveIdentity();
    const uuid = identity && identity.accountUuid;
    return (typeof uuid === 'string' && uuid) ? uuid : null;
  }

  /**
   * Convenience: the email of the account active on this machine.
   *
   * @returns {string|null}
   */
  function getActiveEmail() {
    const identity = readActiveIdentity();
    const email = identity && identity.emailAddress;
    return (typeof email === 'string' && email) ? email : null;
  }

  /**
   * Path of the snapshot file for one account. Validates the uuid first so
   * no unvalidated id ever reaches path construction.
   *
   * @param {string} accountUuid
   * @returns {string} Absolute snapshot path.
   */
  function snapshotPath(accountUuid) {
    if (!validateAccountUuid(accountUuid)) {
      throw credError(400, 'VALIDATION', 'profileId must be 8 to 64 hex/dash characters');
    }
    return path.join(accountsDir, accountUuid + '.json');
  }

  /**
   * Normalize a raw parsed snapshot to the current schema. Missing
   * tokenState migrates from any legacy tokenDead flag, but conservatively:
   * legacy dead flags come from the buggy reference tool and are treated as
   * 'unverified' (cheap to re-derive), never as needs_login.
   *
   * @param {object} snap - Parsed snapshot object.
   * @returns {object} Normalized snapshot.
   */
  function _normalizeSnapshot(snap) {
    if (!snap.tokenState) {
      snap.tokenState = snap.tokenDead === true ? TOKEN_STATE_UNVERIFIED : TOKEN_STATE_OK;
    }
    if (snap.lastRefreshError === undefined) snap.lastRefreshError = null;
    if (snap.usage === undefined) snap.usage = null;
    if (typeof snap.label !== 'string') snap.label = '';
    delete snap.tokenDead; // legacy field; derived at read time from tokenState
    return snap;
  }

  /**
   * Read one snapshot by accountUuid. Missing or corrupt files degrade to
   * null (the next capture self-heals them).
   *
   * @param {string} accountUuid
   * @returns {object|null} Normalized snapshot or null.
   */
  function readSnapshot(accountUuid) {
    if (!validateAccountUuid(accountUuid)) return null;
    try {
      const text = fs.readFileSync(path.join(accountsDir, accountUuid + '.json'), 'utf-8');
      const snap = JSON.parse(text);
      if (!snap || typeof snap !== 'object' || !validateAccountUuid(snap.accountUuid)) return null;
      return _normalizeSnapshot(snap);
    } catch (_) {
      return null;
    }
  }

  /**
   * List every valid snapshot in the accounts dir; unparseable files are
   * skipped silently.
   *
   * @returns {object[]} Normalized snapshots.
   */
  function listSnapshots() {
    let files;
    try {
      files = fs.readdirSync(accountsDir).filter((f) => f.toLowerCase().endsWith('.json'));
    } catch (_) {
      return [];
    }
    const out = [];
    for (const f of files) {
      const uuid = f.slice(0, -5);
      const snap = readSnapshot(uuid);
      if (snap) out.push(snap);
    }
    return out;
  }

  /**
   * Write one snapshot exactly as given (atomic, chmod 0600 best effort).
   * Internal writer; callers own the merge semantics.
   *
   * @param {object} snapshot - Fully formed snapshot.
   * @returns {object} The same snapshot.
   */
  function _writeSnapshot(snapshot) {
    const p = snapshotPath(snapshot.accountUuid);
    writeFileAtomic(p, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
    return snapshot;
  }

  /**
   * Read-modify-write one snapshot: apply the patch fields over the current
   * on-disk state and bump updatedAt. Throws CRED_NOT_FOUND when missing.
   *
   * @param {string} accountUuid
   * @param {object} patch - Fields to overwrite.
   * @returns {object} The updated snapshot.
   */
  function _mutateSnapshot(accountUuid, patch) {
    const current = readSnapshot(accountUuid);
    if (!current) {
      throw credError(404, 'CRED_NOT_FOUND', 'No stored credential snapshot for profile ' + accountUuid + '.');
    }
    const next = { ...current, ...patch, updatedAt: new Date(clock()).toISOString() };
    return _writeSnapshot(next);
  }

  /**
   * Persist a snapshot with carry-forward semantics (design 2.1/2.2): an
   * existing non-empty label survives unless preserveLabel is explicitly
   * false; usage, tokenState, lastRefreshError, and savedAt carry forward
   * when the incoming snapshot omits them.
   *
   * @param {object} snapshot - Partial or full snapshot (accountUuid required).
   * @param {{preserveLabel?: boolean}} [saveOpts]
   * @returns {object} The merged, persisted snapshot.
   */
  function saveSnapshot(snapshot, saveOpts = {}) {
    if (!snapshot || !validateAccountUuid(snapshot.accountUuid)) {
      throw credError(400, 'VALIDATION', 'snapshot.accountUuid is required and must be a valid account uuid');
    }
    const preserveLabel = saveOpts.preserveLabel !== false;
    const existing = readSnapshot(snapshot.accountUuid);
    const nowIso = new Date(clock()).toISOString();
    const existingLabel = existing && existing.label ? existing.label : '';
    const incomingLabel = snapshot.label != null ? String(snapshot.label) : '';
    const merged = {
      accountUuid: snapshot.accountUuid,
      email: snapshot.email != null ? snapshot.email : (existing ? existing.email : ''),
      label: (preserveLabel && existingLabel) ? existingLabel : (incomingLabel || existingLabel),
      savedAt: (existing && existing.savedAt) || snapshot.savedAt || nowIso,
      updatedAt: nowIso,
      credentials: snapshot.credentials !== undefined ? snapshot.credentials : (existing ? existing.credentials : null),
      identity: snapshot.identity !== undefined ? snapshot.identity : (existing ? existing.identity : null),
      usage: snapshot.usage !== undefined ? snapshot.usage : (existing ? existing.usage : null),
      tokenState: snapshot.tokenState !== undefined ? snapshot.tokenState : ((existing && existing.tokenState) || TOKEN_STATE_UNVERIFIED),
      lastRefreshError: snapshot.lastRefreshError !== undefined ? snapshot.lastRefreshError : ((existing && existing.lastRefreshError) || null),
    };
    return _writeSnapshot(merged);
  }

  /**
   * Sanitize the raw usage-endpoint response to the stored shape:
   * five_hour/seven_day {utilization, resets_at} plus a sanitized limits[]
   * array. Null-tolerant everywhere; endpoint drift degrades to nulls,
   * never to a crash.
   *
   * @param {object|null} raw - Parsed usage response body.
   * @returns {object|null} Stored usage shape, or null.
   */
  function _mapUsageResponse(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const pickWindow = (w) => {
      if (!w || typeof w !== 'object') return null;
      return {
        utilization: typeof w.utilization === 'number' ? w.utilization : null,
        resets_at: typeof w.resets_at === 'string' ? w.resets_at : null,
      };
    };
    const usage = {
      five_hour: pickWindow(raw.five_hour),
      seven_day: pickWindow(raw.seven_day),
      fetchedAt: new Date(clock()).toISOString(),
    };
    if (Array.isArray(raw.limits)) {
      usage.limits = raw.limits
        .filter((l) => l && typeof l === 'object')
        .map((l) => {
          const row = {};
          if (typeof l.kind === 'string') row.kind = l.kind;
          if (typeof l.group === 'string') row.group = l.group;
          if (typeof l.percent === 'number') row.percent = l.percent;
          if (typeof l.severity === 'string') row.severity = l.severity;
          if (typeof l.resets_at === 'string') row.resets_at = l.resets_at;
          if (typeof l.is_active === 'boolean') row.is_active = l.is_active;
          if (typeof l.scope === 'string') row.scope = l.scope;
          return row;
        });
    }
    return usage;
  }

  /**
   * Read-only usage fetch for one access token. Safe for the ACTIVE
   * account's live token (a GET never mutates tokens). Returns null on any
   * failure; usage failures never say anything about the refresh token and
   * never change tokenState.
   *
   * @param {string} accessToken - A live or stored OAuth access token.
   * @returns {Promise<object|null>} Stored usage shape or null.
   */
  async function fetchUsage(accessToken) {
    if (!accessToken || typeof fetchImpl !== 'function') return null;
    const timeoutMs = Math.max(1, Number(getSettings().httpTimeoutSec) || 5) * 1000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(usageUrl, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + accessToken,
          'anthropic-beta': ANTHROPIC_OAUTH_BETA,
        },
        signal: controller.signal,
      });
      if (!res || !res.ok) return null;
      const raw = await res.json().catch(() => null);
      return _mapUsageResponse(raw);
    } catch (_) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Exchange a refresh token for a fresh pair at the OAuth token endpoint,
   * with the CORRECTED failure classification (this is where the reference
   * tool's bug lived; it returned null for every failure kind):
   *
   *   ok         { ok:true, tokens:{accessToken, refreshToken, expiresAt} }
   *   needs_login DEFINITIVE auth rejection ONLY: HTTP 400/401 whose JSON
   *              body has error === 'invalid_grant', HTTP 403, or a 401
   *              with no parseable body.
   *   transient  network errors, AbortError timeouts, HTTP 429, HTTP 5xx.
   *              NEVER a death verdict.
   *   protocol   any other rejection (e.g. a non-invalid_grant 400): OUR
   *              request bug; logged loudly, caller keeps the prior state.
   *
   * A response without refresh_token keeps the old one. expires_in seconds
   * convert to absolute epoch ms. MUST NEVER be called for the account
   * active on this machine (races the CLI's own rotation).
   *
   * @param {string} refreshToken - The stored refresh token to exchange.
   * @returns {Promise<object>} Classification object per above.
   */
  async function refreshInactiveToken(refreshToken) {
    if (!refreshToken) {
      return { ok: false, verdict: 'needs_login', status: null, detail: 'no stored refresh token' };
    }
    if (typeof fetchImpl !== 'function') {
      return { ok: false, verdict: 'transient', kind: 'network', status: null, detail: 'no fetch implementation available' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), refreshTimeoutMs);
    let res;
    try {
      res = await fetchImpl(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: ANTHROPIC_OAUTH_CLIENT_ID,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const timedOut = !!(err && (err.name === 'AbortError' || err.name === 'TimeoutError' || err.code === 'ABORT_ERR'));
      return {
        ok: false,
        verdict: 'transient',
        kind: timedOut ? 'timeout' : 'network',
        status: null,
        detail: String((err && err.message) || err),
      };
    }
    clearTimeout(timer);
    let body = null;
    try { body = await res.json(); } catch (_) { body = null; }
    if (res.ok) {
      const accessToken = body && typeof body.access_token === 'string' ? body.access_token : '';
      if (!accessToken) {
        return { ok: false, verdict: 'protocol', status: res.status, detail: 'token response missing access_token' };
      }
      const newRefresh = (body && typeof body.refresh_token === 'string' && body.refresh_token) ? body.refresh_token : refreshToken;
      const expiresInSec = (body && Number.isFinite(Number(body.expires_in))) ? Number(body.expires_in) : 0;
      return {
        ok: true,
        tokens: { accessToken, refreshToken: newRefresh, expiresAt: clock() + (expiresInSec * 1000) },
      };
    }
    const status = res.status;
    const bodyError = (body && typeof body.error === 'string') ? body.error : null;
    if (status === 403) {
      return { ok: false, verdict: 'needs_login', status, detail: bodyError || 'HTTP 403 from token endpoint' };
    }
    if ((status === 400 || status === 401) && bodyError === 'invalid_grant') {
      return { ok: false, verdict: 'needs_login', status, detail: 'invalid_grant' };
    }
    if (status === 401 && body === null) {
      return { ok: false, verdict: 'needs_login', status, detail: 'HTTP 401 with no parseable body' };
    }
    if (status === 429 || (status >= 500 && status <= 599)) {
      return { ok: false, verdict: 'transient', kind: 'server', status, detail: 'HTTP ' + status + ' from token endpoint' };
    }
    // Anything else (including a non-invalid_grant 400) is OUR request bug:
    // log loudly and keep the prior stored state.
    return { ok: false, verdict: 'protocol', status, detail: 'unexpected token endpoint response HTTP ' + status + (bodyError ? ' (' + bodyError + ')' : '') };
  }

  /**
   * True when the stored access token should be treated as expired at
   * `now` (5 minute early skew, missing expiry reads as already expired).
   *
   * @param {object|null} credentials - Stored claudeAiOauth object.
   * @param {number} now - Epoch ms.
   * @returns {boolean}
   */
  function _isAccessTokenExpired(credentials, now) {
    const expMs = credentials ? Number(credentials.expiresAt) || 0 : 0;
    return (expMs - EXPIRY_SKEW_MS) <= now;
  }

  /**
   * Record a transient or protocol refresh failure on a snapshot without
   * touching tokenState. Protocol failures log loudly (they are our bug).
   *
   * @param {string} accountUuid
   * @param {object} r - Non-ok classification from refreshInactiveToken.
   * @returns {object} The updated snapshot.
   */
  function _recordRefreshFailure(accountUuid, r) {
    if (r.verdict === 'protocol') {
      log.error('[Credentials] token refresh PROTOCOL error for ' + accountUuid + ': ' + r.detail +
        ' (this is a request bug on our side, not a dead token; prior state kept)');
    } else {
      log.warn('[Credentials] transient token refresh failure for ' + accountUuid + ': ' + (r.kind || 'unknown') + ' ' + (r.detail || ''));
    }
    return _mutateSnapshot(accountUuid, {
      lastRefreshError: {
        at: new Date(clock()).toISOString(),
        kind: r.verdict === 'protocol' ? 'protocol' : (r.kind || 'network'),
        status: r.status != null ? r.status : null,
        detail: String(r.detail || ''),
      },
    });
  }

  /**
   * Unlocked core of updateSnapshotUsage. Full token policy with the
   * corrected state model:
   *   cache fresher than usageCacheMinutes and no force: zero network;
   *   account ACTIVE here: read-only live token, NEVER refresh;
   *   inactive + expired: refresh, PERSIST THE ROTATED PAIR IMMEDIATELY
   *     (before the usage call; the old refresh token dies server-side the
   *     instant the new one exists);
   *   refresh classification: needs_login only on a definitive rejection;
   *     transient/protocol failures keep the prior state;
   *   usage success writes usage and clears needs_login; usage failure
   *     keeps the prior cache and NEVER changes tokenState.
   *
   * @param {string} accountUuid
   * @param {{force?: boolean}} [usageOpts]
   * @returns {Promise<object>} The (possibly updated) snapshot.
   */
  async function _updateSnapshotUsageUnlocked(accountUuid, usageOpts = {}) {
    const force = !!usageOpts.force;
    if (!validateAccountUuid(accountUuid)) {
      throw credError(400, 'VALIDATION', 'profileId must be a valid account uuid');
    }
    let snap = readSnapshot(accountUuid);
    if (!snap) {
      throw credError(404, 'CRED_NOT_FOUND', 'No stored credential snapshot for profile ' + accountUuid + '.');
    }
    const now = clock();
    const cacheMs = Math.max(0, Number(getSettings().usageCacheMinutes) || 10) * 60000;
    const fetchedAtMs = snap.usage && snap.usage.fetchedAt ? Date.parse(snap.usage.fetchedAt) : NaN;
    if (!force && Number.isFinite(fetchedAtMs) && (now - fetchedAtMs) < cacheMs) {
      return snap; // fresh cache: zero network calls
    }

    const activeUuid = getActiveAccountUuid();
    if (activeUuid && activeUuid === snap.accountUuid) {
      // ACTIVE on this machine: strictly read-only with the LIVE token.
      // Refreshing here would race the CLI's own rotation and brick the
      // live login. Locked by a dedicated unit test.
      const live = readActiveCredential();
      const liveToken = live && live.oauth && live.oauth.accessToken ? live.oauth.accessToken : null;
      if (!liveToken) return snap;
      const usage = await fetchUsage(liveToken);
      if (usage) {
        // Usage success is positive evidence the account is alive.
        snap = _mutateSnapshot(accountUuid, { usage, tokenState: TOKEN_STATE_OK, lastRefreshError: null });
      }
      return snap;
    }

    // Inactive account.
    let accessToken = snap.credentials ? snap.credentials.accessToken : null;
    if (_isAccessTokenExpired(snap.credentials, now)) {
      const storedRefresh = (snap.credentials && snap.credentials.refreshToken) ? String(snap.credentials.refreshToken) : '';
      if (!storedRefresh) {
        // Expired access token AND no refresh token: definitively dead,
        // no network call needed.
        return _mutateSnapshot(accountUuid, { tokenState: TOKEN_STATE_NEEDS_LOGIN, lastRefreshError: null });
      }
      if (snap.tokenState === TOKEN_STATE_NEEDS_LOGIN && !force) {
        // Known-dead refresh token: skip the pointless round trip unless the
        // user explicitly forces a retry (the recovery path if the verdict
        // was somehow wrong; one extra invalid_grant is harmless).
        return snap;
      }
      const r = await refreshInactiveToken(storedRefresh);
      if (r.ok) {
        const prior = snap.credentials || {};
        const rotated = { ...prior, accessToken: r.tokens.accessToken, refreshToken: r.tokens.refreshToken, expiresAt: r.tokens.expiresAt };
        // PERSIST IMMEDIATELY, before any usage call.
        snap = _mutateSnapshot(accountUuid, { credentials: rotated, tokenState: TOKEN_STATE_OK, lastRefreshError: null });
        accessToken = r.tokens.accessToken;
      } else if (r.verdict === 'needs_login') {
        return _mutateSnapshot(accountUuid, { tokenState: TOKEN_STATE_NEEDS_LOGIN, lastRefreshError: null });
      } else {
        return _recordRefreshFailure(accountUuid, r);
      }
    }

    if (!accessToken) return snap;
    const usage = await fetchUsage(accessToken);
    if (usage) {
      // Usage success clears needs_login/unverified: fresh positive evidence.
      snap = _mutateSnapshot(accountUuid, { usage, tokenState: TOKEN_STATE_OK, lastRefreshError: null });
    }
    // Usage failure: keep the prior cache and the prior state. A usage 401
    // may just be an expired access token; it says NOTHING about the
    // refresh token.
    return snap;
  }

  /**
   * Unlocked core of syncActiveTokenToProfile (the rotation write-back loop,
   * design Decision 3). Matches the live pair to a snapshot by the active
   * accountUuid; writes rotated credentials back only when the live
   * expiresAt is strictly newer; auto-captures when no snapshot exists; and
   * ALWAYS resurrects the active account's tokenState to ok (a live login
   * is definitive proof the account works; mandatory per the corrected
   * state model).
   *
   * @returns {string|null} The synced accountUuid, or null when live state
   *   is unreadable (nothing written).
   */
  function _syncActiveTokenToProfileUnlocked() {
    try {
      const live = readActiveCredential();
      if (!live || !live.oauth) return null;
      const identity = readActiveIdentity();
      const uuid = identity && identity.accountUuid ? String(identity.accountUuid) : '';
      if (!validateAccountUuid(uuid)) return null;
      const existing = readSnapshot(uuid);
      if (!existing) {
        const nowIso = new Date(clock()).toISOString();
        _writeSnapshot({
          accountUuid: uuid,
          email: identity.emailAddress || '',
          label: '',
          savedAt: nowIso,
          updatedAt: nowIso,
          credentials: live.oauth,
          identity,
          usage: null,
          tokenState: TOKEN_STATE_OK,
          lastRefreshError: null,
        });
        return uuid;
      }
      const liveExp = Number(live.oauth.expiresAt) || 0;
      const storedExp = existing.credentials ? Number(existing.credentials.expiresAt) || 0 : 0;
      const patch = {};
      if (liveExp > storedExp) {
        patch.credentials = live.oauth;
        patch.identity = identity;
      }
      if (existing.tokenState !== TOKEN_STATE_OK) {
        // Watcher recapture of a live login always resurrects the account.
        patch.tokenState = TOKEN_STATE_OK;
        patch.lastRefreshError = null;
      }
      if (Object.keys(patch).length > 0) _mutateSnapshot(uuid, patch);
      return uuid;
    } catch (err) {
      log.warn('[Credentials] sync-back skipped: ' + ((err && err.message) || err));
      return null;
    }
  }

  /**
   * Unlocked core of captureCurrent: explicit snapshot of the live PC pair
   * (first run, post /login). Captured state is definitionally alive, so
   * tokenState is set to ok.
   *
   * @param {{label?: string}} [captureOpts] - Optional friendly label.
   * @returns {object} The persisted snapshot.
   */
  function _captureCurrentUnlocked(captureOpts = {}) {
    const live = readActiveCredential();
    const identity = readActiveIdentity();
    if (!live || !live.oauth || !identity || !identity.accountUuid) {
      throw credError(500, 'CRED_LIVE_STATE_UNREADABLE',
        'The live credential pair is unreadable (token file or identity missing). Run /login in a terminal first.');
    }
    const uuid = String(identity.accountUuid);
    if (!validateAccountUuid(uuid)) {
      throw credError(500, 'CRED_LIVE_STATE_UNREADABLE', 'live oauthAccount.accountUuid is not a valid account uuid');
    }
    let label = '';
    if (captureOpts.label != null) {
      if (typeof captureOpts.label !== 'string') throw credError(400, 'VALIDATION', 'label must be a string');
      label = captureOpts.label.trim();
      if (label.length > LABEL_MAX_LENGTH) {
        throw credError(400, 'VALIDATION', 'label must be ' + LABEL_MAX_LENGTH + ' characters or fewer');
      }
    }
    const existing = readSnapshot(uuid);
    const nowIso = new Date(clock()).toISOString();
    return _writeSnapshot({
      accountUuid: uuid,
      email: identity.emailAddress || '',
      label: label || (existing && existing.label) || '',
      savedAt: (existing && existing.savedAt) || nowIso,
      updatedAt: nowIso,
      credentials: live.oauth,
      identity,
      usage: (existing && existing.usage) || null,
      tokenState: TOKEN_STATE_OK,
      lastRefreshError: null,
    });
  }

  /**
   * Unlocked core of seedFromClaudeSwap: one-time READ-ONLY conversion of
   * claude-swap's profiles/pc/*.json into our schema. Runs only when the
   * accounts dir has no snapshots. The old tool's tokenDead flags are
   * IGNORED entirely (they come from its buggy refresh classification and
   * are provably wrong); every import lands as 'unverified' and the first
   * refresh, usage success, apply verification, or watcher recapture
   * converts it to ok or needs_login with fresh evidence.
   *
   * @param {string} [dir] - Seed root; defaults to resolveSeedDir().
   * @returns {{imported: number, skipped: number}}
   */
  function _seedFromClaudeSwapUnlocked(dir) {
    const source = dir || resolveSeedDir();
    const result = { imported: 0, skipped: 0 };
    if (listSnapshots().length > 0) return result; // store already populated
    const pcDir = path.join(source, 'profiles', 'pc');
    let files;
    try {
      files = fs.readdirSync(pcDir).filter((f) => f.toLowerCase().endsWith('.json'));
    } catch (_) {
      return result; // no seed dir: silent no-op
    }
    for (const f of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(pcDir, f), 'utf-8'));
        const credParsed = JSON.parse(String(raw.credentialsFileText || ''));
        const oauth = credParsed && credParsed.claudeAiOauth;
        const identity = JSON.parse(String(raw.oauthAccountJson || ''));
        const uuid = identity && identity.accountUuid;
        if (!oauth || typeof oauth !== 'object' || !validateAccountUuid(uuid)) {
          result.skipped += 1;
          continue;
        }
        if (readSnapshot(uuid)) { result.skipped += 1; continue; } // duplicate uuid
        const nowIso = new Date(clock()).toISOString();
        _writeSnapshot({
          accountUuid: uuid,
          email: identity.emailAddress || raw.email || '',
          label: raw.label ? String(raw.label) : '',
          savedAt: nowIso,
          updatedAt: nowIso,
          credentials: oauth,
          identity,
          usage: null,
          tokenState: TOKEN_STATE_UNVERIFIED,
          lastRefreshError: null,
        });
        result.imported += 1;
      } catch (_) {
        result.skipped += 1;
      }
    }
    if (result.imported > 0) {
      log.log('[Credentials] seeded ' + result.imported + ' snapshot(s) from claude-swap (all unverified; old dead flags ignored)');
    }
    return result;
  }

  /**
   * Unlocked core of setLabel: trim, cap at 60 chars (VALIDATION beyond),
   * empty clears (display falls back per the chain). Updates only the label.
   *
   * @param {string} accountUuid
   * @param {string} label
   * @returns {object} The updated snapshot.
   */
  function _setLabelUnlocked(accountUuid, label) {
    if (!validateAccountUuid(accountUuid)) {
      throw credError(400, 'VALIDATION', 'profileId must be a valid account uuid');
    }
    if (label == null) label = '';
    if (typeof label !== 'string') throw credError(400, 'VALIDATION', 'label must be a string');
    const trimmed = label.trim();
    if (trimmed.length > LABEL_MAX_LENGTH) {
      throw credError(400, 'VALIDATION', 'label must be ' + LABEL_MAX_LENGTH + ' characters or fewer');
    }
    return _mutateSnapshot(accountUuid, { label: trimmed });
  }

  /**
   * Timestamped backup of one live file into the backups dir, pruning the
   * oldest beyond backupKeep per basename. The just-created backup is never
   * a prune candidate (NTFS tunneling lesson from the reference tool).
   * A missing or uncopyable source degrades to null (nothing to back up).
   *
   * @param {string} livePath - File to back up.
   * @returns {string|null} The backup path, or null.
   */
  function backupLiveFile(livePath) {
    try {
      if (!livePath || !fs.existsSync(livePath) || !fs.statSync(livePath).isFile()) return null;
    } catch (_) {
      return null;
    }
    try {
      fs.mkdirSync(backupsDir, { recursive: true });
      const base = path.basename(livePath);
      const stamp = _formatStamp(clock());
      let candidate = path.join(backupsDir, base + '.' + stamp + '.bak');
      let n = 0;
      while (fs.existsSync(candidate)) {
        n += 1;
        candidate = path.join(backupsDir, base + '.' + stamp + '.' + n + '.bak');
      }
      fs.copyFileSync(livePath, candidate);
      try { fs.chmodSync(candidate, 0o600); } catch (_) { /* best effort */ }
      const keep = Math.max(1, Number(getSettings().backupKeep) || 20);
      try {
        const others = fs.readdirSync(backupsDir)
          .filter((f) => f.startsWith(base + '.') && f.endsWith('.bak'))
          .map((f) => path.join(backupsDir, f))
          .filter((p) => p !== candidate)
          .map((p) => {
            let m = 0;
            try { m = fs.statSync(p).mtimeMs; } catch (_) { m = 0; }
            return { p, m };
          })
          .sort((a, b) => a.m - b.m);
        const allowedOthers = keep > 0 ? keep - 1 : 0;
        while (others.length > allowedOthers) {
          const victim = others.shift();
          try { fs.unlinkSync(victim.p); } catch (_) { /* best effort */ }
        }
      } catch (_) { /* prune is best effort */ }
      return candidate;
    } catch (err) {
      log.warn('[Credentials] backup of ' + livePath + ' failed: ' + ((err && err.message) || err));
      return null;
    }
  }

  /**
   * Unlocked core of applyCredential: the PC swap transaction, step order
   * load-bearing (ported from Invoke-PcSwap), with the corrected apply
   * rules: an expired access token ALONE never blocks apply; a definitive
   * needs_login state is the ONLY blocker. When the target is expired and
   * ok/unverified, an inline verification refresh runs first (safe: the
   * account is inactive here); transient verification failures apply anyway
   * with a warning instead of blocking.
   *
   * @param {string} accountUuid - The target profileId.
   * @returns {Promise<{applied: boolean, alreadyActive: boolean, email: string, warning?: string}>}
   */
  async function _applyCredentialUnlocked(accountUuid) {
    // Step 0: validate and load.
    if (!validateAccountUuid(accountUuid)) {
      throw credError(400, 'VALIDATION', 'profileId must be a valid account uuid');
    }
    let snap = readSnapshot(accountUuid);
    if (!snap) {
      throw credError(404, 'CRED_NOT_FOUND', 'No stored credential snapshot for that profile. /login as that account once; it recaptures automatically.');
    }
    if (!snap.credentials || !snap.credentials.accessToken || !snap.identity) {
      throw credError(422, 'CRED_INCOMPLETE', 'The stored snapshot for ' + (snap.email || accountUuid) + ' is missing one half of the credential pair. /login as that account once; it recaptures automatically.');
    }
    const activeUuid = getActiveAccountUuid();
    if (activeUuid && activeUuid === accountUuid) {
      return { applied: false, alreadyActive: true, email: snap.email || '' };
    }
    if (snap.tokenState === TOKEN_STATE_NEEDS_LOGIN) {
      throw credError(409, 'CRED_TOKEN_DEAD', 'The stored token for ' + (snap.email || accountUuid) + ' needs a fresh login. /login as that account once; it recaptures automatically.');
    }

    // Step 0.5: inline verification. Expired access token alone NEVER
    // blocks; verify the refresh token instead (safe: inactive here).
    let warning = null;
    const now = clock();
    if (_isAccessTokenExpired(snap.credentials, now)) {
      const storedRefresh = snap.credentials.refreshToken ? String(snap.credentials.refreshToken) : '';
      if (!storedRefresh) {
        _mutateSnapshot(accountUuid, { tokenState: TOKEN_STATE_NEEDS_LOGIN, lastRefreshError: null });
        throw credError(409, 'CRED_TOKEN_DEAD', 'The stored token for ' + (snap.email || accountUuid) + ' is expired and has no refresh token. /login as that account once; it recaptures automatically.');
      }
      const r = await refreshInactiveToken(storedRefresh);
      if (r.ok) {
        const rotated = { ...snap.credentials, accessToken: r.tokens.accessToken, refreshToken: r.tokens.refreshToken, expiresAt: r.tokens.expiresAt };
        // Persist the rotated pair BEFORE applying (the old refresh token
        // dies server-side the instant the new one is issued).
        snap = _mutateSnapshot(accountUuid, { credentials: rotated, tokenState: TOKEN_STATE_OK, lastRefreshError: null });
      } else if (r.verdict === 'needs_login') {
        _mutateSnapshot(accountUuid, { tokenState: TOKEN_STATE_NEEDS_LOGIN, lastRefreshError: null });
        throw credError(409, 'CRED_TOKEN_DEAD', 'The stored token for ' + (snap.email || accountUuid) + ' was rejected by the auth server. /login as that account once; it recaptures automatically.');
      } else {
        // Transient (network/timeout/5xx/429) or protocol failure: apply
        // anyway; never block on transience.
        warning = 'Could not verify the stored token over the network; applied anyway. If the CLI demands login, run /login once.';
        snap = _recordRefreshFailure(accountUuid, r);
      }
    }

    // Step a: arm the self-write guard so the watcher ignores our writes.
    _selfWriteUntil = clock() + SELF_WRITE_GUARD_MS;
    // Step 1: capture the CURRENT account's freshest rotated tokens before
    // anything is replaced (no-op on unreadable live state).
    _syncActiveTokenToProfileUnlocked();
    // Step 2: backups. The .claude.json backup doubles as the rollback source.
    const credBackup = backupLiveFile(credFilePath);
    const jsonBackup = backupLiveFile(claudeJsonPath);
    // Step 3: IDENTITY FIRST. Surgical oauthAccount replacement.
    let claudeJsonObj = {};
    try {
      const text = fs.readFileSync(claudeJsonPath, 'utf-8');
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) claudeJsonObj = parsed;
    } catch (_) {
      claudeJsonObj = {}; // missing identity file: create a minimal one
    }
    claudeJsonObj.oauthAccount = snap.identity;
    try {
      writeFileAtomic(claudeJsonPath, JSON.stringify(claudeJsonObj, null, 2));
    } catch (err) {
      // Atomic write means the identity file is untouched on failure.
      throw credError(500, 'CRED_APPLY_FAILED', 'Identity write failed; live files are unchanged. ' + ((err && err.message) || err));
    }
    // Step 4: TOKENS LAST. On failure restore the identity file atomically
    // (a live Claude process may be mid-read; same torn-write-proof path).
    try {
      writeFileAtomic(credFilePath, serializeCredentialsFile(snap.credentials));
    } catch (credWriteErr) {
      const detail = (credWriteErr && credWriteErr.message) || String(credWriteErr);
      if (jsonBackup) {
        try {
          writeFileAtomic(claudeJsonPath, fs.readFileSync(jsonBackup, 'utf-8'));
        } catch (rollbackErr) {
          throw credError(500, 'CRED_ROLLBACK_FAILED',
            'Credentials write failed AND the identity rollback also failed (' + ((rollbackErr && rollbackErr.message) || rollbackErr) +
            '). Recover manually from the backups in ' + backupsDir + '. Swap aborted: ' + detail);
        }
        throw credError(500, 'CRED_APPLY_FAILED', 'Credentials write failed; the identity file was restored from its backup. Swap aborted: ' + detail);
      }
      throw credError(500, 'CRED_APPLY_FAILED', 'Credentials write failed; no identity backup existed, so nothing was restored. Swap aborted: ' + detail);
    }
    // Step 5: VERIFY the live identity now reports the target account.
    const verifyUuid = getActiveAccountUuid();
    if (verifyUuid !== accountUuid) {
      // Restore BOTH halves (deliberately stronger than the reference tool's
      // identity-only rollback: restoring only the identity would recreate
      // the exact identity/token mismatch this transaction exists to avoid).
      try {
        if (jsonBackup) writeFileAtomic(claudeJsonPath, fs.readFileSync(jsonBackup, 'utf-8'));
        if (credBackup) writeFileAtomic(credFilePath, fs.readFileSync(credBackup, 'utf-8'));
      } catch (_) { /* verify rollback is best effort; backups remain on disk */ }
      throw credError(500, 'CRED_VERIFY_FAILED',
        'Post-apply verification failed: the live identity does not report the target account. Backups are in ' + backupsDir + '.');
    }
    // Step 6: reconcile the snapshot with what is now live, then report.
    _syncActiveTokenToProfileUnlocked();
    const result = { applied: true, alreadyActive: false, email: snap.email || '' };
    if (warning) result.warning = warning;
    return result;
  }

  /**
   * Unlocked core of deleteSnapshot: removes the snapshot file only (never
   * live files, never remote files).
   *
   * @param {string} accountUuid
   * @returns {{deleted: boolean}}
   */
  function _deleteSnapshotUnlocked(accountUuid) {
    if (!validateAccountUuid(accountUuid)) {
      throw credError(400, 'VALIDATION', 'profileId must be a valid account uuid');
    }
    const p = path.join(accountsDir, accountUuid + '.json');
    if (!fs.existsSync(p)) {
      throw credError(404, 'CRED_NOT_FOUND', 'No stored credential snapshot for profile ' + accountUuid + '.');
    }
    fs.unlinkSync(p);
    return { deleted: true };
  }

  /**
   * Fire one serialized sync-back, swallowing every error (the watcher can
   * never crash the server).
   *
   * @returns {void}
   */
  function _fireSync() {
    if (clock() < _selfWriteUntil) return; // our own apply is writing
    serialize(() => _syncActiveTokenToProfileUnlocked()).catch((err) => {
      log.warn('[Credentials] watcher sync failed: ' + ((err && err.message) || err));
    });
  }

  /**
   * Start the rotation write-back loop (design Decision 3): a dir-scoped
   * fs.watch on the claude dir filtered to .credentials.json (watching the
   * file itself drops on Windows when it is replaced by rename), debounced,
   * plus a low-frequency mtime poll fallback because Windows watchers can
   * silently die. Idempotent. Also fires one initial sync so the active
   * account self-registers at boot.
   *
   * @returns {void}
   */
  function startCredentialWatcher() {
    if (_watcher || _pollTimer) return; // already running
    try {
      _watcher = fs.watch(claudeDir, (event, filename) => {
        try {
          if (filename && String(filename).toLowerCase() !== CREDENTIALS_FILE_NAME) return;
          if (_debounceTimer) clearTimeout(_debounceTimer);
          _debounceTimer = setTimeout(_fireSync, watchDebounceMs);
          if (_debounceTimer.unref) _debounceTimer.unref();
        } catch (_) { /* watcher callback must never throw */ }
      });
      _watcher.on('error', (err) => {
        log.warn('[Credentials] watcher error, degrading to poll-only: ' + ((err && err.message) || err));
        try { _watcher.close(); } catch (_) { /* best effort */ }
        _watcher = null;
      });
    } catch (err) {
      log.warn('[Credentials] fs.watch unavailable (' + ((err && err.message) || err) + '); poll fallback only');
      _watcher = null;
    }
    _pollTimer = setInterval(() => {
      try {
        const st = fs.statSync(credFilePath);
        if (_lastPollMtime !== null && st.mtimeMs !== _lastPollMtime) _fireSync();
        _lastPollMtime = st.mtimeMs;
      } catch (_) { /* live file missing: nothing to sync */ }
    }, pollIntervalMs);
    if (_pollTimer.unref) _pollTimer.unref();
    // Initial sync: the active account self-registers on first run.
    setImmediate(_fireSync);
  }

  /**
   * Stop the watcher and every timer. Idempotent; called on shutdown.
   *
   * @returns {void}
   */
  function stopCredentialWatcher() {
    if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    if (_watcher) { try { _watcher.close(); } catch (_) { /* best effort */ } _watcher = null; }
    _lastPollMtime = null;
  }

  /**
   * Browser-safe projection of the roster. THE ONLY SHAPE ROUTES MAY
   * SERIALIZE. Never contains accessToken, refreshToken, raw credentials,
   * or the raw identity blob; only whitelisted org/display fields.
   *
   * @returns {{activeProfileId: string|null, profiles: object[]}}
   */
  function getSafeList() {
    const activeProfileId = getActiveAccountUuid();
    const profiles = listSnapshots().map((snap) => {
      const tokenState = snap.tokenState || TOKEN_STATE_UNVERIFIED;
      return {
        profileId: snap.accountUuid,
        email: snap.email || '',
        label: snap.label || '',
        displayName: displayNameFor(snap),
        isActive: !!activeProfileId && snap.accountUuid === activeProfileId,
        tokenState,
        tokenDead: tokenState === TOKEN_STATE_NEEDS_LOGIN,
        health: healthFor(tokenState),
        savedAt: snap.savedAt || null,
        updatedAt: snap.updatedAt || null,
        subscriptionType: (snap.credentials && snap.credentials.subscriptionType) || null,
        rateLimitTier: (snap.credentials && snap.credentials.rateLimitTier) || null,
        organizationType: (snap.identity && snap.identity.organizationType) || null,
        organizationName: (snap.identity && snap.identity.organizationName) || '',
        usage: snap.usage || null,
        lastRefreshError: snap.lastRefreshError ? {
          at: snap.lastRefreshError.at || null,
          kind: snap.lastRefreshError.kind || null,
          status: snap.lastRefreshError.status != null ? snap.lastRefreshError.status : null,
        } : null,
      };
    });
    profiles.sort((a, b) => (Number(b.isActive) - Number(a.isActive)) ||
      String(a.displayName).localeCompare(String(b.displayName)));
    return { activeProfileId: activeProfileId || null, profiles };
  }

  /**
   * Arm the self-write guard window manually. Internal, exposed for tests
   * that exercise the watcher guard without running a full apply.
   *
   * @param {number} ms - Guard duration from now.
   * @returns {void}
   */
  function _armSelfWriteGuard(ms) {
    _selfWriteUntil = clock() + (Number(ms) || 0);
  }

  return {
    // Paths and config (read-only introspection for routes and tests)
    claudeDir,
    claudeJsonPath,
    accountsDir,
    backupsDir,
    getSettings,
    resolveSeedDir,
    // Pure helpers re-exposed on the instance for convenience
    validateAccountUuid,
    displayNameFor,
    serializeCredentialsFile,
    // Live-state readers
    readActiveCredential,
    readActiveIdentity,
    getActiveAccountUuid,
    getActiveEmail,
    // Snapshot store
    snapshotPath,
    readSnapshot,
    saveSnapshot,
    listSnapshots,
    deleteSnapshot: (uuid) => serialize(() => _deleteSnapshotUnlocked(uuid)),
    // Watcher (rotation write-back loop)
    startCredentialWatcher,
    stopCredentialWatcher,
    syncActiveTokenToProfile: () => serialize(() => _syncActiveTokenToProfileUnlocked()),
    // Capture / seed / labels
    captureCurrent: (o) => serialize(() => _captureCurrentUnlocked(o)),
    seedFromClaudeSwap: (dir) => serialize(() => _seedFromClaudeSwapUnlocked(dir)),
    setLabel: (uuid, label) => serialize(() => _setLabelUnlocked(uuid, label)),
    // Network
    fetchUsage,
    refreshInactiveToken,
    updateSnapshotUsage: (uuid, o) => serialize(() => _updateSnapshotUsageUnlocked(uuid, o)),
    // Apply transaction
    backupLiveFile,
    applyCredential: (uuid) => serialize(() => _applyCredentialUnlocked(uuid)),
    // Safe projection (the only route-serializable shape)
    getSafeList,
    // Internal, for tests only
    _armSelfWriteGuard,
  };
}

module.exports = {
  createCredentialManager,
  serializeCredentialsFile,
  validateAccountUuid,
  writeFileAtomic,
  displayNameFor,
  healthFor,
  credError,
  DEFAULT_CRED_SETTINGS,
  ANTHROPIC_TOKEN_URL,
  ANTHROPIC_USAGE_URL,
  ANTHROPIC_OAUTH_BETA,
  ANTHROPIC_OAUTH_CLIENT_ID,
  REFRESH_TIMEOUT_MS,
  EXPIRY_SKEW_MS,
  TOKEN_STATE_OK,
  TOKEN_STATE_NEEDS_LOGIN,
  TOKEN_STATE_UNVERIFIED,
};
