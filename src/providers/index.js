/**
 * Provider registry: the single source of truth for what counts as a "Provider"
 * (Claude Code, ChatGPT Codex, etc.) inside Myrlin Workbook.
 *
 * Every downstream module that wants to discover, parse, spawn, or search a
 * session goes through this registry. The registry intentionally does NOT
 * require any provider modules itself; Plan 14-03 wires the Claude provider in
 * via static require() inside initRegistry. This keeps the file free of
 * circular-import hazards and side-effects at module load.
 *
 * Public API (frozen by Plan 14-01, every export is required by tests):
 *   register(provider)         add a provider object to the registry
 *   getProvider(id)            resolve a provider by id, even if disabled
 *   listEnabled()              array of currently-enabled provider objects
 *   listAll()                  array of every registered provider object
 *   setEnabled(id, on)         toggle membership and write through to store
 *   isEnabled(id)              boolean snapshot of the enabled set
 *   initRegistry(store)        idempotent boot: read store config, force-on
 *                              claude, await provider.init() for each enabled
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * @module src/providers
 */

'use strict';

// Plan 14-03 (ABST-03): the Claude provider object. Required eagerly so
// initRegistry can self-register it without the caller having to know
// about provider files. The require chain is small and side-effect-free
// at module load (the provider object is built from pure functions).
const claudeProvider = require('./claude'); // gsd:provider-literal-allowed

// Plan 17-02 (CDX-05/06/07/10 wiring half): the Codex provider object.
// Same eager-require + self-register pattern as Claude. Codex is NOT
// force-on: its enabled state comes from store.state.settings.providers.codex
// which Phase 14 seeded to false on a fresh state file. The toggle lights it
// up via PUT /api/providers/codex/enabled {enabled: true}.
const codexProvider = require('./codex'); // gsd:provider-literal-allowed

// ---------------------------------------------------------------------------
// Type definitions (JSDoc, mirrored verbatim in docs/PROVIDER-INTERFACE.md)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ProviderSession
 * @property {string} provider             Provider id (e.g. 'claude', 'codex')
 * @property {string} providerSessionId    Provider-native identifier
 * @property {string} projectPath          Resolved cwd (real filesystem path)
 * @property {string|null} title           Custom or extracted title
 * @property {Date} lastActive             mtime of conversation artifact
 * @property {number} sizeBytes            Conversation file size for UI
 *
 * @typedef {Object} ProviderMessage
 * @property {'user'|'assistant'|'system'|'tool'} role
 * @property {string} text
 * @property {string|null} timestamp
 * @property {string|null} model
 *
 * @typedef {Object} SpawnDescriptor
 * @property {string} cmd                  Shell-safe single-token command
 * @property {string[]} args               Argv tokens. NOTE: pty-manager joins
 *                                         these with spaces and runs through
 *                                         the platform shell (cmd.exe /c on
 *                                         Windows, /bin/sh -c elsewhere).
 *                                         Tokens MAY include shell-quoted
 *                                         substrings; the provider is
 *                                         responsible for correctly quoting
 *                                         tokens that contain spaces or
 *                                         shell-special characters. A future
 *                                         phase may switch to argv-style
 *                                         spawn (no shell wrap), at which
 *                                         point providers will need to drop
 *                                         the explicit quoting.
 * @property {string} cwd
 * @property {Object<string,(string|undefined)>} env  undefined values mean DELETE this key
 *
 * @typedef {Object} Provider
 * @property {string} id                                                          Stable identifier (lowercase, slug-style).
 * @property {string} displayName                                                 Human label for UI surfaces (sidebar, settings).
 * @property {string} accentToken                                                 Catppuccin palette token name (mauve/green/blue).
 * @property {string} cliBinary                                                   Process name we look up via PATH availability checks.
 * @property {(opts: {forceRefresh?: boolean}) => Promise<ProviderSession[]>} discover
 * @property {(providerSessionId: string) => Promise<ProviderMessage[]>} parseTranscript
 * @property {(init: Object) => SpawnDescriptor} spawnCommand
 * @property {(args: {query: string, limit: number, timeBudgetMs: number}) => Promise<Array>} search
 * @property {() => Promise<void>} init
 * @property {() => Promise<void>} dispose
 * @property {() => boolean} supportsCost                                         Mandatory in v1.2 to prevent misleading $0 stubs.
 * @property {(line: string) => boolean} isIdleSignal                             Per-provider idle detector (PTY parity).
 * @property {() => {shiftEnter?: string, ctrlV?: string}} getKeyBindings         Per-provider key-binding overrides.
 * @property {Object} [costAdapter]                                               Optional v1.3 slot.
 */

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** @type {Map<string, Provider>} id -> provider object */
const _providers = new Map();

/** @type {Set<string>} ids that are currently enabled (visible in discovery / spawn-allowed) */
const _enabled = new Set();

/** @type {Object|null} reference to the store passed into initRegistry; setEnabled writes through to it */
let _storeRef = null;

/** @type {boolean} guards initRegistry idempotency */
let _initialized = false;

/**
 * @type {((providerId: string) => void) | null}
 * Plan 22-03 callback the server passes through initRegistry. Fired by
 * a provider's watcher when on-disk state changes; the server uses it
 * to invalidate the discover cache + broadcast SSE.
 */
let _onProviderChange = null;

// Validation tables. Lifted to module scope so the validator does not allocate
// per-call; also makes the contract trivially greppable.
const REQUIRED_FIELDS = ['id', 'displayName', 'accentToken', 'cliBinary'];
const REQUIRED_METHODS = [
  'discover',
  'parseTranscript',
  'spawnCommand',
  'search',
  'init',
  'dispose',
  'supportsCost',
  'isIdleSignal',
  'getKeyBindings',
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register a provider object. Validates the provider against REQUIRED_FIELDS
 * and REQUIRED_METHODS; throws an Error with a comma-joined list of missing
 * fields if validation fails. Successful registration adds the provider to
 * the internal Map keyed by provider.id; it does NOT add it to the enabled
 * set (that happens at initRegistry time, or via setEnabled).
 *
 * @param {Provider} provider  The provider object to register.
 * @throws {Error} 'Provider validation failed: <field>,<method>()' on missing fields.
 * @returns {void}
 * @sideeffect Mutates the internal _providers Map.
 */
function register(provider) {
  const missing = [];
  if (!provider || typeof provider !== 'object') {
    throw new Error('Provider validation failed: provider is not an object');
  }
  for (const f of REQUIRED_FIELDS) {
    if (typeof provider[f] !== 'string' || provider[f].length === 0) {
      missing.push(f);
    }
  }
  for (const m of REQUIRED_METHODS) {
    if (typeof provider[m] !== 'function') {
      missing.push(m + '()');
    }
  }
  if (missing.length) {
    throw new Error('Provider validation failed: ' + missing.join(','));
  }
  _providers.set(provider.id, provider);
}

/**
 * Resolve a provider by id. Returns the provider object regardless of whether
 * it is currently enabled, so callers reading transcripts on disabled-provider
 * sessions still work (PITFALLS #8: register-but-mark-disabled semantics).
 *
 * @param {string} id  Provider id to look up.
 * @returns {Provider|null} The registered provider, or null if not found.
 */
function getProvider(id) {
  return _providers.get(id) || null;
}

/**
 * Snapshot of every registered provider, regardless of enabled state.
 * Used by Settings UI to render the provider toggle list.
 *
 * @returns {Provider[]} Array of provider objects in insertion order.
 */
function listAll() {
  return Array.from(_providers.values());
}

/**
 * Snapshot of every enabled provider object. Discovery and PTY-spawn paths
 * use this list as the gating predicate. Disabled providers are excluded.
 *
 * @returns {Provider[]} Array of currently-enabled provider objects.
 */
function listEnabled() {
  const out = [];
  for (const id of _enabled) {
    const p = _providers.get(id);
    if (p) out.push(p);
  }
  return out;
}

/**
 * Boolean snapshot of enabled membership. Cheaper than scanning listEnabled
 * for hot paths (e.g. server middleware deciding whether to surface an item).
 *
 * @param {string} id  Provider id to test.
 * @returns {boolean} True if the id is in the enabled set.
 */
function isEnabled(id) {
  return _enabled.has(id);
}

/**
 * Toggle a provider's enabled state. Updates the in-memory Set AND writes
 * through to the captured store reference at
 * store.state.settings.providers[id]. This does NOT call store.save();
 * the store is responsible for persisting on its next mutation. Toggling an id
 * that has not been registered is allowed (the Set tracks the desired state
 * even if the provider object lands later via register()).
 *
 * @param {string} id  Provider id to toggle.
 * @param {boolean} on  True to enable, false to disable.
 * @returns {void}
 * @sideeffect Mutates _enabled and (if a store was captured) the store object.
 */
function setEnabled(id, on) {
  if (on) {
    _enabled.add(id);
  } else {
    _enabled.delete(id);
  }
  if (_storeRef && _storeRef.state) {
    if (!_storeRef.state.settings) _storeRef.state.settings = {};
    if (!_storeRef.state.settings.providers) _storeRef.state.settings.providers = {};
    _storeRef.state.settings.providers[id] = !!on;
  }
}

/**
 * Boot the registry against a live store. Reads
 * store.state.settings.providers (a plain object map of id -> bool) and adds
 * every truthy entry whose id is registered to the enabled set. Force-adds
 * 'claude' /* gsd:provider-literal-allowed *\/ regardless of what the
 * settings block says, so a corrupt or missing settings entry can never
 * silently disable Claude (PITFALLS #1: state-migration silent loss).
 *
 * Idempotent: subsequent calls with the SAME store reference short-circuit
 * before re-invoking provider.init(). Calls with a DIFFERENT store reference
 * are treated as a fresh boot (used in tests).
 *
 * Provider.init() rejections are caught and logged with console.error, so a
 * misbehaving provider cannot crash the boot sequence.
 *
 * @param {Object} store  Object exposing state.settings.providers map.
 * @returns {Promise<void>} Resolves once every enabled provider's init() settles.
 * @sideeffect Captures _storeRef, mutates _enabled, may invoke provider.init().
 */
async function initRegistry(store, opts) {
  if (_initialized && _storeRef === store) {
    return; // idempotent: same store ref, no-op
  }
  _storeRef = store;
  // Plan 22-03: optional onProviderChange callback that providers can
  // wire to (e.g., codex fs.watch -> SSE rebroadcast). Stored so we can
  // pass it through to each provider.init() below.
  _onProviderChange = (opts && typeof opts.onProviderChange === 'function')
    ? opts.onProviderChange
    : null;

  // Plan 14-03 (ABST-03): self-register the Claude provider exactly once.
  // Tests that pre-register a fake claude with the same id are honored
  // (the `has` guard prevents overwrite); production code paths get the
  // real provider without needing to know about provider files.
  if (!_providers.has(claudeProvider.id)) {
    register(claudeProvider);
  }

  // Plan 17-02 (CDX-05/06/07/10 wiring half): self-register the Codex
  // provider exactly once. The has() guard mirrors the Claude path so a
  // test that pre-registers a fake codex with the same id is honored.
  // Codex is NOT force-on; the enabled state is read from
  // store.state.settings.providers.codex below (default: false, seeded by
  // Phase 14 at src/state/store.js).
  if (!_providers.has(codexProvider.id)) {
    register(codexProvider);
  }

  const cfg = (store && store.state && store.state.settings && store.state.settings.providers) || {};
  for (const [id, on] of Object.entries(cfg)) {
    if (on && _providers.has(id)) {
      _enabled.add(id);
    }
  }

  // Force-on for zero-regression: even if settings explicitly says false, or
  // the settings block is missing entirely, claude must boot enabled. The
  // marker comment below is required so the grep gate in Plan 14-05 does NOT
  // flag this single unavoidable provider-name literal.
  _enabled.add('claude'); // gsd:provider-literal-allowed

  // Initialize each enabled provider. We iterate listEnabled() rather than
  // _enabled directly so unregistered ids in the settings block are skipped.
  // Plan 22-03: pass an `onChange` callback that routes through the
  // registry's _onProviderChange and includes the provider id, so the
  // server-side SSE broadcaster knows which provider tab to refresh.
  for (const p of listEnabled()) {
    try {
      const opts = _onProviderChange
        ? { onChange: () => _onProviderChange(p.id) }
        : undefined;
      await p.init(opts);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[providers] init failed for ' + p.id + ': ' + (err && err.message ? err.message : err));
    }
  }

  _initialized = true;
}

// ---------------------------------------------------------------------------
// Test-only helpers (not exported, but reachable via module-cache reset)
// ---------------------------------------------------------------------------

// Tests rely on `delete require.cache[require.resolve('../src/providers')]`
// to get a fresh registry; we deliberately do NOT export a `_reset()` to keep
// the production surface minimal.

module.exports = {
  register: register,
  getProvider: getProvider,
  listEnabled: listEnabled,
  listAll: listAll,
  setEnabled: setEnabled,
  isEnabled: isEnabled,
  initRegistry: initRegistry,
};
