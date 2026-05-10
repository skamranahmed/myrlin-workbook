/**
 * Claude path-decode helpers.
 *
 * MOVED VERBATIM from src/web/server.js lines 1717-1938 in Plan 14-03 (ABST-03).
 * No logic change. Only relocation behind the Provider abstraction.
 *
 * These helpers translate the encoded directory names that Claude Code uses
 * under ~/.claude/projects/ back to real filesystem paths, with special
 * handling for CJK-character-encoded paths and Windows drive letters.
 *
 * Composed by:
 *   - src/providers/claude/discover.js (consumes resolveProjectPath)
 *   - src/web/server.js (existing legacy callers, unchanged signatures)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * @module src/providers/claude/path-decode
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Decode a Claude projects directory name to a real filesystem path.
 * Uses filesystem-aware greedy matching to correctly handle hyphens in directory names.
 *
 * Encoding rules:
 *   "C--"  at start    -> "C:\"          (drive separator)
 *   "--"   in middle   -> "\."           (dot-prefixed dir, e.g. .claude)
 *   "-"    elsewhere   -> "\" OR literal "-"  (ambiguous, resolved via fs)
 *
 * Examples:
 *   C--Users-Jane-Desktop-my-project
 *     -> C:\Users\Jane\Desktop\my-project
 *   C--Users-Jane--claude
 *     -> C:\Users\Jane\.claude
 */
function decodeClaudePath(encoded) {
  // Windows path: C--Users-Jane-foo -> C:\Users\Jane\foo
  const driveMatch = encoded.match(/^([A-Z])--(.*)/);
  if (driveMatch) {
    const drive = driveMatch[1] + ':\\';
    const rest = driveMatch[2];
    if (!rest) return drive;

    // Split on '--' to handle dot-prefixed dirs (Jane--claude -> Jane\.claude)
    const majorParts = rest.split('--');
    let resolved = drive;

    for (let i = 0; i < majorParts.length; i++) {
      const part = majorParts[i];
      const dotPrefix = i > 0 ? '.' : '';
      const tokens = part.split('-').filter(t => t.length > 0);

      if (tokens.length === 0) continue;

      // Dot-prefixed segments (after --) are a single directory name
      if (dotPrefix) {
        resolved = path.join(resolved, '.' + tokens.join('-'));
        continue;
      }

      resolved = greedyFsWalk(resolved, tokens);
    }

    return resolved;
  }

  // Linux/macOS absolute path: -home-vivi-my-project -> /home/vivi/my-project
  // Claude encodes the leading '/' as a leading '-', and every '/' as '-'.
  if (encoded.startsWith('-')) {
    const tokens = encoded.slice(1).split('-').filter(t => t.length > 0);
    return greedyFsWalk('/', tokens);
  }

  // Unknown format - return as-is
  return encoded;
}

/**
 * Walk the filesystem greedily, resolving ambiguous hyphens.
 * Claude encodes both path separators AND spaces as '-', so "my-project"
 * could be one dir or two. We try the longest match first.
 */
function greedyFsWalk(root, tokens) {
  let resolved = root;
  let idx = 0;

  while (idx < tokens.length) {
    let matched = false;

    // Try longest slice first to prefer "claude-workspace-manager" over "claude"+"workspace"+"manager"
    for (let len = tokens.length - idx; len > 1; len--) {
      const slice = tokens.slice(idx, idx + len);
      // Try hyphen-joined, underscore-joined, and space-joined (Claude encodes
      // path separators, underscores, and spaces as dashes)
      const candidates = [slice.join('-'), slice.join('_'), slice.join(' ')];
      for (const candidate of candidates) {
        const candidatePath = path.join(resolved, candidate);
        try {
          if (fs.existsSync(candidatePath)) {
            resolved = candidatePath;
            idx += len;
            matched = true;
            break;
          }
        } catch (_) { /* skip */ }
      }
      if (matched) break;
    }

    if (!matched) {
      // Single token - treat as its own directory segment
      resolved = path.join(resolved, tokens[idx]);
      idx++;
    }
  }

  return resolved;
}

/**
 * Read the original path from a jsonl file's cwd field.
 * This contains the full path with Chinese characters, unlike the encoded directory name.
 * Only reads the first 4KB to avoid loading large files into memory.
 *
 * @param {string} projectDir - Absolute path to the project dir
 * @returns {string|null} The original path from cwd field, or null if not found
 */
function getOriginalPathFromJsonl(projectDir) {
  try {
    const jsonlFiles = fs.readdirSync(projectDir).filter(f => {
      if (!f.endsWith('.jsonl')) return false;
      try { return !fs.statSync(path.join(projectDir, f)).isDirectory(); } catch (_) { return false; }
    });

    // Try each file until one yields a cwd, stub sessions may lack it
    for (const jsonlFile of jsonlFiles) {
      try {
        const fd = fs.openSync(path.join(projectDir, jsonlFile), 'r');
        let content;
        try {
          const buffer = Buffer.alloc(16384);
          const bytesRead = fs.readSync(fd, buffer, 0, 16384, 0);
          content = buffer.toString('utf-8', 0, bytesRead);
        } finally {
          fs.closeSync(fd);
        }

        for (const line of content.split('\n')) {
          if (!line.includes('"cwd"')) continue;
          try {
            const record = JSON.parse(line);
            if (record.cwd && typeof record.cwd === 'string') return record.cwd;
          } catch (_) { continue; }
        }
      } catch (_) { continue; }
    }
  } catch (_) {}
  return null;
}

/**
 * Resolve the real filesystem path for a Claude projects directory.
 * Tries sources in order of reliability:
 * 1. sessions-index.json (reliable on all platforms)
 * 2. jsonl file's cwd field (contains original Chinese path)
 * 3. decodeClaudePath (legacy fallback)
 *
 * @param {string} projectDir - Absolute path to the project dir under ~/.claude/projects/
 * @param {string} encodedName - The encoded directory name (e.g. "-Users-jane-project")
 * @returns {string} The resolved real filesystem path
 */
function resolveProjectPath(projectDir, encodedName) {
  try {
    // 1. Try sessions-index.json first
    const indexPath = path.join(projectDir, 'sessions-index.json');
    if (fs.existsSync(indexPath)) {
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      // Newer format has originalPath at top level
      if (index.originalPath) return index.originalPath;
      // Older format only has projectPath inside entries
      if (index.entries && index.entries.length > 0 && index.entries[0].projectPath) {
        return index.entries[0].projectPath;
      }
    }
  } catch (_) {}

  // 2. Try to read from jsonl file's cwd field (for Chinese paths)
  const jsonlPath = getOriginalPathFromJsonl(projectDir);
  if (jsonlPath) return jsonlPath;

  // 3. Fall back to decoding the directory name
  return decodeClaudePath(encodedName);
}

/**
 * Regex to match CJK characters (Chinese, Japanese, Korean).
 * Covers: Hiragana, Katakana, CJK Extension A, CJK Unified Ideographs,
 * Hangul Syllables, and Fullwidth/Halfwidth forms.
 */
const CJK_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/;

/**
 * Extract a readable display name from an encoded directory name.
 * When realPath contains CJK characters (from jsonl cwd field), use it directly.
 * Otherwise, fall back to extracting from realPath or showing drive info.
 *
 * @param {string} encodedName - The encoded directory name (e.g. "D--Projects-CU------")
 * @param {string} realPath - The decoded path from resolveProjectPath
 * @returns {string} A human-readable display name
 */
function getProjectDisplayName(encodedName, realPath) {
  // If realPath contains CJK characters, it came from jsonl cwd, use it directly
  if (realPath && CJK_REGEX.test(realPath)) {
    const parts = realPath.split(/[\\/]/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : encodedName;
  }

  // Check if the encoded name has failed CJK encoding indicators
  // Claude Code replaces CJK characters with "-" during encoding
  // This creates long sequences of "-" in the encoded name (e.g., "CU------" where 6 dashes = 3 CJK chars)
  const longDashSequence = encodedName.match(/-{3,}/);
  if (longDashSequence) {
    // Extract drive letter and the rest (supports A-Z and a-z)
    const driveMatch = encodedName.match(/^([A-Za-z])--(.*)/);
    if (driveMatch) {
      const drive = driveMatch[1];
      const rest = driveMatch[2];
      // Try to extract meaningful parts (non-dash sequences)
      const parts = rest.split('-').filter(p => p.length > 0);
      // Take the last meaningful part as project name
      const name = parts.length > 0 ? parts[parts.length - 1] : encodedName;
      return `[${drive}:] ${name}`;
    }
  }

  // Default: extract the last path component from realPath
  if (realPath) {
    const parts = realPath.split(/[\\/]/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : encodedName;
  }

  return encodedName;
}

/**
 * Check if an encoded directory name likely contains CJK characters that were
 * replaced with dashes during encoding.
 * Returns true if the name contains long sequences of consecutive dashes.
 *
 * @param {string} encodedName - The encoded directory name
 * @returns {boolean} True if encoding likely replaced CJK characters
 */
function isLikelyFailedCJKDecode(encodedName) {
  if (!encodedName) return false;
  // Long sequences of dashes (3 or more) indicate CJK chars were replaced
  return /-{3,}/.test(encodedName);
}

module.exports = {
  decodeClaudePath,
  greedyFsWalk,
  resolveProjectPath,
  getOriginalPathFromJsonl,
  getProjectDisplayName,
  isLikelyFailedCJKDecode,
  CJK_REGEX,
};
