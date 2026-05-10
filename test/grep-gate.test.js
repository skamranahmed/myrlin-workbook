#!/usr/bin/env node
/**
 * Grep gate: forbidden provider-name literals outside src/providers/.
 *
 * Walks src/ recursively, skips src/providers/ entirely, skips node_modules
 * and any dot-prefixed directory (e.g. src/web/public/.backup/), and fails
 * on any line containing 'claude' or 'codex' as a bare quoted literal that
 * does NOT carry the gsd:provider-literal-allowed comment marker.
 *
 * Allowlist mechanism: per-line comment marker. Line numbers drift across
 * commits; comment markers travel with the line they exempt.
 *
 * Includes a self-test that creates a temporary fixture file under
 * src/providers/claude/ containing the forbidden literal and asserts the
 * gate IGNORES it (proving subtree exclusion works). The fixture is
 * deleted in a finally block regardless of test outcome. Without this
 * self-test a future refactor that breaks subtree exclusion would turn
 * the gate into a silent no-op.
 *
 * Plan 14-05 (Phase 14, Foundation). Requirement ABST-04.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC_ROOT = path.join(__dirname, '..', 'src');
const PROVIDERS_DIR = path.join(SRC_ROOT, 'providers');
const FORBIDDEN = /['"]\b(claude|codex)\b['"]/;
const ALLOWLIST_MARKER = 'gsd:provider-literal-allowed';

/**
 * Recursively yield every .js file path under `dir`, skipping the
 * src/providers/ subtree, node_modules, and any dot-prefixed directory.
 *
 * @param {string} dir Absolute path of directory to walk.
 * @yields {string} Absolute path of a .js file.
 */
function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return; // Permission error or vanished directory; skip silently.
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      // Skip the entire src/providers/ subtree (provider impls own their literals).
      if (path.relative(SRC_ROOT, p) === 'providers') continue;
      // Skip node_modules defensively (not normally under src/, but cheap to guard).
      if (e.name === 'node_modules') continue;
      // Skip dot-prefixed directories (e.g. .backup/, .vscode/, .git/).
      if (e.name.startsWith('.')) continue;
      yield* walk(p);
    } else if (e.name.endsWith('.js')) {
      yield p;
    }
  }
}

/**
 * Walk src/ and collect any line outside src/providers/ that contains a
 * forbidden literal without the allowlist marker.
 *
 * @returns {{ failed: number, offenders: Array<{file: string, line: number, text: string}> }}
 */
function runGate() {
  let failed = 0;
  const offenders = [];
  const projectRoot = path.join(__dirname, '..');
  for (const file of walk(SRC_ROOT)) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch (_) {
      continue; // Binary or unreadable file; skip.
    }
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      if (FORBIDDEN.test(line) && !line.includes(ALLOWLIST_MARKER)) {
        offenders.push({
          file: path.relative(projectRoot, file).replace(/\\/g, '/'),
          line: i + 1,
          text: line.trim(),
        });
        failed++;
      }
    });
  }
  return { failed, offenders };
}

// ─── Self-test: prove subtree exclusion is real, not visual ─────────────
// Create a fixture file under src/providers/claude/ that contains the
// forbidden literal AND no allowlist marker. If the gate flags this
// file, subtree exclusion is broken and we must fail loudly. The
// fixture is deleted in finally so the working tree stays clean even
// when assertions throw.

const fixturePath = path.join(PROVIDERS_DIR, 'claude', '__grep_self_test_fixture__.js');
let selfTestPassed = false;
try {
  // Worst-case content: bare literal with no marker. If subtree
  // exclusion fails, this line will be flagged.
  fs.writeFileSync(fixturePath, "module.exports = { provider: 'claude' };\n", 'utf-8');
  const selfResult = runGate();
  const fixtureFlagged = selfResult.offenders.some(
    (o) => o.file.includes('__grep_self_test_fixture__')
  );
  if (fixtureFlagged) {
    console.error('Grep gate self-test FAILED: fixture in src/providers/claude/ was flagged.');
    console.error('Subtree exclusion is broken. Inspect the walk() function in test/grep-gate.test.js.');
    process.exit(1);
  }
  selfTestPassed = true;
} finally {
  // Always delete the fixture, even when assertions or unexpected errors throw.
  try {
    fs.unlinkSync(fixturePath);
  } catch (_) {
    // Fixture may have already been deleted or never written; ignore.
  }
}

if (!selfTestPassed) {
  console.error('Grep gate self-test did not run to completion.');
  process.exit(1);
}

// ─── Real gate: walk src/ for actual offenders ──────────────────────────

const { failed, offenders } = runGate();

if (failed > 0) {
  console.error('Grep gate FAILED. ' + failed + ' forbidden literal(s) outside src/providers/:');
  for (const o of offenders) {
    console.error('  ' + o.file + ':' + o.line + ': ' + o.text);
  }
  console.error('');
  console.error('Resolution:');
  console.error('  1. If the literal is legitimate (e.g., bootstrap default, migration default,');
  console.error('     v1.1 back-compat fallback), add the comment marker on the same line:');
  console.error('       // gsd:provider-literal-allowed');
  console.error('     Or for inline form (inside expressions, JSDoc, etc.):');
  console.error('       providerId === \'claude\' /* gsd:provider-literal-allowed */');
  console.error('  2. If the literal is unintentional, replace it with a registry lookup');
  console.error('     (claudeProvider.cliBinary, claudeProvider.id) or move the consuming');
  console.error('     code into src/providers/<id>/.');
  process.exit(1);
}

console.log('Grep gate PASSED (subtree-exclusion self-test + real walk).');
process.exit(0);
