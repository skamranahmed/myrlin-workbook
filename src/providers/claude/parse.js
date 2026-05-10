/**
 * Claude parse helpers.
 *
 * extractCustomTitle and extractSessionName are MOVED VERBATIM from
 * src/web/server.js (formerly lines 7016-7083) in Plan 14-03 (ABST-03).
 * No logic change.
 *
 * parseTranscript is a NEW minimum-viable implementation introduced in
 * Plan 14-03 to satisfy the Provider contract surface (ABST-02). No
 * Phase 14 route consumes parseTranscript yet; Phase 15 will rewrite
 * /api/transcript through it. The body returns [] on missing/empty/
 * malformed JSONL and never throws on bad input (per Provider contract).
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * @module src/providers/claude/parse
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Extract a session name from the first user or assistant message content
 * in a JSONL file (first 50 chars), or fall back to the session UUID.
 * @param {string} filePath - Path to the .jsonl file
 * @param {string} sessionId - Fallback UUID
 * @returns {string} A human-readable session name
 */
function extractCustomTitle(jsonlPath) {
  try {
    const fd = fs.openSync(jsonlPath, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const tailSize = Math.min(131072, size);
      const buf = Buffer.alloc(tailSize);
      fs.readSync(fd, buf, 0, tailSize, size - tailSize);
      const lines = buf.toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].includes('"custom-title"')) {
          try {
            const obj = JSON.parse(lines[i]);
            if (obj.customTitle) return obj.customTitle;
          } catch (_) {}
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {}
  return null;
}

function extractSessionName(filePath, sessionId) {
  try {
    // Read just the first 10KB to find the first meaningful message
    const fd = fs.openSync(filePath, 'r');
    const headSize = Math.min(10 * 1024, fs.fstatSync(fd).size);
    const buf = Buffer.alloc(headSize);
    fs.readSync(fd, buf, 0, headSize, 0);
    fs.closeSync(fd);

    const lines = buf.toString('utf-8').split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const inner = entry.message || entry;
        const role = entry.type || inner.role;
        if (role !== 'user' && role !== 'human' && role !== 'assistant') continue;

        const c = inner.content;
        let text = '';
        if (typeof c === 'string') {
          text = c;
        } else if (Array.isArray(c)) {
          const textBlocks = c.filter(b => b.type === 'text' && b.text);
          text = textBlocks.map(b => b.text).join(' ');
        }
        // Skip system-generated and very short messages
        if (!text || text.length < 5) continue;
        if (text.startsWith('<') && text.includes('system-reminder')) continue;

        // Clean up and truncate to 50 chars
        text = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (text.length > 50) {
          text = text.substring(0, 50).replace(/\s+\S*$/, '') + '...';
        }
        return text;
      } catch (_) {
        // Skip unparseable lines
      }
    }
  } catch (_) {
    // Fall through to UUID
  }
  return sessionId;
}

/**
 * Load and normalize a Claude transcript by session UUID.
 * Returns ProviderMessage[]: [{role, text, timestamp, model}].
 * Returns [] for missing/empty/malformed JSONL. Never throws on bad
 * input per Provider contract; only catastrophic IO errors surface.
 *
 * STATUS: minimum-viable implementation introduced in Plan 14-03.
 * No Phase 14 route consumes this yet; the function exists to satisfy
 * the Provider interface contract surface (ABST-02) so Codex (Phase 17)
 * has a shape-compatible reference implementation. Phase 15 will route
 * /api/transcript through this function and may extend it to cover
 * additional tool-call shapes.
 *
 * @param {string} providerSessionId - Claude session UUID
 * @returns {Promise<Array<{role:string,text:string,timestamp:string|null,model:string|null}>>}
 */
async function parseTranscript(providerSessionId) {
  try {
    if (!providerSessionId || typeof providerSessionId !== 'string') return [];
    const claudeDir = path.join(os.homedir(), '.claude', 'projects');
    if (!fs.existsSync(claudeDir)) return [];

    let entries;
    try {
      entries = fs.readdirSync(claudeDir);
    } catch (_) {
      return [];
    }

    for (const dir of entries) {
      const jsonlPath = path.join(claudeDir, dir, providerSessionId + '.jsonl');
      let stat;
      try { stat = fs.statSync(jsonlPath); } catch (_) { continue; }
      if (!stat.isFile()) continue;

      let raw;
      try {
        raw = fs.readFileSync(jsonlPath, 'utf-8');
      } catch (_) {
        return [];
      }

      const lines = raw.split('\n').filter(Boolean);
      const messages = [];
      for (const line of lines) {
        try {
          const e = JSON.parse(line);
          const inner = e.message || e;
          const role = inner.role || e.role || e.type || 'system';
          if (role !== 'user' && role !== 'assistant' && role !== 'system' && role !== 'tool' && role !== 'human') {
            // Non-message envelope (e.g. permission-mode, custom-title); skip
            continue;
          }
          const normalizedRole = role === 'human' ? 'user' : role;

          const content = inner.content;
          let text = '';
          if (typeof content === 'string') {
            text = content;
          } else if (Array.isArray(content)) {
            text = content.map(c => {
              if (typeof c === 'string') return c;
              if (c && typeof c === 'object') {
                if (typeof c.text === 'string') return c.text;
                if (typeof c.content === 'string') return c.content;
              }
              return '';
            }).join('');
          }

          messages.push({
            role: normalizedRole,
            text: text,
            timestamp: e.timestamp || inner.timestamp || null,
            model: inner.model || e.model || null,
          });
        } catch (_) {
          // Skip unparseable line
        }
      }
      return messages;
    }
    return [];
  } catch (_) {
    return [];
  }
}

module.exports = {
  parseTranscript,
  extractCustomTitle,
  extractSessionName,
};
