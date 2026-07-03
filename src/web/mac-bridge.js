/**
 * Mac Mini bridge for the Claude account switcher (optional, config-gated).
 *
 * Mirrors an applied credential to the Mac Mini by reusing the Mac-native
 * ~/.local/bin/claude-profile tool. Format VERIFIED live on 2026-07-02 by
 * reading the script over SSH:
 *   profiles are RAW COPIES of ~/.claude/.credentials.json stored at
 *   ~/.claude-profiles/<name>.credentials.json (chmod 600), with the active
 *   profile name recorded in ~/.claude-profiles/active. 'claude-profile use'
 *   syncs the live file back into the outgoing profile, overlays the target,
 *   and restarts the forge agent. It swaps ONLY the token file; the Mac's
 *   ~/.claude.json identity is untouched by the tool, so verification here
 *   compares the live token file to the pushed profile (cmp) plus the
 *   active-name marker rather than the Mac identity email (which would
 *   spuriously mismatch by design).
 *
 * Security posture (design section 7):
 *   ssh host/user are charset-allowlisted (option-injection guard);
 *   secret payloads travel only as scp'd temp files, never on remote
 *   command lines (visible in process listings);
 *   local child processes use execFile with argv arrays, no shell.
 *
 * Mirror failures NEVER roll back a successful PC apply; every function
 * degrades to a structured warning object instead of throwing mid-route.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const { serializeCredentialsFile } = require('./credential-manager');

// Charset allowlist for ssh host/user; also rejected when starting with a
// dash (ssh option injection guard). Matches the design section 2.3 rule.
const MAC_TARGET_RE = /^[A-Za-z0-9._@-]+$/;
// Default remote profile tool path when config omits it.
const DEFAULT_PROFILE_TOOL = '$HOME/.local/bin/claude-profile';
// Cap slugs so remote filenames stay sane.
const SLUG_MAX_LENGTH = 40;
// The 'use' step restarts the forge agent (script sleeps about 6s plus
// process checks); give it a generous floor regardless of sshTimeoutSec.
const USE_TIMEOUT_FLOOR_SEC = 45;
// ssh option ConnectTimeout is capped so a large exec budget does not also
// stretch the TCP connect phase.
const CONNECT_TIMEOUT_CAP_SEC = 10;
// Host key policy for every ssh/scp invocation. WHY accept-new and not the
// ssh default (ask): BatchMode=yes means ssh can never prompt, so a host
// whose key is not yet in known_hosts (e.g. the Mac renamed from
// arthurs-mac-mini to alloy) would hard-fail every connection forever.
// accept-new performs trust-on-first-use, which is appropriate on the
// private tailnet these hosts live on, while STILL failing loudly if a
// previously known host presents a DIFFERENT key (the actual MITM signal).
// NEVER weaken this to 'no': that would also accept changed keys and
// silently swallow a real man-in-the-middle.
const HOST_KEY_POLICY = 'accept-new';

/**
 * Validate the ssh target. Throws on any charset violation or a leading
 * dash on host or user (which ssh would parse as an option).
 *
 * @param {{host?: string, user?: string}} cfg - Mac config.
 * @returns {true} When valid; throws otherwise.
 */
function validateMacTarget(cfg) {
  if (!cfg || typeof cfg !== 'object') throw new Error('mac config missing');
  const host = String(cfg.host || '');
  const user = String(cfg.user || '');
  if (!host || !MAC_TARGET_RE.test(host) || host.startsWith('-')) {
    throw new Error('mac host must match ^[A-Za-z0-9._@-]+$ and must not start with a dash');
  }
  if (!user || !MAC_TARGET_RE.test(user) || user.startsWith('-')) {
    throw new Error('mac user must match ^[A-Za-z0-9._@-]+$ and must not start with a dash');
  }
  return true;
}

/**
 * Resolve the execFile implementation for one bridge call. Tests inject a
 * fake through opts.execFileImpl so every bridge test is hermetic (zero
 * real ssh/scp processes ever spawn in CI); production callers omit it and
 * get the real child_process.execFile.
 *
 * @param {{execFileImpl?: Function}} [opts] - Per-call options bag.
 * @returns {Function} An execFile-compatible function.
 */
function _resolveExecFile(opts) {
  return (opts && typeof opts.execFileImpl === 'function') ? opts.execFileImpl : execFile;
}

/**
 * Run one remote command over ssh with BatchMode (never prompts) and
 * keep-alive options. Never throws; resolves a structured result. Exit
 * code 255 is ssh's own client/link error and maps to unreachable.
 *
 * @param {{host: string, user: string}} cfg - Validated mac config.
 * @param {string} remoteCommand - Command line for the remote shell.
 * @param {number} timeoutSec - Total execution budget in seconds.
 * @param {{execFileImpl?: Function}} [opts] - Injection point for tests.
 * @returns {Promise<{code: number, stdout: string, stderr: string, timedOut: boolean}>}
 */
function sshExec(cfg, remoteCommand, timeoutSec, opts = {}) {
  return new Promise((resolve) => {
    const t = Math.max(1, Number(timeoutSec) || 8);
    const connectT = Math.min(t, CONNECT_TIMEOUT_CAP_SEC);
    const args = [
      '-o', 'ConnectTimeout=' + connectT,
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=' + HOST_KEY_POLICY,
      '-o', 'ServerAliveInterval=5',
      '-o', 'ServerAliveCountMax=2',
      cfg.user + '@' + cfg.host,
      remoteCommand,
    ];
    _resolveExecFile(opts)('ssh', args, { timeout: t * 1000, windowsHide: true }, (err, stdout, stderr) => {
      const timedOut = !!(err && (err.killed || err.signal === 'SIGTERM'));
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      resolve({ code, stdout: String(stdout || ''), stderr: String(stderr || ''), timedOut });
    });
  });
}

/**
 * Copy one local file to the Mac over scp. Secret payloads always travel
 * this way, never interpolated into remote command lines. Never throws.
 *
 * @param {{host: string, user: string}} cfg - Validated mac config.
 * @param {string} localPath - Local source file.
 * @param {string} remotePath - Remote destination path.
 * @param {number} timeoutSec - Total execution budget in seconds.
 * @param {{execFileImpl?: Function}} [opts] - Injection point for tests.
 * @returns {Promise<boolean>} true on success.
 */
function scpSend(cfg, localPath, remotePath, timeoutSec, opts = {}) {
  return new Promise((resolve) => {
    const t = Math.max(1, Number(timeoutSec) || 8);
    const args = [
      '-o', 'ConnectTimeout=' + Math.min(t, CONNECT_TIMEOUT_CAP_SEC),
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=' + HOST_KEY_POLICY,
      localPath,
      cfg.user + '@' + cfg.host + ':' + remotePath,
    ];
    _resolveExecFile(opts)('scp', args, { timeout: Math.max(t, 20) * 1000, windowsHide: true }, (err) => {
      resolve(!err);
    });
  });
}

/**
 * Read the Mac's live identity (its ~/.claude.json oauthAccount) in one
 * SSH round trip via python3. Informational: claude-profile only swaps the
 * token file, so the Mac identity legitimately lags the mirrored token.
 *
 * @param {{host: string, user: string, sshTimeoutSec?: number}} cfg
 * @param {{execFileImpl?: Function}} [opts] - Injection point for tests.
 * @returns {Promise<{email: string|null, accountUuid: string|null}|null>}
 */
async function readMacLiveState(cfg, opts = {}) {
  try { validateMacTarget(cfg); } catch (_) { return null; }
  const pyCode = "import json,os;a=json.load(open(os.path.expanduser('~/.claude.json'))).get('oauthAccount') or {};" +
    "print(json.dumps({'email':a.get('emailAddress'),'accountUuid':a.get('accountUuid')}))";
  const r = await sshExec(cfg, 'python3 -c "' + pyCode + '"', Number(cfg.sshTimeoutSec) || 8, opts);
  if (r.code !== 0) return null;
  try {
    const lines = r.stdout.trim().split('\n');
    const parsed = JSON.parse(lines[lines.length - 1]);
    return { email: parsed.email || null, accountUuid: parsed.accountUuid || null };
  } catch (_) {
    return null;
  }
}

/**
 * Build a shell-safe remote profile name from a snapshot: slugified label
 * (lowercase, runs of non-alphanumerics collapse to single hyphens, edges
 * trimmed, capped) or the first 8 chars of the accountUuid.
 *
 * @param {{label?: string, accountUuid?: string}} snapshot
 * @returns {string} Safe profile name, never empty.
 */
function profileSlug(snapshot) {
  const label = snapshot && typeof snapshot.label === 'string' ? snapshot.label : '';
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH);
  if (slug) return slug;
  const uuid = snapshot && typeof snapshot.accountUuid === 'string' ? snapshot.accountUuid : '';
  return uuid.slice(0, 8) || 'profile';
}

/**
 * Mirror one snapshot to the Mac Mini through claude-profile:
 *   1. load and gate the snapshot (missing or needs_login rejects);
 *   2. write the raw credentials payload to a local 0600 temp file and scp
 *      it to a random /tmp path on the Mac;
 *   3. install it as ~/.claude-profiles/<name>.credentials.json (mkdir,
 *      atomic mv, chmod 600);
 *   4. run 'claude-profile use <name>' (the script owns sync-back, live
 *      overlay, and the forge agent restart on the Mac);
 *   5. verify: the active marker equals <name> AND the Mac live token file
 *      byte-matches the pushed profile (cmp);
 *   6. run postSwapCommand when configured (nonzero exit = warning only).
 * Local temp files are deleted in finally; a failed install attempts a
 * best-effort remote temp cleanup. Never throws; always returns a result
 * object so a mirror failure can never fail the PC apply.
 *
 * @param {object} manager - A credential manager instance (readSnapshot).
 * @param {{host: string, user: string, profileTool?: string, postSwapCommand?: string, sshTimeoutSec?: number}} cfg
 * @param {string} accountUuid - The profileId to mirror.
 * @returns {Promise<{mirrored: boolean, error?: string, message?: string, warning?: string}>}
 */
async function mirrorToMac(manager, cfg, accountUuid, opts = {}) {
  try {
    validateMacTarget(cfg);
  } catch (err) {
    return { mirrored: false, error: 'VALIDATION', message: err.message };
  }
  const snap = manager.readSnapshot(accountUuid);
  if (!snap) {
    return { mirrored: false, error: 'CRED_NOT_FOUND', message: 'No stored snapshot for that profile; nothing to mirror.' };
  }
  if (snap.tokenState === 'needs_login') {
    return { mirrored: false, error: 'MAC_TOKEN_DEAD', message: 'The stored token needs a fresh login; not mirroring a dead token to the Mac.' };
  }
  if (!snap.credentials || !snap.credentials.accessToken) {
    return { mirrored: false, error: 'CRED_NOT_FOUND', message: 'The stored snapshot has no credentials to mirror.' };
  }
  const timeoutSec = Math.max(1, Number(cfg.sshTimeoutSec) || 8);
  const name = profileSlug(snap);
  const payload = serializeCredentialsFile(snap.credentials);
  const localTmp = path.join(os.tmpdir(), 'cwm-mac-mirror-' + crypto.randomBytes(8).toString('hex') + '.json');
  const remoteTmp = '/tmp/cwm-mirror-' + crypto.randomBytes(8).toString('hex') + '.json';
  const remoteProfile = '$HOME/.claude-profiles/' + name + '.credentials.json';
  try {
    fs.writeFileSync(localTmp, payload, { mode: 0o600 });
    const sent = await scpSend(cfg, localTmp, remoteTmp, timeoutSec, opts);
    if (!sent) {
      return { mirrored: false, error: 'MAC_UNREACHABLE', message: 'scp to ' + cfg.host + ' failed; check SSH connectivity (Tailscale up, key auth working).' };
    }
    // Both remoteTmp and the profile name are safe by construction
    // ([a-z0-9-] slug, hex temp name), so no remote quoting can break.
    const install = await sshExec(cfg,
      'mkdir -p "$HOME/.claude-profiles" && mv ' + remoteTmp + ' "' + remoteProfile + '" && chmod 600 "' + remoteProfile + '"',
      timeoutSec, opts);
    if (install.code !== 0) {
      await sshExec(cfg, 'rm -f ' + remoteTmp, timeoutSec, opts); // best-effort temp cleanup
      if (install.code === 255) {
        return { mirrored: false, error: 'MAC_UNREACHABLE', message: 'ssh to ' + cfg.host + ' failed: ' + (install.stderr || 'link error').trim() };
      }
      return { mirrored: false, error: 'MAC_VERIFY_FAILED', message: 'Installing the profile on the Mac failed: ' + ((install.stderr || install.stdout) || 'unknown error').trim() };
    }
    const tool = (cfg.profileTool && String(cfg.profileTool).trim()) ? String(cfg.profileTool).trim() : DEFAULT_PROFILE_TOOL;
    const useRes = await sshExec(cfg,
      'export PATH="$HOME/.local/bin:$PATH"; ' + tool + ' use ' + name,
      Math.max(timeoutSec, USE_TIMEOUT_FLOOR_SEC), opts);
    if (useRes.code === 255) {
      return { mirrored: false, error: 'MAC_UNREACHABLE', message: 'ssh to ' + cfg.host + ' dropped while applying: ' + (useRes.stderr || 'link error').trim() };
    }
    if (useRes.code === 127 || /command not found|No such file/i.test(useRes.stderr)) {
      return { mirrored: false, error: 'MAC_TOOL_MISSING', message: 'claude-profile tool missing on the Mac (' + tool + '). Install it or fix profileTool in mac-config.' };
    }
    if (useRes.code !== 0) {
      return { mirrored: false, error: 'MAC_VERIFY_FAILED', message: 'claude-profile use failed on the Mac: ' + ((useRes.stderr || useRes.stdout) || 'unknown error').trim() };
    }
    // Verify: active marker matches AND the live token file equals the
    // pushed profile byte for byte. (The Mac identity file is deliberately
    // NOT compared; claude-profile does not touch it.)
    const verify = await sshExec(cfg,
      'cat "$HOME/.claude-profiles/active" 2>/dev/null; cmp -s "$HOME/.claude/.credentials.json" "' + remoteProfile + '" && echo CWM_MATCH',
      timeoutSec, opts);
    let warning;
    if (verify.code === 255 || verify.timedOut) {
      warning = 'Mirror applied but the verification round trip could not connect; assume applied.';
    } else {
      const activeName = verify.stdout.split('\n')[0].trim();
      const bytesMatch = verify.stdout.indexOf('CWM_MATCH') !== -1;
      if (activeName !== name || !bytesMatch) {
        return { mirrored: false, error: 'MAC_VERIFY_FAILED', message: 'The Mac live credentials do not match the pushed profile after apply.' };
      }
    }
    if (cfg.postSwapCommand && String(cfg.postSwapCommand).trim()) {
      const post = await sshExec(cfg, String(cfg.postSwapCommand), Math.max(timeoutSec, 30), opts);
      if (post.code !== 0) {
        warning = (warning ? warning + ' ' : '') + 'postSwapCommand exited ' + post.code + '.';
      }
    }
    const result = { mirrored: true };
    if (warning) result.warning = warning;
    return result;
  } catch (err) {
    return { mirrored: false, error: 'MAC_UNREACHABLE', message: 'Mirror failed: ' + ((err && err.message) || err) };
  } finally {
    try { fs.unlinkSync(localTmp); } catch (_) { /* best effort */ }
  }
}

module.exports = {
  validateMacTarget,
  sshExec,
  scpSend,
  readMacLiveState,
  profileSlug,
  mirrorToMac,
};
