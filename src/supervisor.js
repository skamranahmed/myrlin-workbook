#!/usr/bin/env node
/**
 * Process supervisor for Claude Workspace Manager GUI.
 *
 * Spawns src/gui.js as a child process and automatically restarts it
 * if it exits unexpectedly. Graceful shutdown via Ctrl+C or SIGTERM
 * stops the restart loop and tears down the child cleanly.
 *
 * Usage:
 *   node src/supervisor.js [--demo] [--cdp]
 *
 * All CLI flags are forwarded to gui.js.
 *
 * Environment:
 *   CWM_RESTART_DELAY=2000   Delay (ms) before restart after crash (default 2000)
 *   CWM_MAX_RESTARTS=20      Max consecutive restarts before giving up (default 20)
 */

const { spawn } = require('child_process');
const path = require('path');

// Forward all CLI args after supervisor.js to gui.js
const guiArgs = process.argv.slice(2);
const guiScript = path.join(__dirname, 'gui.js');

const RESTART_DELAY = parseInt(process.env.CWM_RESTART_DELAY, 10) || 2000;
const MAX_RESTARTS = parseInt(process.env.CWM_MAX_RESTARTS, 10) || 20;
// Reset the consecutive restart counter after this many ms of stable uptime
const STABLE_THRESHOLD = 30000; // 30 seconds

let child = null;
let shuttingDown = false;
let consecutiveRestarts = 0;
let lastStartTime = 0;

/**
 * Start the GUI server as a child process.
 * Inherits stdio so the user sees all output inline.
 */
function startChild() {
  lastStartTime = Date.now();
  console.log(`[supervisor] Starting GUI server (attempt ${consecutiveRestarts + 1})...`);

  child = spawn(process.execPath, [guiScript, ...guiArgs], {
    stdio: 'inherit',
    env: { ...process.env, CWM_NO_OPEN: consecutiveRestarts > 0 ? '1' : '' },
  });

  child.on('exit', (code, signal) => {
    child = null;

    if (shuttingDown) {
      console.log('[supervisor] Graceful shutdown complete.');
      process.exit(0);
      return;
    }

    // If the process ran for a while before dying, reset the counter
    const uptime = Date.now() - lastStartTime;
    if (uptime > STABLE_THRESHOLD) {
      consecutiveRestarts = 0;
    }

    consecutiveRestarts++;

    if (consecutiveRestarts > MAX_RESTARTS) {
      console.error(`[supervisor] Server crashed ${MAX_RESTARTS} times consecutively. Giving up.`);
      process.exit(1);
      return;
    }

    const reason = signal ? `signal ${signal}` : `exit code ${code}`;
    console.log(`[supervisor] Server exited (${reason}). Restarting in ${RESTART_DELAY}ms...`);

    setTimeout(startChild, RESTART_DELAY);
  });

  child.on('error', (err) => {
    console.error(`[supervisor] Failed to start server: ${err.message}`);
    child = null;

    if (!shuttingDown) {
      consecutiveRestarts++;
      if (consecutiveRestarts <= MAX_RESTARTS) {
        setTimeout(startChild, RESTART_DELAY);
      } else {
        console.error(`[supervisor] Too many failures. Exiting.`);
        process.exit(1);
      }
    }
  });
}

/**
 * Graceful shutdown: signal the child to stop and don't restart it.
 */
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[supervisor] Shutting down...');

  if (child) {
    // Send SIGINT so gui.js runs its graceful shutdown handler
    child.kill('SIGINT');

    // Force kill after 5 seconds if it hasn't exited
    const forceTimer = setTimeout(() => {
      if (child) {
        console.log('[supervisor] Force killing server...');
        child.kill('SIGKILL');
      }
    }, 5000);
    forceTimer.unref();
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start the server
startChild();
