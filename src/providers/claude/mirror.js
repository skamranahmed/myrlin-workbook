/**
 * Claude Code per-line mirror parser.
 *
 * Issue #10 (session mirror, Tier 1) Phase 2. Turns ONE raw JSONL transcript
 * line into at most one MirrorMessage for the live mirror stream. It is the
 * per-line sibling of parseTranscript (src/providers/claude/parse.js), which
 * is intentionally left untouched (code preservation): parseTranscript owns
 * the whole-file transcript view, parseLine owns the incremental tail view
 * fed by src/web/jsonl-tailer.js. parse.js exports no reusable content
 * extraction helpers (its logic is inlined in parseTranscript), so this
 * module is self-contained by design.
 *
 * Contract: parseLine is pure, synchronous, and NEVER throws. Anything it
 * cannot understand maps to null and the caller simply skips the line. This
 * also covers the tailer's oversized-line sentinel (a NUL-framed string that
 * can never be valid JSON): it fails JSON.parse here and returns null, so a
 * mirror consumer that does not special-case the sentinel stays correct.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * @module src/providers/claude/mirror
 */

'use strict';

// ---------------------------------------------------------------------------
// Shared mirror message shape (contract for ALL provider mirror modules)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} MirrorMessage
 * @property {'user'|'assistant'|'system'|'tool'} role  Who the entry belongs to.
 * @property {string} text                              Display text, capped at MIRROR_MAX_TEXT_CHARS.
 * @property {string|null} timestamp                    ISO timestamp when present on the line.
 * @property {string|null} model                        Model id for assistant text; null elsewhere.
 * @property {'text'|'tool_use'|'tool_result'|'system'} [kind]  Fine-grained rendering hint.
 * @property {string} [toolName]                        Tool name, present when kind === 'tool_use'.
 * @property {boolean} [truncated]                      True when text was capped (only set when true).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum characters of text carried by one MirrorMessage. Mirror frames go
 * over SSE to potentially slow mobile clients; a 2MB tool result must not
 * become a 2MB SSE frame. Truncation is flagged via truncated:true so the
 * UI can render an ellipsis affordance.
 */
const MIRROR_MAX_TEXT_CHARS = 8192;

/**
 * Transcript entry types that never carry mirror-visible conversation
 * content. progress = streaming progress ticks, file-history-snapshot =
 * checkpoint bookkeeping, queue-operation = queued-prompt bookkeeping,
 * custom-title = rename events, summary = compact summaries (rendered via
 * other surfaces, not the live mirror).
 */
const SKIPPED_TYPES = new Set([
  'progress',
  'file-history-snapshot',
  'queue-operation',
  'custom-title',
  'summary',
]);

/** Separator used when joining multiple text blocks from one line. */
const TEXT_BLOCK_JOINER = '\n';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a MirrorMessage, applying the text cap. Central choke point so every
 * emit path shares identical capping + shape.
 *
 * @param {'user'|'assistant'|'system'|'tool'} role
 * @param {'text'|'tool_use'|'tool_result'|'system'} kind
 * @param {string} text - Uncapped text (may be empty).
 * @param {string|null} timestamp
 * @param {string|null} model
 * @param {string|null} toolName - Set only for kind 'tool_use'.
 * @returns {MirrorMessage}
 */
function buildMessage(role, kind, text, timestamp, model, toolName) {
  const raw = typeof text === 'string' ? text : '';
  const capped = raw.length > MIRROR_MAX_TEXT_CHARS;
  const msg = {
    role: role,
    text: capped ? raw.slice(0, MIRROR_MAX_TEXT_CHARS) : raw,
    timestamp: typeof timestamp === 'string' ? timestamp : null,
    model: typeof model === 'string' ? model : null,
    kind: kind,
  };
  if (toolName) msg.toolName = toolName;
  if (capped) msg.truncated = true;
  return msg;
}

/**
 * Join every {type:'text'} block of a content array into one string.
 * Non-text blocks (thinking, images, tool blocks) are ignored here; the
 * callers decide what to do when no text blocks exist.
 *
 * @param {Array} content - message.content array.
 * @returns {string} Joined text; empty string when no text blocks exist.
 */
function joinTextBlocks(content) {
  const parts = [];
  for (const block of content) {
    if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
      parts.push(block.text);
    }
  }
  return parts.join(TEXT_BLOCK_JOINER);
}

/**
 * Stringify one tool_result block's content into display text. Real-world
 * shapes: a plain string, or an array of {type:'text', text} parts; anything
 * else is JSON-stringified defensively so no result shape is dropped silently.
 *
 * @param {Object} block - A {type:'tool_result'} content block.
 * @returns {string} Display text for the result (may be empty).
 */
function stringifyToolResult(block) {
  const c = block.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    const parts = [];
    for (const p of c) {
      if (typeof p === 'string') parts.push(p);
      else if (p && typeof p === 'object' && typeof p.text === 'string') parts.push(p.text);
    }
    return parts.join(TEXT_BLOCK_JOINER);
  }
  if (c === undefined || c === null) return '';
  try {
    return JSON.stringify(c);
  } catch (_) {
    return String(c);
  }
}

/**
 * Stringify a tool_use input object for display. JSON.parse output can never
 * be circular, but the try/catch keeps the never-throws guarantee airtight.
 *
 * @param {*} input - The tool_use block's input value.
 * @returns {string} JSON text of the input; '{}' for absent input.
 */
function stringifyToolInput(input) {
  if (input === undefined) return '{}';
  try {
    const s = JSON.stringify(input);
    return typeof s === 'string' ? s : '{}';
  } catch (_) {
    return '{}';
  }
}

/**
 * Map a user-typed line's message body to a MirrorMessage.
 * String content -> user text. Array content -> joined text blocks when any
 * exist, otherwise the line is a tool-result carrier: every tool_result
 * block's content is stringified and joined into ONE role:'tool' message
 * (parseLine emits at most one message per line by contract).
 *
 * @param {Object} inner - The entry.message object.
 * @param {string|null} ts - Entry timestamp.
 * @returns {MirrorMessage|null}
 */
function parseUserMessage(inner, ts) {
  const content = inner.content;
  if (typeof content === 'string') {
    if (content.length === 0) return null;
    return buildMessage('user', 'text', content, ts, null, null);
  }
  if (!Array.isArray(content)) return null;

  const text = joinTextBlocks(content);
  if (text.length > 0) {
    return buildMessage('user', 'text', text, ts, null, null);
  }

  const results = [];
  for (const block of content) {
    if (block && typeof block === 'object' && block.type === 'tool_result') {
      results.push(stringifyToolResult(block));
    }
  }
  if (results.length > 0) {
    return buildMessage('tool', 'tool_result', results.join(TEXT_BLOCK_JOINER), ts, null, null);
  }
  return null; // e.g. image-only content; nothing mirrorable.
}

/**
 * Map an assistant line's message body to a MirrorMessage.
 * Text blocks win when present (joined, model attached). Otherwise the first
 * tool_use block becomes a role:'tool' message carrying the stringified
 * input (model deliberately null on tool messages so tool frames look
 * identical across providers). Thinking-only lines map to null.
 *
 * In practice Claude Code writes one content block per JSONL line, so the
 * text-over-tool priority only matters for hypothetical combined lines.
 *
 * @param {Object} inner - The entry.message object.
 * @param {string|null} ts - Entry timestamp.
 * @returns {MirrorMessage|null}
 */
function parseAssistantMessage(inner, ts) {
  const model = typeof inner.model === 'string' ? inner.model : null;
  const content = inner.content;
  if (typeof content === 'string') {
    if (content.length === 0) return null;
    return buildMessage('assistant', 'text', content, ts, model, null);
  }
  if (!Array.isArray(content)) return null;

  const text = joinTextBlocks(content);
  if (text.length > 0) {
    return buildMessage('assistant', 'text', text, ts, model, null);
  }

  for (const block of content) {
    if (block && typeof block === 'object' && block.type === 'tool_use') {
      const toolName = typeof block.name === 'string' && block.name.length > 0 ? block.name : null;
      return buildMessage('tool', 'tool_use', stringifyToolInput(block.input), ts, null, toolName);
    }
  }
  return null; // thinking-only / redacted content; nothing mirrorable.
}

// ---------------------------------------------------------------------------
// Public: parseLine
// ---------------------------------------------------------------------------

/**
 * Parse ONE raw Claude JSONL transcript line into a MirrorMessage.
 *
 * Emit set:
 *   user string content            -> {role:'user', kind:'text'}
 *   user text blocks               -> {role:'user', kind:'text'} (joined)
 *   user tool_result blocks        -> {role:'tool', kind:'tool_result'}
 *   assistant text blocks          -> {role:'assistant', kind:'text', model}
 *   assistant tool_use block       -> {role:'tool', kind:'tool_use', toolName}
 *   system lines (string content)  -> {role:'system', kind:'system'}
 *
 * Skip set (returns null): progress, file-history-snapshot, queue-operation,
 * custom-title, summary, thinking-only assistant lines, image-only user
 * lines, unknown types, and anything unparseable (including the tailer's
 * oversized-line sentinel). All text is capped at MIRROR_MAX_TEXT_CHARS
 * with truncated:true when the cap applied.
 *
 * Pure, synchronous, never throws.
 *
 * @param {string} line - One raw JSONL line (no trailing newline).
 * @returns {MirrorMessage|null}
 */
function parseLine(line) {
  try {
    if (typeof line !== 'string' || line.length === 0) return null;

    let entry;
    try {
      entry = JSON.parse(line);
    } catch (_) {
      return null; // Corrupt / partial / sentinel line.
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;

    const type = typeof entry.type === 'string' ? entry.type : null;
    if (type && SKIPPED_TYPES.has(type)) return null;

    const ts = typeof entry.timestamp === 'string' ? entry.timestamp : null;

    // System notices (hook output, API error banners) carry a top-level
    // string content field instead of a message envelope.
    if (type === 'system') {
      const text = typeof entry.content === 'string' ? entry.content : '';
      if (text.length === 0) return null;
      return buildMessage('system', 'system', text, ts, null, null);
    }

    const inner = entry.message && typeof entry.message === 'object' ? entry.message : null;
    if (!inner) return null;
    const role = typeof inner.role === 'string' ? inner.role : type;

    if (type === 'user' || role === 'user' || role === 'human') {
      return parseUserMessage(inner, ts);
    }
    if (type === 'assistant' || role === 'assistant') {
      return parseAssistantMessage(inner, ts);
    }
    return null; // Unknown envelope; defensive skip.
  } catch (_) {
    return null; // Never throws, by contract.
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  parseLine,
  MIRROR_MAX_TEXT_CHARS,
};
