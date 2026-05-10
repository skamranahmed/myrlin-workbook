/**
 * Claude session discovery.
 *
 * STATUS: NEW minimum-viable implementation introduced in Plan 14-03 (ABST-03).
 *
 * Walks ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl and returns
 * ProviderSession[] suitable for the Provider contract. Composes the
 * MOVED helpers from path-decode.js (resolveProjectPath) and parse.js
 * (extractCustomTitle, extractSessionName) so the abstraction is real.
 *
 * Plan 15-02 (DISC-01/02/04/05) consumes this from the new per-provider
 * /api/discover dispatcher in src/web/server.js. The dispatcher groups the
 * returned ProviderSession[] by projectPath into the v1.2 accordion shape
 * the frontend renders; the encodedName field below is what the v1.1 shape
 * (?legacy=1 back-compat) uses as the accordion key.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.forceRefresh=false] - bypass any caching layer (no caching in Phase 14)
 * @returns {Promise<Array<{provider:string,providerSessionId:string,projectPath:string,encodedName:string,title:string|null,lastActive:Date,sizeBytes:number}>>}
 *   ProviderSession[] entries. The encodedName field (Plan 15-02) carries
 *   the ~/.claude/projects/<encodedName>/ directory basename and is
 *   preserved end-to-end so the v1.1 frontend's accordion-key shape
 *   continues to work. The field is OPTIONAL on the Provider contract;
 *   Codex's discover (Phase 17) may set it to null or omit it entirely.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * @module src/providers/claude/discover
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { resolveProjectPath } = require('./path-decode');
const { extractCustomTitle, extractSessionName } = require('./parse');

/**
 * Enumerate locally-discoverable Claude sessions.
 * Returns an empty array (never throws) when ~/.claude/projects/ is absent.
 *
 * @param {{forceRefresh?: boolean}} [opts]
 * @returns {Promise<Array>} ProviderSession[]
 */
async function discover(opts) {
  // forceRefresh accepted but not used in Phase 14 (no internal cache yet).
  void (opts && opts.forceRefresh);

  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(claudeDir)) return [];

  let topEntries;
  try {
    topEntries = fs.readdirSync(claudeDir, { withFileTypes: true });
  } catch (_) {
    return [];
  }

  const sessions = [];
  for (const entry of topEntries) {
    if (!entry.isDirectory()) continue;
    const projectDir = path.join(claudeDir, entry.name);
    let projectPath;
    try {
      projectPath = resolveProjectPath(projectDir, entry.name) || entry.name;
    } catch (_) {
      projectPath = entry.name;
    }

    let files;
    try {
      files = fs.readdirSync(projectDir);
    } catch (_) {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const fullPath = path.join(projectDir, file);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch (_) {
        continue;
      }
      if (!stat.isFile()) continue;

      const providerSessionId = file.replace(/\.jsonl$/, '');

      // Title extraction: prefer explicit custom-title entries, fall back to
      // first-message extraction. Both helpers swallow IO errors and return
      // null/uuid respectively, so this composition never throws.
      let title = null;
      try {
        title = extractCustomTitle(fullPath);
        if (!title) {
          const fromBody = extractSessionName(fullPath, providerSessionId);
          // extractSessionName returns the UUID as fallback; treat that as "no title"
          if (fromBody && fromBody !== providerSessionId) {
            title = fromBody;
          }
        }
      } catch (_) {
        // Title extraction must never break discovery
      }

      sessions.push({
        provider: 'claude', // gsd:provider-literal-allowed
        providerSessionId: providerSessionId,
        projectPath: projectPath,
        encodedName: entry.name, // Plan 15-02 (DISC-01): preserved for v1.1 frontend accordion key
        title: title,
        lastActive: stat.mtime,
        sizeBytes: stat.size,
      });
    }
  }

  return sessions;
}

module.exports = discover;
