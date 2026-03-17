/**
 * Path utilities for cross-platform path handling
 */

const os = require('os');

/**
 * Expand ~ to home directory
 * Supports: ~, ~/path, ~\path
 * @param {string} filepath
 * @returns {string}
 */
function expandHome(filepath) {
  if (!filepath || typeof filepath !== 'string') {
    return filepath;
  }
  if (filepath === '~' || filepath.startsWith('~/') || filepath.startsWith('~\\')) {
    return filepath.replace('~', os.homedir());
  }
  return filepath;
}

module.exports = { expandHome };
