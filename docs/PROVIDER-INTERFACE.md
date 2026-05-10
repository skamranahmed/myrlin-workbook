# Provider Interface

> One-page human-readable mirror of the JSDoc contract in `src/providers/index.js`.
> Last revised 2026-05-10 (Plan 14-01).

## What is a Provider

A Provider is the contract Myrlin Workbook uses to talk to a CLI-based AI coding tool (Claude Code, ChatGPT Codex, future Gemini, and so on). Every provider implementation is a small folder under `src/providers/<id>/` exposing a single object that satisfies the four touchpoints we care about: discover sessions on disk, parse a transcript, build the spawn command for a live PTY, and run a search query. Providers do not talk to each other, do not own UI rendering, and do not own state persistence.

## Required fields

Every Provider object must define these four string fields. Each is non-empty and stable across releases (treat them as identifiers, not display text).

* `id`: Stable lowercase slug. Used as the registry key and as the value of session.provider on disk.
* `displayName`: Human label for sidebar tabs and Settings UI.
* `accentToken`: Catppuccin palette token (mauve, green, blue, etc.) that the CSS layer maps to a theme variable.
* `cliBinary`: Process name we look up via PATH availability checks (used for the Settings tile state).

## Required methods

Every Provider object must define these methods. Each method has a fixed signature and a one-sentence behavior contract.

* `discover(opts: {forceRefresh?: boolean}) => Promise<ProviderSession[]>`: Walk the provider's on-disk session store and return one entry per chat.
* `parseTranscript(providerSessionId: string) => Promise<ProviderMessage[]>`: Parse the raw transcript file into a normalized message array.
* `spawnCommand(init: Object) => SpawnDescriptor`: Pure function. Build the {cmd, args, cwd, env} descriptor; no side effects.
* `search(args: {query, limit, timeBudgetMs}) => Promise<Array>`: Return ranked snippets across the provider's transcript files.
* `init() => Promise<void>`: One-shot setup hook called once during initRegistry boot.
* `dispose() => Promise<void>`: Tear-down hook for resources held by init (file watchers, etc.).

## Capability methods

These three methods are mandatory in v1.2 (decided 2026-05-10 in LIVING-DOC.md). They exist to prevent two specific brownfield failure modes:

* `supportsCost() => boolean`: Prevents PITFALLS#9 (misleading $0.00 stubs). UI checks before rendering.
* `isIdleSignal(line: string) => boolean`: Prevents PITFALLS#4 (PTY parity). Each provider owns its idle regex.
* `getKeyBindings() => {shiftEnter?, ctrlV?}`: Prevents PITFALLS#4 (Shift+Enter and bracketed-paste differ per CLI).

PITFALLS#4 is the "PTY parity is 7 distinct hand-tuned Claude fixes" risk. PITFALLS#9 is the "cost-tracking placeholder traps" risk.

## SpawnDescriptor shell semantics

`spawnCommand` returns a SpawnDescriptor of the shape `{cmd, args, cwd, env}`. The contract is intentionally loose because pty-manager runs the descriptor through the platform shell (`cmd.exe /c` on Windows, `/bin/sh -c` elsewhere). This means:

* `cmd` is a single shell-safe token. It must NOT contain spaces.
* `args` is an array of argv tokens. Tokens MAY contain shell-quoted substrings; the provider is responsible for correctly quoting any token that contains spaces or shell-special characters. pty-manager will join `args` with spaces and pass the result to the shell.
* `cwd` is an absolute filesystem path. pty-manager validates existence and falls back to `os.homedir()` if the path no longer resolves.
* `env` is an object whose values are strings, with one important wrinkle: `undefined` values mean DELETE this environment key, not "leave it unset". Providers use this to scrub variables that would leak between panes.

A future phase MAY switch pty-manager to argv-style spawn (no shell wrap), at which point providers will need to drop the explicit shell quoting from their `args` tokens. The contract is documented this way today so that switch is a single, locatable change. Plan 14-05's allowlist marker convention (`gsd:provider-literal-allowed`) applies if any provider needs to embed a literal id inside its args array; outside that single-line marker, args content is opaque to the registry.

## Optional fields

* `costAdapter`: v1.3 slot. When defined, the cost worker reads it instead of its hardcoded Claude path.

Providers that do not track cost set `supportsCost()` to return false and omit `costAdapter`. The UI renders an em-blank placeholder and a tooltip ("Cost not tracked for this provider") for those rows; aggregate totals exclude unsupported providers.

## Lifecycle

The registry exposes seven public functions. Their interaction over a server session looks like this:

1. **register(provider)** at module load. Each provider folder's index.js is required and the resulting object is registered. Validation runs synchronously.
2. **initRegistry(store)** at server boot. Reads `store.state.settings.providers`, force-adds claude to enabled, awaits `provider.init()` for every enabled provider. Idempotent on the same store reference.
3. **setEnabled(id, on)** at user toggle. Updates the Set membership and writes through to `store.state.settings.providers[id]`. Does not save (the store decides when to flush).
4. **getProvider(id)** at any time. Resolves to the registered object even when the provider is disabled, so transcript reads on disabled-provider sessions still work (PITFALLS#8).
5. **listEnabled()** at discovery and PTY-spawn paths. Excludes disabled providers; this is the gate.
6. **listAll()** in the Settings UI render path.
7. **isEnabled(id)** for hot-path predicate checks where listEnabled would be wasteful.
8. **dispose** is invoked on every provider's index.js when the server shuts down (Phase 14-04 wires this into the server lifecycle).

## Adding a new provider

1. Create `src/providers/<id>/index.js` exporting an object that satisfies every required field, every required method, and the three capability methods.
2. Register it inside `src/providers/index.js` (Plan 14-03 and onward inline `const x = require('./<id>'); register(x);` calls inside initRegistry, before the settings-block read).
3. Add a default entry to the providers map in `src/state/store.js` (`providers: { claude: true, codex: false, <id>: false }`); this controls the off-by-default behavior for existing users.
4. Add a CSS variable in `:root` for the accent so the existing 13 themes inherit the new color for free. Use the naming pattern `provider id accent` as a CSS custom property; reference it as a `var()` call in component selectors.

The registry is module-imports based on purpose. Filesystem auto-discovery is rejected because grep needs to find every provider, and config-driven loading is rejected because the set of providers is small (two in v1.2, projected to five lifetime). Settings only toggle which shipped providers are enabled.

## Why no auto-discovery, why not config-driven

Grep is the navigation tool. A new contributor reading `src/providers/index.js` should be able to see every provider that exists with a single search; filesystem walks at runtime would hide that. Config-driven loading would also let an end-user accidentally enable a provider whose code is not in the running build, leading to confusing "provider not found" errors at the worst moment. Static registration trades a tiny amount of flexibility for full traceability and a zero-surprise startup sequence.

## Provider-Name Literals Outside src/providers/

The grep gate at `test/grep-gate.test.js` walks `src/` and fails any line outside `src/providers/` that contains a bare quoted `'claude'` or `'codex'` literal. This is the regression net for ABST-04 (zero provider-name leakage outside the abstraction). It runs as part of `npm test` and exits non-zero on any unflagged literal.

Legitimate exceptions exist: bootstrap defaults, migration defaults, v1.1 back-compat fallbacks, install-path probes for a specific CLI binary. Mark these with the same-line comment:

```
// gsd:provider-literal-allowed
```

Or for inline form (inside expressions, JSDoc, multi-token lines):

```
providerId === 'claude' /* gsd:provider-literal-allowed */
```

Line-based allowlists are rejected because line numbers drift across commits. Comment markers travel with the line they exempt. The marker substring is what the gate matches; surrounding text is free-form so you can document why the exception exists (e.g., `// gsd:provider-literal-allowed (v1.1 back-compat default; refactor deferred to Phase 18)`).

The grep gate also includes a subtree-exclusion self-test: it creates a temporary fixture under `src/providers/claude/` containing the forbidden literal, runs the walker, and asserts the fixture is NOT flagged. This proves the exclusion logic is real and prevents silent regression where a future refactor breaks subtree exclusion and turns the gate into a no-op. The fixture is deleted in a `finally` block regardless of test outcome.

The walker also skips `node_modules` (defensive, although it should not appear under `src/`) and any dot-prefixed directory (e.g., `src/web/public/.backup/`).

Current legitimate-exception sites in v1.2 (the marker is present on each):

* `src/state/store.js`: DEFAULT_STATE.settings.providers bootstrap, `_tryLoadFile` session normalization, `migrateStateV1toV2` session tagging, `createSession` and `createTemplate` defaults.
* `src/web/pty-manager.js`: `providerId` back-compat default, `useProvider` sentinel (`command === 'claude'`), cwd JSONL fallback gate, JSONL UUID watcher gate, JSDoc `@param`.
* `src/web/server.js`: `_cachedClaudePath` cache, install-path candidates list, worktree-task and worktree-session creation defaults, command sanitization fallback.
* `src/web/pty-server.js`: JSDoc `command` default note.
* `src/core/session-manager.js` and `src/core/workspace-manager.js`: v1.1 back-compat defaults.
* `src/web/public/app.js`: 23 frontend back-compat defaults; tagged for Phase 18 refactor when sidebar tabs and per-provider session creation land.
* `src/index.js`: TUI demo data; tagged for Phase 18.
* `src/ui/session-detail.js`: TUI session detail display fallback; tagged for Phase 18.

Do not add new exceptions casually. If a new literal is needed, prefer pushing the consuming code into `src/providers/<id>/` first, or derive the value from the session record's `provider` field plus a registry lookup. Phase 15 will refactor the discovery dispatcher and remove most of the server.js exceptions; Phase 18 owns the frontend refactor.

## Em-Dash Convention in This Doc

Project policy forbids em dashes (Unicode U+2014) and double-hyphens in prose. The grep gate's resolution-text uses single hyphens for its bullet list. The verify command for this file is a `grep -qE` invocation with a regex alternation matching the em dash codepoint OR a doubled-hyphen sequence; if either is present in the doc body the doc fails verification. The em dashes inside that grep regex pattern are functional (they search for em dashes); that is the single legitimate use of the character anywhere in the codebase, and it lives in shell scripts and verify commands, never in source-checked prose.
