/**
 * Session Manager - Manages Claude Code session lifecycle
 * Handles launching, stopping, and restarting session processes.
 * Supports Windows (cmd.exe), macOS, and Linux/WSL.
 */

const { spawn } = require('child_process');
const { getStore } = require('../state/store');

/**
 * Allowlist of known-safe login shells.
 * Used to validate process.env.SHELL on non-Windows platforms to prevent
 * arbitrary binary execution if the environment is compromised.
 */
const ALLOWED_SHELLS = [
  '/bin/bash', '/usr/bin/bash',
  '/bin/sh', '/usr/bin/sh',
  '/bin/zsh', '/usr/bin/zsh',
  '/bin/fish', '/usr/bin/fish',
  '/bin/dash', '/usr/bin/dash',
  '/bin/ash',
];

/**
 * Get a safe shell path for the current platform.
 * Validates process.env.SHELL against an allowlist; falls back to /bin/bash.
 * @returns {string} Absolute path to a safe shell binary
 */
function getSafeShell() {
  const envShell = process.env.SHELL;
  if (envShell && ALLOWED_SHELLS.includes(envShell)) {
    return envShell;
  }
  return '/bin/bash';
}

/**
 * Launch a Claude Code session by spawning a new detached process.
 * On Windows, opens a new cmd.exe console window.
 * On Linux/macOS, spawns a detached shell process (primarily used by TUI;
 * the web GUI uses PTY terminals via pty-manager.js instead).
 * Updates the store with the new PID and sets status to 'running'.
 * @param {string} sessionId - The session ID to launch
 * @returns {{ success: boolean, pid?: number, error?: string }}
 */
function launchSession(sessionId) {
  const store = getStore();
  const session = store.getSession(sessionId);

  if (!session) {
    return { success: false, error: `Session ${sessionId} not found` };
  }

  if (session.status === 'running' && session.pid) {
    return { success: false, error: `Session ${sessionId} is already running (PID: ${session.pid})` };
  }

  try {
    const baseCommand = session.command || 'claude';
    const bypassFlag = session.bypassPermissions ? ' --dangerously-skip-permissions' : '';
    const command = baseCommand + bypassFlag;
    const workingDir = session.workingDir || process.cwd();

    let child;
    if (process.platform === 'win32') {
      // Windows: open a new console window via `cmd /c start cmd /k`
      child = spawn('cmd', ['/c', 'start', 'cmd', '/k', command], {
        detached: true,
        stdio: 'ignore',
        cwd: workingDir,
        shell: false,
      });
    } else {
      // Linux/macOS/WSL: spawn a detached login shell
      // Note: without a TTY, interactive CLI tools will exit immediately.
      // The web GUI uses pty-manager.js (with a real PTY) for terminal sessions.
      // This code path is kept for TUI compatibility and headless/scripted launches.
      const shell = getSafeShell();
      child = spawn(shell, ['-l', '-c', command], {
        detached: true,
        stdio: 'ignore',
        cwd: workingDir,
      });
    }

    const pid = child.pid;

    // Unref so the parent process can exit independently
    child.unref();

    store.updateSessionStatus(sessionId, 'running', pid);
    store.addSessionLog(sessionId, `Session launched with PID ${pid} (command: ${command})`);

    return { success: true, pid, process: child };
  } catch (err) {
    store.updateSessionStatus(sessionId, 'error', null);
    store.addSessionLog(sessionId, `Failed to launch session: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Stop a running session by killing its process.
 * Updates the store status to 'stopped'.
 * @param {string} sessionId - The session ID to stop
 * @returns {{ success: boolean, error?: string }}
 */
function stopSession(sessionId) {
  const store = getStore();
  const session = store.getSession(sessionId);

  if (!session) {
    return { success: false, error: `Session ${sessionId} not found` };
  }

  if (session.status !== 'running' || !session.pid) {
    store.updateSessionStatus(sessionId, 'stopped', null);
    return { success: true };
  }

  try {
    process.kill(session.pid);
    store.updateSessionStatus(sessionId, 'stopped', null);
    store.addSessionLog(sessionId, `Session stopped (PID ${session.pid} killed)`);
    return { success: true };
  } catch (err) {
    // Process may already be dead — that's fine, mark as stopped anyway
    store.updateSessionStatus(sessionId, 'stopped', null);
    store.addSessionLog(sessionId, `Session stop — process already exited (${err.message})`);
    return { success: true };
  }
}

/**
 * Restart a session by stopping it first, then relaunching.
 * @param {string} sessionId - The session ID to restart
 * @returns {{ success: boolean, pid?: number, error?: string }}
 */
function restartSession(sessionId) {
  const store = getStore();
  const session = store.getSession(sessionId);

  if (!session) {
    return { success: false, error: `Session ${sessionId} not found` };
  }

  store.addSessionLog(sessionId, 'Restarting session...');

  const stopResult = stopSession(sessionId);
  if (!stopResult.success) {
    return { success: false, error: `Failed to stop before restart: ${stopResult.error}` };
  }

  return launchSession(sessionId);
}

/**
 * Get process info for a session.
 * @param {string} sessionId - The session ID
 * @returns {{ pid: number|null, status: string, command: string }|null}
 */
function getSessionProcess(sessionId) {
  const store = getStore();
  const session = store.getSession(sessionId);

  if (!session) {
    return null;
  }

  return {
    pid: session.pid,
    status: session.status,
    command: session.command || 'claude',
    workingDir: session.workingDir || '',
  };
}

module.exports = {
  launchSession,
  stopSession,
  restartSession,
  getSessionProcess,
};
