#!/usr/bin/env node
/**
 * scripts/anonymize-state.js
 *
 * Anonymize a real production ~/.myrlin/workspaces.json for use as a
 * migration test fixture. Preserves shape, IDs, timestamps, and counts;
 * redacts every field that could carry PII. Drops auth-bearing collections
 * (pushDevices, pairedDevices) entirely.
 *
 * Usage:
 *   node scripts/anonymize-state.js
 *   node scripts/anonymize-state.js --input /path/to/workspaces.json --output test/fixtures/migration-v1-state.json
 *
 * Hashing rule: replace identifying strings with first 6 hex chars of
 * sha256(originalString). Stable across runs (same input -> same hash) so
 * the fixture is regenerable but reveals nothing about the source.
 *
 * Required fixture invariants (verified by test/migration.test.js):
 *   - version stays 1 (so the migration logic actually has work to do)
 *   - sessions count matches the source (zero session loss)
 *   - workspaces count matches the source
 *   - no field longer than 30 chars after redaction (sanity heuristic)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

/**
 * Hash an arbitrary input to the first 6 hex chars of its sha256 digest.
 * Used to replace identifying strings (workspace name, session name,
 * working directory) with stable but opaque tokens.
 *
 * @param {*} s - Any value coercible to a string.
 * @returns {string} Six lowercase hex chars.
 */
function hash6(s) {
  return crypto.createHash('sha256').update(String(s || '')).digest('hex').slice(0, 6);
}

/**
 * Recursively redact name/description/text/topic fields on collections that
 * may contain PII (templates, features, worktreeTasks). Keeps IDs and
 * timestamps intact so structural assertions still hold.
 *
 * @param {object} collection - { id: { name?, description?, text?, topic?, ...} }
 */
function redactCollection(collection) {
  if (!collection || typeof collection !== 'object') return;
  for (const id of Object.keys(collection)) {
    const item = collection[id];
    if (!item || typeof item !== 'object') continue;
    for (const f of ['name', 'description', 'text', 'topic']) {
      if (typeof item[f] === 'string' && item[f].length > 0) {
        // For name fields keep a stable hashed token so collisions stay impossible.
        // For description/text/topic blank out entirely (no signal needed).
        item[f] = (f === 'name') ? (f.charAt(0).toUpperCase() + f.slice(1) + '-' + hash6(item[f])) : '';
      }
    }
  }
}

/**
 * Produce an anonymized deep-clone of a real workspaces.json state object.
 * Preserves structure (version, all top-level keys, all IDs, timestamps,
 * status flags, counts), redacts all PII (names, working directories,
 * descriptions, topic, log text, prompts), drops auth-bearing collections.
 *
 * @param {object} state - Parsed workspaces.json contents.
 * @returns {object} Anonymized state suitable for committing to test/fixtures/.
 */
function anonymize(state) {
  const out = JSON.parse(JSON.stringify(state)); // deep clone, safe to mutate

  // Workspaces: hash the name, blank the description.
  for (const id of Object.keys(out.workspaces || {})) {
    const w = out.workspaces[id];
    if (!w || typeof w !== 'object') continue;
    if (w.name) w.name = 'Workspace-' + hash6(w.name);
    if (w.description !== undefined) w.description = '';
  }

  // Sessions: hash name + workingDir, blank topic + initialPrompt + log text.
  for (const id of Object.keys(out.sessions || {})) {
    const s = out.sessions[id];
    if (!s || typeof s !== 'object') continue;
    if (s.name) s.name = 'Session-' + hash6(s.name);
    if (s.topic !== undefined) s.topic = '';
    if (s.workingDir) s.workingDir = '/anon/' + hash6(s.workingDir);
    s.initialPrompt = null;
    if (Array.isArray(s.logs)) {
      s.logs = s.logs.map(l => ({ ...l, text: '', message: '' }));
    }
  }

  // Templates / features / worktreeTasks: redact name/description/text/topic.
  for (const collection of ['templates', 'features', 'worktreeTasks']) {
    redactCollection(out[collection]);
  }

  // Drop auth-bearing collections entirely (tokens never enter a fixture).
  out.pushDevices = [];
  out.pairedDevices = [];

  // Worktree tasks may carry a `branch` and `worktreePath` and `repoDir` that
  // could leak directory structure. Hash those.
  for (const id of Object.keys(out.worktreeTasks || {})) {
    const t = out.worktreeTasks[id];
    if (!t || typeof t !== 'object') continue;
    if (t.branch) t.branch = 'feat/' + hash6(t.branch);
    if (t.worktreePath) t.worktreePath = '/anon/' + hash6(t.worktreePath);
    if (t.repoDir) t.repoDir = '/anon/' + hash6(t.repoDir);
    if (t.baseBranch && t.baseBranch !== 'main' && t.baseBranch !== 'dev' && t.baseBranch !== 'master') {
      t.baseBranch = 'branch-' + hash6(t.baseBranch);
    }
    if (Array.isArray(t.tags)) {
      t.tags = t.tags.map(tag => 'tag-' + hash6(tag));
    }
  }

  return out;
}

/**
 * CLI entrypoint: parse --input/--output, read source, anonymize, write
 * fixture, log a summary so the operator can spot-check counts.
 */
function main() {
  const inputArg = process.argv.indexOf('--input');
  const outputArg = process.argv.indexOf('--output');
  const input = inputArg > -1
    ? process.argv[inputArg + 1]
    : path.join(os.homedir(), '.myrlin', 'workspaces.json');
  const output = outputArg > -1
    ? process.argv[outputArg + 1]
    : path.join(__dirname, '..', 'test', 'fixtures', 'migration-v1-state.json');

  if (!fs.existsSync(input)) {
    console.error('Input not found: ' + input);
    process.exit(1);
  }

  const raw = fs.readFileSync(input, 'utf-8');
  const state = JSON.parse(raw);
  const anon = anonymize(state);

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(anon, null, 2), 'utf-8');

  const wsCount = Object.keys(anon.workspaces || {}).length;
  const sessCount = Object.keys(anon.sessions || {}).length;
  const tmplCount = Object.keys(anon.templates || {}).length;
  console.log('Anonymized: ' + wsCount + ' workspaces, ' + sessCount + ' sessions, ' + tmplCount + ' templates');
  console.log('Wrote: ' + output);
}

if (require.main === module) main();

module.exports = { anonymize, hash6 };
