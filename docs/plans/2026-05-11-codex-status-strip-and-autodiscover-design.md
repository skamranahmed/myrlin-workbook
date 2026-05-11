# Codex Pane Status Strip + Auto-Discovery (v1.2.0-alpha.7)

**Date:** 2026-05-11
**Status:** approved, ready for writing-plans
**Predecessor:** alpha.6 (provider-settings persistence for ad-hoc panes)

## Problem

Three concrete user-reported gaps after alpha.6:

1. **No visible settings state on Codex panes.** Codex Desktop shows model/sandbox/approval/effort/bypass at the bottom of its window; in Myrlin the user has to right-click to even see what's active. Bypass especially needs a permanent visual signal — turning it on weakens the sandbox.
2. **Codex panes still feel like Claude panes.** The alpha.3 3px accent + 4% tint is too subtle. Users can't reliably tell which provider a pane belongs to at a glance.
3. **New Codex Desktop sessions don't appear without clicking Refresh.** Discovery only runs at app boot / manual sync; sessions created in the last few minutes are invisible until the user reaches for the refresh button.

## Goals

- Make Codex pane state visible without a right-click.
- Make provider identity obvious from across the room (still tasteful, still theme-safe).
- Pick up new Codex sessions (CLI and Desktop) without manual refresh.

## Non-goals

- Showing the same status strip for Claude panes (Claude doesn't have an equivalent settings surface yet; v1.3 may add one).
- Restructuring the right-click menu (alpha.4 design holds).
- Persisting settings differently from alpha.6 (the ad-hoc slot stays).

## Design

### Component 1 — Codex bottom status strip

A new `.codex-pane-status` strip rendered absolutely along the bottom of every `.terminal-pane[data-provider="codex"]`. Single row of clickable chips:

```
[model: gpt-5-codex] [sandbox: workspace-write] [approval: on-request] [effort: medium] [BYPASS] [features: 2]
```

**Behavior**

- Each chip reflects the current effective setting. When a setting is unset, the chip shows the Codex CLI's documented default in muted text (so the user knows what the CLI will use, not a literal "default" word).
- Chips are clickable. Click opens the corresponding right-click submenu anchored to the chip's screen rect (model chip → Model submenu, etc.). Reuses the existing menu factory; no new menu logic.
- Bypass chip is red (`var(--red)`) and shown ONLY when bypass is ON. Off = absent. Keeps the strip clean and makes the dangerous state impossible to miss.
- Features chip shows the count when ≥1 enabled, hidden when zero.

**Data source**

- For store-managed sessions: `session.providerSettings.codex` (alpha.4 path).
- For ad-hoc Codex Desktop panes: a new `adHocProviderSettings[uuid]` field on the `/api/discover` response, populated from `state.providerSessionSettings.codex[uuid]` (alpha.6 slot). One round-trip, no new endpoint.

Updates from the right-click menu mutate the same local cache the strip reads from, so chips re-render immediately. SSE `discover:refreshed` events also trigger a re-render.

**Theming**

Strip uses existing tokens — `--surface-1` background, `--text-base` foreground, `--green` border accent on non-default chips, `--red` for bypass. Works across all 13 Catppuccin themes via the existing cascade. No hardcoded hex.

### Component 2 — Provider differentiation

**Three small bumps:**

1. Pane tint: **4% → 8%** (`color-mix` saturation on the whole-pane background).
2. Top accent stripe: **3px → 4px**.
3. New provider label pill in the pane header next to the title:
   - Codex panes: green dot + text "Codex" (~10px, uppercase letter-spacing).
   - Claude panes: mauve dot + text "Claude" (same shape, symmetric).

**Why both labels (not just non-default):** Symmetry. Users learn to scan for the colored dot. If Claude has no pill, "missing pill = Claude" is a fragile inference once Gemini/others ship in v1.3.

**Theming**

Pill uses `--provider-{id}-accent` for the dot and a `--surface-2` background with `--text-muted` text. All theme-safe via existing tokens.

### Component 3 — Auto-discovery

**Filesystem watcher** (in `src/providers/codex/index.js`):

- On `provider.init()`, start `fs.watch($CODEX_HOME/sessions, { recursive: true })`.
- Debounce 500ms (Codex writes a multi-event rollout when a session starts; we want one trigger, not five).
- After debounce, invalidate the discover cache for the codex provider, run discover, emit SSE event `discover:refreshed` with `{provider: <codex-id>}`.
- On `provider.dispose()`, close the watcher.
- Watch errors are caught and logged; the fallback poll keeps the system live.

**Fallback poll:**

- 5-minute `setInterval` runs `discover()` even when no watch event fired.
- Hashes the result (cheap: count + max mtime). If different from last broadcast, emit `discover:refreshed`.
- Covers: network drives, paused watchers, Windows FS quirks, Codex writing files atomically via rename (some watch implementations miss this).

**Frontend:**

- New SSE handler for `discover:refreshed`. Re-fetches `/api/discover`, merges into `state.projectsByProvider`, re-renders the sidebar's discovered panel.
- Existing manual Refresh button stays as override.

**Scope:** Codex CLI and Codex Desktop both write to `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. One watcher covers both. Subagent rollouts continue to be filtered at session_meta read time (alpha.1 fix stands).

## Data flow

```
fs.watch event ──> 500ms debounce ──> discover() ──> SSE broadcast
                                                          │
                                                          ▼
                                              frontend re-fetches /api/discover
                                                          │
                                                          ▼
                                              merges new sessions into state
                                                          │
                                                          ▼
                                              re-renders discovered panel
                                              (status strip already lives on
                                               open panes; re-render is no-op
                                               unless settings cache changed)
```

## Error handling

- Watch start fails (path missing, permission denied): log warning, rely on fallback poll. Codex hasn't been used yet — that's fine.
- Watcher emits while discover is in-flight: discover is idempotent, debounce coalesces. No race.
- SSE client missing (page reload mid-flight): broadcast is fire-and-forget; next manual refresh re-syncs. Existing pattern.
- Settings chip click while menu is open: existing menu hide-on-click handles it.

## Testing

- **Status strip:** string-match gate in new `test/codex-status-strip.test.js` asserting `.codex-pane-status` selector exists in CSS, render function `_renderCodexStatusStrip` exists in app.js, all 6 chip labels present, bypass chip is conditional.
- **Provider label pill:** extend `test/css-tokens.test.js` with two new checks asserting `.pane-provider-pill[data-provider="codex"]` and `[data-provider="claude"]` selectors exist with the right accent dot references.
- **Auto-discovery watcher:** new `test/codex-discover-watcher.test.js` — create temp `$CODEX_HOME`, start watcher, write a fake rollout file, assert callback fires exactly once within 1s. Test debounce by writing 5 files in 50ms apart, assert callback fires once after settle.
- **Fallback poll:** stub timer in test, assert poll fires discover on the configured interval.
- **Discover response shape:** existing `test/discover-route.test.js` extended to assert `adHocProviderSettings` is included when settings exist for a discovered session.

## Phasing

Three logically separate plans, all ship together as v1.2.0-alpha.7:

1. **22-01:** Bottom status strip + chip click handlers + discover-response settings hydration.
2. **22-02:** Provider label pill + 8% tint + 4px accent + css-tokens test bump.
3. **22-03:** fs.watch + debounce + 5-min poll + SSE event + frontend handler.

Plans 22-01 and 22-02 can run in parallel (different files, no shared state). 22-03 is independent of both.

## Risks

- `fs.watch` on Windows is well-known to miss events on some operations. Mitigated by the 5-min fallback poll.
- Status strip eats ~28px of pane vertical space. Acceptable on desktop; mobile layout may need a collapse-on-small-screen tweak (TODO if it looks bad after first ship).
- 8% tint may still feel subtle on the Latte (light) theme. Visual QA after build; tunable per-theme via separate tokens if needed.
- Provider label pill in the header competes with existing buttons (close, upload, schedule). Place left of the title, not right, so it doesn't crowd the action cluster.

## Open questions

None blocking. The five `_render*` / handler function names are not yet locked; the writing-plans phase will pick them.
