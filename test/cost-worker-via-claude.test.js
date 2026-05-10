#!/usr/bin/env node
/**
 * Smoke test for COST-04: claudeProvider.costAdapter must be the same module
 * export as src/web/cost-worker.js. This wiring is established by Plan 14-03
 * (when it creates src/providers/claude/index.js) and verified here. Plan
 * 14-04 only adds the test; the wiring is owned by Plan 14-03.
 *
 * If this test fails because src/providers/claude/index.js does not yet
 * exist (Plan 14-03 has not landed), the failure is informative: it tells
 * the orchestrator the merge order is wrong.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

'use strict';

const assert = require('assert');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  PASS  ' + name);
  } catch (err) {
    failed++;
    console.log('  FAIL  ' + name);
    console.log('        ' + (err && err.message ? err.message : String(err)));
  }
}

console.log('\n  Plan 14-04 cost-worker wiring (COST-04)');
console.log('  ' + '-'.repeat(42));

check('COST-04: claudeProvider.costAdapter === require("src/web/cost-worker")', () => {
  // require both modules. Node caches by absolute path, so the strict-equal
  // check works against the module.exports object even when cost-worker has
  // no explicit module.exports assignment (worker thread file).
  const claudeProvider = require('../src/providers/claude');
  const costWorker = require('../src/web/cost-worker');
  assert.ok(claudeProvider, 'claudeProvider must be importable');
  assert.ok('costAdapter' in claudeProvider, 'claudeProvider must expose costAdapter slot');
  assert.strictEqual(claudeProvider.costAdapter, costWorker,
    'claudeProvider.costAdapter must be the same module export as cost-worker.js');
});

console.log('  ' + '-'.repeat(42));
console.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
console.log('  ' + '-'.repeat(42) + '\n');

if (failed > 0) {
  process.exit(1);
}
console.log('All passed.');
process.exit(0);
