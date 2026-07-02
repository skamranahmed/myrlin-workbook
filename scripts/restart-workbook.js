#!/usr/bin/env node
/**
 * restart-workbook.js
 *
 * Safe, idempotent restart tool for the Myrlin Workbook GUI server.
 * Windows-primary (uses Get-NetTCPConnection, Get-CimInstance, taskkill,
 * Stop-Process -Id). Fails fast with a clear message on other platforms.
 *
 * WHY THIS EXISTS
 *   The live workbook (port 3457) runs under a respawner. Two respawner
 *   shapes exist in this repo and both are handled:
 *     1. scripts/watchdog.js: a port poller. It probes 127.0.0.1:3457
 *        every 10s and spawns a fresh detached "node src/gui.js"
 *        (PORT=3457, CWM_NO_OPEN=1) whenever the port stops answering.
 *        It tracks the PORT, not a PID.
 *     2. src/supervisor.js: a parent process that respawns its gui.js
 *        child on exit (the \Myrlin-Workbook boot Scheduled Task shape).
 *   A naive "kill and start" fights these respawners and produces
 *   duplicate instances or EADDRINUSE flapping. This script instead:
 *     - kills ONLY the exact PID that owns the target port (never a
 *       blanket kill, never by process name, never the process tree),
 *     - if a respawner is present, WAITS for it to bring the workbook
 *       back and verifies the result,
 *     - only starts the workbook itself when no respawner will,
 *     - then verifies local health, the Cloudflare tunnel ingress
 *       (workbook.myrlin.dev must map to http://127.0.0.1:<port>,
 *       never "localhost": localhost resolves to ::1 while the server
 *       binds IPv4, which caused a real 524), and the public URL.
 *   Public URL note: workbook.myrlin.dev is behind Cloudflare Access,
 *   so an unauthenticated probe sees a 302 to cloudflareaccess.com.
 *   That proves the edge only; the script additionally reads the
 *   tunnel connector status from the Cloudflare API (read only) to
 *   prove cloudflared itself is serving.
 *
 * USAGE
 *   node scripts/restart-workbook.js [flags]
 *
 * FLAGS
 *   --check       Report current status only (process, health, tunnel,
 *                 public URL). No changes of any kind. Exit 0 when all
 *                 checked layers are healthy, 9 otherwise.
 *   --dry-run     Read-only rehearsal of a real run: finds the PID,
 *                 checks health, GETs the tunnel config and public URL,
 *                 and narrates exactly what a real run WOULD do (kill,
 *                 start, PUT). Sends no kills, no spawns, no PUTs.
 *   --no-tunnel   Skip the Cloudflare tunnel and public URL stages.
 *                 Required when restarting a port that has no tunnel
 *                 (for example a test instance on 3900).
 *   --no-reap     Skip the post-restart cleanup of duplicate gui.js
 *                 zombie processes created during the restart window.
 *   --port <n>    Target port (default 3457, or env WORKBOOK_PORT).
 *   --help        Show usage.
 *
 * ENVIRONMENT
 *   WORKBOOK_PORT          Target port (same as --port).
 *   WORKBOOK_PUBLIC_HOST   Public hostname (default workbook.myrlin.dev).
 *   CLOUDFLARE_API_TOKEN   Cloudflare API token. When absent the script
 *                          parses the master token from
 *                          ~/.claude/credentials.md. Tokens are never
 *                          printed; log output is scrubbed.
 *   CWM_DATA_DIR           Inherited by the instance this script starts.
 *                          Set it ONLY for sandboxed test instances. A
 *                          real run against the live port refuses to
 *                          start with CWM_DATA_DIR set unless
 *                          CWM_RESTART_ALLOW_SANDBOXED_LIVE=1, so the
 *                          live workbook can never silently come back
 *                          with an empty sandbox state dir.
 *
 * EXIT CODES
 *   0  Full success.
 *   1  Unexpected error.
 *   2  Configuration problem (bad flag, missing token, refused sandbox).
 *   3  Could not stop the old instance / port never freed.
 *   4  New instance never became healthy locally.
 *   5  Tunnel configuration could not be fetched or parsed.
 *   6  Tunnel repair was needed but failed (or PUT rejected).
 *   7  Public URL unhealthy and fixing it needs an elevated cloudflared
 *      service restart. The exact admin command is printed.
 *   8  Public URL still unhealthy after the cloudflared bounce.
 *   9  --check found one or more unhealthy layers.
 *
 * EXAMPLES
 *   node scripts/restart-workbook.js --check
 *   node scripts/restart-workbook.js --dry-run
 *   node scripts/restart-workbook.js
 *   WORKBOOK_PORT=3900 node scripts/restart-workbook.js --no-tunnel
 */

'use strict';

const { spawnSync, execSync } = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* ===================== Named constants ===================== */

/** Absolute repo root (this file lives in <repo>/scripts/). */
const REPO_ROOT = path.resolve(__dirname, '..');
/** The GUI entry point that actually binds the port. */
const GUI_SCRIPT = path.join(REPO_ROOT, 'src', 'gui.js');
/** Node binary used to start replacements (same node running this script). */
const NODE_EXE = process.execPath;
/** Heap ceiling used by the canonical launch shapes (supervisor, boot task). */
const NODE_HEAP_MB = 4096;

/** Default / live port. The watchdog only guards this port. */
const DEFAULT_PORT = 3457;
const LIVE_PORT = 3457;
/** The server binds IPv4 loopback; health checks must match. */
const LOCAL_HOST = '127.0.0.1';
/** Public hostname served by the Cloudflare tunnel. */
const DEFAULT_PUBLIC_HOST = 'workbook.myrlin.dev';
/** Unauthenticated health endpoint exposed by src/web/server.js. */
const HEALTH_PATH = '/api/health';

/** Cloudflare account and tunnel that route workbook.myrlin.dev. */
const CF_ACCOUNT_ID = 'b80ee074a084c8dcf7eb9053d04b20db';
const CF_TUNNEL_ID = 'b97ba90b-7451-4807-8434-d4b4412c7bcf';
const CF_API_HOST = 'api.cloudflare.com';
/** Credentials file holding the Cloudflare master token (never printed). */
const CREDENTIALS_FILE = path.join(os.homedir(), '.claude', 'credentials.md');

/** Where a manually started (detached) instance writes stdout/stderr. */
const SPAWN_LOG = path.join(REPO_ROOT, 'logs', 'restart-workbook-spawn.log');

/* Timeouts and polling intervals (ms). */
const PS_TIMEOUT_MS = 20000;             /* any single PowerShell call     */
const SCHTASKS_TIMEOUT_MS = 15000;       /* scheduled task listing         */
const HTTP_TIMEOUT_MS = 8000;            /* single local HTTP attempt      */
const PUBLIC_HTTP_TIMEOUT_MS = 15000;    /* single public HTTPS attempt    */
const CF_API_TIMEOUT_MS = 20000;         /* Cloudflare API call            */
const GRACEFUL_KILL_WAIT_MS = 4000;      /* wait after polite taskkill     */
const FORCE_KILL_WAIT_MS = 6000;         /* wait after Stop-Process -Force */
const PORT_RELEASE_TIMEOUT_MS = 20000;   /* wait for the port to free      */
const POLL_INTERVAL_MS = 500;            /* generic poll cadence           */
const WATCHDOG_RESPAWN_WAIT_MS = 45000;  /* watchdog polls every 10s plus  */
                                         /* a 4s probe timeout plus boot   */
const SUPERVISOR_RESPAWN_WAIT_MS = 20000;/* supervisor restarts in ~2s     */
const LOCAL_HEALTH_TIMEOUT_MS = 30000;   /* poll /api/health after start   */
const HEALTH_POLL_INTERVAL_MS = 1000;
const PUBLIC_RECHECK_TIMEOUT_MS = 90000; /* tunnel reconnect can be slow   */
const PUBLIC_RECHECK_INTERVAL_MS = 5000;
const ZOMBIE_GRACE_MS = 5000;            /* let racing spawns settle       */
const ANCESTOR_WALK_LIMIT = 15;          /* max parent hops for self check */

/** Cloudflare edge statuses that mean "connector wedged", not app error. */
const CONNECTOR_ERROR_CODES = [502, 504, 520, 522, 524, 530];

/* Exit codes (documented in the header). */
const EXIT_OK = 0;
const EXIT_UNEXPECTED = 1;
const EXIT_CONFIG = 2;
const EXIT_STOP_FAILED = 3;
const EXIT_START_FAILED = 4;
const EXIT_TUNNEL_READ = 5;
const EXIT_TUNNEL_REPAIR = 6;
const EXIT_NEEDS_ELEVATION = 7;
const EXIT_PUBLIC_UNHEALTHY = 8;
const EXIT_CHECK_UNHEALTHY = 9;

/** Secrets registered here are scrubbed from every log line. */
const SECRETS = [];

/* ===================== Logging helpers ===================== */

/**
 * Scrub known secrets and token-shaped substrings from a string before
 * it is logged. Applied to every log line so a Cloudflare token can
 * never leak even via an error message or a process command line.
 * @param {string} text
 * @returns {string}
 */
function scrub(text) {
  let out = String(text);
  for (const secret of SECRETS) {
    if (secret && secret.length >= 8) {
      out = out.split(secret).join('<REDACTED>');
    }
  }
  /* Defense in depth: mask JWT-shaped and token flag values. */
  out = out.replace(/eyJ[A-Za-z0-9_\-.]{20,}/g, '<REDACTED>');
  out = out.replace(/(token[=\s]+)[A-Za-z0-9_\-.]{25,}/gi, '$1<REDACTED>');
  return out;
}

/**
 * Structured log line with timestamp and stage tag.
 * @param {string} stage - Short stage marker, for example 'STOP'.
 * @param {string} msg - Human readable message.
 */
function log(stage, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  process.stdout.write('[restart-workbook ' + ts + '] [' + stage + '] ' + scrub(msg) + '\n');
}

/**
 * Print a visual stage banner so long runs are easy to scan.
 * @param {string} title
 */
function banner(title) {
  const line = '='.repeat(64);
  process.stdout.write('\n' + line + '\n  ' + title + '\n' + line + '\n');
}

/**
 * Async sleep helper used by every polling loop.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ===================== Shell helpers ===================== */

/**
 * Run a PowerShell snippet and return trimmed stdout. All snippets in
 * this script use single-quoted PowerShell strings so no fragile
 * double-quote escaping crosses the process boundary. Never throws:
 * returns null on failure or timeout so callers can degrade gracefully.
 * @param {string} script - PowerShell source.
 * @param {number} [timeoutMs]
 * @returns {string|null}
 */
function runPowerShell(script, timeoutMs) {
  const res = spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', timeout: timeoutMs || PS_TIMEOUT_MS, windowsHide: true });
  if (res.error) {
    log('PS', 'PowerShell invocation failed: ' + res.error.message);
    return null;
  }
  if (typeof res.stdout !== 'string') return null;
  return res.stdout.trim();
}

/**
 * Tolerant JSON parse that accepts null/empty input and normalizes a
 * single object into a one-element array when asList is true (works
 * around PowerShell serializing single results as bare objects).
 * @param {string|null} text
 * @param {boolean} [asList]
 * @returns {any}
 */
function parseJsonLoose(text, asList) {
  if (!text) return asList ? [] : null;
  try {
    const parsed = JSON.parse(text);
    if (asList) return Array.isArray(parsed) ? parsed : [parsed];
    return parsed;
  } catch (err) {
    log('PS', 'Could not parse PowerShell JSON output: ' + err.message);
    return asList ? [] : null;
  }
}

/* ===================== HTTP helpers ===================== */

/**
 * Minimal promise wrapper over http/https.request with a hard timeout.
 * Never rejects: resolves { ok, status, body, error } so polling loops
 * stay simple and no failure path is silently swallowed.
 * @param {object} opts - { protocol, host, port, path, method, headers, body, timeoutMs }
 * @returns {Promise<{ok:boolean,status:number|null,body:string,error:string|null}>}
 */
function httpRequest(opts) {
  return new Promise((resolve) => {
    const lib = opts.protocol === 'https' ? https : http;
    const req = lib.request({
      host: opts.host,
      port: opts.port,
      path: opts.path,
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({ ok: true, status: res.statusCode, headers: res.headers || {}, body: Buffer.concat(chunks).toString('utf8'), error: null });
      });
    });
    req.setTimeout(opts.timeoutMs || HTTP_TIMEOUT_MS, () => {
      req.destroy(new Error('timeout after ' + (opts.timeoutMs || HTTP_TIMEOUT_MS) + 'ms'));
    });
    req.on('error', (err) => {
      resolve({ ok: false, status: null, headers: {}, body: '', error: err.message });
    });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/**
 * GET the local health endpoint once.
 * @param {number} port
 * @returns {Promise<{healthy:boolean,status:number|null,error:string|null}>}
 */
async function checkLocalHealth(port) {
  const res = await httpRequest({ protocol: 'http', host: LOCAL_HOST, port, path: HEALTH_PATH });
  return { healthy: res.ok && res.status === 200, status: res.status, error: res.error };
}

/**
 * GET the public health endpoint once over HTTPS and classify the
 * result. workbook.myrlin.dev sits behind Cloudflare Access, so an
 * unauthenticated probe normally receives a 302 to
 * <team>.cloudflareaccess.com. That proves DNS plus the Cloudflare
 * edge plus the Access policy, but NOT the tunnel connector (Access
 * intercepts before the origin fetch), so redirect results are paired
 * with a Cloudflare API connector check by the caller.
 *   healthy:          HTTP 200 straight through (full end to end).
 *   accessRedirect:   3xx whose Location is a cloudflareaccess.com
 *                     login (edge healthy, connector unproven).
 *   connectorSuspect: network error or a Cloudflare origin-failure
 *                     status (502/504/520/522/524/530).
 * @param {string} host - Public hostname.
 * @returns {Promise<{healthy:boolean,status:number|null,error:string|null,connectorSuspect:boolean,accessRedirect:boolean}>}
 */
async function checkPublicHealth(host) {
  const res = await httpRequest({
    protocol: 'https', host, port: 443, path: HEALTH_PATH,
    headers: { 'User-Agent': 'myrlin-restart-workbook' },
    timeoutMs: PUBLIC_HTTP_TIMEOUT_MS,
  });
  const location = (res.headers && res.headers.location) || '';
  const accessRedirect = res.ok && res.status >= 300 && res.status < 400 &&
    /cloudflareaccess\.com/i.test(location);
  const connectorSuspect = (!res.ok) || CONNECTOR_ERROR_CODES.indexOf(res.status) !== -1;
  return { healthy: res.ok && res.status === 200, status: res.status, error: res.error, connectorSuspect, accessRedirect };
}

/**
 * Read-only Cloudflare API check of the tunnel connector: fetches the
 * tunnel details (status: healthy/degraded/inactive/down) plus the
 * live connection list. This is the authoritative origin-side signal
 * when Cloudflare Access hides the origin from unauthenticated probes.
 * @param {string} token - Bearer token.
 * @returns {Promise<{status:string|null, connections:number, error:string|null}>}
 */
async function fetchTunnelConnectorStatus(token) {
  const detail = await cfApi('GET', '/accounts/' + CF_ACCOUNT_ID + '/cfd_tunnel/' + CF_TUNNEL_ID, token);
  if (detail.error) return { status: null, connections: 0, error: detail.error };
  if (!detail.json || detail.json.success !== true) {
    return { status: null, connections: 0, error: 'tunnel detail fetch failed (HTTP ' + detail.status + ')' };
  }
  const status = (detail.json.result && detail.json.result.status) || null;
  let connections = 0;
  const conns = await cfApi('GET', '/accounts/' + CF_ACCOUNT_ID + '/cfd_tunnel/' + CF_TUNNEL_ID + '/connections', token);
  if (!conns.error && conns.json && conns.json.success === true && Array.isArray(conns.json.result)) {
    for (const connector of conns.json.result) {
      if (Array.isArray(connector.conns)) connections += connector.conns.length;
      else connections += 1;
    }
  }
  return { status, connections, error: null };
}

/* ===================== Process discovery ===================== */

/**
 * Find the PID(s) currently LISTENing on a local port. Returns a
 * deduplicated array of PIDs (empty when nothing is bound). PID 0 rows
 * are filtered out (they are TIME_WAIT artifacts, not real owners).
 * @param {number} port
 * @returns {number[]}
 */
function findPortOwners(port) {
  const out = runPowerShell(
    'Get-NetTCPConnection -LocalPort ' + port + ' -State Listen -ErrorAction SilentlyContinue | ' +
    'Select-Object -ExpandProperty OwningProcess -Unique');
  if (!out) return [];
  const pids = [];
  for (const line of out.split(/\r?\n/)) {
    const n = parseInt(line.trim(), 10);
    if (Number.isFinite(n) && n > 0 && pids.indexOf(n) === -1) pids.push(n);
  }
  return pids;
}

/**
 * Fetch identifying details for one PID via CIM. Returns null when the
 * process does not exist (also the "is it gone yet" primitive for kill
 * polling). createdMs is UTC epoch milliseconds for race-window checks.
 * @param {number} pid
 * @returns {{procId:number,parentPid:number,name:string,cmd:string,createdMs:number}|null}
 */
function getProcessInfo(pid) {
  const script =
    "$p = Get-CimInstance Win32_Process -Filter 'ProcessId=" + pid + "' -ErrorAction SilentlyContinue; " +
    'if ($p) { ' +
    "$epoch = 0; if ($p.CreationDate) { $epoch = [long]((($p.CreationDate.ToUniversalTime()) - [datetime]'1970-01-01').TotalMilliseconds) }; " +
    '$o = @{ procId = [int]$p.ProcessId; parentPid = [int]$p.ParentProcessId; name = [string]$p.Name; cmd = [string]$p.CommandLine; createdMs = $epoch }; ' +
    'ConvertTo-Json -InputObject $o -Compress }';
  return parseJsonLoose(runPowerShell(script), false);
}

/**
 * Find every node process whose command line mentions a given script
 * fragment (for example 'watchdog.js' or 'gui.js'). Uses Where-Object
 * instead of a CIM -Filter so no nested double quotes cross the
 * PowerShell boundary.
 * @param {string} fragment - Substring to match in the command line.
 * @returns {Array<{procId:number,parentPid:number,cmd:string,createdMs:number}>}
 */
function findNodeProcessesByCmd(fragment) {
  const safe = fragment.replace(/'/g, "''");
  const script =
    "$list = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*" + safe + "*' }); " +
    '$out = @(); foreach ($p in $list) { ' +
    "$epoch = 0; if ($p.CreationDate) { $epoch = [long]((($p.CreationDate.ToUniversalTime()) - [datetime]'1970-01-01').TotalMilliseconds) }; " +
    '$out += ,(@{ procId = [int]$p.ProcessId; parentPid = [int]$p.ParentProcessId; cmd = [string]$p.CommandLine; createdMs = $epoch }) }; ' +
    "if ($out.Count -eq 0) { '[]' } else { ConvertTo-Json -InputObject $out -Compress }";
  return parseJsonLoose(runPowerShell(script), true);
}

/**
 * List Myrlin-related Scheduled Tasks (read only, informational). Used
 * in the topology report so the operator knows a boot-time supervisor
 * task exists even when its process is not currently running.
 * @returns {string[]} Matching CSV lines, empty on any failure.
 */
function queryScheduledTasks() {
  const res = spawnSync('schtasks', ['/query', '/fo', 'csv'],
    { encoding: 'utf8', timeout: SCHTASKS_TIMEOUT_MS, windowsHide: true });
  if (res.error || typeof res.stdout !== 'string') return [];
  return res.stdout.split(/\r?\n/).filter((l) => /myrlin|workbook/i.test(l));
}

/**
 * Walk this script's own parent chain so we can refuse to kill an
 * ancestor. If the workbook is an ancestor (script launched from a
 * terminal INSIDE the workbook), killing it would kill this script
 * mid-restart; that is only survivable when a respawner exists.
 * @returns {number[]} PIDs of self and up to ANCESTOR_WALK_LIMIT ancestors.
 */
function getSelfAncestry() {
  const chain = [process.pid];
  let current = process.pid;
  for (let i = 0; i < ANCESTOR_WALK_LIMIT; i++) {
    const info = getProcessInfo(current);
    if (!info || !info.parentPid || info.parentPid <= 0) break;
    if (chain.indexOf(info.parentPid) !== -1) break;
    chain.push(info.parentPid);
    current = info.parentPid;
  }
  return chain;
}

/**
 * Discover the full process topology around the target port: the port
 * owner(s), each owner's parent (to detect a supervisor.js parent),
 * any running watchdog.js pollers, and Myrlin Scheduled Tasks.
 * @param {number} port
 * @returns {object} topology snapshot used by every later stage.
 */
function discoverTopology(port) {
  const owners = findPortOwners(port).map((pid) => {
    const info = getProcessInfo(pid) || { procId: pid, parentPid: 0, name: 'unknown', cmd: '', createdMs: 0 };
    let parent = null;
    if (info.parentPid > 0) parent = getProcessInfo(info.parentPid);
    return { info, parent };
  });
  const watchdogs = findNodeProcessesByCmd('watchdog.js');
  const supervisors = findNodeProcessesByCmd('supervisor.js');
  const tasks = queryScheduledTasks();
  return { port, owners, watchdogs, supervisors, tasks };
}

/**
 * Pretty-print the discovered topology with secrets scrubbed.
 * @param {object} topo - Result of discoverTopology().
 */
function logTopology(topo) {
  if (topo.owners.length === 0) {
    log('TOPO', 'No process is listening on port ' + topo.port + '.');
  }
  for (const o of topo.owners) {
    log('TOPO', 'Port ' + topo.port + ' owner: PID ' + o.info.procId + ' (' + o.info.name + ') cmd: ' + (o.info.cmd || '<unavailable>'));
    if (o.parent) {
      log('TOPO', '  parent: PID ' + o.parent.procId + ' (' + o.parent.name + ') cmd: ' + (o.parent.cmd || '<unavailable>'));
    } else {
      log('TOPO', '  parent: PID ' + o.info.parentPid + ' no longer exists (owner is orphaned/detached)');
    }
  }
  if (topo.watchdogs.length > 0) {
    for (const w of topo.watchdogs) log('TOPO', 'Watchdog running: PID ' + w.procId + ' cmd: ' + w.cmd);
  } else {
    log('TOPO', 'No watchdog.js process found.');
  }
  if (topo.supervisors.length > 0) {
    for (const s of topo.supervisors) log('TOPO', 'Supervisor running: PID ' + s.procId + ' cmd: ' + s.cmd);
  } else {
    log('TOPO', 'No supervisor.js process found.');
  }
  if (topo.tasks.length > 0) {
    for (const t of topo.tasks) log('TOPO', 'Scheduled task: ' + t);
  }
}

/**
 * Decide which respawner (if any) will bring the workbook back after
 * we kill the port owner.
 *   supervisor: the owner's live parent runs supervisor.js; it respawns
 *               its child within ~2s regardless of port.
 *   watchdog:   a watchdog.js poller is running. It only guards the
 *               LIVE port (3457 by default; its own WORKBOOK_PORT env
 *               is not inspectable), so it only counts when the target
 *               port IS the live port.
 *   none:       this script must start the replacement itself.
 * @param {object} topo
 * @returns {{kind:'supervisor'|'watchdog'|'none', waitMs:number, detail:string}}
 */
function classifyRespawner(topo) {
  for (const o of topo.owners) {
    if (o.parent && /supervisor\.js/i.test(o.parent.cmd || '')) {
      return {
        kind: 'supervisor',
        waitMs: SUPERVISOR_RESPAWN_WAIT_MS,
        detail: 'supervisor.js PID ' + o.parent.procId + ' parents the port owner and respawns on child exit',
      };
    }
  }
  if (topo.watchdogs.length > 0 && topo.port === LIVE_PORT) {
    return {
      kind: 'watchdog',
      waitMs: WATCHDOG_RESPAWN_WAIT_MS,
      detail: 'watchdog.js PID ' + topo.watchdogs[0].procId + ' polls port ' + LIVE_PORT + ' every 10s and respawns gui.js when it stops answering',
    };
  }
  if (topo.watchdogs.length > 0) {
    return {
      kind: 'none',
      waitMs: 0,
      detail: 'a watchdog.js is running but it guards port ' + LIVE_PORT + ', not target port ' + topo.port + '; manual start required',
    };
  }
  return { kind: 'none', waitMs: 0, detail: 'no supervisor parent and no watchdog; manual start required' };
}

/* ===================== Stop / start ===================== */

/**
 * Kill exactly one PID: polite taskkill first (lets a windowed process
 * close cleanly), then Stop-Process -Id -Force. Polls until the process
 * is really gone. NEVER kills by name and NEVER kills a process tree,
 * so PTY children (which may host other Claude Code sessions) survive.
 * @param {number} pid
 * @returns {Promise<boolean>} true when the process is confirmed gone.
 */
async function killPid(pid) {
  log('STOP', 'Sending polite taskkill to PID ' + pid + '...');
  spawnSync('taskkill', ['/PID', String(pid)], { encoding: 'utf8', timeout: PS_TIMEOUT_MS, windowsHide: true });
  const politeDeadline = Date.now() + GRACEFUL_KILL_WAIT_MS;
  while (Date.now() < politeDeadline) {
    if (!getProcessInfo(pid)) { log('STOP', 'PID ' + pid + ' exited after polite kill.'); return true; }
    await sleep(POLL_INTERVAL_MS);
  }
  log('STOP', 'PID ' + pid + ' still alive; forcing with Stop-Process -Id ' + pid + ' -Force...');
  const out = runPowerShell(
    "try { Stop-Process -Id " + pid + " -Force -ErrorAction Stop; 'OK' } catch { 'ERR: ' + $_.Exception.Message }");
  if (out && out.indexOf('ERR:') === 0) log('STOP', 'Stop-Process reported: ' + out);
  const forceDeadline = Date.now() + FORCE_KILL_WAIT_MS;
  while (Date.now() < forceDeadline) {
    if (!getProcessInfo(pid)) { log('STOP', 'PID ' + pid + ' confirmed gone.'); return true; }
    await sleep(POLL_INTERVAL_MS);
  }
  return !getProcessInfo(pid);
}

/**
 * After killing the owner, wait for the port to actually change state.
 * Distinguishes three outcomes because a respawner may re-bind faster
 * than we poll:
 *   'free'         the port is unbound (safe to start a replacement),
 *   'rebound'      a NEW pid owns the port (a respawner already won),
 *   'stuck'        the OLD pid still owns it after the timeout.
 * @param {number} port
 * @param {number[]} oldPids - PIDs we killed.
 * @returns {Promise<{state:'free'|'rebound'|'stuck', pid:number|null}>}
 */
async function waitPortReleased(port, oldPids) {
  const deadline = Date.now() + PORT_RELEASE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const owners = findPortOwners(port);
    if (owners.length === 0) return { state: 'free', pid: null };
    const fresh = owners.filter((p) => oldPids.indexOf(p) === -1);
    if (fresh.length > 0) return { state: 'rebound', pid: fresh[0] };
    await sleep(POLL_INTERVAL_MS);
  }
  const finalOwners = findPortOwners(port);
  if (finalOwners.length === 0) return { state: 'free', pid: null };
  const fresh = finalOwners.filter((p) => oldPids.indexOf(p) === -1);
  if (fresh.length > 0) return { state: 'rebound', pid: fresh[0] };
  return { state: 'stuck', pid: finalOwners[0] };
}

/**
 * Start a detached workbook instance the canonical way: the same shape
 * the watchdog and the boot Scheduled Task use ("node gui.js" with
 * PORT in env, cwd at the repo root). Uses the cmd.exe "start /b"
 * pattern proven by src/supervisor.js daemon mode, because a plain
 * detached spawn still shares the launching console's Job Object on
 * Windows and dies with it. CWM_NO_OPEN=1 so a restart never pops a
 * browser. The rest of process.env is inherited on purpose: a test
 * invocation passes CWM_DATA_DIR/CWM_PASSWORD through to the child,
 * and a real invocation (no overrides) yields the real ~/.myrlin data.
 * @param {number} port
 * @returns {void} Throws on spawn failure.
 */
function startDetached(port) {
  const logDir = path.dirname(SPAWN_LOG);
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const cmdLine = 'start "" /b "' + NODE_EXE + '" --max-old-space-size=' + NODE_HEAP_MB +
    ' "' + GUI_SCRIPT + '" >> "' + SPAWN_LOG + '" 2>&1';
  log('START', 'Spawning detached workbook: node gui.js (PORT=' + port + ', CWM_NO_OPEN=1, cwd=' + REPO_ROOT + ')');
  log('START', 'Child output appends to ' + SPAWN_LOG);
  execSync(cmdLine, {
    cwd: REPO_ROOT,
    env: Object.assign({}, process.env, { PORT: String(port), CWM_NO_OPEN: '1' }),
    windowsHide: true,
    stdio: 'ignore',
    timeout: PS_TIMEOUT_MS,
  });
}

/**
 * Poll the local health endpoint until it answers 200 or the deadline
 * passes. Logs progress once per second so a slow boot is visible.
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function waitForHealthy(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    const h = await checkLocalHealth(port);
    if (h.healthy) {
      log('VERIFY', 'Local health OK on attempt ' + attempt + ' (HTTP 200 from ' + LOCAL_HOST + ':' + port + HEALTH_PATH + ')');
      return true;
    }
    log('VERIFY', 'Waiting for health... attempt ' + attempt + ' (' + (h.status !== null ? 'HTTP ' + h.status : h.error) + ')');
    await sleep(HEALTH_POLL_INTERVAL_MS);
  }
  return false;
}

/**
 * Post-restart hygiene: find gui.js processes that were created after
 * this script started, are NOT the healthy port owner, and are still
 * alive after a grace period. These are losers of a respawner race
 * (gui.js swallows EADDRINUSE via its uncaughtException handler and
 * can linger without a listener). Only processes born inside our
 * restart window are touched, so pre-existing instances on other
 * ports (for example a test instance) are never harmed.
 * @param {number} sinceMs - Epoch ms when this script started.
 * @param {number} keepPid - The healthy new owner to preserve.
 * @param {number} port - Target port (for the final ownership check).
 * @returns {Promise<number[]>} PIDs reaped.
 */
async function reapZombieGuis(sinceMs, keepPid, port) {
  await sleep(ZOMBIE_GRACE_MS);
  const candidates = findNodeProcessesByCmd('gui.js')
    .filter((p) => p.procId !== keepPid && p.createdMs > sinceMs);
  if (candidates.length === 0) {
    log('REAP', 'No duplicate gui.js processes from the restart window. Clean.');
    return [];
  }
  const owners = findPortOwners(port);
  const reaped = [];
  for (const c of candidates) {
    if (owners.indexOf(c.procId) !== -1) continue; /* never reap a listener */
    log('REAP', 'Duplicate gui.js from restart window detected: PID ' + c.procId + ' cmd: ' + c.cmd);
    const gone = await killPid(c.procId);
    if (gone) reaped.push(c.procId);
    else log('REAP', 'WARNING: could not reap PID ' + c.procId + '; kill it manually.');
  }
  return reaped;
}

/* ===================== Cloudflare tunnel ===================== */

/**
 * Resolve the Cloudflare API token: env CLOUDFLARE_API_TOKEN first,
 * then the master token parsed from ~/.claude/credentials.md (section
 * heading contains "Cloudflare MASTER token", token on a following
 * line as "Token: `...`"). The token is registered for log scrubbing
 * and is never printed.
 * @returns {{token:string|null, source:string, fileToken:string|null}}
 */
function resolveCloudflareToken() {
  let fileToken = null;
  try {
    const text = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
    const m = text.match(/Cloudflare MASTER token[\s\S]{0,400}?Token:\s*`([^`]+)`/i);
    if (m) fileToken = m[1].trim();
  } catch (err) {
    log('TUNNEL', 'Could not read credentials file: ' + err.message);
  }
  if (fileToken) SECRETS.push(fileToken);
  const envToken = (process.env.CLOUDFLARE_API_TOKEN || '').trim() || null;
  if (envToken) {
    SECRETS.push(envToken);
    return { token: envToken, source: 'env CLOUDFLARE_API_TOKEN', fileToken };
  }
  if (fileToken) {
    return { token: fileToken, source: 'credentials.md master token', fileToken };
  }
  return { token: null, source: 'none', fileToken: null };
}

/**
 * Call the Cloudflare v4 API. Returns parsed JSON plus HTTP status.
 * @param {string} method - GET or PUT.
 * @param {string} apiPath - Path under /client/v4.
 * @param {string} token - Bearer token (scrubbed from logs).
 * @param {object} [body] - JSON body for PUT.
 * @returns {Promise<{status:number|null, json:any, error:string|null}>}
 */
async function cfApi(method, apiPath, token, body) {
  const res = await httpRequest({
    protocol: 'https', host: CF_API_HOST, port: 443,
    path: '/client/v4' + apiPath,
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      'User-Agent': 'myrlin-restart-workbook',
    },
    body: body ? JSON.stringify(body) : undefined,
    timeoutMs: CF_API_TIMEOUT_MS,
  });
  if (!res.ok) return { status: null, json: null, error: res.error };
  let json = null;
  try { json = JSON.parse(res.body); } catch (err) { return { status: res.status, json: null, error: 'bad JSON: ' + err.message }; }
  return { status: res.status, json, error: null };
}

/**
 * GET the tunnel's remote configuration. If the first token is refused
 * (401/403) and a different credentials-file token exists, retries once
 * with it (covers an ambient CLOUDFLARE_API_TOKEN scoped to another
 * project that lacks tunnel permissions).
 * @param {{token:string,source:string,fileToken:string|null}} tok
 * @returns {Promise<{config:any|null, tokenUsed:string|null, error:string|null}>}
 */
async function fetchTunnelConfig(tok) {
  const apiPath = '/accounts/' + CF_ACCOUNT_ID + '/cfd_tunnel/' + CF_TUNNEL_ID + '/configurations';
  let res = await cfApi('GET', apiPath, tok.token);
  let tokenUsed = tok.token;
  if (res.status === 401 || res.status === 403) {
    log('TUNNEL', 'Token from ' + tok.source + ' was refused (HTTP ' + res.status + ').');
    if (tok.fileToken && tok.fileToken !== tok.token) {
      log('TUNNEL', 'Retrying with the credentials.md master token...');
      res = await cfApi('GET', apiPath, tok.fileToken);
      tokenUsed = tok.fileToken;
    }
  }
  if (res.error) return { config: null, tokenUsed: null, error: res.error };
  if (!res.json || res.json.success !== true) {
    const errs = res.json && res.json.errors ? JSON.stringify(res.json.errors) : ('HTTP ' + res.status);
    return { config: null, tokenUsed: null, error: 'Cloudflare API error: ' + errs };
  }
  const config = res.json.result ? res.json.result.config : null;
  if (!config || !Array.isArray(config.ingress)) {
    return { config: null, tokenUsed: null, error: 'Tunnel has no remotely managed ingress config (config was null). It may be locally managed; aborting tunnel stage.' };
  }
  return { config, tokenUsed, error: null };
}

/**
 * Evaluate the ingress rules against the expected mapping. Reports
 * every hostname to service pair (for the summary), whether the
 * workbook rule is present and correct, and whether the required
 * catch-all http_status:404 terminator exists.
 * @param {object} config - Tunnel config with .ingress array.
 * @param {string} hostname - Public hostname to check.
 * @param {string} expectedService - Required service value.
 * @returns {{ok:boolean, ruleIndex:number, currentService:string|null, problems:string[], pairs:string[]}}
 */
function evaluateIngress(config, hostname, expectedService) {
  const ingress = config.ingress;
  const pairs = [];
  let ruleIndex = -1;
  let currentService = null;
  for (let i = 0; i < ingress.length; i++) {
    const r = ingress[i];
    pairs.push((r.hostname || '<catch-all>') + ' -> ' + (r.service || '<none>'));
    if (r.hostname && r.hostname.toLowerCase() === hostname.toLowerCase() && ruleIndex === -1) {
      ruleIndex = i;
      currentService = r.service || null;
    }
  }
  const problems = [];
  if (ruleIndex === -1) {
    problems.push('No ingress rule for ' + hostname + '.');
  } else if (currentService !== expectedService) {
    problems.push('Rule for ' + hostname + ' maps to "' + currentService + '" but must be "' + expectedService + '".');
    if (/localhost/i.test(currentService || '')) {
      problems.push('("localhost" resolves to IPv6 ::1 while the server binds IPv4 ' + LOCAL_HOST + '; this exact mismatch caused a real 524.)');
    }
  }
  const last = ingress[ingress.length - 1];
  const hasCatchAll = last && !last.hostname && typeof last.service === 'string' && last.service.indexOf('http_status:') === 0;
  if (!hasCatchAll) problems.push('Final catch-all http_status rule is missing.');
  return { ok: problems.length === 0, ruleIndex, currentService, problems, pairs };
}

/**
 * Build a repaired copy of the tunnel config. Only the workbook rule
 * is touched: fixed in place when present, inserted before the
 * catch-all when missing. Every other rule is preserved byte for byte,
 * and the catch-all terminator is appended if absent. Returns the new
 * config plus a human diff of exactly what changed.
 * @param {object} config
 * @param {string} hostname
 * @param {string} expectedService
 * @returns {{config:object, diff:string[]}}
 */
function buildRepairedConfig(config, hostname, expectedService) {
  const clone = JSON.parse(JSON.stringify(config));
  const ingress = clone.ingress;
  const diff = [];
  let idx = -1;
  for (let i = 0; i < ingress.length; i++) {
    const r = ingress[i];
    if (r.hostname && r.hostname.toLowerCase() === hostname.toLowerCase()) { idx = i; break; }
  }
  if (idx !== -1) {
    diff.push(hostname + ': "' + ingress[idx].service + '" changes to "' + expectedService + '"');
    ingress[idx].service = expectedService;
  } else {
    const rule = { hostname, service: expectedService };
    const last = ingress[ingress.length - 1];
    const hasCatchAll = last && !last.hostname;
    if (hasCatchAll) ingress.splice(ingress.length - 1, 0, rule);
    else ingress.push(rule);
    diff.push(hostname + ': rule inserted with service "' + expectedService + '"');
  }
  const newLast = ingress[ingress.length - 1];
  if (!(newLast && !newLast.hostname && typeof newLast.service === 'string' && newLast.service.indexOf('http_status:') === 0)) {
    ingress.push({ service: 'http_status:404' });
    diff.push('catch-all http_status:404 appended');
  }
  return { config: clone, diff };
}

/**
 * PUT the repaired config back to Cloudflare and verify by re-fetching.
 * Only called on a real run (never in dry-run or check mode).
 * @param {object} newConfig
 * @param {string} token
 * @param {string} hostname
 * @param {string} expectedService
 * @returns {Promise<{ok:boolean, error:string|null}>}
 */
async function repairTunnel(newConfig, token, hostname, expectedService) {
  const apiPath = '/accounts/' + CF_ACCOUNT_ID + '/cfd_tunnel/' + CF_TUNNEL_ID + '/configurations';
  const res = await cfApi('PUT', apiPath, token, { config: newConfig });
  if (res.error) return { ok: false, error: res.error };
  if (!res.json || res.json.success !== true) {
    const errs = res.json && res.json.errors ? JSON.stringify(res.json.errors) : ('HTTP ' + res.status);
    return { ok: false, error: 'PUT rejected: ' + errs };
  }
  const verify = await fetchTunnelConfig({ token, source: 'repair-verify', fileToken: null });
  if (verify.error) return { ok: false, error: 'PUT accepted but re-fetch failed: ' + verify.error };
  const evalAfter = evaluateIngress(verify.config, hostname, expectedService);
  if (!evalAfter.ok) return { ok: false, error: 'PUT accepted but config still wrong: ' + evalAfter.problems.join(' ') };
  return { ok: true, error: null };
}

/* ===================== cloudflared service ===================== */

/**
 * Check whether this script runs elevated (needed to bounce the
 * cloudflared Windows service).
 * @returns {boolean}
 */
function isElevated() {
  const out = runPowerShell(
    '(New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)');
  return out === 'True';
}

/**
 * Report the state of the cloudflared Windows service.
 * @returns {string} Status text, or 'ABSENT' when no such service.
 */
function cloudflaredServiceStatus() {
  const out = runPowerShell(
    "$s = Get-Service -Name cloudflared -ErrorAction SilentlyContinue; if ($s) { $s.Status.ToString() } else { 'ABSENT' }");
  return out || 'UNKNOWN';
}

/**
 * Restart the cloudflared service (requires elevation). Returns the
 * outcome so the caller can decide the exit code.
 * @returns {{ok:boolean, message:string}}
 */
function bounceCloudflared() {
  const out = runPowerShell(
    "try { Restart-Service -Name cloudflared -Force -ErrorAction Stop; 'OK' } catch { 'ERR: ' + $_.Exception.Message }",
    60000);
  if (out === 'OK') return { ok: true, message: 'cloudflared service restarted.' };
  return { ok: false, message: 'Restart-Service failed: ' + (out || 'no output') };
}

/* ===================== CLI parsing ===================== */

/**
 * Parse CLI flags and env into a config object. Exits with EXIT_CONFIG
 * on malformed input so nothing downstream sees a bad value.
 * @param {string[]} argv
 * @returns {object}
 */
function parseArgs(argv) {
  const cfg = {
    port: DEFAULT_PORT,
    publicHost: process.env.WORKBOOK_PUBLIC_HOST || DEFAULT_PUBLIC_HOST,
    check: false,
    dryRun: false,
    noTunnel: false,
    noReap: false,
    help: false,
  };
  const envPort = parseInt(process.env.WORKBOOK_PORT, 10);
  if (Number.isFinite(envPort) && envPort > 0) cfg.port = envPort;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') cfg.check = true;
    else if (a === '--dry-run') cfg.dryRun = true;
    else if (a === '--no-tunnel') cfg.noTunnel = true;
    else if (a === '--no-reap') cfg.noReap = true;
    else if (a === '--help' || a === '-h') cfg.help = true;
    else if (a === '--port') {
      const n = parseInt(argv[++i], 10);
      if (!Number.isFinite(n) || n <= 0 || n > 65535) {
        log('CONFIG', 'Invalid --port value: ' + argv[i]);
        process.exit(EXIT_CONFIG);
      }
      cfg.port = n;
    } else {
      log('CONFIG', 'Unknown flag: ' + a + ' (use --help)');
      process.exit(EXIT_CONFIG);
    }
  }
  return cfg;
}

/**
 * Print usage extracted from intent (kept short; the file header holds
 * the full documentation).
 */
function printHelp() {
  process.stdout.write([
    'Usage: node scripts/restart-workbook.js [flags]',
    '',
    '  --check       Status report only, no changes. Exit 0 healthy, 9 not.',
    '  --dry-run     Read-only rehearsal; narrates what a real run would do.',
    '  --no-tunnel   Skip Cloudflare tunnel and public URL stages.',
    '  --no-reap     Skip duplicate-instance cleanup after restart.',
    '  --port <n>    Target port (default 3457; env WORKBOOK_PORT).',
    '  --help        This text.',
    '',
    'Env: WORKBOOK_PORT, WORKBOOK_PUBLIC_HOST, CLOUDFLARE_API_TOKEN',
    'Exit codes: 0 ok, 2 config, 3 stop failed, 4 start failed,',
    '            5 tunnel read, 6 tunnel repair, 7 needs admin for',
    '            cloudflared bounce, 8 public still down, 9 check unhealthy.',
    '',
  ].join('\n'));
}

/* ===================== Stage runners ===================== */

/**
 * Run the tunnel verification stage (GET + compare). Repair behavior
 * depends on mode: real runs PUT the fix, dry-run and check only log.
 * @param {object} cfg - Parsed CLI config.
 * @param {object} summary - Mutable summary object for the final report.
 * @param {boolean} allowWrite - true only for a real run.
 * @returns {Promise<{exit:number|null, tokenUsed:string|null}>} exit is an
 *          exit code on fatal failure, else null; tokenUsed lets the
 *          public stage reuse the working token for connector checks.
 */
async function runTunnelStage(cfg, summary, allowWrite) {
  banner('STAGE: Cloudflare tunnel ingress (' + cfg.publicHost + ')');
  const expectedService = 'http://' + LOCAL_HOST + ':' + cfg.port;
  const tok = resolveCloudflareToken();
  if (!tok.token) {
    log('TUNNEL', 'ERROR: no Cloudflare API token. Set CLOUDFLARE_API_TOKEN or ensure the master token exists in ' + CREDENTIALS_FILE);
    summary.tunnel = 'NO TOKEN';
    return { exit: EXIT_CONFIG, tokenUsed: null };
  }
  log('TUNNEL', 'Using token from ' + tok.source + ' (value redacted).');
  const fetched = await fetchTunnelConfig(tok);
  if (fetched.error) {
    log('TUNNEL', 'ERROR: ' + fetched.error);
    summary.tunnel = 'READ FAILED';
    return { exit: EXIT_TUNNEL_READ, tokenUsed: null };
  }
  const evalRes = evaluateIngress(fetched.config, cfg.publicHost, expectedService);
  log('TUNNEL', 'Current ingress rules:');
  for (const p of evalRes.pairs) log('TUNNEL', '  ' + p);
  if (evalRes.ok) {
    log('TUNNEL', 'OK: ' + cfg.publicHost + ' already maps to ' + expectedService + ' and the catch-all is present.');
    summary.tunnel = 'OK (no repair needed)';
    return { exit: null, tokenUsed: fetched.tokenUsed };
  }
  for (const prob of evalRes.problems) log('TUNNEL', 'PROBLEM: ' + prob);
  const repaired = buildRepairedConfig(fetched.config, cfg.publicHost, expectedService);
  for (const d of repaired.diff) log('TUNNEL', 'Planned change: ' + d);
  if (!allowWrite) {
    log('TUNNEL', (cfg.dryRun ? 'DRY RUN' : 'CHECK') + ': would PUT the repaired config. Nothing sent.');
    summary.tunnel = 'NEEDS REPAIR (not applied in this mode)';
    return { exit: null, tokenUsed: fetched.tokenUsed };
  }
  log('TUNNEL', 'Applying repair via PUT...');
  const put = await repairTunnel(repaired.config, fetched.tokenUsed, cfg.publicHost, expectedService);
  if (!put.ok) {
    log('TUNNEL', 'ERROR: ' + put.error);
    summary.tunnel = 'REPAIR FAILED';
    return { exit: EXIT_TUNNEL_REPAIR, tokenUsed: fetched.tokenUsed };
  }
  log('TUNNEL', 'Repair verified: ' + cfg.publicHost + ' now maps to ' + expectedService);
  summary.tunnel = 'REPAIRED';
  return { exit: null, tokenUsed: fetched.tokenUsed };
}

/**
 * Run the public URL verification stage, including the cloudflared
 * bounce path when the connector looks wedged.
 * Signals combined (the hostname is behind Cloudflare Access, so an
 * unauthenticated 200 is usually impossible):
 *   1. Edge probe: 200 means fully verified end to end. A 3xx to
 *      cloudflareaccess.com means the edge and Access are healthy.
 *   2. Connector: Cloudflare API tunnel status plus live connection
 *      count (read only). This is what actually proves cloudflared,
 *      because Access answers redirects even when the connector is dead.
 * @param {object} cfg
 * @param {object} summary
 * @param {boolean} allowWrite - true only for a real run.
 * @param {string|null} token - Working Cloudflare token from the tunnel stage.
 * @returns {Promise<number|null>} Exit code on failure needing caller exit, else null.
 */
async function runPublicStage(cfg, summary, allowWrite, token) {
  banner('STAGE: Public URL (https://' + cfg.publicHost + HEALTH_PATH + ')');
  let pub = await checkPublicHealth(cfg.publicHost);
  if (pub.healthy) {
    log('PUBLIC', 'OK: HTTP 200 from https://' + cfg.publicHost + HEALTH_PATH);
    summary.publicUrl = 'OK';
    return null;
  }
  let connectorSuspect = pub.connectorSuspect;
  if (pub.accessRedirect) {
    log('PUBLIC', 'Edge probe: HTTP ' + pub.status + ' redirect to the Cloudflare Access login. Edge and Access policy are healthy.');
    log('PUBLIC', 'Access hides the origin from unauthenticated probes; verifying the tunnel connector via the API instead...');
    if (token) {
      const conn = await fetchTunnelConnectorStatus(token);
      if (conn.error) {
        log('PUBLIC', 'WARNING: connector status check failed: ' + conn.error);
        summary.publicUrl = 'EDGE OK (Access-protected); connector status UNKNOWN';
        return null;
      }
      log('PUBLIC', 'Tunnel connector status: "' + conn.status + '" with ' + conn.connections + ' live connection(s).');
      if (conn.status === 'healthy' && conn.connections > 0) {
        summary.publicUrl = 'OK (Access-protected; edge healthy, connector healthy, ' + conn.connections + ' connection(s))';
        return null;
      }
      if (conn.status === 'degraded' && conn.connections > 0) {
        log('PUBLIC', 'Connector is degraded but has live connections; treating as up with a warning.');
        summary.publicUrl = 'OK-DEGRADED (Access-protected; connector degraded, ' + conn.connections + ' connection(s))';
        return null;
      }
      log('PUBLIC', 'Connector is not serving (status "' + conn.status + '", ' + conn.connections + ' connections).');
      connectorSuspect = true;
    } else {
      log('PUBLIC', 'No Cloudflare token available for the connector check; edge is healthy but the connector is unverified.');
      summary.publicUrl = 'EDGE OK (Access-protected); connector UNVERIFIED (no token)';
      return null;
    }
  } else {
    log('PUBLIC', 'Unhealthy: ' + (pub.status !== null ? 'HTTP ' + pub.status : pub.error));
  }
  if (!connectorSuspect) {
    summary.publicUrl = 'UNHEALTHY (HTTP ' + pub.status + ', not a connector code)';
    return allowWrite ? EXIT_PUBLIC_UNHEALTHY : null;
  }
  log('PUBLIC', 'Signals suggest the cloudflared connector is wedged.');
  const svc = cloudflaredServiceStatus();
  log('PUBLIC', 'cloudflared Windows service status: ' + svc);
  if (!allowWrite) {
    log('PUBLIC', (cfg.dryRun ? 'DRY RUN' : 'CHECK') + ': would bounce cloudflared (needs admin). Command:');
    log('PUBLIC', '  powershell -Command "Restart-Service cloudflared -Force"   (run as Administrator)');
    summary.publicUrl = 'UNHEALTHY (connector suspect; bounce not attempted in this mode)';
    return null;
  }
  if (svc === 'ABSENT') {
    log('PUBLIC', 'No cloudflared Windows service found. If cloudflared runs as a bare process or on another host, restart it there.');
    summary.publicUrl = 'UNHEALTHY (no local cloudflared service to bounce)';
    return EXIT_NEEDS_ELEVATION;
  }
  if (!isElevated()) {
    log('PUBLIC', 'MANUAL ACTION REQUIRED: this shell is not elevated. Run as Administrator:');
    log('PUBLIC', '  powershell -Command "Restart-Service cloudflared -Force"');
    log('PUBLIC', 'Then re-verify with: node scripts/restart-workbook.js --check');
    summary.publicUrl = 'UNHEALTHY (needs elevated cloudflared restart)';
    return EXIT_NEEDS_ELEVATION;
  }
  log('PUBLIC', 'Elevated: bouncing cloudflared service...');
  const bounce = bounceCloudflared();
  log('PUBLIC', bounce.message);
  if (!bounce.ok) {
    summary.publicUrl = 'UNHEALTHY (bounce failed)';
    return EXIT_PUBLIC_UNHEALTHY;
  }
  log('PUBLIC', 'Re-verifying for up to ' + (PUBLIC_RECHECK_TIMEOUT_MS / 1000) + 's (tunnel reconnect takes time)...');
  const deadline = Date.now() + PUBLIC_RECHECK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    pub = await checkPublicHealth(cfg.publicHost);
    if (pub.healthy) {
      log('PUBLIC', 'OK after bounce: HTTP 200.');
      summary.publicUrl = 'OK (after cloudflared bounce)';
      return null;
    }
    if (pub.accessRedirect && token) {
      const conn = await fetchTunnelConnectorStatus(token);
      if (!conn.error && conn.status === 'healthy' && conn.connections > 0) {
        log('PUBLIC', 'OK after bounce: edge Access-protected, connector healthy with ' + conn.connections + ' connection(s).');
        summary.publicUrl = 'OK (after cloudflared bounce; Access-protected, connector healthy)';
        return null;
      }
    }
    log('PUBLIC', 'Still waiting... (edge: ' + (pub.status !== null ? 'HTTP ' + pub.status : pub.error) + ')');
    await sleep(PUBLIC_RECHECK_INTERVAL_MS);
  }
  summary.publicUrl = 'STILL UNHEALTHY after bounce';
  return EXIT_PUBLIC_UNHEALTHY;
}

/**
 * Print the final summary block and return the process exit code.
 * @param {object} summary
 * @param {number} exitCode
 * @returns {number}
 */
function finish(summary, exitCode) {
  banner('SUMMARY');
  for (const key of Object.keys(summary)) {
    log('DONE', key + ': ' + summary[key]);
  }
  log('DONE', 'Exit code: ' + exitCode);
  return exitCode;
}

/* ===================== Main ===================== */

/**
 * Orchestrate the full restart pipeline. Mode selection:
 *   --check    stages: topology, local health, tunnel GET, public GET.
 *   --dry-run  same reads plus narration of every write it would do.
 *   (default)  stop, start (respawner-aware), verify, reap, tunnel,
 *              public, summary.
 * @returns {Promise<number>} Process exit code.
 */
async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.help) { printHelp(); return EXIT_OK; }
  if (process.platform !== 'win32') {
    log('CONFIG', 'This script is Windows-only (Get-NetTCPConnection / Stop-Process based). Run it on the Windows host that serves the workbook.');
    return EXIT_CONFIG;
  }

  const mode = cfg.check ? 'CHECK (read only)' : cfg.dryRun ? 'DRY RUN (read only)' : 'REAL RUN';
  banner('Myrlin Workbook restart tool');
  log('CONFIG', 'Mode: ' + mode);
  log('CONFIG', 'Target: http://' + LOCAL_HOST + ':' + cfg.port + '  public: https://' + cfg.publicHost + (cfg.noTunnel ? ' (tunnel stages SKIPPED via --no-tunnel)' : ''));
  log('CONFIG', 'Repo: ' + REPO_ROOT);
  if (process.env.CWM_DATA_DIR) log('CONFIG', 'CWM_DATA_DIR is set and will be inherited by any instance this script starts: ' + process.env.CWM_DATA_DIR);

  const scriptStartMs = Date.now();
  const summary = {
    mode,
    port: String(cfg.port),
    oldPid: 'n/a',
    newPid: 'n/a',
    localHealth: 'not checked',
    tunnel: cfg.noTunnel ? 'skipped (--no-tunnel)' : 'not checked',
    publicUrl: cfg.noTunnel ? 'skipped (--no-tunnel)' : 'not checked',
  };

  /* ==== Stage: topology ==== */
  banner('STAGE: Topology discovery (port ' + cfg.port + ')');
  const topo = discoverTopology(cfg.port);
  logTopology(topo);
  const respawner = classifyRespawner(topo);
  log('TOPO', 'Respawner: ' + respawner.kind + ' (' + respawner.detail + ')');
  const oldPids = topo.owners.map((o) => o.info.procId);
  summary.oldPid = oldPids.length > 0 ? oldPids.join(', ') : 'none (not running)';

  /* ==== Stage: pre health ==== */
  const pre = await checkLocalHealth(cfg.port);
  log('HEALTH', 'Local health before: ' + (pre.healthy ? 'OK (HTTP 200)' : (pre.status !== null ? 'HTTP ' + pre.status : String(pre.error))));

  /* ==== CHECK mode: report and exit ==== */
  if (cfg.check) {
    summary.localHealth = pre.healthy ? 'OK' : 'UNHEALTHY';
    let healthy = pre.healthy && oldPids.length === 1;
    if (oldPids.length > 1) log('CHECK', 'WARNING: multiple PIDs listen on port ' + cfg.port + ': ' + oldPids.join(', '));
    if (!cfg.noTunnel) {
      const tunnel = await runTunnelStage(cfg, summary, false);
      healthy = healthy && tunnel.exit === null && summary.tunnel.indexOf('OK') === 0;
      await runPublicStage(cfg, summary, false, tunnel.tokenUsed);
      healthy = healthy && summary.publicUrl.indexOf('OK') === 0;
    }
    return finish(summary, healthy ? EXIT_OK : EXIT_CHECK_UNHEALTHY);
  }

  /* ==== Safety gate: never sandbox the live port by accident ==== */
  if (!cfg.dryRun && cfg.port === LIVE_PORT && process.env.CWM_DATA_DIR &&
      process.env.CWM_RESTART_ALLOW_SANDBOXED_LIVE !== '1') {
    log('CONFIG', 'REFUSING: CWM_DATA_DIR is set while targeting the LIVE port ' + LIVE_PORT + '.');
    log('CONFIG', 'The restarted live instance would inherit a sandbox data dir and come up with the wrong state.');
    log('CONFIG', 'Unset CWM_DATA_DIR, or set CWM_RESTART_ALLOW_SANDBOXED_LIVE=1 if you truly mean it.');
    return finish(summary, EXIT_CONFIG);
  }

  /* ==== Safety gate: refuse to kill non-node owners or our own ancestors ==== */
  let ancestorWarning = false;
  if (!cfg.dryRun && oldPids.length > 0) {
    const ancestry = getSelfAncestry();
    for (const o of topo.owners) {
      if ((o.info.name || '').toLowerCase() !== 'node.exe') {
        log('STOP', 'REFUSING: port owner PID ' + o.info.procId + ' is "' + o.info.name + '", not node.exe. Will not kill an unrecognized process. Investigate manually.');
        return finish(summary, EXIT_CONFIG);
      }
      if (ancestry.indexOf(o.info.procId) !== -1) {
        ancestorWarning = true;
        log('STOP', 'WARNING: port owner PID ' + o.info.procId + ' is an ANCESTOR of this script (you are running inside a workbook terminal).');
        if (respawner.kind === 'none') {
          log('STOP', 'REFUSING: killing it would kill this script with no respawner to recover. Run from an independent terminal.');
          return finish(summary, EXIT_CONFIG);
        }
        log('STOP', 'Proceeding because the ' + respawner.kind + ' will respawn the workbook even if this script dies with it.');
      }
    }
  }

  /* ==== Stage: stop ==== */
  banner('STAGE: Stop old instance');
  let reboundPid = null;
  if (oldPids.length === 0) {
    log('STOP', 'Nothing is listening on port ' + cfg.port + '; skipping kill (idempotent path).');
  } else if (cfg.dryRun) {
    log('STOP', 'DRY RUN: would kill PID(s) ' + oldPids.join(', ') + ' (each individually, no name kills, no tree kills).');
    if (respawner.kind !== 'none') log('STOP', 'DRY RUN: would then wait up to ' + (respawner.waitMs / 1000) + 's for the ' + respawner.kind + ' to respawn the workbook.');
    else log('STOP', 'DRY RUN: would then start a detached replacement (node gui.js, PORT=' + cfg.port + ', CWM_NO_OPEN=1).');
  } else {
    for (const pid of oldPids) {
      const gone = await killPid(pid);
      if (!gone) {
        log('STOP', 'ERROR: PID ' + pid + ' would not die. Aborting before starting a duplicate.');
        return finish(summary, EXIT_STOP_FAILED);
      }
    }
    log('STOP', 'Waiting for port ' + cfg.port + ' to release (avoids EADDRINUSE)...');
    const rel = await waitPortReleased(cfg.port, oldPids);
    if (rel.state === 'stuck') {
      log('STOP', 'ERROR: port ' + cfg.port + ' is still owned by PID ' + rel.pid + ' after ' + (PORT_RELEASE_TIMEOUT_MS / 1000) + 's.');
      return finish(summary, EXIT_STOP_FAILED);
    }
    if (rel.state === 'rebound') {
      reboundPid = rel.pid;
      log('STOP', 'A respawner already re-bound port ' + cfg.port + ' (new PID ' + reboundPid + '). Skipping manual start.');
    } else {
      log('STOP', 'Port ' + cfg.port + ' is free.');
    }
  }

  /* ==== Stage: start ==== */
  if (!cfg.dryRun) {
    banner('STAGE: Start replacement');
    if (reboundPid !== null) {
      log('START', 'Respawner already provided the replacement (PID ' + reboundPid + ').');
    } else if (respawner.kind !== 'none') {
      log('START', 'Waiting up to ' + (respawner.waitMs / 1000) + 's for the ' + respawner.kind + ' to respawn the workbook...');
      const deadline = Date.now() + respawner.waitMs;
      let bound = false;
      while (Date.now() < deadline) {
        const owners = findPortOwners(cfg.port);
        if (owners.length > 0) { bound = true; log('START', 'Respawner bound port ' + cfg.port + ' (PID ' + owners[0] + ').'); break; }
        await sleep(POLL_INTERVAL_MS);
      }
      if (!bound) {
        log('START', 'Respawner did not act within the window. Falling back to a manual detached start.');
        if (findPortOwners(cfg.port).length === 0) startDetached(cfg.port);
        else log('START', 'Port got bound during fallback decision; using that instance.');
      }
    } else {
      startDetached(cfg.port);
    }

    /* ==== Stage: verify local ==== */
    banner('STAGE: Verify local health');
    const healthy = await waitForHealthy(cfg.port, LOCAL_HEALTH_TIMEOUT_MS);
    if (!healthy) {
      log('VERIFY', 'ERROR: workbook never answered 200 on ' + LOCAL_HOST + ':' + cfg.port + HEALTH_PATH + ' within ' + (LOCAL_HEALTH_TIMEOUT_MS / 1000) + 's.');
      log('VERIFY', 'Check ' + SPAWN_LOG + ' and logs/crash.log for the boot failure.');
      summary.localHealth = 'FAILED';
      return finish(summary, EXIT_START_FAILED);
    }
    summary.localHealth = 'OK';
    const newOwners = findPortOwners(cfg.port);
    if (newOwners.length !== 1) {
      log('VERIFY', 'WARNING: expected exactly 1 listener on port ' + cfg.port + ', found ' + newOwners.length + ' (' + newOwners.join(', ') + ').');
    }
    const newPid = newOwners[0] || null;
    summary.newPid = newOwners.join(', ') || 'unknown';
    const newInfo = newPid ? getProcessInfo(newPid) : null;
    if (newInfo) log('VERIFY', 'New instance: PID ' + newInfo.procId + ' cmd: ' + newInfo.cmd);

    /* ==== Stage: reap duplicates from the restart window ==== */
    if (!cfg.noReap && newPid) {
      banner('STAGE: Duplicate cleanup');
      const reaped = await reapZombieGuis(scriptStartMs, newPid, cfg.port);
      if (reaped.length > 0) log('REAP', 'Reaped duplicate PIDs: ' + reaped.join(', '));
      const finalOwners = findPortOwners(cfg.port);
      if (finalOwners.length === 1) log('REAP', 'Exactly one healthy instance owns port ' + cfg.port + ' (PID ' + finalOwners[0] + ').');
      else log('REAP', 'WARNING: port ' + cfg.port + ' listener count is ' + finalOwners.length + ' after cleanup.');
    }
  } else {
    summary.localHealth = pre.healthy ? 'OK (pre-existing, dry run)' : 'UNHEALTHY (pre-existing, dry run)';
  }

  /* ==== Stage: tunnel + public ==== */
  if (!cfg.noTunnel) {
    const tunnel = await runTunnelStage(cfg, summary, !cfg.dryRun);
    if (tunnel.exit !== null) return finish(summary, tunnel.exit);
    const pubExit = await runPublicStage(cfg, summary, !cfg.dryRun, tunnel.tokenUsed);
    if (pubExit !== null) return finish(summary, pubExit);
  }

  if (ancestorWarning) log('DONE', 'Note: this script survived restarting its own ancestor; if output stopped above, the respawner completed the job.');
  return finish(summary, EXIT_OK);
}

/* Entry point with a last-resort catch so no failure is silent. */
main().then((code) => {
  process.exit(code);
}).catch((err) => {
  log('FATAL', 'Unexpected error: ' + (err && err.stack ? err.stack : String(err)));
  process.exit(EXIT_UNEXPECTED);
});
