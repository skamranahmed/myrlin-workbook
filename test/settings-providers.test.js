#!/usr/bin/env node
/**
 * Plan 18-03: Settings Providers section + toggle confirmation modal.
 *
 * Asserts the runtime contract of three new methods added to CWMApp in
 * src/web/public/app.js:
 *   1. _renderProvidersSection(filter) returns the HTML for the Providers
 *      category block, one .settings-providers-tile per provider, conditional
 *      install hint when p.available === false.
 *   2. _installHintFor(providerId) returns the expected hint string for
 *      'claude' and 'codex'; a generic fallback for unknown ids.
 *   3. _handleProviderToggleChange(event) calls showConfirmModal when
 *      toggling OFF with running PTYs for that provider; calls the PUT API
 *      directly when no PTYs exist or when toggling ON; reverts the
 *      checkbox to the source-of-truth state on cancel and on PUT failure.
 *
 * Approach: extract the method source text from app.js via balanced-brace
 * scanning starting at each method's declaration. Reassemble the methods as
 * a tiny standalone class with stubbed dependencies (escapeHtml, showToast,
 * api, showConfirmModal, etc.). This keeps the test in lockstep with the
 * real source: if a future refactor changes the method signature, the
 * harness instantiation fails loudly rather than silently testing a stale
 * copy.
 *
 * Requirements covered: SET-01, SET-02, SET-03, SET-04, SET-05, SET-06.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const APP_JS_PATH = path.join(__dirname, '..', 'src', 'web', 'public', 'app.js');
const src = fs.readFileSync(APP_JS_PATH, 'utf8');

let passed = 0;
let failed = 0;

/**
 * Run a single named assertion and tally pass/fail so failures stay visible
 * but the suite continues. Mirrors the helper in test/css-tokens.test.js.
 *
 * @param {string} name Human-readable test name.
 * @param {() => void | Promise<void>} fn Function that throws on failure.
 */
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + name);
  } catch (err) {
    failed++;
    console.log('  \x1b[31m✗\x1b[0m ' + name);
    console.log('    \x1b[31m' + (err && err.message ? err.message : String(err)) + '\x1b[0m');
  }
}

/**
 * Extract the body of a class method from app.js source text. Locates the
 * method declaration by name (must be at the start of a line, possibly with
 * leading whitespace and an optional `async ` modifier) and walks balanced
 * braces to capture the full body. Returns the raw text from the method
 * signature line through the matching closing brace.
 *
 * @param {string} text Source text of app.js.
 * @param {string} methodName Method name to extract.
 * @returns {string} The full text of the method declaration + body.
 */
function extractMethod(text, methodName) {
  // Match either "async methodName(" or "methodName(" at line start with leading whitespace.
  const sigRe = new RegExp('^[ \\t]*(?:async\\s+)?' + methodName + '\\s*\\(', 'm');
  const sigMatch = sigRe.exec(text);
  if (!sigMatch) {
    throw new Error('extractMethod: could not find declaration of ' + methodName);
  }
  const start = sigMatch.index;
  // Find the first '{' after the signature.
  let i = text.indexOf('{', start);
  if (i < 0) throw new Error('extractMethod: no opening brace for ' + methodName);
  let depth = 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  throw new Error('extractMethod: unbalanced braces for ' + methodName);
}

/**
 * Build a minimal harness class that mounts the four extracted methods plus
 * stub dependencies. Each stub is recordable so tests can assert call counts
 * and arguments. The harness exposes the stubs via instance fields named
 * with a _spy prefix so tests can introspect after the method runs.
 *
 * @returns {Function} The harness class constructor.
 */
function buildHarness() {
  const renderSrc = extractMethod(src, '_renderProvidersSection');
  const hintSrc = extractMethod(src, '_installHintFor');
  const sessionIdSrc = extractMethod(src, '_sessionProviderId');
  const toggleSrc = extractMethod(src, '_handleProviderToggleChange');

  // Build the class body as text. The four methods are pasted verbatim so
  // their behaviour is identical to the production code. The stubs cover
  // every `this.*` call site each method makes.
  const classText = `
    return class TestHarness {
      constructor(opts) {
        opts = opts || {};
        this.state = opts.state || { providers: [], allSessions: [], sessions: [] };
        this.terminalPanes = opts.terminalPanes || [];
        this.els = opts.els || { settingsSearchInput: null, settingsBody: null };

        // Recordable spies. Tests inspect these after invoking methods.
        this._spyApi = [];
        this._spyConfirm = [];
        this._spyToast = [];
        this._spyRenderProviderTabs = 0;
        this._spyRenderWorkspaces = 0;
        this._spyRenderProjects = 0;
        this._spyRenderSettingsBody = [];
        this._spyLoadProviders = 0;

        // Stub responses. Tests can override these before invoking methods.
        this._apiResponse = opts.apiResponse !== undefined ? opts.apiResponse : null;
        this._apiError = opts.apiError || null;
        this._confirmResponse = opts.confirmResponse !== undefined ? opts.confirmResponse : true;
      }

      escapeHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/[&<>"']/g, (c) => ({
          '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
        })[c]);
      }

      async api(method, urlPath, body) {
        this._spyApi.push({ method, path: urlPath, body });
        if (this._apiError) throw this._apiError;
        return this._apiResponse;
      }

      async showConfirmModal(opts) {
        this._spyConfirm.push(opts);
        return this._confirmResponse;
      }

      showToast(msg, level) {
        this._spyToast.push({ msg, level });
      }

      async loadProviders() {
        this._spyLoadProviders++;
      }

      renderProviderTabs() { this._spyRenderProviderTabs++; }
      renderWorkspaces() { this._spyRenderWorkspaces++; }
      renderProjects() { this._spyRenderProjects++; }
      renderSettingsBody(filter) { this._spyRenderSettingsBody.push(filter); }

      ${renderSrc}

      ${hintSrc}

      ${sessionIdSrc}

      ${toggleSrc}
    };
  `;

  // eslint-disable-next-line no-new-func
  return new Function(classText)();
}

console.log('\n  \x1b[1mPlan 18-03: Settings Providers section\x1b[0m');
console.log('  ' + '─'.repeat(42));

const Harness = buildHarness();

// ─── Render-shape tests ────────────────────────────────────────────────

(async () => {
  await check('_renderProvidersSection emits one tile per provider', async () => {
    const h = new Harness({
      state: {
        providers: [
          { id: 'claude', displayName: 'Claude', enabled: true, available: true },
          { id: 'codex', displayName: 'Codex', enabled: true, available: true },
        ],
        allSessions: [],
        sessions: [],
      },
    });
    const html = await h._renderProvidersSection('');
    const tiles = html.match(/<div class="settings-providers-tile" data-provider="/g) || [];
    assert.strictEqual(tiles.length, 2, 'Expected 2 tiles for 2 providers; got ' + tiles.length);
    assert.ok(html.includes('data-provider="claude"'), 'tile for claude provider missing');
    assert.ok(html.includes('data-provider="codex"'), 'tile for codex provider missing');
    assert.ok(html.includes('Claude'), 'display name Claude missing');
    assert.ok(html.includes('Codex'), 'display name Codex missing');
  });

  await check('_renderProvidersSection shows install hint when available === false', async () => {
    const h = new Harness({
      state: {
        providers: [
          { id: 'codex', displayName: 'Codex', enabled: false, available: false },
        ],
        allSessions: [],
        sessions: [],
      },
    });
    const html = await h._renderProvidersSection('');
    assert.ok(
      html.includes('settings-providers-install-hint'),
      'install hint element must appear when p.available is false'
    );
    assert.ok(
      html.includes('@openai/codex'),
      'codex install hint text (@openai/codex) must appear in tile body'
    );
  });

  await check('_renderProvidersSection hides install hint when available === true', async () => {
    const h = new Harness({
      state: {
        providers: [
          { id: 'claude', displayName: 'Claude', enabled: true, available: true },
        ],
        allSessions: [],
        sessions: [],
      },
    });
    const html = await h._renderProvidersSection('');
    assert.ok(
      !html.includes('settings-providers-install-hint'),
      'install hint must NOT appear when p.available is true'
    );
  });

  await check('_renderProvidersSection status text reflects enabled + available matrix', async () => {
    const h = new Harness({
      state: {
        providers: [
          { id: 'a', displayName: 'A', enabled: true, available: true },
          { id: 'b', displayName: 'B', enabled: false, available: true },
          { id: 'c', displayName: 'C', enabled: false, available: false },
          { id: 'd', displayName: 'D', enabled: true, available: false },
        ],
        allSessions: [],
        sessions: [],
      },
    });
    const html = await h._renderProvidersSection('');
    assert.ok(html.includes('Enabled &middot; CLI on PATH'), 'enabled+available text missing');
    assert.ok(html.includes('Disabled &middot; CLI on PATH'), 'disabled+available text missing');
    assert.ok(html.includes('CLI not found in PATH'), 'CLI-not-found text missing');
    assert.ok(html.includes('Enabled but CLI not found in PATH'), 'enabled-but-missing warning text missing');
  });

  await check('_renderProvidersSection respects search filter (returns empty for non-matching filter)', async () => {
    const h = new Harness({
      state: {
        providers: [{ id: 'claude', displayName: 'Claude', enabled: true, available: true }],
        allSessions: [],
        sessions: [],
      },
    });
    const html = await h._renderProvidersSection('terminal');
    assert.strictEqual(html, '', 'Filter "terminal" should not match the providers section');
  });

  await check('_renderProvidersSection renders when filter matches "provider"', async () => {
    const h = new Harness({
      state: {
        providers: [{ id: 'claude', displayName: 'Claude', enabled: true, available: true }],
        allSessions: [],
        sessions: [],
      },
    });
    const html = await h._renderProvidersSection('provider');
    assert.ok(html.length > 0, 'Filter "provider" must match the providers section');
    assert.ok(html.includes('Claude'), 'Claude tile must render under matching filter');
  });

  await check('_installHintFor returns claude and codex hints; falls back for unknown', () => {
    const h = new Harness();
    assert.ok(h._installHintFor('claude').includes('@anthropic-ai/claude-code'), 'claude hint missing');
    assert.ok(h._installHintFor('codex').includes('@openai/codex'), 'codex hint missing');
    assert.ok(
      h._installHintFor('made-up').toLowerCase().includes('documentation'),
      'unknown provider id should fall back to a generic hint'
    );
  });

  // ─── Toggle handler tests ──────────────────────────────────────────────

  await check('toggle OFF with running PTYs invokes showConfirmModal (modal path)', async () => {
    const h = new Harness({
      state: {
        providers: [{ id: 'codex', displayName: 'Codex', enabled: true, available: true }],
        allSessions: [
          { id: 'sess-A', provider: 'codex' },
          { id: 'sess-B', provider: 'codex' },
        ],
        sessions: [],
      },
      terminalPanes: [
        { sessionId: 'sess-A' },
        { sessionId: 'sess-B' },
      ],
      apiResponse: { id: 'codex', displayName: 'Codex', enabled: false, available: true, accentToken: '--green' },
      confirmResponse: true,
    });
    const target = { checked: false, dataset: { providerToggle: 'codex' } };
    await h._handleProviderToggleChange({ target });
    assert.strictEqual(h._spyConfirm.length, 1, 'showConfirmModal must be called exactly once');
    assert.ok(
      h._spyConfirm[0].title && h._spyConfirm[0].title.includes('Codex'),
      'confirm modal title must include display name'
    );
    assert.ok(
      h._spyConfirm[0].message && h._spyConfirm[0].message.includes('2'),
      'confirm modal body must include running PTY count'
    );
    assert.strictEqual(h._spyApi.length, 1, 'PUT must be called once after confirm');
    assert.strictEqual(h._spyApi[0].method, 'PUT');
    assert.ok(h._spyApi[0].path.includes('/api/providers/codex/enabled'), 'PUT path must target /api/providers/<id>/enabled');
    assert.deepStrictEqual(h._spyApi[0].body, { enabled: false });
  });

  await check('toggle OFF without running PTYs skips modal and calls PUT directly', async () => {
    const h = new Harness({
      state: {
        providers: [{ id: 'codex', displayName: 'Codex', enabled: true, available: true }],
        allSessions: [],
        sessions: [],
      },
      terminalPanes: [],
      apiResponse: { id: 'codex', displayName: 'Codex', enabled: false, available: true },
      confirmResponse: true,
    });
    const target = { checked: false, dataset: { providerToggle: 'codex' } };
    await h._handleProviderToggleChange({ target });
    assert.strictEqual(h._spyConfirm.length, 0, 'showConfirmModal must NOT be called when no PTYs are running');
    assert.strictEqual(h._spyApi.length, 1, 'PUT must be called once');
    assert.strictEqual(h._spyApi[0].method, 'PUT');
    assert.deepStrictEqual(h._spyApi[0].body, { enabled: false });
  });

  await check('toggle ON never invokes confirmation modal (modal is for disable only)', async () => {
    const h = new Harness({
      state: {
        providers: [{ id: 'codex', displayName: 'Codex', enabled: false, available: true }],
        allSessions: [{ id: 'sess-A', provider: 'codex' }],
        sessions: [],
      },
      terminalPanes: [{ sessionId: 'sess-A' }],
      apiResponse: { id: 'codex', displayName: 'Codex', enabled: true, available: true },
    });
    const target = { checked: true, dataset: { providerToggle: 'codex' } };
    await h._handleProviderToggleChange({ target });
    assert.strictEqual(h._spyConfirm.length, 0, 'showConfirmModal must NOT be called for toggle ON');
    assert.strictEqual(h._spyApi.length, 1, 'PUT must be called for toggle ON');
    assert.deepStrictEqual(h._spyApi[0].body, { enabled: true });
  });

  await check('Cancel branch reverts checkbox and leaves state.providers unchanged', async () => {
    const initialProvider = { id: 'codex', displayName: 'Codex', enabled: true, available: true };
    const h = new Harness({
      state: {
        providers: [initialProvider],
        allSessions: [{ id: 'sess-A', provider: 'codex' }],
        sessions: [],
      },
      terminalPanes: [{ sessionId: 'sess-A' }],
      confirmResponse: false, // user clicks Cancel
    });
    const target = { checked: false, dataset: { providerToggle: 'codex' } };
    await h._handleProviderToggleChange({ target });

    // Modal was shown but cancel was pressed: no PUT, no toast, checkbox reverts.
    assert.strictEqual(h._spyConfirm.length, 1, 'confirm modal must have been shown');
    assert.strictEqual(h._spyApi.length, 0, 'PUT must NOT be called when user cancels');
    assert.strictEqual(target.checked, true, 'checkbox must revert to its prior checked state (enabled = true)');
    // State.providers is unchanged (same reference, same enabled flag).
    assert.strictEqual(h.state.providers[0], initialProvider, 'state.providers[0] reference must be unchanged');
    assert.strictEqual(h.state.providers[0].enabled, true, 'state.providers[0].enabled must still be true');
  });

  await check('PUT failure reverts checkbox and shows error toast', async () => {
    const h = new Harness({
      state: {
        providers: [{ id: 'codex', displayName: 'Codex', enabled: true, available: true }],
        allSessions: [],
        sessions: [],
      },
      terminalPanes: [],
      apiError: new Error('network down'),
    });
    const target = { checked: false, dataset: { providerToggle: 'codex' } };
    await h._handleProviderToggleChange({ target });
    assert.strictEqual(h._spyApi.length, 1, 'PUT was attempted');
    assert.strictEqual(target.checked, true, 'checkbox must revert when PUT fails');
    const errToast = h._spyToast.find(t => t.level === 'error');
    assert.ok(errToast, 'error toast must be shown on PUT failure');
    assert.ok(errToast.msg.includes('network down'), 'error toast must include underlying error message');
  });

  await check('successful PUT updates state.providers, calls renderProviderTabs, and shows success toast', async () => {
    const h = new Harness({
      state: {
        providers: [{ id: 'codex', displayName: 'Codex', enabled: true, available: true }],
        allSessions: [],
        sessions: [],
      },
      terminalPanes: [],
      apiResponse: { id: 'codex', displayName: 'Codex', enabled: false, available: true, accentToken: '--green' },
    });
    const target = { checked: false, dataset: { providerToggle: 'codex' } };
    await h._handleProviderToggleChange({ target });
    assert.strictEqual(h.state.providers[0].enabled, false, 'state.providers reflects server response');
    assert.strictEqual(h._spyRenderProviderTabs, 1, 'renderProviderTabs called once');
    assert.strictEqual(h._spyRenderWorkspaces, 1, 'renderWorkspaces called once');
    assert.strictEqual(h._spyRenderProjects, 1, 'renderProjects called once');
    const okToast = h._spyToast.find(t => t.level === 'success');
    assert.ok(okToast, 'success toast must be shown');
    assert.ok(okToast.msg.includes('disabled'), 'success toast must reflect the action');
  });

  await check('No-op toggle (desired === current) does not call api or modal', async () => {
    const h = new Harness({
      state: {
        providers: [{ id: 'codex', displayName: 'Codex', enabled: true, available: true }],
        allSessions: [],
        sessions: [],
      },
      terminalPanes: [],
    });
    // Browser change event fires with target.checked unchanged is unusual but
    // possible (programmatic .checked = true on an already-checked input).
    const target = { checked: true, dataset: { providerToggle: 'codex' } };
    await h._handleProviderToggleChange({ target });
    assert.strictEqual(h._spyApi.length, 0, 'no-op toggle must skip PUT');
    assert.strictEqual(h._spyConfirm.length, 0, 'no-op toggle must skip modal');
  });

  await check('_sessionProviderId returns session.provider; falls back when session missing', () => {
    const h = new Harness({
      state: {
        providers: [],
        allSessions: [
          { id: 'sess-A', provider: 'codex' },
          { id: 'sess-B' }, // missing provider field
        ],
        sessions: [],
      },
    });
    assert.strictEqual(h._sessionProviderId('sess-A'), 'codex', 'should return explicit provider');
    assert.strictEqual(h._sessionProviderId('sess-B'), 'claude', 'should fall back when provider field missing');
    assert.strictEqual(h._sessionProviderId('does-not-exist'), 'claude', 'should fall back when session missing');
  });

  console.log('  ' + '─'.repeat(42));
  console.log('  [settings-providers] ' + passed + '/' + (passed + failed) + ' tests passed');

  if (failed > 0) process.exit(1);
  process.exit(0);
})();
