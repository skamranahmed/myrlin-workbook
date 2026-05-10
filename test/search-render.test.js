#!/usr/bin/env node
/**
 * Plan 18-04 gate: search-result provider accent (SRCH-05).
 *
 * Asserts that performGlobalSearch decorates each rendered .search-result
 * with:
 *
 *   1. a data-provider attribute carrying the provider id (with
 *      escapeHtml) and a v1.1 back-compat default for results that
 *      arrive without the field;
 *
 *   2. a .search-result-provider chip inside the .search-result-header
 *      bearing the provider id uppercased.
 *
 * The frontend has no module export and instantiating CWMApp here would
 * require jsdom + WebSocket mocks. Following the Plan 18-01 convention
 * (test/data-provider-attr.test.js), this gate reads app.js as text and
 * asserts the template shape with regexes tight enough to fail on a
 * shape regression while loose enough to tolerate whitespace.
 *
 * Requirements covered: SRCH-05.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const APP_JS_PATH = path.join(__dirname, '..', 'src', 'web', 'public', 'app.js');
const src = fs.readFileSync(APP_JS_PATH, 'utf8');
const CSS_PATH = path.join(__dirname, '..', 'src', 'web', 'public', 'styles.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

let passed = 0;
let failed = 0;

/**
 * Run a single named assertion and tally pass/fail so failures are visible
 * but do not abort the suite on the first miss.
 *
 * @param {string} name Human-readable test name.
 * @param {() => void} fn Function that throws on failure.
 */
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + name);
  } catch (err) {
    failed++;
    console.log('  \x1b[31m✗\x1b[0m ' + name);
    console.log('    \x1b[31m' + err.message + '\x1b[0m');
  }
}

console.log('\n  \x1b[1mPlan 18-04: search-result provider accent\x1b[0m');
console.log('  ' + '─'.repeat(42));

// ─── Test 1: performGlobalSearch result HTML carries data-provider ───
check('performGlobalSearch result HTML opens .search-result with data-provider', () => {
  // The template literal builds the result row inline; the data-provider
  // attribute must appear inside the same opening tag.
  const re = /<div class="search-result"\s+data-session-id="\$\{sessionId\}"\s+data-project-path="\$\{[^}]+\}"\s+data-provider="\$\{providerAttr\}"/;
  assert.ok(
    re.test(src),
    '.search-result opening tag must carry data-provider="${providerAttr}"; not found'
  );
});

// ─── Test 2: result HTML includes the .search-result-provider chip ───
check('performGlobalSearch result HTML includes .search-result-provider chip with the provider label', () => {
  const re = /<span class="search-result-provider">\$\{providerLabel\}<\/span>/;
  assert.ok(
    re.test(src),
    '.search-result-provider chip must render ${providerLabel} in the result header'
  );
});

// ─── Test 3: provider id uppercased for the chip ───
check('performGlobalSearch uppercases the provider id for the chip text', () => {
  // The label is computed via providerId.toUpperCase() so CODEX, CLAUDE,
  // GEMINI all read as uppercase. Assert the .toUpperCase() call.
  assert.ok(
    /providerLabel\s*=\s*this\.escapeHtml\(providerId\.toUpperCase\(\)\)/.test(src),
    'providerLabel must be the escaped uppercase of providerId'
  );
});

// ─── Test 4: provider id default falls back to claude ───
check('performGlobalSearch defaults missing provider field to the v1.1 back-compat value', () => {
  // The default is the v1.1 back-compat value; the literal carries the
  // allowlist marker. The chip therefore reads 'CLAUDE' for legacy
  // results from pre-v1.2 servers.
  assert.ok(
    /providerId\s*=\s*r\.provider\s*\|\|\s*'claude'/.test(src),
    'providerId must default to the v1.1 back-compat value when r.provider is missing'
  );
});

// ─── Test 5: data-provider attribute is HTML-escaped ───
check('performGlobalSearch HTML-escapes the provider attribute value', () => {
  // The attribute value is passed through escapeHtml; this defends against
  // a malformed provider id with quotes or other HTML metacharacters.
  assert.ok(
    /providerAttr\s*=\s*this\.escapeHtml\(providerId\)/.test(src),
    'providerAttr must be HTML-escaped before insertion into the template'
  );
});

// ─── Test 6: the chip is placed inside the header div (not the snippet) ───
check('performGlobalSearch places the chip inside .search-result-header', () => {
  // The chip is the first child of .search-result-header so the visual
  // ordering is provider chip, then project name, then time. Loose check:
  // the chip appears AFTER 'search-result-header' and BEFORE 'search-result-project'
  // in the source.
  const headerIdx = src.indexOf('search-result-header"');
  const chipIdx = src.indexOf('search-result-provider"');
  const projectIdx = src.indexOf('search-result-project"');
  assert.ok(headerIdx > 0 && chipIdx > 0 && projectIdx > 0, 'all three markers must be present');
  assert.ok(
    headerIdx < chipIdx && chipIdx < projectIdx,
    'chip must appear between .search-result-header opener and .search-result-project to land inside the header'
  );
});

// ─── Test 7: CSS selectors for the accent chip exist ───
check('styles.css defines .search-result-provider chip selector', () => {
  assert.ok(
    /\.search-result-provider\s*\{/.test(css),
    'styles.css must define .search-result-provider with chip styling'
  );
});

check('styles.css defines per-provider .search-result[data-provider] color rules', () => {
  // Claude rule
  assert.ok(
    /\.search-result\[data-provider="claude"\][^}]*search-result-provider\s*\{[\s\S]{0,120}var\(--provider-claude-accent\)/.test(css),
    'styles.css must route Claude search-result chips to var(--provider-claude-accent)'
  );
  // Codex rule
  assert.ok(
    /\.search-result\[data-provider="codex"\][^}]*search-result-provider\s*\{[\s\S]{0,120}var\(--provider-codex-accent\)/.test(css),
    'styles.css must route Codex search-result chips to var(--provider-codex-accent)'
  );
});

// ─── Summary ─────────────────────────────────────────────────────
console.log('  ' + '─'.repeat(42));
console.log('  \x1b[1m[search-render]\x1b[0m ' + passed + '/' + (passed + failed) + ' tests passed');
process.exit(failed > 0 ? 1 : 0);
