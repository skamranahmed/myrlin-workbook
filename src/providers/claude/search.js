/**
 * Claude search adapter.
 *
 * STUB: Phase 16 will implement this; Phase 14 ships only the signature
 * to satisfy the Provider interface contract (ABST-02). Once Phase 16
 * lands, this file will be rewritten to wrap the JSONL search logic
 * currently inline at src/web/server.js (formerly lines 7413-7560)
 * with snippet extraction and a per-provider time budget.
 *
 * @module src/providers/claude/search
 */

'use strict';

/**
 * Search Claude transcripts for matches against a query.
 *
 * @param {Object} args
 * @param {string} args.query
 * @param {number} args.limit
 * @param {number} args.timeBudgetMs
 * @returns {Promise<Array>} SearchResult[]; never reached in Phase 14.
 * @throws {Error} 'claudeProvider.search not yet implemented in Phase 14; see Phase 16'
 */
async function search({ query, limit, timeBudgetMs } = {}) {
  // The arguments are accepted (and intentionally unused) so the interface
  // shape is stable for Phase 16 even though the body throws today.
  void query; void limit; void timeBudgetMs;
  throw new Error('claudeProvider.search not yet implemented in Phase 14; see Phase 16 for the dispatcher rewrite');
}

module.exports = { search };
