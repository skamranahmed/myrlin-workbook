/**
 * Byte-offset incremental JSONL tailer + tail-window reader.
 *
 * Issue #10 (session mirror, Tier 1) Phase 1 foundation. This module is the
 * transport half of the mirror feature: it turns an append-mostly JSONL file
 * on disk into a stream of complete raw lines without ever re-reading the
 * whole file. Provider modules (src/providers/<id>/mirror or parse) own the
 * per-line semantics; this file is intentionally provider-agnostic and MUST
 * NEVER require any provider module or contain provider-name literals
 * (grep gate: test/grep-gate.test.js walks src/ outside src/providers/).
 *
 * Why byte offsets: the real corpus contains multi-GB transcripts (a 1.86GB
 * file exists in production). readFile or start-at-zero scans are forbidden;
 * the only full-window entry point is readTailWindow, which is capped at
 * MIRROR_HISTORY_TAIL_BYTES from EOF.
 *
 * Watch strategy (mirrors src/providers/codex/index.js _startWatcher and
 * pty-manager.js waitForNewJsonl): fs.watch on the PARENT DIRECTORY with a
 * basename filter, because fs.watch on a single file handle on Windows breaks
 * when the file is replaced/recreated. Watch events are debounced
 * (MIRROR_DEBOUNCE_MS); a setInterval fstat poll (MIRROR_POLL_MS, unref'd)
 * is the fallback for platforms/filesystems where fs.watch drops events.
 *
 * UTF-8 boundary safety: the partial-line carry between reads is kept as a
 * Buffer, never a string. 0x0A (\n) can never be a UTF-8 continuation byte,
 * so splitting on the last 0x0A and only utf8-decoding the complete-lines
 * slice guarantees a multi-byte codepoint split across two appends is
 * reassembled without mojibake.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * @module src/web/jsonl-tailer
 */

'use strict';

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

// ---------------------------------------------------------------------------
// Named constants (env-overridable so operators can tune without a deploy)
// ---------------------------------------------------------------------------

/**
 * Parse a positive integer environment override, falling back to a default.
 * Malformed, zero, or negative values fall back silently (robustness: a bad
 * env var must never wedge the tailer with a nonsense budget).
 *
 * @param {string} name - Environment variable name.
 * @param {number} fallback - Default when the env var is absent or invalid.
 * @returns {number} The resolved positive integer.
 */
function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** History window read backwards from EOF by readTailWindow (bytes). */
const MIRROR_HISTORY_TAIL_BYTES = envInt('MIRROR_HISTORY_TAIL_BYTES', 2 * 1024 * 1024);

/** Debounce applied to fs.watch bursts before reading (milliseconds). */
const MIRROR_DEBOUNCE_MS = envInt('MIRROR_DEBOUNCE_MS', 200);

/** Fallback fstat poll cadence when fs.watch misses events (milliseconds). */
const MIRROR_POLL_MS = envInt('MIRROR_POLL_MS', 2000);

/**
 * Carry-buffer cap (bytes). A single line whose byte length exceeds this is
 * dropped (see OVERSIZED_LINE_SENTINEL) so a pathological transcript line
 * cannot balloon resident memory.
 */
const MIRROR_MAX_LINE_BYTES = envInt('MIRROR_MAX_LINE_BYTES', 2 * 1024 * 1024);

/** Per-read chunk cap (bytes); the read loop iterates while behind. */
const MIRROR_READ_CHUNK_BYTES = envInt('MIRROR_READ_CHUNK_BYTES', 4 * 1024 * 1024);

/**
 * Sentinel delivered through onLines when an oversized line was dropped.
 *
 * Contract: when the carry buffer exceeds maxLineBytes, the tailer drops the
 * partial line, enters skip-until-next-newline mode, and pushes this exact
 * string into the rawLines array at the position where the dropped line
 * would have appeared. Callers that care compare with === and render a
 * system notice ("a line was too large to mirror"). Callers that do not
 * know about the sentinel are still safe: the string starts with a NUL byte
 * so it can never be valid JSON, and every consumer in this codebase skips
 * unparseable lines. The NUL framing also guarantees no real JSONL line can
 * collide with it (transcript lines are JSON, which forbids raw NUL bytes).
 */
const OVERSIZED_LINE_SENTINEL = '\u0000__mirror_oversized_line_dropped__\u0000';

/** Byte value of '\n'; never a UTF-8 continuation byte, safe split point. */
const NEWLINE_BYTE = 0x0a;

/** Byte value of '\r'; stripped from line tails for CRLF tolerance. */
const CARRIAGE_RETURN = '\r';

/** Consecutive ENOENT poll observations required before onGone fires. */
const MISSING_POLLS_BEFORE_GONE = 2;

/** Shared zero-length buffer used to reset the carry without allocating. */
const EMPTY_BUFFER = Buffer.alloc(0);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Split a decoded complete-lines string (always ends with '\n') into an
 * array of lines with no trailing newline. A single trailing '\r' per line
 * is stripped for CRLF tolerance; blank lines are dropped because they carry
 * no JSONL content (offset math is unaffected, offsets count file bytes).
 *
 * @param {string} text - utf8 text ending at a newline boundary.
 * @returns {string[]} Complete non-empty lines.
 */
function splitCompleteLines(text) {
  const parts = text.split('\n');
  // split on a string ending in '\n' always yields a trailing '' element.
  parts.pop();
  const lines = [];
  for (let i = 0; i < parts.length; i++) {
    let line = parts[i];
    if (line.length > 0 && line[line.length - 1] === CARRIAGE_RETURN) {
      line = line.slice(0, -1);
    }
    if (line.length > 0) lines.push(line);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// JsonlTailer
// ---------------------------------------------------------------------------

/**
 * Incrementally tail a JSONL file from a byte offset, emitting complete
 * lines as they are appended.
 *
 * Callback contract:
 *   onLines(rawLines: string[], newOffset: number)
 *     Complete lines only, no trailing newline. newOffset is the byte
 *     offset immediately AFTER the last complete newline consumed, i.e.
 *     the safe value to persist and hand to a future tailer's startOffset
 *     (any pending partial line stays in the internal carry and its bytes
 *     are logically un-consumed). rawLines may contain the exported
 *     OVERSIZED_LINE_SENTINEL; see its doc for the drop contract. While in
 *     skip mode (right after a drop) newOffset can point mid-line; resuming
 *     from such an offset re-enters the oversized line, whose remainder then
 *     fails JSON.parse downstream and is skipped, so the stream self-heals.
 *   onTruncate(newSize: number)
 *     The file shrank below the current offset (truncate/rotate). The tailer
 *     resets its own offset to max(0, newSize - MIRROR_HISTORY_TAIL_BYTES),
 *     clears the carry, and then re-delivers the tail from the reset offset
 *     via onLines. Callers should treat onTruncate as "clear derived state
 *     now; fresh lines follow".
 *   onGone()
 *     ENOENT persisted across MISSING_POLLS_BEFORE_GONE consecutive checks.
 *     Fired at most once per disappearance episode. The tailer keeps polling
 *     (a rotated file may reappear); callers typically stop() the tailer.
 *
 * Lifecycle: start() and stop() are idempotent; stop() is safe to call
 * twice and a stopped tailer can be start()ed again.
 */
class JsonlTailer {
  /**
   * @param {string} filePath - Absolute (or resolvable) path of the JSONL file.
   * @param {object} [opts]
   * @param {number} [opts.startOffset=0] - Byte offset to start tailing from
   *   (typically readTailWindow().endOffset, which closes the history/tail race).
   * @param {(rawLines: string[], newOffset: number) => void} [opts.onLines]
   * @param {(newSize: number) => void} [opts.onTruncate]
   * @param {() => void} [opts.onGone]
   * @param {number} [opts.debounceMs=MIRROR_DEBOUNCE_MS]
   * @param {number} [opts.pollMs=MIRROR_POLL_MS]
   * @param {number} [opts.maxLineBytes=MIRROR_MAX_LINE_BYTES]
   * @param {boolean} [opts.watch=true] - Set false to disable fs.watch and
   *   rely purely on the fstat poll (used by tests to exercise the poll path
   *   deterministically; also useful on filesystems with broken watchers).
   */
  constructor(filePath, opts) {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new TypeError('JsonlTailer: filePath must be a non-empty string');
    }
    const o = opts && typeof opts === 'object' ? opts : {};

    /** @type {string} Absolute path of the tailed file. */
    this.filePath = path.resolve(filePath);
    /** @type {string} Parent directory that fs.watch is attached to. */
    this._dir = path.dirname(this.filePath);
    /**
     * Lowercased basename used as the watch filter. Windows filesystems are
     * case-insensitive, so the comparison is case-folded too.
     * @type {string}
     */
    this._basenameLower = path.basename(this.filePath).toLowerCase();

    this._onLines = typeof o.onLines === 'function' ? o.onLines : null;
    this._onTruncate = typeof o.onTruncate === 'function' ? o.onTruncate : null;
    this._onGone = typeof o.onGone === 'function' ? o.onGone : null;

    this._debounceMs = Number.isFinite(o.debounceMs) && o.debounceMs >= 0 ? o.debounceMs : MIRROR_DEBOUNCE_MS;
    this._pollMs = Number.isFinite(o.pollMs) && o.pollMs > 0 ? o.pollMs : MIRROR_POLL_MS;
    this._maxLineBytes = Number.isFinite(o.maxLineBytes) && o.maxLineBytes > 0 ? o.maxLineBytes : MIRROR_MAX_LINE_BYTES;
    this._useWatch = o.watch !== false;

    /** @type {number} Raw read position in the file (bytes consumed). */
    this._offset = Number.isFinite(o.startOffset) && o.startOffset >= 0 ? Math.floor(o.startOffset) : 0;

    /** @type {Buffer} Bytes after the last newline, awaiting completion. */
    this._carry = EMPTY_BUFFER;
    /** @type {boolean} True while discarding an oversized line's remainder. */
    this._skipUntilNewline = false;

    /** @type {fs.FSWatcher|null} */
    this._watcher = null;
    /** @type {NodeJS.Timeout|null} */
    this._pollTimer = null;
    /** @type {NodeJS.Timeout|null} */
    this._debounceTimer = null;

    this._started = false;
    this._stopped = false;
    /** @type {boolean} Re-entrancy guard: one read pipeline at a time. */
    this._checking = false;
    /** @type {boolean} A change arrived while a read was in flight. */
    this._recheck = false;

    /** @type {number} Consecutive checks that observed ENOENT. */
    this._missingChecks = 0;
    /** @type {boolean} onGone fired for the current disappearance episode. */
    this._goneFired = false;
  }

  /**
   * Begin watching + polling. Idempotent: calling start() on a running
   * tailer is a no-op. Also performs an immediate catch-up read so content
   * appended between startOffset capture and start() is not missed.
   *
   * @returns {void}
   */
  start() {
    if (this._started) return;
    this._started = true;
    this._stopped = false;
    this._ensureWatcher();
    this._pollTimer = setInterval(() => {
      // The poll doubles as a watcher self-heal: if the watcher errored out
      // (network drive hiccup, dir briefly unlinked) we re-arm it here.
      this._ensureWatcher();
      this._check();
    }, this._pollMs);
    // unref so a forgotten tailer never holds the process open.
    if (this._pollTimer && typeof this._pollTimer.unref === 'function') this._pollTimer.unref();
    this._check();
  }

  /**
   * Stop watching + polling and clear every timer. Idempotent and safe to
   * call twice (or before start()). A stopped tailer can be restarted with
   * start(); its offset and carry are preserved across the stop/start.
   *
   * @returns {void}
   */
  stop() {
    this._stopped = true;
    this._started = false;
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._watcher) {
      try { this._watcher.close(); } catch (_) { /* already closed */ }
      this._watcher = null;
    }
  }

  // -------------------------------------------------------------------------
  // Internal machinery
  // -------------------------------------------------------------------------

  /**
   * Attach fs.watch to the PARENT DIRECTORY with a basename filter. Watching
   * the directory (not the file) survives delete/recreate cycles on Windows,
   * where a single-file watch handle goes dead when the inode is replaced.
   * Failures fall through silently: the fstat poll is the safety net, and
   * the poll tick retries this method so the watcher self-heals.
   *
   * @returns {void}
   */
  _ensureWatcher() {
    if (!this._useWatch || this._watcher || this._stopped) return;
    try {
      const watcher = fs.watch(this._dir, (_event, filename) => {
        if (this._stopped) return;
        // filename can be null on some platforms; treat null as "maybe us".
        if (filename && String(filename).toLowerCase() !== this._basenameLower) return;
        this._scheduleDebouncedCheck();
      });
      // Without an error handler an fs.watch error becomes an uncaught
      // exception and takes the process down (known Windows failure mode).
      watcher.on('error', () => {
        try { watcher.close(); } catch (_) { /* already dead */ }
        if (this._watcher === watcher) this._watcher = null;
      });
      this._watcher = watcher;
    } catch (_) {
      // Parent dir missing or watch unsupported: poll fallback covers us.
      this._watcher = null;
    }
  }

  /**
   * Debounce a watch-event burst into a single _check call. Editors and the
   * CLI can fire dozens of change events for one logical append; reading
   * once after MIRROR_DEBOUNCE_MS of quiet is cheaper and still snappy.
   *
   * @returns {void}
   */
  _scheduleDebouncedCheck() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      this._check();
    }, this._debounceMs);
    if (this._debounceTimer && typeof this._debounceTimer.unref === 'function') this._debounceTimer.unref();
  }

  /**
   * Serialized entry point for "the file may have changed". Guarantees only
   * one read pipeline runs at a time; changes that arrive mid-read set a
   * recheck flag and are handled immediately after, so no event is lost.
   * Never throws (a tailer tick must never take the server down).
   *
   * @returns {Promise<void>}
   */
  async _check() {
    if (this._stopped) return;
    if (this._checking) {
      this._recheck = true;
      return;
    }
    this._checking = true;
    try {
      do {
        this._recheck = false;
        await this._checkOnce();
      } while (this._recheck && !this._stopped);
    } catch (_) {
      // Defensive: individual steps already guard their IO; this catch is
      // the last line of defense so a bug cannot produce an unhandled
      // rejection inside a timer callback.
    } finally {
      this._checking = false;
    }
  }

  /**
   * One stat-and-read cycle: classify the file state (missing, truncated,
   * grown, unchanged) and act on it.
   *
   * @returns {Promise<void>}
   */
  async _checkOnce() {
    let st;
    try {
      st = await fsp.stat(this.filePath);
    } catch (err) {
      if (err && err.code === 'ENOENT') this._handleMissing();
      // Other IO errors (EPERM during AV scan, transient network drive
      // failure) are treated as "try again next tick".
      return;
    }

    // File exists: reset the disappearance episode if one was in progress.
    this._missingChecks = 0;
    this._goneFired = false;

    const size = st.size;

    if (size < this._offset) {
      // Truncation or rotation-in-place. Reset to the tail window, discard
      // the now-meaningless carry, and tell the caller to re-seed BEFORE
      // fresh lines start flowing again.
      this._carry = EMPTY_BUFFER;
      this._offset = Math.max(0, size - MIRROR_HISTORY_TAIL_BYTES);
      // A mid-file reset can land mid-line; skip to the next newline so the
      // first delivered line after a truncate is always complete.
      this._skipUntilNewline = this._offset > 0;
      this._emit(this._onTruncate, size);
    }

    if (size > this._offset && !this._stopped) {
      await this._readPending();
    }
  }

  /**
   * Read [offset, size) in MIRROR_READ_CHUNK_BYTES slices using positioned
   * reads on an explicit file handle (never readFile, never byte 0 unless
   * offset is 0), feeding each slice through the line splitter. The handle
   * is closed in finally on every path.
   *
   * @returns {Promise<void>}
   */
  async _readPending() {
    let fh = null;
    try {
      try {
        fh = await fsp.open(this.filePath, 'r');
      } catch (err) {
        if (err && err.code === 'ENOENT') this._handleMissing();
        return;
      }

      // Authoritative size from the open handle (the pre-check stat may be
      // stale if the writer appended in between).
      let size;
      try {
        size = (await fh.stat()).size;
      } catch (_) {
        return;
      }
      if (size < this._offset) {
        // Raced with a truncation between stat and open; let the next tick
        // classify it through the truncate path.
        return;
      }

      while (!this._stopped && this._offset < size) {
        const want = Math.min(MIRROR_READ_CHUNK_BYTES, size - this._offset);
        const buf = Buffer.allocUnsafe(want);
        let bytesRead = 0;
        try {
          const res = await fh.read(buf, 0, want, this._offset);
          bytesRead = res.bytesRead;
        } catch (_) {
          return;
        }
        if (bytesRead <= 0) return; // EOF earlier than stat claimed; retry later.
        this._offset += bytesRead;
        this._ingestChunk(bytesRead === want ? buf : buf.subarray(0, bytesRead));
      }
    } finally {
      if (fh) {
        try { await fh.close(); } catch (_) { /* double-close or dead handle */ }
      }
    }
  }

  /**
   * Fold a freshly read chunk into the carry buffer, emit every complete
   * line, and enforce the oversized-line cap.
   *
   * Buffer-first design: the carry stays a Buffer and only the slice that
   * ends at the last 0x0A is utf8-decoded, so a multi-byte codepoint split
   * across chunk boundaries can never be corrupted (0x0A is never a UTF-8
   * continuation byte).
   *
   * @param {Buffer} chunk - Bytes just read from the file (owned by us).
   * @returns {void}
   */
  _ingestChunk(chunk) {
    let work = chunk;

    // Skip mode: we are inside a dropped oversized line; discard bytes
    // through the next newline, then resume normal processing.
    if (this._skipUntilNewline) {
      const nl = work.indexOf(NEWLINE_BYTE);
      if (nl === -1) return; // Entire chunk is still oversized-line remainder.
      work = work.subarray(nl + 1);
      this._skipUntilNewline = false;
      if (work.length === 0) return;
    }

    const buf = this._carry.length > 0 ? Buffer.concat([this._carry, work]) : work;
    const lastNl = buf.lastIndexOf(NEWLINE_BYTE);

    let lines = [];
    if (lastNl === -1) {
      // No complete line yet; everything becomes carry. `buf` is either a
      // fresh concat or a subarray of a buffer allocated for this read, so
      // holding the reference is safe (no reuse).
      this._carry = buf;
    } else {
      lines = splitCompleteLines(buf.toString('utf8', 0, lastNl + 1));
      // Copy the remainder so the (potentially multi-MB) chunk buffer can be
      // garbage collected instead of being pinned by a tiny subarray view.
      const rest = buf.subarray(lastNl + 1);
      this._carry = rest.length > 0 ? Buffer.from(rest) : EMPTY_BUFFER;
    }

    // Oversized-line guard: cap the carry, drop the line, surface a sentinel.
    let dropped = false;
    if (this._carry.length > this._maxLineBytes) {
      this._carry = EMPTY_BUFFER;
      this._skipUntilNewline = true;
      dropped = true;
    }

    if (lines.length > 0 || dropped) {
      if (dropped) lines.push(OVERSIZED_LINE_SENTINEL);
      // newOffset excludes any pending carry: it is the offset immediately
      // after the last complete newline, safe to persist as a resume point.
      this._emit(this._onLines, lines, this._offset - this._carry.length);
    }
  }

  /**
   * Track consecutive ENOENT observations; fire onGone exactly once per
   * disappearance episode after MISSING_POLLS_BEFORE_GONE misses. The carry
   * is cleared because it belongs to a file that no longer exists (if a new
   * file appears at the same path, stale bytes must not prefix its lines).
   *
   * @returns {void}
   */
  _handleMissing() {
    this._missingChecks++;
    if (this._missingChecks >= MISSING_POLLS_BEFORE_GONE && !this._goneFired) {
      this._goneFired = true;
      this._carry = EMPTY_BUFFER;
      this._skipUntilNewline = false;
      this._emit(this._onGone);
    }
  }

  /**
   * Invoke a user callback defensively: a throwing callback must never
   * break the read pipeline or leak as an unhandled rejection.
   *
   * @param {Function|null} fn - Callback (may be null when not configured).
   * @param {...*} args - Arguments forwarded to the callback.
   * @returns {void}
   */
  _emit(fn, ...args) {
    if (typeof fn !== 'function') return;
    try {
      fn(...args);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[jsonl-tailer] callback threw: ' + (err && err.message ? err.message : err));
    }
  }
}

// ---------------------------------------------------------------------------
// readTailWindow
// ---------------------------------------------------------------------------

/**
 * Read the last maxBytes of a file and return its complete lines plus the
 * byte offsets needed to attach a JsonlTailer with zero gap and zero overlap.
 *
 * Offset contract (closes the history/tail race):
 *   startOffset  max(0, size - maxBytes), advanced past the first partial
 *                line when the window starts mid-line. Implementation detail:
 *                one extra byte before the window is read so a window that
 *                happens to start exactly at a line boundary keeps that first
 *                complete line instead of blindly skipping it.
 *   endOffset    the byte AFTER the last complete newline. The trailing
 *                partial line (a write in progress) is NOT parsed and its
 *                bytes stay on disk for the tailer's first read; construct
 *                the follow-up tailer with {startOffset: endOffset}.
 *   truncatedHead true when the window did not reach back to byte 0 (older
 *                history exists beyond the window).
 *
 * Degenerate windows: a window that contains no newline at all (one giant
 * partial line) yields lines: [] with startOffset = endOffset positioned so
 * the tailer resumes cleanly (at EOF for a mid-line window; the fragment's
 * completion later fails JSON.parse downstream and is skipped).
 *
 * Rejects on IO errors (ENOENT and friends) so callers can distinguish
 * missing-file from empty-file; the file handle is closed in finally.
 *
 * @param {string} filePath - Path of the JSONL file.
 * @param {number} [maxBytes=MIRROR_HISTORY_TAIL_BYTES] - Window size in bytes.
 * @returns {Promise<{lines: string[], startOffset: number, endOffset: number, fileSize: number, truncatedHead: boolean}>}
 */
async function readTailWindow(filePath, maxBytes) {
  const cap = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : MIRROR_HISTORY_TAIL_BYTES;
  const fh = await fsp.open(filePath, 'r');
  try {
    const size = (await fh.stat()).size;
    if (size === 0) {
      return { lines: [], startOffset: 0, endOffset: 0, fileSize: 0, truncatedHead: false };
    }

    const rawStart = Math.max(0, size - cap);
    const truncatedHead = rawStart > 0;
    // Read one sentinel byte before the window (when possible) so we can
    // tell whether rawStart is already a line start (previous byte is \n).
    const readStart = truncatedHead ? rawStart - 1 : 0;

    const total = size - readStart;
    const buf = Buffer.allocUnsafe(total);
    let pos = 0;
    while (pos < total) {
      const want = Math.min(MIRROR_READ_CHUNK_BYTES, total - pos);
      const { bytesRead } = await fh.read(buf, pos, want, readStart + pos);
      if (bytesRead <= 0) break; // File shrank mid-read; use what we have.
      pos += bytesRead;
    }
    const data = pos === total ? buf : buf.subarray(0, pos);

    // Locate the first complete line inside the window.
    let startIdx = 0;
    if (truncatedHead) {
      const firstNl = data.indexOf(NEWLINE_BYTE);
      if (firstNl === -1) {
        // The whole window is one giant partial line. Nothing parseable;
        // point the tailer at EOF so it only sees future appends.
        return { lines: [], startOffset: size, endOffset: size, fileSize: size, truncatedHead: true };
      }
      startIdx = firstNl + 1;
    }
    const startOffset = readStart + startIdx;

    const lastNl = data.lastIndexOf(NEWLINE_BYTE);
    if (lastNl < startIdx) {
      // No complete newline at or after the first line boundary: the window
      // holds at most one unfinished line. Leave its bytes for the tailer.
      return { lines: [], startOffset, endOffset: startOffset, fileSize: size, truncatedHead };
    }

    const lines = splitCompleteLines(data.toString('utf8', startIdx, lastNl + 1));
    return {
      lines,
      startOffset,
      endOffset: readStart + lastNl + 1,
      fileSize: size,
      truncatedHead,
    };
  } finally {
    try { await fh.close(); } catch (_) { /* already closed */ }
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  JsonlTailer,
  readTailWindow,
  OVERSIZED_LINE_SENTINEL,
  // Constants exported so the future wiring task and tests share one source
  // of truth instead of re-declaring magic numbers.
  MIRROR_HISTORY_TAIL_BYTES,
  MIRROR_DEBOUNCE_MS,
  MIRROR_POLL_MS,
  MIRROR_MAX_LINE_BYTES,
  MIRROR_READ_CHUNK_BYTES,
};
