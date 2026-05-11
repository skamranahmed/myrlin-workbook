# Codex Pane Customization (v1.2.0-alpha.3) Design

**Date:** 2026-05-11
**Author:** Arthur + Claude (brainstormed)
**Targets:** v1.2.0-alpha.3 (visual) and v1.2.0-alpha.4 (right-click menu), or both bundled
**Approval:** Arthur picked option 3 (tint + accent strip) and all 6 menu items.

## What this is

Make ChatGPT Codex terminal panes visually distinct from Claude panes and add a Codex-specific right-click submenu surfacing the most useful per-spawn Codex CLI flags.

## Why

Today both providers share the same pane chrome. The 6% green tint at the border (Phase 18-01) is too subtle for at-a-glance identification when running mixed-provider sessions side by side. There is no UI to set Codex-specific flags (model, sandbox, approval policy, reasoning effort, features); the user has to set them via `~/.codex/config.toml` or environment, outside the workbook.

## What we are building

### Visual (option 3: both)

1. Per-pane background tint: `.terminal-pane[data-provider="codex"] .xterm-screen` gets a faint background derived from `--provider-codex-accent` mixed with the existing terminal background. About 3-5% saturation, theme-respectful via `color-mix(in srgb, ...)`.
2. Accent strip: a 2-3px solid `--provider-codex-accent` stripe at the top of the pane (above the terminal text), reusing the existing pane header band.
3. Both behaviors are keyed on `[data-provider="<id>"]` so Claude can also get a per-provider color in the same pass (mauve), and Gemini drops in for v1.3 (blue, reserved tokens already exist).

### Right-click context menu (6 items)

A new "ChatGPT settings" or "Codex settings" submenu surfaces on Codex panes only. Items map 1:1 to `codex` CLI flags:

| Menu item | Backing flag | Choices |
|-----------|--------------|---------|
| Model | `-m, --model <MODEL>` | gpt-5-codex (default), o3, o3-mini, custom |
| Sandbox | `-s, --sandbox <MODE>` | read-only, workspace-write, danger-full-access |
| Approval policy | `-a, --ask-for-approval <POLICY>` | untrusted, on-request, never |
| Reasoning effort | `-c model_reasoning_effort=<X>` | low, medium, high |
| Bypass approvals + sandbox | `--dangerously-bypass-approvals-and-sandbox` | toggle (red, requires confirmation) |
| Features (advanced) | `--enable <NAME>` / `--disable <NAME>` | freeform comma-separated list |

The menu is rendered by extending the existing pane right-click handler to dispatch by `data-provider`. Claude panes keep their current menu; Codex panes get this new one; Gemini will get its own in v1.3.

### Persistence

Per-pane settings live alongside the session record in `state.sessions[id].providerSettings.codex` (object). Defaults pull from `state.settings.providerDefaults.codex` (new top-level field, also editable from Settings > Providers > Codex > Defaults). Changes apply on next spawn; if the pane is currently running, the UI shows a "Restart pane to apply" hint.

### Spawn descriptor wiring

`codexProvider.spawnCommand` is extended to read `init.providerSettings` and translate it into CLI flags. The existing SpawnDescriptor.args contract (Phase 14-04) already tolerates shell-quoted tokens; the new flags slot in without changing the contract.

## What we are NOT building

- No "live mid-session" mutation. Codex flags are spawn-time only.
- No model registry / autocomplete from Codex API. Models are a freeform field with sensible enum defaults.
- No mobile UI for the menu (mobile gets the v1.2 menu surface in a later milestone).
- No telemetry on which settings get used.
- Not changing the existing pane border tint (Phase 18-01) - the new background tint is additive.

## Architecture

### Server (one new endpoint, one extended interface)

- `PUT /api/sessions/:id/provider-settings` accepts `{settings: {<key>: <value>}}` and persists into `state.sessions[id].providerSettings.codex`. Validates against an enum allow-list (no shell-unsafe values). Provider-agnostic; routes via the registry.
- `codexProvider.spawnCommand(init)` reads `init.providerSettings`, builds the args array. Pure function (no IO). Default values are baked into a constant.

### Frontend

- `src/web/public/styles.css`: extend the Phase 18-01 pane block with the new tint + accent-strip selectors.
- `src/web/public/app.js`: extend the existing pane right-click handler (search for `paneEl` event listeners) to dispatch by `data-provider`. New helper `_showCodexPaneMenu(paneEl)` builds the menu DOM and wires it to the new endpoint. Reuses the existing modal/menu CSS classes.
- `src/web/public/index.html`: no new elements required; menu is JIT-rendered.

### State migration

Additive only: `state.sessions[id].providerSettings` is optional and defaults to undefined. Old sessions read with no `providerSettings` get the registry-level default (`state.settings.providerDefaults.codex`). `state.settings.providerDefaults` is a new optional field; absent = baked-in defaults.

## Testing

| Test | Scope |
|------|-------|
| `test/codex-spawn.test.js` extension | Spawn descriptor includes `-m model` when `providerSettings.model` set; includes `-s sandbox` when set; includes `-a policy`; toggles `--dangerously-bypass-approvals-and-sandbox`; passes `-c model_reasoning_effort=...`; passes `--enable name1 --enable name2`. |
| `test/pane-context-menu.test.js` (new) | Right-click on Codex pane DOM dispatches to `_showCodexPaneMenu`. Right-click on Claude pane dispatches to existing menu. Menu items render and accept clicks. |
| `test/codex-settings-route.test.js` (new) | `PUT /api/sessions/:id/provider-settings` validates enum allowlists, rejects shell-unsafe values, persists to store, returns 200 with the canonical record. 401 without auth. |
| Visual sanity | Manual: open Codex pane + Claude pane side-by-side in Mocha + Latte themes, screenshot, confirm distinct. |

## Risks

- **Codex CLI flag drift.** A Codex release could rename or remove a flag we surface. Mitigation: capture current `codex --help` output as a test fixture, diff in CI. Same pattern as the v1.2 RolloutLine schema gate.
- **Right-click menu collision.** The existing right-click handler likely already does several provider-agnostic things (close, rename, etc.). The Codex-specific items must ADD to that menu, not replace.
- **Bypass-approvals item is dangerous.** Must require a confirmation modal ("This disables ALL safety checks. Continue?") before applying. Default off.

## Open questions

1. Should we mirror the same menu pattern for Claude (model picker, etc.) in this commit, or defer to a separate v1.2.1 hardening pass? **Decision: defer.** This change is Codex-scoped; touching Claude doubles regression risk.
2. Reasoning effort key: `-c model_reasoning_effort=high` is one of several possible config keys. Need to verify the exact key against current Codex docs. **Decision: capture into a test fixture; if the key changes, the test breaks loudly.**

## Rollout

- alpha.3: ships the visual changes (small, low risk).
- alpha.4: ships the right-click menu + endpoint + spawn wiring.
- OR both in alpha.3 if scope stays bounded.

Final call: **bundle in alpha.3** unless the menu work pushes the LOC budget past ~400 lines.

---
*Plan source of truth: this design doc.*
