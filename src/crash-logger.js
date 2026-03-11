/**
 * Persistent crash logger for Claude Workspace Manager.
 *
 * Writes structured crash entries to logs/crash.log with timestamps,
 * source (supervisor vs server), severity, and stack traces.
 * Rotates the log file when it exceeds MAX_LOG_SIZE bytes.
 *
 * Usage:
 *   const { logCrash, logError, logWarning } = require('./crash-logger');
 *   logCrash('supervisor', 'Server exited with code 1', { code: 1, signal: null });
 *   logError('server', 'Uncaught exception', err);
 *   logWarning('server', 'Unhandled promise rejection', reason);
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'crash.log');
const MAX_LOG_SIZE = 512 * 1024; // 512 KB, then rotate

/**
 * Ensure the logs directory exists.
 */
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Rotate crash.log to crash.log.1 if it exceeds MAX_LOG_SIZE.
 * Keeps only one backup to avoid unbounded disk usage.
 */
function rotateIfNeeded() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > MAX_LOG_SIZE) {
      const backup = LOG_FILE + '.1';
      if (fs.existsSync(backup)) fs.unlinkSync(backup);
      fs.renameSync(LOG_FILE, backup);
    }
  } catch (_) {
    // rotation is best-effort
  }
}

/**
 * Format an error, reason, or metadata object into a readable string.
 * @param {*} detail - Error object, string, or arbitrary value
 * @returns {string} Formatted detail string
 */
function formatDetail(detail) {
  if (!detail) return '';
  if (detail instanceof Error) {
    return detail.stack || detail.message || String(detail);
  }
  if (typeof detail === 'object') {
    try {
      return JSON.stringify(detail, null, 2);
    } catch (_) {
      return String(detail);
    }
  }
  return String(detail);
}

/**
 * Write a log entry to crash.log.
 * @param {'CRASH'|'ERROR'|'WARNING'} level - Severity level
 * @param {string} source - Component that generated the entry (e.g. 'supervisor', 'server')
 * @param {string} message - Human-readable description
 * @param {*} [detail] - Error object, metadata, or additional context
 */
function writeEntry(level, source, message, detail) {
  try {
    ensureLogDir();
    rotateIfNeeded();

    const timestamp = new Date().toISOString();
    const detailStr = formatDetail(detail);
    const entry = [
      `[${timestamp}] [${level}] [${source}]`,
      `  ${message}`,
      detailStr ? `  ${detailStr.split('\n').join('\n  ')}` : '',
      '',
    ].filter(Boolean).join('\n') + '\n';

    fs.appendFileSync(LOG_FILE, entry, 'utf8');
  } catch (_) {
    // crash logger must never itself crash the process
  }
}

/**
 * Log a fatal crash (process exit, kill signal).
 * @param {string} source - Component name
 * @param {string} message - What happened
 * @param {*} [detail] - Exit code, signal, error object
 */
function logCrash(source, message, detail) {
  writeEntry('CRASH', source, message, detail);
}

/**
 * Log an uncaught exception or critical error.
 * @param {string} source - Component name
 * @param {string} message - What happened
 * @param {*} [detail] - Error object
 */
function logError(source, message, detail) {
  writeEntry('ERROR', source, message, detail);
}

/**
 * Log a warning (unhandled rejection, non-fatal issue).
 * @param {string} source - Component name
 * @param {string} message - What happened
 * @param {*} [detail] - Reason or context
 */
function logWarning(source, message, detail) {
  writeEntry('WARNING', source, message, detail);
}

module.exports = { logCrash, logError, logWarning, LOG_FILE };
