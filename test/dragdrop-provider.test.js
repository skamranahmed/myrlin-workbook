#!/usr/bin/env node
/**
 * Plan 18-04 gate: drag-drop provider propagation (UI-10).
 *
 * Asserts that every drag source AND every drop site that creates a new
 * session forwards the provider tag end-to-end:
 *
 *   1. Source side: .project-session-item and .project-accordion-header
 *      dragstart handlers write JSON payloads that include a provider
 *      field, sourced from the source DOM node's data-provider attribute
 *      (set by Plan 18-01) with a v1.1 back-compat default.
 *
 *   2. Sink side: every POST /api/sessions and openTerminalInPane payload
 *      in the drag-drop drop handlers (workspace drop + terminal-pane drop)
 *      forwards `provider` from the parsed JSON payload, again with the
 *      back-compat default.
 *
 *   3. The grep gate marker (`gsd:provider-literal-allowed`) accompanies
 *      every || 'claude' fallback so the literal does not regress the
 *      grep gate.
 *
 * The frontend has no module export and a full DOM harness for dragstart
 * events would require jsdom + DataTransfer mocks. Following the Plan
 * 18-01 convention, this gate reads app.js as text and asserts the
 * shape with regexes tight enough to catch a missed callsite.
 *
 * Requirements covered: UI-10.
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

console.log('\n  \x1b[1mPlan 18-04: drag-drop provider propagation\x1b[0m');
console.log('  ' + '─'.repeat(42));

// ─── Test 1: project-session dragstart includes provider in the JSON payload ───
check('project-session dragstart JSON payload includes provider field', () => {
  // The dragstart handler builds the cwm/project-session payload with
  // setData('cwm/project-session', JSON.stringify({...})). The new field
  // must appear inside the same object literal.
  const re = /setData\('cwm\/project-session',\s*JSON\.stringify\(\{[\s\S]{0,400}provider:\s*dragProvider/;
  assert.ok(
    re.test(src),
    'cwm/project-session dragstart must include provider: dragProvider in the JSON payload'
  );
});

// ─── Test 2: project-session dragstart sources provider from data-provider ───
check('project-session dragstart reads provider from sessionItem.dataset.provider', () => {
  assert.ok(
    /dragProvider\s*=\s*sessionItem\.dataset\.provider\s*\|\|\s*'claude'/.test(src),
    'project-session dragstart must source provider from the dragged element data-provider attribute'
  );
});

// ─── Test 3: project (accordion header) dragstart includes provider ───
check('project (accordion) dragstart JSON payload includes provider field', () => {
  const re = /setData\('cwm\/project',\s*JSON\.stringify\(\{[\s\S]{0,300}provider:\s*accordionProvider/;
  assert.ok(
    re.test(src),
    'cwm/project dragstart must include provider: accordionProvider in the JSON payload'
  );
});

// ─── Test 4: project dragstart sources provider from the parent accordion ───
check('project dragstart reads provider from accordion.dataset.provider', () => {
  assert.ok(
    /accordionProvider\s*=\s*\(accordion\s+&&\s+accordion\.dataset\.provider\)\s*\|\|\s*'claude'/.test(src),
    'project dragstart must source provider from the parent .project-accordion'
  );
});

// ─── Test 5: workspace drop (project-session) forwards provider in POST payload ───
check('workspace drop handler for cwm/project-session forwards provider to POST /api/sessions', () => {
  // Inside the cwm/project-session drop branch of the workspace drop handler,
  // assert the POST body includes provider.
  const re = /getData\('cwm\/project-session'\)[\s\S]{0,1200}api\('POST',\s*'\/api\/sessions',\s*\{[\s\S]{0,400}provider:\s*psProvider/;
  assert.ok(
    re.test(src),
    'workspace drop cwm/project-session POST /api/sessions must include provider: psProvider'
  );
});

// ─── Test 6: workspace drop (project) forwards provider in POST payload ───
check('workspace drop handler for cwm/project forwards provider to POST /api/sessions', () => {
  // The cwm/project drop branch occurs after the cwm/project-session branch.
  // Find the second occurrence (the project branch) and assert provider in POST.
  const projectDropIdx = src.indexOf("getData('cwm/project')");
  assert.ok(projectDropIdx > 0, 'cwm/project drop branch must be present');
  const region = src.slice(projectDropIdx, projectDropIdx + 1500);
  assert.ok(
    /api\('POST',\s*'\/api\/sessions',\s*\{[\s\S]{0,400}provider:\s*projProvider/.test(region),
    'workspace drop cwm/project POST /api/sessions must include provider: projProvider'
  );
});

// ─── Test 7: terminal-pane drop (project-session) forwards provider in openTerminalInPane ───
check('terminal-pane drop handler for cwm/project-session forwards provider in spawnOpts', () => {
  // openTerminalInPane accepts a spawnOpts object with a provider field;
  // the terminal-pane drop path must include it. Find the second cwm/project-session
  // getData (the first is in the workspace drop handler).
  const all = src.split("getData('cwm/project-session')");
  // 3 segments => 2 occurrences (workspace + terminal-pane)
  assert.ok(all.length >= 3, 'cwm/project-session drop must appear in both workspace AND terminal-pane drop handlers');
  // Inspect the second occurrence's tail
  const region = all[2].slice(0, 2000);
  assert.ok(
    /openTerminalInPane\([\s\S]{0,400}provider:\s*psProvider/.test(region),
    'terminal-pane cwm/project-session openTerminalInPane must include provider: psProvider'
  );
});

// ─── Test 8: terminal-pane drop (project) forwards provider in openTerminalInPane ───
check('terminal-pane drop handler for cwm/project forwards provider in spawnOpts', () => {
  // Same pattern for cwm/project.
  const all = src.split("getData('cwm/project')");
  assert.ok(all.length >= 3, 'cwm/project drop must appear in both workspace AND terminal-pane drop handlers');
  const region = all[2].slice(0, 2000);
  assert.ok(
    /openTerminalInPane\([\s\S]{0,400}provider:\s*projProvider/.test(region),
    'terminal-pane cwm/project openTerminalInPane must include provider: projProvider'
  );
});

// ─── Test 9: every || 'claude' default carries the grep-gate marker ───
check('every Phase 18-04 drag-drop || \'claude\' default carries the grep-gate marker', () => {
  // Catch any drag-drop region that uses the literal default without
  // the allowlist marker. We grep for the specific variable names from
  // this plan (dragProvider, accordionProvider, psProvider, projProvider)
  // and assert each declaration line carries the marker.
  const varNames = ['dragProvider', 'accordionProvider', 'psProvider', 'projProvider'];
  for (const v of varNames) {
    const re = new RegExp("const\\s+" + v + "\\s*=[^\\n]*\\|\\|\\s*'claude'[^\\n]*gsd:provider-literal-allowed");
    assert.ok(
      re.test(src),
      'Phase 18-04 drag-drop default for ' + v + ' must carry the grep-gate marker on its declaration line'
    );
  }
});

// ─── Test 10: source has zero ?legacy=1 references ───
check('app.js has zero ?legacy=1 references remaining', () => {
  // Plan 18-04 retires the Phase 15 back-compat shim. Use the same
  // verification command the plan specifies: a literal count of zero.
  const count = (src.match(/legacy=1/g) || []).length;
  assert.strictEqual(count, 0, 'expected zero ?legacy=1 references; got ' + count);
});

// ─── session-lifecycle: pane header dragstart advertises droppable types ───
// The pane-header dragstart previously set ONLY 'cwm/terminal-swap', so the
// sidebar's workspace/folder drop targets (which accept 'cwm/session' and
// 'cwm/project-session') never fired for dragged panes. The fix adds both
// types conditionally: store-managed panes set cwm/session (sidebar branch
// calls moveSessionToWorkspace unchanged); ad-hoc panes set a
// cwm/project-session JSON payload matching the drop branch's parsed shape.

/**
 * Locate the pane-header dragstart handler region: the setData call for
 * 'cwm/terminal-swap' inside the header dragstart listener.
 * @returns {string} A source window starting at the handler.
 */
function findPaneHeaderDragstartRegion() {
  const idx = src.indexOf("setData('cwm/terminal-swap'");
  assert.ok(idx > 0, "pane header dragstart must still set 'cwm/terminal-swap'");
  // 3000-char window comfortably contains the whole handler body.
  return src.slice(idx, idx + 3000);
}

check('pane header dragstart still sets cwm/terminal-swap (pane-to-pane swap preserved)', () => {
  const count = (src.match(/setData\('cwm\/terminal-swap'/g) || []).length;
  assert.ok(count >= 1, 'cwm/terminal-swap setData must remain');
});

check('pane header dragstart additionally sets cwm/session for store-managed panes', () => {
  const region = findPaneHeaderDragstartRegion();
  assert.ok(
    /setData\('cwm\/session',\s*tp\.sessionId\)/.test(region),
    "store-managed pane drag must set 'cwm/session' with tp.sessionId"
  );
});

check('pane header dragstart sets cwm/project-session JSON payload for ad-hoc panes', () => {
  const region = findPaneHeaderDragstartRegion();
  // Payload must match the sidebar drop branch's parsed field names EXACTLY:
  // sessionName (upstream resume UUID), projectPath, displayName, provider.
  const re = /setData\('cwm\/project-session',\s*JSON\.stringify\(\{[\s\S]{0,400}sessionName:[\s\S]{0,400}projectPath:[\s\S]{0,400}displayName:[\s\S]{0,400}provider:/;
  assert.ok(
    re.test(region),
    "ad-hoc pane drag must set 'cwm/project-session' with {sessionName, projectPath, displayName, provider}"
  );
});

check('pane header dragstart resolves the ad-hoc resume uuid from spawnOpts.resumeSessionId first', () => {
  const region = findPaneHeaderDragstartRegion();
  assert.ok(
    /spawnOpts\s*&&\s*tp\.spawnOpts\.resumeSessionId\)\s*\|\|\s*tp\.sessionId/.test(region),
    'resume uuid must prefer tp.spawnOpts.resumeSessionId with tp.sessionId fallback'
  );
});

// ─── Summary ─────────────────────────────────────────────────────
console.log('  ' + '─'.repeat(42));
console.log('  \x1b[1m[dragdrop-provider]\x1b[0m ' + passed + '/' + (passed + failed) + ' tests passed');
process.exit(failed > 0 ? 1 : 0);
