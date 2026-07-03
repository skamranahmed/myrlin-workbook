#!/usr/bin/env node
/**
 * chore/windowshide-sweep: source-scan gate for windowsHide on every
 * server-side child_process call site.
 *
 * WHY: on Windows, any child process spawned by a windowless parent (the
 * daemonized supervisor, the watchdog-spawned workbook) without
 * `windowsHide: true` flashes a visible conhost/OpenConsole window. This
 * gate scans the server-side sources and asserts that EVERY child_process
 * call site (spawn/spawnSync/exec/execSync/execFile/execFileSync, the
 * promisified execFileAsync in td-adapter, the injectable
 * _resolveExecFile(opts)(...) runner in mac-bridge, and the aliased
 * es(psCmd...) probe in supervisor.js) carries `windowsHide` in its options.
 *
 * Deliberately OUT of scope:
 *   - src/web/public/**: browser bundle, no child_process there.
 *   - Method-style calls like `pty.spawn(...)` (dot-prefixed): node-pty
 *     ConPTY sessions are the interactive terminals the user asked to see;
 *     hiding them would break the product. The lookbehind in CALL_PATTERNS
 *     excludes any `x.spawn(` / `x.exec(` on purpose, EXCEPT the explicit
 *     `require('child_process').execFile(` inline form which is matched by
 *     its own pattern.
 *   - test/**: the test harness runs in a real console.
 *
 * The scan is a regex gate over file text (same approach as
 * test/grep-gate.test.js): each match must have `windowsHide` within the
 * next WINDOW_CHARS characters, which covers multi-line options objects.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let passed = 0;
let failed = 0;

/** Minimal pass/fail runner matching the other standalone tests. */
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  \x1b[32mPASS\x1b[0m ' + name);
  } catch (err) {
    failed++;
    console.log('  \x1b[31mFAIL\x1b[0m ' + name);
    console.log('       ' + (err && err.message ? err.message : String(err)));
  }
}

/**
 * Recursively collect .js files under a directory, skipping excluded dirs.
 * @param {string} dir - Absolute directory to walk.
 * @param {string[]} excludeDirs - Directory basenames to skip entirely.
 * @returns {string[]} Absolute file paths.
 */
function collectJsFiles(dir, excludeDirs) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (excludeDirs.includes(entry.name)) continue;
      out.push(...collectJsFiles(full, excludeDirs));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

// Server-side surface: all of src/ except the browser bundle, plus the
// runtime scripts the server/scheduled tasks invoke on this machine.
const SWEPT_FILES = [
  ...collectJsFiles(path.join(ROOT, 'src'), ['public', 'node_modules']),
  path.join(ROOT, 'scripts', 'watchdog.js'),
  path.join(ROOT, 'scripts', 'restart-workbook.js'),
  path.join(ROOT, 'scripts', 'recover-orphan-panes.js'),
].filter((f) => fs.existsSync(f));

/**
 * Call-site patterns. Each match position must be followed by `windowsHide`
 * within WINDOW_CHARS characters. The negative lookbehind on the bare-name
 * pattern excludes method calls (pty.spawn, /re/.exec) and longer
 * identifiers (spawnFn, execFileAsyncFoo).
 */
const CALL_PATTERNS = [
  // No whitespace allowed before '(' so comment prose like "spawn (no shell
  // wrap)" is not flagged; every real call site in this codebase is `name(`.
  /(?<![.\w$])(?:spawnSync|spawn|execFileSync|execFileAsync|execFile|execSync|exec)\(/g,
  /require\('child_process'\)\s*\.\s*(?:execFileSync|execFile|execSync|exec|spawnSync|spawn)\(/g,
  /_resolveExecFile\(opts\)\s*\(/g,
  // supervisor.js daemon PID probe: execSync aliased to `es`
  /(?<![.\w$])es\(psCmd/g,
];

/** How far past the call token windowsHide may appear (multi-line options). */
const WINDOW_CHARS = 700;

/**
 * Scan one source file and return violations plus the match count.
 * @param {string} file - Absolute path of the file to scan.
 * @returns {{ violations: string[], matches: number }}
 */
function scanFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const violations = [];
  let matches = 0;
  for (const pattern of CALL_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(src)) !== null) {
      matches++;
      const windowText = src.slice(m.index, m.index + WINDOW_CHARS);
      if (!/windowsHide/.test(windowText)) {
        const line = src.slice(0, m.index).split('\n').length;
        violations.push(path.relative(ROOT, file) + ':' + line + ' [' + m[0].trim() + ']');
      }
    }
  }
  return { violations, matches };
}

console.log('\n  chore/windowshide-sweep: windowsHide source gate');
console.log('  ' + '-'.repeat(58));

let totalMatches = 0;
const allViolations = [];
for (const file of SWEPT_FILES) {
  const { violations, matches } = scanFile(file);
  totalMatches += matches;
  allViolations.push(...violations);
}

check('every server-side child_process call site passes windowsHide', () => {
  if (allViolations.length > 0) {
    throw new Error('missing windowsHide at:\n         ' + allViolations.join('\n         '));
  }
});

check('the scan actually finds the known call sites (pattern-rot guard)', () => {
  // The sweep covers 40+ real call sites today. A drop below this floor
  // means the patterns or file list rotted and the gate silently passes.
  const FLOOR = 30;
  if (totalMatches < FLOOR) {
    throw new Error('only ' + totalMatches + ' call sites matched (< ' + FLOOR + '); patterns or file list rotted');
  }
});

check('pty-manager keeps interactive PTY sessions out of the sweep', () => {
  // node-pty spawns are dot-prefixed (pty.spawn / spawnFn alias) and must
  // NOT be flagged: those are the terminals the user opens on purpose.
  const ptyPath = path.join(ROOT, 'src', 'web', 'pty-manager.js');
  const { violations } = scanFile(ptyPath);
  if (violations.length > 0) {
    throw new Error('pty-manager flagged unexpectedly: ' + violations.join(', '));
  }
  const src = fs.readFileSync(ptyPath, 'utf8');
  if (!/pty\.spawn/.test(src)) {
    throw new Error('pty-manager no longer references pty.spawn; re-check the allow-list rationale');
  }
});

console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
