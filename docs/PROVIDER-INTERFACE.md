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
