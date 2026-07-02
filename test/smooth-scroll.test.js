#!/usr/bin/env node
/**
 * Issue #41: smooth terminal scrolling.
 *
 * Terminal panes previously scrolled in instant discrete row blocks because
 * the Terminal was constructed without xterm 6.0.0's smoothScrollDuration
 * option. The fix constructs panes with a duration resolved by
 * TerminalPane.getSmoothScrollDuration() (persisted setting + OS
 * reduced-motion preference), exposes a Settings toggle (smoothScrolling),
 * live-applies changes via applySmoothScrollSetting(), and guards the mobile
 * touch momentum engine so its per-frame scrollLines() calls are never
 * double-animated by xterm's own easing.
 *
 * This test uses the no-jsdom pattern from test/idle-signal-dispatch.test.js:
 * the terminal.js source is evaluated inside a `new Function` sandbox with
 * stubbed window/document/localStorage globals, and behavior-critical wiring
 * in terminal.js and app.js is verified by source scan.
 *
 * Asserts:
 *   1. Capability gate: the vendored xterm build supports smoothScrollDuration
 *      (a future vendor downgrade fails loudly here).
 *   2. getSmoothScrollDuration(): default duration, 0 when the setting is
 *      false, 0 under reduced motion, default under malformed or throwing
 *      localStorage, default when matchMedia is unavailable.
 *   3. terminal.js wiring: construction option, _engineDriving guard in
 *      onTouchStart, restore in stopMomentum and the onTouchEnd end paths.
 *   4. app.js wiring: smoothScrolling default, settings registry entry,
 *      applySmoothScrollSetting sync (grid panes + group pane cache) in
 *      applySettings, reduced-motion media-query listener.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const TERMINAL_JS_PATH = path.join(__dirname, '..', 'src', 'web', 'public', 'terminal.js');
const APP_JS_PATH = path.join(__dirname, '..', 'src', 'web', 'public', 'app.js');
const XTERM_VENDOR_PATH = path.join(__dirname, '..', 'src', 'web', 'public', 'vendor', 'xterm', 'xterm.min.js');

let passed = 0;
let failed = 0;

/**
 * Run a single named assertion block, tallying pass/fail without aborting
 * the rest of the suite. Mirrors the runner in idle-signal-dispatch.test.js.
 *
 * @param {string} name - Human-readable test name printed in the report.
 * @param {Function} fn - Assertion body; throws on failure.
 */
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  \x1b[32mPASS\x1b[0m ' + name);
  } catch (err) {
    failed++;
    console.log('  \x1b[31mFAIL\x1b[0m ' + name);
    console.log('       ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n       ') : String(err)));
  }
}

console.log('\n  Issue #41: smooth terminal scrolling (xterm smoothScrollDuration)');
console.log('  ' + '='.repeat(58));

const terminalSrc = fs.readFileSync(TERMINAL_JS_PATH, 'utf8');
const appSrc = fs.readFileSync(APP_JS_PATH, 'utf8');

/**
 * Evaluate terminal.js in a sandboxed Function with stubbed globals and
 * harvest the pieces this suite exercises. Nothing DOM-real is needed:
 * getSmoothScrollDuration only touches localStorage and window.matchMedia,
 * and the TerminalPane constructor only assigns instance state.
 *
 * @param {object} [opts] - Sandbox behavior knobs.
 * @param {string} [opts.settingsJson] - Raw string localStorage returns for
 *   the cwm_settings key (undefined means "key absent", i.e. getItem null).
 * @param {boolean} [opts.reducedMotion] - matchMedia matches value for the
 *   prefers-reduced-motion query.
 * @param {boolean} [opts.storageThrows] - Make localStorage.getItem throw
 *   (private-mode/blocked-storage simulation).
 * @param {boolean} [opts.noMatchMedia] - Omit window.matchMedia entirely
 *   (very old engines).
 * @returns {{TerminalPane: Function, SMOOTH_SCROLL_DURATION_MS: number}}
 */
function loadTerminalRuntime(opts) {
  const o = opts || {};
  const storage = {
    getItem: (key) => {
      if (o.storageThrows) throw new Error('storage blocked');
      if (key !== 'cwm_settings') return null;
      return o.settingsJson !== undefined ? o.settingsJson : null;
    },
  };
  const win = {};
  if (!o.noMatchMedia) {
    win.matchMedia = (query) => ({ matches: !!o.reducedMotion, media: query });
  }
  const factory = new Function(
    'window', 'document', 'Terminal', 'FitAddon', 'WebSocket', 'localStorage', 'navigator',
    terminalSrc + '\nreturn { TerminalPane: TerminalPane, SMOOTH_SCROLL_DURATION_MS: SMOOTH_SCROLL_DURATION_MS };'
  );
  return factory(
    win,
    { documentElement: { dataset: {} } },
    function () {},
    { FitAddon: function () {} },
    function () {},
    storage,
    { maxTouchPoints: 0 }
  );
}

/**
 * Extract a balanced-brace source block starting at the given anchor string
 * (a function or method header). Used for scoped source scans so assertions
 * hit the intended function body, not a lookalike elsewhere in the file.
 *
 * @param {string} src - Full file source.
 * @param {string} anchor - Unique text immediately preceding the block's
 *   opening brace (e.g. "const onTouchStart = (e) => {").
 * @returns {string} Source from the anchor through the matching close brace.
 */
function extractBlock(src, anchor) {
  const idx = src.indexOf(anchor);
  assert.notStrictEqual(idx, -1, 'Anchor not found in source: ' + anchor);
  const braceStart = src.indexOf('{', idx);
  assert.notStrictEqual(braceStart, -1, 'No opening brace after anchor: ' + anchor);
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(idx, i + 1);
    }
  }
  assert.fail('Unbalanced braces after anchor: ' + anchor);
}

/* ============================================================
   1. Vendored xterm capability gate
   ============================================================ */

check('vendored xterm build supports smoothScrollDuration (capability gate)', () => {
  const vendorSrc = fs.readFileSync(XTERM_VENDOR_PATH, 'utf8');
  assert.ok(
    vendorSrc.includes('smoothScrollDuration'),
    'vendor/xterm/xterm.min.js must contain smoothScrollDuration; a vendor ' +
    'downgrade below xterm 5.2 would silently disable the issue #41 fix'
  );
});

/* ============================================================
   2. getSmoothScrollDuration() resolution matrix
   ============================================================ */

check('getSmoothScrollDuration is a static method returning the named constant by default', () => {
  const rt = loadTerminalRuntime();
  assert.strictEqual(typeof rt.TerminalPane.getSmoothScrollDuration, 'function');
  assert.strictEqual(typeof rt.SMOOTH_SCROLL_DURATION_MS, 'number');
  assert.ok(rt.SMOOTH_SCROLL_DURATION_MS > 0, 'default duration must be a positive ms value');
  assert.strictEqual(rt.TerminalPane.getSmoothScrollDuration(), rt.SMOOTH_SCROLL_DURATION_MS);
});

check('returns 0 when cwm_settings.smoothScrolling === false', () => {
  const rt = loadTerminalRuntime({ settingsJson: JSON.stringify({ smoothScrolling: false }) });
  assert.strictEqual(rt.TerminalPane.getSmoothScrollDuration(), 0);
});

check('returns 0 under prefers-reduced-motion even when the setting is on', () => {
  const rt = loadTerminalRuntime({
    settingsJson: JSON.stringify({ smoothScrolling: true }),
    reducedMotion: true,
  });
  assert.strictEqual(rt.TerminalPane.getSmoothScrollDuration(), 0);
});

check('returns the default under malformed-JSON localStorage', () => {
  const rt = loadTerminalRuntime({ settingsJson: '{not valid json' });
  assert.strictEqual(rt.TerminalPane.getSmoothScrollDuration(), rt.SMOOTH_SCROLL_DURATION_MS);
});

check('returns the default when localStorage.getItem throws (blocked storage)', () => {
  const rt = loadTerminalRuntime({ storageThrows: true });
  assert.strictEqual(rt.TerminalPane.getSmoothScrollDuration(), rt.SMOOTH_SCROLL_DURATION_MS);
});

check('returns the default when window.matchMedia is unavailable', () => {
  const rt = loadTerminalRuntime({ noMatchMedia: true });
  assert.strictEqual(rt.TerminalPane.getSmoothScrollDuration(), rt.SMOOTH_SCROLL_DURATION_MS);
});

/* ============================================================
   3. Instance behavior: constructor flag + live re-apply
   ============================================================ */

check('constructor initializes _engineDriving to false', () => {
  const rt = loadTerminalRuntime();
  const pane = new rt.TerminalPane('container-1', 'session-1', 'Pane', {});
  assert.strictEqual(pane._engineDriving, false);
});

check('applySmoothScrollSetting applies the resolved duration to term.options', () => {
  const rt = loadTerminalRuntime();
  const fake = { term: { options: { smoothScrollDuration: 999 } }, _engineDriving: false };
  rt.TerminalPane.prototype.applySmoothScrollSetting.call(fake);
  assert.strictEqual(fake.term.options.smoothScrollDuration, rt.SMOOTH_SCROLL_DURATION_MS);
});

check('applySmoothScrollSetting no-ops while the mobile engine is driving', () => {
  const rt = loadTerminalRuntime();
  const fake = { term: { options: { smoothScrollDuration: 0 } }, _engineDriving: true };
  rt.TerminalPane.prototype.applySmoothScrollSetting.call(fake);
  assert.strictEqual(
    fake.term.options.smoothScrollDuration, 0,
    'duration must stay 0 mid-gesture; restore happens at gesture end'
  );
});

check('applySmoothScrollSetting is safe before the terminal exists', () => {
  const rt = loadTerminalRuntime();
  assert.doesNotThrow(() => {
    rt.TerminalPane.prototype.applySmoothScrollSetting.call({ term: null, _engineDriving: false });
  });
});

/* ============================================================
   4. terminal.js wiring (source scan)
   ============================================================ */

check('Terminal is constructed with smoothScrollDuration from the getter', () => {
  assert.ok(
    terminalSrc.includes('smoothScrollDuration: TerminalPane.getSmoothScrollDuration(),'),
    'new Terminal({...}) must include the smoothScrollDuration option'
  );
});

check('onTouchStart takes engine ownership and zeroes the xterm animation', () => {
  const block = extractBlock(terminalSrc, 'const onTouchStart = (e) => {');
  assert.ok(block.includes('this._engineDriving = true'), 'onTouchStart must set _engineDriving');
  assert.ok(
    /this\.term\.options\.smoothScrollDuration = 0/.test(block),
    'onTouchStart must zero smoothScrollDuration for the gesture'
  );
});

check('restoreSmoothScroll clears the flag and re-reads the getter fresh', () => {
  const block = extractBlock(terminalSrc, 'const restoreSmoothScroll = () => {');
  assert.ok(block.includes('this._engineDriving = false'), 'restore must clear _engineDriving');
  assert.ok(
    block.includes('TerminalPane.getSmoothScrollDuration()'),
    'restore must resolve the duration fresh so mid-gesture settings changes self-correct'
  );
});

check('stopMomentum (momentum decay / teardown path) restores smooth scrolling', () => {
  const block = extractBlock(terminalSrc, 'const stopMomentum = () => {');
  assert.ok(block.includes('restoreSmoothScroll()'), 'stopMomentum must call restoreSmoothScroll');
});

check('onTouchEnd restores on the no-momentum and selection end paths', () => {
  const block = extractBlock(terminalSrc, 'const onTouchEnd = (e) => {');
  const restores = (block.match(/restoreSmoothScroll\(\)/g) || []).length;
  assert.ok(
    restores >= 2,
    'onTouchEnd must restore in both the no-momentum else-path and the long-press selection path, found ' + restores
  );
  assert.ok(
    /\} else \{[^]*?restoreSmoothScroll\(\)/.test(block),
    'the no-momentum branch must be an explicit else-path restore'
  );
});

/* ============================================================
   5. app.js wiring (source scan)
   ============================================================ */

check('app.js defaults include smoothScrolling: true', () => {
  assert.ok(
    appSrc.includes('smoothScrolling: true,'),
    'settings defaults block must default smoothScrolling on'
  );
});

check('settings registry exposes the smoothScrolling toggle in the Terminal category', () => {
  const block = extractBlock(appSrc, 'getSettingsRegistry() {');
  assert.ok(
    /key: 'smoothScrolling'[^]*?category: 'Terminal'/.test(block),
    'registry must contain the smoothScrolling entry categorized under Terminal'
  );
});

check('applySettings syncs applySmoothScrollSetting to grid panes AND the group pane cache', () => {
  const block = extractBlock(appSrc, 'applySettings() {');
  assert.ok(block.includes('applySmoothScrollSetting'), 'applySettings must live-apply the setting to panes');
  assert.ok(
    block.includes('_groupPaneCache'),
    'applySettings must also reach panes cached for inactive tab groups'
  );
  assert.ok(
    /typeof tp\.applySmoothScrollSetting === 'function'/.test(block),
    'pane sync must feature-detect the method (cached panes from older code paths)'
  );
});

check('app.js registers a live prefers-reduced-motion change listener', () => {
  assert.ok(
    appSrc.includes("matchMedia('(prefers-reduced-motion: reduce)')"),
    'bindEvents must query the reduced-motion media list'
  );
  const anchor = appSrc.indexOf("matchMedia('(prefers-reduced-motion: reduce)')");
  const tail = appSrc.slice(anchor, anchor + 800);
  assert.ok(tail.includes('addEventListener'), 'must attach a change listener on the media query');
  assert.ok(tail.includes('addListener'), 'must fall back to the deprecated addListener for older Safari');
});

/* ============================================================
   Results
   ============================================================ */

console.log('  ' + '='.repeat(58));
console.log('  [smooth-scroll] ' + passed + '/' + (passed + failed) + ' tests passed');

if (failed > 0) {
  process.exit(1);
}
process.exit(0);
