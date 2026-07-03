/**
 * MirrorService: server-side owner of read-only live session mirrors.
 *
 * Issue #10 (session mirror, Tier 1) Phase 3. Bridges the transport layer
 * (src/web/jsonl-tailer.js, byte-offset incremental reads) and the provider
 * layer (provider.mirror.parseLine + provider.findArtifactPath) into a
 * refcounted watcher registry keyed by providerId + ':' + providerSessionId.
 * HTTP routes in src/web/server.js own request validation; SSE fan-out is
 * injected as a `broadcast` callback so this module never touches Express
 * or the SSE client map directly (modularity: swappable transport).
 *
 * This file MUST stay provider-agnostic: no provider-name literals, all
 * provider resolution goes through the injected getProvider (the registry).
 * Grep gate: test/grep-gate.test.js.
 *
 * Event contract (all payloads carry mirrorKey; SSE delivery is scoped by
 * server.js to subscribersOf(mirrorKey)):
 *   mirror:message {mirrorKey, messages, offset, prevOffset}
 *     Batched MirrorMessages. offset = byte offset after the batch,
 *     prevOffset = offset before it (null right after a truncate reset).
 *     Batches are contiguous: a client whose known offset equals prevOffset
 *     appends; offset <= known means duplicate (skip); anything else means
 *     a gap or partial overlap and the client should re-open (idempotent).
 *     Empty batches ARE broadcast (every parsed-to-null line still advances
 *     offset; suppressing them would fake gaps on the client).
 *   mirror:reset {mirrorKey, reason:'truncated'}
 *     The file shrank; derived client state must be cleared. Fresh tail
 *     lines follow as normal mirror:message events with prevOffset null.
 *   mirror:status {mirrorKey, live}
 *     Liveness transition. live=true on any new line; live=false after
 *     liveThresholdMs without activity (mtime semantics: "recently wrote
 *     transcript", not "process running").
 *   mirror:closed {mirrorKey, reason:'gone'|'idle'|'disposed'}
 *     The watcher is torn down (file deleted, refcount idle timeout, or
 *     server shutdown). Clients render a disconnected notice.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * @module src/web/mirror-service
 */

'use strict';

const fsp = require('fs').promises;
const {
  JsonlTailer,
  readTailWindow,
  MIRROR_HISTORY_TAIL_BYTES,
  MIRROR_DEBOUNCE_MS,
  MIRROR_POLL_MS,
} = require('./jsonl-tailer');

// ---------------------------------------------------------------------------
// Named constants (env-overridable for operators; ctor-overridable for tests)
// ---------------------------------------------------------------------------

/**
 * Parse a positive integer environment override, falling back to a default.
 * Mirrors the helper in jsonl-tailer.js (duplicated on purpose: the two
 * modules stay independently extractable).
 *
 * @param {string} name - Environment variable name.
 * @param {number} fallback - Default when absent or invalid.
 * @returns {number} Resolved positive integer.
 */
function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Maximum number of DISTINCT mirror keys with live tailers at once. */
const MIRROR_MAX_WATCHERS = envInt('CWM_MIRROR_MAX_WATCHERS', 10);

/** Grace period after the last subscriber closes before the tailer stops. */
const MIRROR_IDLE_CLOSE_MS = envInt('CWM_MIRROR_IDLE_CLOSE_MS', 60000);

/**
 * Hard cap on MirrorMessage.text length. Providers already cap at the same
 * value; this is defense in depth so a future provider that forgets cannot
 * push multi-MB SSE frames.
 */
const MIRROR_MAX_TEXT_CHARS = envInt('CWM_MIRROR_MAX_TEXT_CHARS', 8192);

/**
 * Activity window for the `live` flag. Shares the env knob with the Phase 0
 * discovery liveness constant in server.js so the sidebar dot and the mirror
 * header dot always agree on what "live" means.
 */
const MIRROR_LIVE_THRESHOLD_MS = envInt('CWM_LIVE_THRESHOLD_MS', 120000);

/**
 * Cadence of the housekeeping sweep (liveness transitions + GC of
 * subscribers whose SSE client vanished without a close call).
 */
const MIRROR_SWEEP_MS = envInt('CWM_MIRROR_SWEEP_MS', 15000);

/**
 * Consecutive sweeps a subscriber's device may be absent from the SSE
 * client map before it is force-unsubscribed. Two misses (~30s) tolerate a
 * quick reconnect (mobile network blip) without leaking a tailer forever
 * when a tab is closed without POSTing /api/mirror/close.
 */
const MIRROR_SUBSCRIBER_MISS_LIMIT = 2;

/** Separator between providerId and providerSessionId in a mirror key. */
const MIRROR_KEY_SEPARATOR = ':';

/** Byte value of '\n' (never a UTF-8 continuation byte; safe split point). */
const NEWLINE_BYTE = 0x0a;

/** Per-read chunk cap for readEarlier's positioned reads (bytes). */
const MIRROR_EARLIER_READ_CHUNK_BYTES = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Error helper
// ---------------------------------------------------------------------------

/**
 * Build an Error carrying a machine-readable .code that the HTTP layer maps
 * to a status (MIRROR_UNSUPPORTED -> 400, ARTIFACT_NOT_FOUND -> 404,
 * MIRROR_LIMIT -> 409). Real Error instances (not bare objects) so stack
 * traces survive into logs.
 *
 * @param {string} code - Machine-readable error code.
 * @param {string} message - Human-readable detail.
 * @returns {Error} Error with .code attached.
 */
function mirrorError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// MirrorService
// ---------------------------------------------------------------------------

class MirrorService {
  /**
   * @param {object} opts
   * @param {(id: string) => object|null} opts.getProvider - Registry lookup
   *   (injected so this module never imports provider files).
   * @param {(type: string, data: object) => void} opts.broadcast - SSE
   *   fan-out (server.js broadcastSSE); called with mirror:* event types.
   * @param {(deviceId: string) => boolean} [opts.isDeviceConnected] - Probe
   *   used by the sweep to GC subscribers whose SSE client vanished without
   *   a close call. Optional: without it, cleanup relies on explicit close.
   * @param {number} [opts.historyTailBytes=MIRROR_HISTORY_TAIL_BYTES]
   * @param {number} [opts.maxWatchers=MIRROR_MAX_WATCHERS]
   * @param {number} [opts.idleCloseMs=MIRROR_IDLE_CLOSE_MS]
   * @param {number} [opts.maxTextChars=MIRROR_MAX_TEXT_CHARS]
   * @param {number} [opts.liveThresholdMs=MIRROR_LIVE_THRESHOLD_MS]
   * @param {number} [opts.sweepMs=MIRROR_SWEEP_MS]
   * @param {number} [opts.debounceMs=MIRROR_DEBOUNCE_MS] - Tailer debounce.
   * @param {number} [opts.pollMs=MIRROR_POLL_MS] - Tailer fallback poll.
   */
  constructor(opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    if (typeof o.getProvider !== 'function') {
      throw new TypeError('MirrorService: getProvider function is required');
    }
    if (typeof o.broadcast !== 'function') {
      throw new TypeError('MirrorService: broadcast function is required');
    }
    this._getProvider = o.getProvider;
    this._broadcastFn = o.broadcast;
    this._isDeviceConnected = typeof o.isDeviceConnected === 'function' ? o.isDeviceConnected : null;

    // Tunables: ctor override (tests) > env override (operators) > default.
    this._historyTailBytes = Number.isFinite(o.historyTailBytes) && o.historyTailBytes > 0 ? o.historyTailBytes : MIRROR_HISTORY_TAIL_BYTES;
    this._maxWatchers = Number.isFinite(o.maxWatchers) && o.maxWatchers > 0 ? o.maxWatchers : MIRROR_MAX_WATCHERS;
    this._idleCloseMs = Number.isFinite(o.idleCloseMs) && o.idleCloseMs >= 0 ? o.idleCloseMs : MIRROR_IDLE_CLOSE_MS;
    this._maxTextChars = Number.isFinite(o.maxTextChars) && o.maxTextChars > 0 ? o.maxTextChars : MIRROR_MAX_TEXT_CHARS;
    this._liveThresholdMs = Number.isFinite(o.liveThresholdMs) && o.liveThresholdMs > 0 ? o.liveThresholdMs : MIRROR_LIVE_THRESHOLD_MS;
    this._sweepMs = Number.isFinite(o.sweepMs) && o.sweepMs > 0 ? o.sweepMs : MIRROR_SWEEP_MS;
    this._debounceMs = Number.isFinite(o.debounceMs) && o.debounceMs >= 0 ? o.debounceMs : MIRROR_DEBOUNCE_MS;
    this._pollMs = Number.isFinite(o.pollMs) && o.pollMs > 0 ? o.pollMs : MIRROR_POLL_MS;

    /**
     * mirrorKey -> entry. Entry shape:
     * {
     *   mirrorKey, providerId, providerSessionId, filePath,
     *   parseLine,                        provider.mirror.parseLine bound ref
     *   tailer,                           JsonlTailer instance
     *   subscribers: Map<deviceId, {missedSweeps:number}>,
     *   lastBroadcastOffset: number|null, offset after last emitted batch
     *                                     (null right after a truncate reset)
     *   live: boolean, lastActivityMs: number,
     *   idleTimer: Timeout|null,          pending refcount-zero teardown
     * }
     * @type {Map<string, object>}
     */
    this._entries = new Map();

    /**
     * Per-key open serialization chain. Two concurrent opens for the same
     * key would otherwise both see "no entry" and start two tailers, leaking
     * one. Map value is the tail of the promise chain for that key.
     * @type {Map<string, Promise>}
     */
    this._openChain = new Map();

    /** @type {NodeJS.Timeout|null} Housekeeping sweep timer (unref'd). */
    this._sweepTimer = null;

    /** @type {boolean} disposeAll() called; all opens rejected after. */
    this._disposed = false;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Open (or attach to) a mirror for one provider session.
   *
   * Idempotent per key: the first open creates the tailer; subsequent opens
   * add the deviceId as a subscriber and return a FRESH history snapshot
   * (readTailWindow at call time), so a reconnecting client fully replaces
   * its message list and resumes from the returned endOffset. One tailer per
   * key regardless of subscriber count.
   *
   * History/live sequencing (no duplicates, no gaps): on repeat opens the
   * shared tailer is drain()ed first, so the fresh window's endOffset is
   * always >= the tailer's lastBroadcastOffset; any batch broadcast after
   * this open with offset <= endOffset is a duplicate the client skips.
   *
   * @param {object} args
   * @param {string} args.provider - Provider id (validated by the route).
   * @param {string} args.providerSessionId - Upstream session id.
   * @param {string} args.deviceId - SSE device id of the subscribing client.
   * @returns {Promise<{mirrorKey:string, live:boolean, fileSize:number,
   *   startOffset:number, endOffset:number, truncatedHead:boolean,
   *   history:Array}>}
   * @throws {Error} code MIRROR_UNSUPPORTED | ARTIFACT_NOT_FOUND | MIRROR_LIMIT
   */
  async open(args) {
    const a = args && typeof args === 'object' ? args : {};
    if (this._disposed) throw mirrorError('MIRROR_DISPOSED', 'mirror service is shut down');
    if (typeof a.provider !== 'string' || a.provider.length === 0) {
      throw mirrorError('MIRROR_UNSUPPORTED', 'provider id is required');
    }
    if (typeof a.providerSessionId !== 'string' || a.providerSessionId.length === 0) {
      throw mirrorError('ARTIFACT_NOT_FOUND', 'providerSessionId is required');
    }
    if (typeof a.deviceId !== 'string' || a.deviceId.length === 0) {
      throw mirrorError('MIRROR_BAD_DEVICE', 'deviceId is required');
    }
    const key = a.provider + MIRROR_KEY_SEPARATOR + a.providerSessionId;

    // Serialize per key: chain onto any in-flight open for the same key so
    // concurrent opens cannot double-create the tailer. The .catch(() => {})
    // keeps one rejected open from poisoning the chain for the next caller.
    const prev = this._openChain.get(key) || Promise.resolve();
    const run = prev.catch(() => { /* previous open's error belongs to its caller */ })
      .then(() => this._openImpl(a, key));
    this._openChain.set(key, run);
    // GC the chain slot once this link settles and is still the tail.
    run.catch(() => {}).then(() => {
      if (this._openChain.get(key) === run) this._openChain.delete(key);
    });
    return run;
  }

  /**
   * Detach a device from a mirror. When the last subscriber leaves, the
   * tailer keeps running for idleCloseMs (a page refresh should not lose
   * the watcher), then tears down and emits mirror:closed {reason:'idle'}.
   *
   * @param {object} args
   * @param {string} args.mirrorKey - Key returned by open().
   * @param {string} args.deviceId - Device to unsubscribe.
   * @returns {{ok: boolean, subscribers: number}}
   */
  close(args) {
    const a = args && typeof args === 'object' ? args : {};
    const entry = this._entries.get(a.mirrorKey);
    if (!entry) return { ok: true, subscribers: 0 };
    if (a.deviceId) entry.subscribers.delete(a.deviceId);
    if (entry.subscribers.size === 0) this._scheduleIdleClose(entry);
    return { ok: true, subscribers: entry.subscribers.size };
  }

  /**
   * The device ids currently subscribed to a mirror key. server.js uses
   * this to scope mirror:* SSE delivery. Always returns a Set (empty for
   * unknown keys) so callers never null-check.
   *
   * @param {string} mirrorKey
   * @returns {Set<string>}
   */
  subscribersOf(mirrorKey) {
    const entry = this._entries.get(mirrorKey);
    if (!entry) return new Set();
    return new Set(entry.subscribers.keys());
  }

  /**
   * Stateless "Load earlier" window read: parse the lines in
   * [beforeOffset - maxBytes, beforeOffset) without touching any watcher.
   * beforeOffset is expected to be line-aligned (clients pass startOffset
   * from a previous open/readEarlier response); a non-aligned offset is
   * tolerated by dropping the trailing partial line.
   *
   * @param {object} args
   * @param {string} args.provider
   * @param {string} args.providerSessionId
   * @param {number} args.beforeOffset - Exclusive upper bound (bytes).
   * @param {number} [args.maxBytes] - Window size, clamped to historyTailBytes.
   * @returns {Promise<{messages:Array, startOffset:number, truncatedHead:boolean}>}
   * @throws {Error} code MIRROR_UNSUPPORTED | ARTIFACT_NOT_FOUND
   */
  async readEarlier(args) {
    const a = args && typeof args === 'object' ? args : {};
    const { parseLine, filePath } = this._resolve(a.provider, a.providerSessionId);

    // Clamp the window: never allow a query param to force a giant read.
    const cap = Number.isFinite(a.maxBytes) && a.maxBytes > 0
      ? Math.min(Math.floor(a.maxBytes), this._historyTailBytes)
      : this._historyTailBytes;
    const before = Number.isFinite(a.beforeOffset) && a.beforeOffset > 0 ? Math.floor(a.beforeOffset) : 0;
    if (before === 0) return { messages: [], startOffset: 0, truncatedHead: false };

    let fh;
    try {
      fh = await fsp.open(filePath, 'r');
    } catch (err) {
      if (err && err.code === 'ENOENT') throw mirrorError('ARTIFACT_NOT_FOUND', 'transcript vanished: ' + filePath);
      throw err;
    }
    try {
      const size = (await fh.stat()).size;
      // The file may have been truncated below beforeOffset since the client
      // captured it; clamp so we never read past EOF.
      const end = Math.min(before, size);
      if (end <= 0) return { messages: [], startOffset: 0, truncatedHead: false };

      const rawStart = Math.max(0, end - cap);
      const truncatedHead = rawStart > 0;
      // One sentinel byte before the window (when possible) so a window that
      // begins exactly at a line boundary keeps that first complete line
      // (same trick as readTailWindow in jsonl-tailer.js).
      const readStart = truncatedHead ? rawStart - 1 : 0;

      const total = end - readStart;
      const buf = Buffer.allocUnsafe(total);
      let pos = 0;
      while (pos < total) {
        const want = Math.min(MIRROR_EARLIER_READ_CHUNK_BYTES, total - pos);
        const { bytesRead } = await fh.read(buf, pos, want, readStart + pos);
        if (bytesRead <= 0) break; // File shrank mid-read; use what we have.
        pos += bytesRead;
      }
      const data = pos === total ? buf : buf.subarray(0, pos);

      // First complete line inside the window.
      let startIdx = 0;
      if (truncatedHead) {
        const firstNl = data.indexOf(NEWLINE_BYTE);
        if (firstNl === -1) {
          // Whole window is one giant partial line: nothing parseable.
          return { messages: [], startOffset: end, truncatedHead: true };
        }
        startIdx = firstNl + 1;
      }

      // Last complete line: drop any trailing partial (only possible when
      // beforeOffset was not line-aligned or the file shrank mid-read).
      const lastNl = data.lastIndexOf(NEWLINE_BYTE);
      if (lastNl < startIdx) {
        return { messages: [], startOffset: readStart + startIdx, truncatedHead };
      }

      const text = data.toString('utf8', startIdx, lastNl + 1);
      const messages = this._parseLines(text.split('\n'), parseLine);
      return { messages, startOffset: readStart + startIdx, truncatedHead };
    } finally {
      try { await fh.close(); } catch (_) { /* already closed */ }
    }
  }

  /**
   * Number of distinct mirror keys with a live tailer. Exposed for the
   * watcher-limit check and for tests.
   *
   * @returns {number}
   */
  watcherCount() {
    return this._entries.size;
  }

  /**
   * Tear down every tailer and timer. Wired into server shutdown so a
   * SIGINT never leaves fs.watch handles or intervals behind. Broadcasts
   * mirror:closed {reason:'disposed'} per key (best effort; SSE clients
   * are usually gone by then too).
   *
   * @returns {void}
   */
  disposeAll() {
    this._disposed = true;
    for (const key of Array.from(this._entries.keys())) {
      this._broadcast('mirror:closed', { mirrorKey: key, reason: 'disposed' });
      this._teardown(key);
    }
    if (this._sweepTimer) {
      clearInterval(this._sweepTimer);
      this._sweepTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Internal: open implementation
  // -------------------------------------------------------------------------

  /**
   * Resolve provider + artifact path for a mirror request, enforcing the
   * capability contract: the provider must expose an object-valued `mirror`
   * with a parseLine function AND a findArtifactPath function.
   *
   * @param {string} providerId
   * @param {string} providerSessionId
   * @returns {{provider:object, parseLine:Function, filePath:string}}
   * @throws {Error} code MIRROR_UNSUPPORTED | ARTIFACT_NOT_FOUND
   */
  _resolve(providerId, providerSessionId) {
    const provider = this._getProvider(providerId);
    if (!provider
      || typeof provider.mirror !== 'object' || provider.mirror === null
      || typeof provider.mirror.parseLine !== 'function'
      || typeof provider.findArtifactPath !== 'function') {
      throw mirrorError('MIRROR_UNSUPPORTED', 'provider does not support mirroring: ' + providerId);
    }
    let filePath = null;
    try {
      filePath = provider.findArtifactPath(providerSessionId);
    } catch (_) {
      filePath = null; // A throwing resolver is treated as not-found.
    }
    if (!filePath || typeof filePath !== 'string') {
      throw mirrorError('ARTIFACT_NOT_FOUND', 'no transcript artifact for session ' + providerSessionId);
    }
    return { provider, parseLine: provider.mirror.parseLine, filePath };
  }

  /**
   * Serialized body of open(). See open() for the contract.
   *
   * @param {object} a - Validated args {provider, providerSessionId, deviceId}.
   * @param {string} key - Mirror key for these args.
   * @returns {Promise<object>} The open() result payload.
   */
  async _openImpl(a, key) {
    if (this._disposed) throw mirrorError('MIRROR_DISPOSED', 'mirror service is shut down');
    let entry = this._entries.get(key);

    if (!entry) {
      // Watcher cap applies to DISTINCT keys only; attaching another device
      // to an existing mirror is always allowed.
      if (this._entries.size >= this._maxWatchers) {
        throw mirrorError('MIRROR_LIMIT', 'mirror watcher limit reached (' + this._maxWatchers + ')');
      }
    } else {
      // Repeat open: barrier the shared tailer so the fresh window below is
      // guaranteed to end at-or-after every byte already broadcast. This is
      // what lets the client dedupe by batch offset without ever resyncing
      // in the common path.
      try { await entry.tailer.drain(); } catch (_) { /* drain never throws; belt+braces */ }
    }

    const { parseLine, filePath } = this._resolve(a.provider, a.providerSessionId);

    // Fresh tail window. readTailWindow is THE only whole-window entry point;
    // it is capped at historyTailBytes from EOF so a 1.86GB transcript costs
    // a 2MB read, never a full scan.
    let win;
    try {
      win = await readTailWindow(filePath, this._historyTailBytes);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        throw mirrorError('ARTIFACT_NOT_FOUND', 'transcript vanished: ' + filePath);
      }
      throw err;
    }
    const history = this._parseLines(win.lines, parseLine);

    // Liveness snapshot from the artifact mtime (same semantics as Phase 0
    // discovery liveness: recently-written transcript, not process state).
    let mtimeMs = 0;
    try { mtimeMs = (await fsp.stat(filePath)).mtimeMs || 0; } catch (_) { mtimeMs = 0; }
    const live = (Date.now() - mtimeMs) < this._liveThresholdMs;

    if (!entry) {
      entry = {
        mirrorKey: key,
        providerId: a.provider,
        providerSessionId: a.providerSessionId,
        filePath,
        parseLine,
        tailer: null,
        subscribers: new Map(),
        lastBroadcastOffset: win.endOffset,
        live,
        lastActivityMs: mtimeMs || Date.now(),
        idleTimer: null,
      };
      entry.tailer = this._buildTailer(entry, win.endOffset);
      this._entries.set(key, entry);
      entry.tailer.start();
      this._ensureSweep();
    } else {
      // Keep the freshest liveness signal; do not regress live -> stale here
      // (the sweep owns the stale transition and its status broadcast).
      entry.lastActivityMs = Math.max(entry.lastActivityMs, mtimeMs || 0);
      if (live && !entry.live) {
        entry.live = true;
        this._broadcast('mirror:status', { mirrorKey: key, live: true });
      }
    }

    // Subscribe (idempotent) and cancel any pending idle teardown.
    entry.subscribers.set(a.deviceId, { missedSweeps: 0 });
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }

    return {
      mirrorKey: key,
      live: entry.live,
      fileSize: win.fileSize,
      startOffset: win.startOffset,
      endOffset: win.endOffset,
      truncatedHead: win.truncatedHead,
      history,
    };
  }

  /**
   * Construct the JsonlTailer for an entry, wiring the three callbacks to
   * SSE broadcasts. Kept separate from _openImpl for readability and so a
   * truncate re-seed path never has to duplicate the wiring.
   *
   * @param {object} entry - The mirror entry (mutated by callbacks).
   * @param {number} startOffset - Byte offset to begin tailing from.
   * @returns {JsonlTailer}
   */
  _buildTailer(entry, startOffset) {
    return new JsonlTailer(entry.filePath, {
      startOffset,
      debounceMs: this._debounceMs,
      pollMs: this._pollMs,
      onLines: (rawLines, newOffset) => {
        const prevOffset = entry.lastBroadcastOffset;
        const messages = this._parseLines(rawLines, entry.parseLine);
        entry.lastBroadcastOffset = newOffset;
        entry.lastActivityMs = Date.now();
        if (!entry.live) {
          entry.live = true;
          this._broadcast('mirror:status', { mirrorKey: entry.mirrorKey, live: true });
        }
        // Broadcast even when every line parsed to null (progress ticks):
        // clients track continuity via prevOffset/offset, and suppressing
        // empty batches would make the next real batch look like a gap.
        this._broadcast('mirror:message', {
          mirrorKey: entry.mirrorKey,
          messages,
          offset: newOffset,
          prevOffset,
        });
      },
      onTruncate: () => {
        // The tailer resets its own offset to the new tail and re-delivers
        // fresh lines via onLines. Null the broadcast offset so the first
        // post-reset batch carries prevOffset:null, which clients treat as
        // "accept unconditionally" (their state was just cleared).
        entry.lastBroadcastOffset = null;
        entry.lastActivityMs = Date.now();
        this._broadcast('mirror:reset', { mirrorKey: entry.mirrorKey, reason: 'truncated' });
      },
      onGone: () => {
        // File deleted (or rotated away) and stayed gone: notify subscribers
        // then tear down. A future re-open re-resolves the artifact path.
        this._broadcast('mirror:closed', { mirrorKey: entry.mirrorKey, reason: 'gone' });
        this._teardown(entry.mirrorKey);
      },
    });
  }

  // -------------------------------------------------------------------------
  // Internal: parsing, teardown, sweep
  // -------------------------------------------------------------------------

  /**
   * Map raw JSONL lines to capped MirrorMessages via the provider's
   * parseLine, skipping nulls. parseLine never throws by contract, but the
   * try/catch keeps a misbehaving future provider from killing the tailer
   * pipeline (robustness over trust).
   *
   * @param {string[]} rawLines
   * @param {(line: string) => object|null} parseLine
   * @returns {Array} MirrorMessage[]
   */
  _parseLines(rawLines, parseLine) {
    const out = [];
    if (!Array.isArray(rawLines)) return out;
    for (const line of rawLines) {
      let msg = null;
      try { msg = parseLine(line); } catch (_) { msg = null; }
      if (msg && typeof msg === 'object') out.push(this._capMessage(msg));
    }
    return out;
  }

  /**
   * Enforce the text cap on one MirrorMessage. Providers already cap at the
   * same default, so this usually no-ops; it exists so the SSE frame size
   * bound holds even if a provider regresses. Returns a copy when capping
   * (never mutates the provider's object).
   *
   * @param {object} msg - MirrorMessage from a provider parseLine.
   * @returns {object} The same message, or a capped copy.
   */
  _capMessage(msg) {
    if (typeof msg.text === 'string' && msg.text.length > this._maxTextChars) {
      return Object.assign({}, msg, {
        text: msg.text.slice(0, this._maxTextChars),
        truncated: true,
      });
    }
    return msg;
  }

  /**
   * Schedule the refcount-zero teardown for an entry. Idempotent: an
   * existing pending timer is left alone. The delay lets a page refresh
   * (close + immediate re-open) keep the warm tailer.
   *
   * @param {object} entry
   * @returns {void}
   */
  _scheduleIdleClose(entry) {
    if (entry.idleTimer) return;
    entry.idleTimer = setTimeout(() => {
      entry.idleTimer = null;
      // A subscriber may have re-attached during the grace period.
      if (entry.subscribers.size > 0) return;
      this._broadcast('mirror:closed', { mirrorKey: entry.mirrorKey, reason: 'idle' });
      this._teardown(entry.mirrorKey);
    }, this._idleCloseMs);
    // unref so a lingering grace timer never holds the process open.
    if (entry.idleTimer && typeof entry.idleTimer.unref === 'function') entry.idleTimer.unref();
  }

  /**
   * Stop and forget one mirror entry: tailer stopped, timers cleared, map
   * slot removed, sweep timer stopped when it was the last entry. Safe to
   * call for unknown keys.
   *
   * @param {string} mirrorKey
   * @returns {void}
   */
  _teardown(mirrorKey) {
    const entry = this._entries.get(mirrorKey);
    if (!entry) return;
    try { entry.tailer.stop(); } catch (_) { /* already stopped */ }
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    this._entries.delete(mirrorKey);
    if (this._entries.size === 0 && this._sweepTimer) {
      clearInterval(this._sweepTimer);
      this._sweepTimer = null;
    }
  }

  /**
   * Start the housekeeping sweep if it is not already running. Started on
   * first entry, stopped on last teardown, so an idle service costs zero
   * timers.
   *
   * @returns {void}
   */
  _ensureSweep() {
    if (this._sweepTimer || this._disposed) return;
    this._sweepTimer = setInterval(() => this._sweep(), this._sweepMs);
    if (typeof this._sweepTimer.unref === 'function') this._sweepTimer.unref();
  }

  /**
   * One housekeeping pass over every entry:
   *   1. Liveness: transition live -> stale after liveThresholdMs without
   *      activity and broadcast mirror:status {live:false}.
   *   2. Subscriber GC (only when isDeviceConnected was injected): count
   *      consecutive sweeps a device has no connected SSE client; after
   *      MIRROR_SUBSCRIBER_MISS_LIMIT misses the device is unsubscribed.
   *      This is what prevents a killed tab (no close call, no SSE client)
   *      from pinning a tailer forever.
   *
   * @returns {void}
   */
  _sweep() {
    const now = Date.now();
    for (const entry of this._entries.values()) {
      if (entry.live && (now - entry.lastActivityMs) >= this._liveThresholdMs) {
        entry.live = false;
        this._broadcast('mirror:status', { mirrorKey: entry.mirrorKey, live: false });
      }
      if (this._isDeviceConnected) {
        for (const [deviceId, sub] of entry.subscribers) {
          let connected = false;
          try { connected = !!this._isDeviceConnected(deviceId); } catch (_) { connected = false; }
          if (connected) {
            sub.missedSweeps = 0;
          } else {
            sub.missedSweeps++;
            if (sub.missedSweeps >= MIRROR_SUBSCRIBER_MISS_LIMIT) {
              entry.subscribers.delete(deviceId);
            }
          }
        }
        if (entry.subscribers.size === 0) this._scheduleIdleClose(entry);
      }
    }
  }

  /**
   * Broadcast wrapper: a throwing SSE layer must never break the tailer
   * read pipeline (the callbacks run inside timer callbacks).
   *
   * @param {string} type - mirror:* event type.
   * @param {object} data - Event payload (always carries mirrorKey).
   * @returns {void}
   */
  _broadcast(type, data) {
    try {
      this._broadcastFn(type, data);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[mirror] broadcast failed: ' + (err && err.message ? err.message : err));
    }
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  MirrorService,
  MIRROR_KEY_SEPARATOR,
  // Constants exported so routes/tests share one source of truth.
  MIRROR_MAX_WATCHERS,
  MIRROR_IDLE_CLOSE_MS,
  MIRROR_MAX_TEXT_CHARS,
  MIRROR_LIVE_THRESHOLD_MS,
  MIRROR_HISTORY_TAIL_BYTES,
};
