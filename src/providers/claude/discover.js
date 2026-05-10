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
 * No Phase 14 route consumes this yet. The existing /api/discover route
 * in src/web/server.js continues to walk the filesystem inline. Phase 15
 * will rewrite /api/discover to call this function and may extend it to
 * cover additional metadata (mtime sorting refinements, project name
 * grouping, etc.).
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.forceRefresh=false] - bypass any caching layer (no caching in Phase 14)
 * @returns {Promise<Array<{provider:string,providerSessionId:string,projectPath:string,title:string|null,lastActive:Date,sizeBytes:number}>>}
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
        title: title,
        lastActive: stat.mtime,
        sizeBytes: stat.size,
      });
    }
  }

  return sessions;
}

module.exports = discover;
