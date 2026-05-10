#!/usr/bin/env node
/**
 * Plan 18-02 gate: sidebar provider tab strip lifecycle.
 *
 * Locks the contract for the six new CWMApp methods plus the render-time
 * filter wiring added in Plan 18-02:
 *   - loadProviders, renderProviderTabs, setActiveProviderTab
 *   - _countAllSessions, _countSessionsByProvider, _patchProviderTabBadges
 *   - renderWorkspaces / renderProjects filter clauses (source-string)
 *
 * Approach: a hybrid of source-string regression-net assertions (mirroring
 * Plan 18-01's gate style) plus a minimal extracted-method harness. Because
 * CWMApp has no module export and instantiating the full class would require
 * jsdom + xterm.js + the WebSocket pty chain, we extract the six method
 * bodies from the source file using a regex on the class brace structure
 * and evaluate them on a hand-built `this` stub. The stub provides only the
 * surface area the six methods touch: this.state, this.els, this.api,
 * this.escapeHtml, this.renderWorkspaces, this.renderProjects, plus a fake
 * localStorage and a fake requestAnimationFrame that runs callbacks
 * synchronously so the scroll-restore is observable in the same tick.
 *
 * Requirements covered: UI-01, UI-02, UI-07, UI-08, UI-09.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const APP_JS_PATH = path.join(__dirname, '..', 'src', 'web', 'public', 'app.js');
const src = fs.readFileSync(APP_JS_PATH, 'utf8');

let passed = 0;
let failed = 0;

// Queue of test functions so sync + async tests run in order.
const queue = [];

/**
 * Register a named assertion. Tests are queued and run sequentially in the
 * order registered so output is deterministic and the final summary fires
 * after every test resolves.
 *
 * @param {string} name Human-readable test name.
 * @param {() => void | Promise<void>} fn Function that throws on failure.
 */
function check(name, fn) {
  queue.push({ name, fn });
}

async function runQueue() {
  for (const { name, fn } of queue) {
    try {
      await fn();
      passed++;
      console.log('  \x1b[32m✓\x1b[0m ' + name);
    } catch (err) {
      failed++;
      console.log('  \x1b[31m✗\x1b[0m ' + name);
      console.log('    \x1b[31m' + err.message + '\x1b[0m');
    }
  }
}

console.log('\n  \x1b[1mPlan 18-02: sidebar provider tabs\x1b[0m');
console.log('  ' + '─'.repeat(42));

// ───────────────────────────────────────────────────────────────────────
// SECTION A: source-string regression-net (template and wiring shape)
// ───────────────────────────────────────────────────────────────────────

// (A1) Render output: each method declaration is present.
check('renderProviderTabs method declared on CWMApp class', () => {
  assert.ok(
    /\n\s*renderProviderTabs\(\)\s*\{/.test(src),
    'renderProviderTabs() must be declared as a class method'
  );
});

check('setActiveProviderTab method declared on CWMApp class', () => {
  assert.ok(
    /\n\s*setActiveProviderTab\(id\)\s*\{/.test(src),
    'setActiveProviderTab(id) must be declared as a class method'
  );
});

check('loadProviders method declared (async)', () => {
  assert.ok(
    /\n\s*async\s+loadProviders\(\)\s*\{/.test(src),
    'loadProviders() must be declared as an async class method'
  );
});

check('_countAllSessions, _countSessionsByProvider, _patchProviderTabBadges declared', () => {
  assert.ok(/\n\s*_countAllSessions\(\)\s*\{/.test(src), '_countAllSessions missing');
  assert.ok(/\n\s*_countSessionsByProvider\(id\)\s*\{/.test(src), '_countSessionsByProvider missing');
  assert.ok(/\n\s*_patchProviderTabBadges\(\)\s*\{/.test(src), '_patchProviderTabBadges missing');
});

// (A2) State surface: state.activeProviderTab, state.providers, state.projectsByProvider.
check('state.activeProviderTab initialised from localStorage with default "all"', () => {
  assert.ok(
    /activeProviderTab:\s*localStorage\.getItem\(\s*['"]cwm_activeProviderTab['"]\s*\)\s*\|\|\s*['"]all['"]/.test(src),
    'state.activeProviderTab must hydrate from localStorage with "all" fallback'
  );
});

check('state.providers initialised as empty array', () => {
  assert.ok(/providers:\s*\[\]/.test(src), 'state.providers must be [] at init');
});

check('state.projectsByProvider initialised as empty object', () => {
  assert.ok(/projectsByProvider:\s*\{\}/.test(src), 'state.projectsByProvider must be {} at init');
});

// (A3) DOM binding present in els.
check('els.sidebarProviderTabs binds #sidebar-provider-tabs', () => {
  assert.ok(
    /sidebarProviderTabs:\s*document\.getElementById\(\s*['"]sidebar-provider-tabs['"]\s*\)/.test(src),
    'this.els.sidebarProviderTabs must getElementById("sidebar-provider-tabs")'
  );
});

// (A4) loadAll wires loadProviders so the strip is populated on initial paint.
check('loadAll Promise.all includes this.loadProviders()', () => {
  const loadAllMatch = src.match(/async\s+loadAll\s*\(\)\s*\{[\s\S]*?await\s+Promise\.all\(\[([\s\S]*?)\]\)/);
  assert.ok(loadAllMatch, 'loadAll Promise.all block not found');
  assert.ok(
    /this\.loadProviders\(\)/.test(loadAllMatch[1]),
    'loadAll must await this.loadProviders() in its Promise.all'
  );
});

// (A5) Render-time filter wired into renderWorkspaces.
check('renderWorkspaces applies render-time provider filter via matchesActiveProvider', () => {
  const reHelper = /matchesActiveProvider\s*=\s*\(s\)\s*=>\s*activeTab\s*===\s*['"]all['"]/;
  assert.ok(reHelper.test(src), 'renderWorkspaces must define a matchesActiveProvider helper');
  // The filter must be applied to allWsSessions or rawWsSessions before the hidden-set filter.
  assert.ok(
    /\.filter\(matchesActiveProvider\)/.test(src),
    'renderWorkspaces must filter sessions via matchesActiveProvider'
  );
});

// (A6) Render-time filter wired into renderProjects.
check('renderProjects applies render-time provider filter when activeTab !== "all"', () => {
  // The filter clause uses (p.provider || 'claude') with an allowlist marker.
  const re = /projects\s*=\s*projects\.filter\(p\s*=>\s*\(p\s*&&\s*\(p\.provider\s*\|\|\s*'claude'\)\)\s*===\s*activeTab\)/;
  assert.ok(re.test(src), 'renderProjects must filter by p.provider when activeTab is not "all"');
});

// (A7) SSE handler hooks _patchProviderTabBadges.
check('handleSSEEvent calls _patchProviderTabBadges for session:* events', () => {
  // Extract handleSSEEvent body. Search for at least 4 distinct call sites.
  const calls = src.match(/this\._patchProviderTabBadges\(\)/g) || [];
  assert.ok(
    calls.length >= 4,
    `handleSSEEvent must call _patchProviderTabBadges in 4+ SSE branches; found ${calls.length}`
  );
});

// (A8) localStorage key for active tab.
check('setActiveProviderTab persists via cwm_activeProviderTab localStorage key', () => {
  assert.ok(
    /localStorage\.setItem\(\s*['"]cwm_activeProviderTab['"]\s*,\s*id\s*\)/.test(src),
    'setActiveProviderTab must persist to cwm_activeProviderTab'
  );
});

// (A9) Scroll preservation: capture before mutation, restore in rAF.
check('setActiveProviderTab captures workspaceList scrollTop pre-mutation', () => {
  // The capture must reference _tabScrollPositions and read wsList.scrollTop.
  const setActiveMatch = src.match(/setActiveProviderTab\(id\)\s*\{([\s\S]*?)\n\s\s\}/);
  assert.ok(setActiveMatch, 'setActiveProviderTab body not found');
  const body = setActiveMatch[1];
  assert.ok(/_tabScrollPositions/.test(body), 'must use _tabScrollPositions cache');
  assert.ok(/wsList\.scrollTop/.test(body), 'must capture workspaceList.scrollTop');
  assert.ok(/requestAnimationFrame/.test(body), 'must restore via requestAnimationFrame');
});

// ───────────────────────────────────────────────────────────────────────
// SECTION B: extracted-method harness (functional behaviour tests)
// ───────────────────────────────────────────────────────────────────────
//
// The six methods are extracted from the source file by capturing the
// contiguous block of method declarations between the
// "PROVIDER TABS (Phase 18-02)" comment banner and the "PROJECTS PANEL"
// banner. The block is wrapped in a class shell and evaluated; an
// instance of the resulting class is the test harness.

function extractMethods() {
  // The six methods sit between the two banner comments. Capture everything
  // from "async loadProviders" through the last brace of _patchProviderTabBadges.
  const startIdx = src.indexOf('async loadProviders()');
  assert.ok(startIdx > -1, 'loadProviders declaration not found');
  // _patchProviderTabBadges is the last of the six; find its declaration and
  // then walk forward to the matching closing brace.
  const patchIdx = src.indexOf('_patchProviderTabBadges()', startIdx);
  assert.ok(patchIdx > -1, '_patchProviderTabBadges declaration not found');
  // Find the opening brace of _patchProviderTabBadges body.
  const openBrace = src.indexOf('{', patchIdx);
  let depth = 1;
  let i = openBrace + 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  // Slice from startIdx to the closing brace of _patchProviderTabBadges.
  return src.slice(startIdx, i);
}

function buildHarness() {
  const methodsSource = extractMethods();
  const classSource = 'class Harness {\n' + methodsSource + '\n}\nreturn Harness;\n';
  // eslint-disable-next-line no-new-func
  const HarnessCtor = new Function(classSource)();
  return HarnessCtor;
}

/** Build a fake localStorage that records writes for inspection. */
function fakeLocalStorage() {
  const store = {};
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    _store: store,
  };
}

/** Build a fake DOM element with the minimum surface for these tests. */
function fakeEl(initial) {
  const el = {
    innerHTML: '',
    scrollTop: 0,
    children: [],
    _listeners: {},
    dataset: {},
    // The harness instances expose querySelectorAll so renderProviderTabs
    // (which calls .querySelectorAll('.sidebar-tab') after innerHTML assign)
    // does not throw. By default we return an empty list; specific tests
    // override per-element to inject button stubs.
    querySelectorAll() { return []; },
    querySelector() { return null; },
  };
  Object.assign(el, initial || {});
  return el;
}

/**
 * Install fake globals (localStorage, requestAnimationFrame, document) for
 * the duration of fn, then restore. Handles both sync and async test bodies
 * by awaiting fn's return value if it is thenable.
 */
async function withFakeGlobals(fn) {
  const origLS = global.localStorage;
  const origRAF = global.requestAnimationFrame;
  const origDoc = global.document;
  global.localStorage = fakeLocalStorage();
  // Synchronous rAF so post-render scroll-restore is observable in the same tick.
  global.requestAnimationFrame = (cb) => { cb(0); return 1; };
  // Stub document.getElementById to return null by default; specific tests
  // override per-call by setting global._idMap.
  global._idMap = {};
  global.document = {
    getElementById(id) { return global._idMap[id] || null; },
  };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') await out;
    return out;
  } finally {
    global.localStorage = origLS;
    global.requestAnimationFrame = origRAF;
    global.document = origDoc;
    delete global._idMap;
  }
}

/** Construct a Harness instance with sane defaults. */
function makeHarness(opts) {
  const Harness = buildHarness();
  const h = new Harness();
  h.state = {
    activeProviderTab: 'all',
    providers: [],
    allSessions: [],
    sessions: [],
    projects: [],
    projectsByProvider: {},
  };
  h.els = {
    workspaceList: fakeEl(),
    projectsList: fakeEl(),
    sidebarProviderTabs: fakeEl(),
  };
  // escapeHtml: minimal HTML escape sufficient for provider ids and display names.
  h.escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
  // Spies on the render methods so we can assert call counts.
  h._renderWorkspacesCalls = 0;
  h._renderProjectsCalls = 0;
  h.renderWorkspaces = function () { this._renderWorkspacesCalls++; };
  h.renderProjects = function () { this._renderProjectsCalls++; };
  // API stub: tests override h.api to return mock provider data.
  h.api = async () => [];
  Object.assign(h, opts || {});
  return h;
}

// (B1) renderProviderTabs HTML output: one enabled provider produces two tabs (All + provider).
check('renderProviderTabs emits All + one tab when one provider is enabled', () => {
  withFakeGlobals(() => {
    const h = makeHarness();
    global._idMap['sidebar-provider-tabs'] = h.els.sidebarProviderTabs;
    h.state.providers = [{ id: 'claude', displayName: 'Claude', enabled: true }];
    h.renderProviderTabs();
    const html = h.els.sidebarProviderTabs.innerHTML;
    assert.ok(/data-provider="all"/.test(html), 'All tab missing');
    assert.ok(/data-provider="claude"/.test(html), 'Claude tab missing');
    // Exactly two .sidebar-tab buttons (regex excludes .sidebar-tab-badge).
    const matches = html.match(/class="sidebar-tab(?:\s+active)?"/g) || [];
    assert.strictEqual(matches.length, 2, `expected 2 tabs, got ${matches.length}`);
  });
});

// (B2) renderProviderTabs with two enabled providers preserves registration order with "All" first.
check('renderProviderTabs emits All first, then providers in registration order', () => {
  withFakeGlobals(() => {
    const h = makeHarness();
    global._idMap['sidebar-provider-tabs'] = h.els.sidebarProviderTabs;
    h.state.providers = [
      { id: 'claude', displayName: 'Claude', enabled: true },
      { id: 'codex', displayName: 'ChatGPT', enabled: true },
    ];
    h.renderProviderTabs();
    const html = h.els.sidebarProviderTabs.innerHTML;
    const allIdx = html.indexOf('data-provider="all"');
    const claudeIdx = html.indexOf('data-provider="claude"');
    const codexIdx = html.indexOf('data-provider="codex"');
    assert.ok(allIdx > -1 && allIdx < claudeIdx, 'All must precede Claude');
    assert.ok(claudeIdx > -1 && claudeIdx < codexIdx, 'Claude must precede ChatGPT (registration order)');
  });
});

// (B3) Active tab carries .active class AND data-provider matching state.activeProviderTab.
check('renderProviderTabs marks the active tab with .active class', () => {
  withFakeGlobals(() => {
    const h = makeHarness();
    global._idMap['sidebar-provider-tabs'] = h.els.sidebarProviderTabs;
    h.state.providers = [
      { id: 'claude', displayName: 'Claude', enabled: true },
      { id: 'codex', displayName: 'ChatGPT', enabled: true },
    ];
    h.state.activeProviderTab = 'codex';
    h.renderProviderTabs();
    const html = h.els.sidebarProviderTabs.innerHTML;
    // The codex button must include " active" in its class list.
    assert.ok(
      /class="sidebar-tab active"[^>]*data-provider="codex"/.test(html),
      'codex tab should have .active class when activeProviderTab="codex"'
    );
    // The All tab must NOT have .active when codex is active.
    assert.ok(
      /class="sidebar-tab"\s+role="tab"\s+data-provider="all"/.test(html),
      'All tab should not have .active when codex is active'
    );
  });
});

// (B4) setActiveProviderTab mutates state, writes localStorage, calls re-renders.
check('setActiveProviderTab mutates state, persists, and re-renders', () => {
  withFakeGlobals(() => {
    const h = makeHarness();
    global._idMap['sidebar-provider-tabs'] = h.els.sidebarProviderTabs;
    h.state.providers = [{ id: 'codex', displayName: 'ChatGPT', enabled: true }];
    h.state.activeProviderTab = 'all';
    h.setActiveProviderTab('codex');
    assert.strictEqual(h.state.activeProviderTab, 'codex', 'state.activeProviderTab not updated');
    assert.strictEqual(
      global.localStorage.getItem('cwm_activeProviderTab'),
      'codex',
      'localStorage cwm_activeProviderTab not persisted'
    );
    assert.strictEqual(h._renderWorkspacesCalls, 1, 'renderWorkspaces should be called once');
    assert.strictEqual(h._renderProjectsCalls, 1, 'renderProjects should be called once');
  });
});

// (B5) setActiveProviderTab captures and restores scroll positions per tab.
check('setActiveProviderTab captures pre-render scrollTop and restores in rAF', () => {
  withFakeGlobals(() => {
    const h = makeHarness();
    global._idMap['sidebar-provider-tabs'] = h.els.sidebarProviderTabs;
    h.state.providers = [
      { id: 'claude', displayName: 'Claude', enabled: true },
      { id: 'codex', displayName: 'ChatGPT', enabled: true },
    ];
    // Scroll the workspace list down while on the All tab.
    h.els.workspaceList.scrollTop = 750;
    h.els.projectsList.scrollTop = 120;
    // Switch to Claude. The All-tab positions get captured.
    h.setActiveProviderTab('claude');
    // Simulate that the new render set scrollTop to 0 (innerHTML reset).
    h.els.workspaceList.scrollTop = 0;
    h.els.projectsList.scrollTop = 0;
    // The synchronous rAF stub already fired during setActiveProviderTab,
    // but with no saved position for "claude" yet, scroll stays at 0.
    assert.strictEqual(h.els.workspaceList.scrollTop, 0, 'claude tab has no saved scroll yet');
    // Now scroll on Claude tab and switch back to All; the All scroll
    // position should be restored to 750.
    h.els.workspaceList.scrollTop = 200;
    h.els.projectsList.scrollTop = 40;
    h.setActiveProviderTab('all');
    // After setActiveProviderTab returns, the synchronous rAF should have
    // restored workspaceList.scrollTop to 750 (the value captured on the
    // All-to-Claude switch).
    assert.strictEqual(
      h.els.workspaceList.scrollTop, 750,
      'All-tab scrollTop should be restored to 750 after switching back'
    );
    assert.strictEqual(
      h.els.projectsList.scrollTop, 120,
      'All-tab projects scrollTop should be restored to 120 after switching back'
    );
  });
});

// (B6) _countAllSessions and _countSessionsByProvider tally correctly.
check('_countAllSessions and _countSessionsByProvider tally per provider', () => {
  withFakeGlobals(() => {
    const h = makeHarness();
    h.state.allSessions = [
      { id: 's1', provider: 'claude' },
      { id: 's2', provider: 'claude' },
      { id: 's3', provider: 'codex' },
      { id: 's4' }, // missing provider -> defaults to claude
    ];
    assert.strictEqual(h._countAllSessions(), 4, 'total should be 4');
    assert.strictEqual(h._countSessionsByProvider('claude'), 3, 'claude should be 3 (2 explicit + 1 default)');
    assert.strictEqual(h._countSessionsByProvider('codex'), 1, 'codex should be 1');
    assert.strictEqual(h._countSessionsByProvider('gemini'), 0, 'gemini should be 0');
  });
});

// (B7) _patchProviderTabBadges updates only badge text; never calls renderProviderTabs.
check('_patchProviderTabBadges patches badge text in-place; no full re-render', () => {
  withFakeGlobals(() => {
    const h = makeHarness();
    global._idMap['sidebar-provider-tabs'] = h.els.sidebarProviderTabs;
    h.state.providers = [{ id: 'claude', displayName: 'Claude', enabled: true }];
    h.state.allSessions = [{ id: 's1', provider: 'claude' }];
    h.renderProviderTabs();
    // Build a fake button + badge DOM matching what renderProviderTabs would produce.
    const badge = { textContent: '0' };
    const button = {
      dataset: { provider: 'claude' },
      querySelector: (sel) => sel === '.sidebar-tab-badge' ? badge : null,
    };
    const allBadge = { textContent: '0' };
    const allButton = {
      dataset: { provider: 'all' },
      querySelector: (sel) => sel === '.sidebar-tab-badge' ? allBadge : null,
    };
    h.els.sidebarProviderTabs.querySelectorAll = (sel) => {
      if (sel === '.sidebar-tab') return [allButton, button];
      return [];
    };
    // Stub renderProviderTabs so we can detect if patch incorrectly calls it.
    let renderCalls = 0;
    const originalRender = h.renderProviderTabs;
    h.renderProviderTabs = function () { renderCalls++; return originalRender.call(this); };
    h._patchProviderTabBadges();
    assert.strictEqual(badge.textContent, '1', 'claude badge should be 1');
    assert.strictEqual(allBadge.textContent, '1', 'All badge should be 1');
    assert.strictEqual(renderCalls, 0, '_patchProviderTabBadges must NOT call renderProviderTabs');
  });
});

// (B8) Render-time filter behaviour: setActiveProviderTab to a specific provider
// causes the matchesActiveProvider helper in renderWorkspaces to filter
// allSessions. The source-string assertion in A5 locks the helper shape;
// this functional test confirms that switching tabs causes a re-render so
// the filter is re-evaluated.
check('Switching to a specific provider tab triggers renderWorkspaces re-evaluation', () => {
  withFakeGlobals(() => {
    const h = makeHarness();
    global._idMap['sidebar-provider-tabs'] = h.els.sidebarProviderTabs;
    h.state.providers = [
      { id: 'claude', displayName: 'Claude', enabled: true },
      { id: 'codex', displayName: 'ChatGPT', enabled: true },
    ];
    h._renderWorkspacesCalls = 0;
    h.setActiveProviderTab('codex');
    assert.strictEqual(h._renderWorkspacesCalls, 1, 'renderWorkspaces should fire on tab switch');
    h.setActiveProviderTab('all');
    assert.strictEqual(h._renderWorkspacesCalls, 2, 'renderWorkspaces should fire on each tab switch');
  });
});

// (B9) loadProviders normalises both array and { providers: [...] } response shapes.
check('loadProviders normalises bare-array and { providers } response shapes', async () => {
  await withFakeGlobals(async () => {
    const h1 = makeHarness();
    global._idMap['sidebar-provider-tabs'] = h1.els.sidebarProviderTabs;
    h1.api = async () => ([
      { id: 'claude', displayName: 'Claude', enabled: true, available: true },
    ]);
    await h1.loadProviders();
    assert.strictEqual(h1.state.providers.length, 1, 'bare-array response should populate providers');
    assert.strictEqual(h1.state.providers[0].id, 'claude');

    const h2 = makeHarness();
    global._idMap['sidebar-provider-tabs'] = h2.els.sidebarProviderTabs;
    h2.api = async () => ({ providers: [
      { id: 'codex', displayName: 'ChatGPT', enabled: false, available: false },
    ]});
    await h2.loadProviders();
    assert.strictEqual(h2.state.providers.length, 1, '{providers} response should populate providers');
    assert.strictEqual(h2.state.providers[0].id, 'codex');
  });
});

// (B10) Stranded-tab fallback: if active tab refers to a disabled provider,
// renderProviderTabs resets activeProviderTab to 'all'.
check('renderProviderTabs falls back to "all" when active tab provider is disabled', () => {
  withFakeGlobals(() => {
    const h = makeHarness();
    global._idMap['sidebar-provider-tabs'] = h.els.sidebarProviderTabs;
    h.state.providers = [
      { id: 'claude', displayName: 'Claude', enabled: true },
      // codex was previously enabled but is now disabled; user's saved tab still points at it.
    ];
    h.state.activeProviderTab = 'codex';
    h.renderProviderTabs();
    assert.strictEqual(h.state.activeProviderTab, 'all', 'stranded tab should reset to "all"');
    assert.strictEqual(
      global.localStorage.getItem('cwm_activeProviderTab'),
      'all',
      'localStorage should also reset to "all"'
    );
  });
});

// ───────────────────────────────────────────────────────────────────────
// Summary and exit.
// ───────────────────────────────────────────────────────────────────────

(async () => {
  await runQueue();
  console.log('\n  ' + '─'.repeat(42));
  console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('  ' + '─'.repeat(42) + '\n');
  process.exit(failed > 0 ? 1 : 0);
})();
