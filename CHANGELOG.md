# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **Notification storm: "ready for input" toasts and dings fired on every tab switch and output burst**, even for panes the user had already viewed. Four compounding root causes, each now fixed:
  - *Level-triggered idle detection* (`terminal.js`). Any output byte (Ink border repaint, focus-report echo, SIGWINCH redraw, spinner tick, scrollback replay) reset the once-per-cycle `_idleNotified` guard, so every cosmetic repaint followed by 2s of quiet re-fired the notification. Re-arm is now edge-triggered: the flushed chunk is ANSI-stripped and must contain at least `MIN_REARM_CHARS` (24) visible characters to count as new work. The 2s debounced idle check still runs on every flush.
  - *Scrollback replay notified on mount, reconnect, and tab switch* (`terminal.js`). The server replays up to 100KB of buffer on attach; that replay flowed through the detector and made every prompt-parked pane toast ~2s after a page load or group switch. `ws.onopen` now arms a `REPLAY_SUPPRESS_MS` (3s) window during which `_checkForCompletion` disarms and stays silent. A per-pane `IDLE_REFIRE_COOLDOWN_MS` (30s) at the dispatch site additionally caps how often a single pane can fire `terminal-idle`.
  - *No acknowledgement on focus + stale active-slot suppression* (`app.js`). Clicking or viewing a pane never consumed its pending needs-attention state, and `switchTerminalGroup` never updated `_activeTerminalSlot`, so the "don't notify the active pane" comparison used the previous group's slot index. `setActiveTerminalPane` now acknowledges on focus (refreshes the per-session dedupe entry, marks the pane's idle cycle notified, clears the amber "Needs input" badge), `switchTerminalGroup` re-points `_activeTerminalSlot` at the restored group's first filled slot, and `onTerminalIdle` gained a per-session dedupe (`SESSION_NOTIFY_DEDUPE_MS`, 60s, reset by genuine new activity) plus suppression of toast+sound for panes visible in the active group while the window has focus (passive indicators, border flash, tab dot, title flash, still run where applicable).
  - *Unthrottled chime that leaked AudioContexts* (`app.js`). `_playNotificationSound` created a new `AudioContext` per ding and never closed it; browsers cap concurrent contexts, so a storm eventually broke tab audio. It now has a global `CHIME_COOLDOWN_MS` (5s) and reuses one lazily-created context (with a `resume()` for autoplay-policy suspensions).
- **Amber "Needs input" badge never rendered.** The `terminal-needs-input` listener looked up `terminal-pane-${i}` but pane elements are id'd `term-pane-${i}`, so the badge dataset flag was set on a null element. Fixed the selector; the badge now appears when auto-trust declines to answer a prompt and is cleared when the user focuses the pane.

### Tests

- Added `test/idle-notification-gating.test.js` (19 checks): behavioral sandbox tests for the edge-triggered re-arm, replay-suppression window, refire cooldown, and once-per-cycle dispatch in `terminal.js`, plus source-presence gates for the `app.js` half (dedupe map, focus acknowledgement, active-slot re-point, chime cooldown, shared AudioContext).
- **`test/search-dispatch.test.js` made hermetic.** Three of its tests left the real provider enabled, so `/api/search` scanned the machine's actual transcript corpus; on a multi-GB corpus the synchronous reads block the event loop (the hard-timeout race timer never fires) and the whole suite hangs indefinitely. Those tests now disable the real provider around their requests (restored in `finally`), exercising the dispatch path with stubs only.

## [1.2.0-alpha.9] - 2026-05-11

### Added

- **Settings page left-side category rail.** Sticky nav inside the Settings panel listing every category from the registry plus an explicit "Providers" entry. Click any item to smooth-scroll to that section; a scroll-spy keeps the active item highlighted as you scroll naturally. Plays with all 13 Catppuccin themes via existing tokens (`--mauve` accent, `--surface-1` hover). Builds automatically from `settingsRegistry`; async Providers section joins the rail after it renders.

### Changed

- **Autostart Scheduled Task pins `PORT=3457`** (matching the current Cloudflared tunnel mapping) via a small `scripts/autostart-wrapper.cmd` shim emitted by `setup-autostart.ps1`. Without this pin, a reboot would default the workbook to `:3456` and silently break `workbook.myrlin.dev`. The wrapper is gitignored (user-specific paths).

## [1.2.0-alpha.8] - 2026-05-11

### Added

- **Codex bottom status strip on every Codex pane** (Plan 22-01). 26px chip row absolutely positioned along the bottom edge of `data-provider="codex"` panes showing `model · sandbox · approval · effort · [BYPASS]? · [features N]?`. Each chip is clickable — opens the matching submenu from `_buildCodexPaneMenu` anchored to the chip rect. Bypass chip only renders when bypass is ON (red, `letter-spacing` 0.08em, impossible to miss). `/api/discover` now returns `adHocProviderSettings` so the strip hydrates immediately for discovered Codex Desktop sessions without a Myrlin store record.
- **Auto-discovery for Codex sessions** (Plan 22-03). New `fs.watch` on `$CODEX_HOME/sessions` with 500ms debounce + 5-minute fallback poll. The provider's `init({onChange})` wires through the registry; server invalidates `_discoverCache` and broadcasts SSE `discover:refreshed`. Frontend re-fetches `/api/discover` on the event. New Codex CLI / Codex Desktop sessions appear in the sidebar within ~1 second of being created. Subagent filter from alpha.1 still in effect.
- **`scripts/setup-cloudflared.ps1`** — idempotent installer/refresher for the `workbook.myrlin.dev` tunnel config. Reads the current `~/.cloudflared/config.yml`, patches the workbook hostname's upstream port (currently 3457 on this PC, was 3456), validates ingress, and prompts for a service restart.
- **`scripts/setup-power-never-sleep.ps1`** — applies "never sleep / never turn off display" on AC and disables hibernate so the tunnel stays reachable.
- **`docs/OPERATIONS.md`** — runbook for the three auto-restart layers, Cloudflare assets, log locations, Service Token rotation, port-mismatch recovery, and failure scenarios.

## [1.2.0-alpha.7] - 2026-05-11

### Fixed

- **Ad-hoc pane right-click menu was nearly empty.** `_buildSessionContextItems` bailed with `return null` when the upstream session id was not in the Myrlin store, erasing the entire shared block (Start/Stop, Model, Naming, Tags, Insights, etc.) from the right-click menu on Codex Desktop panes opened via "Open in Terminal" (Plan 22-04). New `_buildAdHocSessionContextItems` factory returns the universal subset that works without a store record: Naming (Rename Pane + Auto Title), Insights (Summarize + Copy ID + Copy Path), and "Add to <active workspace>" adoption.
- **"Session doesn't exist" when starting Bypass on an adopted Codex session.** `POST /api/sessions` silently dropped the `provider` field from the request body, so adopted Codex sessions persisted as untagged → defaulted to Claude via the read-side normalizer → `Start (Bypass)` launched `claude --dangerously-skip-permissions` against a Codex UUID. Now the route validates and forwards `provider`. `launchSession` also got provider-aware: Claude uses `--dangerously-skip-permissions`, Codex uses `--dangerously-bypass-approvals-and-sandbox`.
- **Settings search hid the Providers section when typing "provider".** The static settings registry has no entries containing the word; the renderer early-returned with "No matching settings" before the async `_renderProvidersSection` could run. Now the filter-empty path still kicks the async section.

### Changed

- **Stronger provider differentiation** (Plan 22-02). Pane tint 4% → 8%, top accent 3px → 4px, tint tokens 6% → 10%. New `.pane-provider-pill` in every pane header (green dot + "Codex" / mauve dot + "Claude"). Sidebar `.ws-session-item`, `.project-session-item`, and `.project-accordion` all carry a 3px provider stripe. Theme-safe via `--provider-{id}-accent`.
- **Visible workspace group membership** (Plan 22-05). Each grouped workspace row shows a 4px left-edge stripe in the group's color and a `.ws-group-chip` with the group name; hovering the chip reveals a × button that calls `removeWorkspaceFromGroup`. Click handler intercepts the × before row activation.

### Tests

- Added `test/adhoc-pane-menu.test.js` (8), `test/provider-label-pill.test.js` (10), `test/workspace-group-ux.test.js` (9). Updated `test/css-tokens.test.js` to accept any tint percentage in [1..99] (the Pitfall 7 guard still enforces var()-only references).

### Deferred to alpha.8

- Codex pane bottom status strip with 6 clickable chips (Plan 22-01).
- Auto-discovery via `fs.watch` + 5-min fallback poll (Plan 22-03).
- Cloudflared tunnel + always-on workbook.myrlin.dev (brainstorm pending).

## [1.2.0-alpha.6] - 2026-05-11

### Fixed

- **Codex settings menu items 404'd on right-click-opened Codex Desktop panes.** Enabling bypass (or changing any of the 6 menu items) on a Codex pane that was opened via right-click "Open in Terminal" returned "Session not found." The PUT `/api/sessions/:id/provider-settings` endpoint required a Myrlin store record, but discovered Codex Desktop sessions use the upstream Codex UUID directly as the pane id and never get a store record until the user adds them to a workspace. Architectural root cause: the alpha.4 settings persistence model only addressed managed sessions, not ad-hoc panes.

### Changed

- **New state slot `providerSessionSettings`** stores per-(provider, upstreamSessionId) settings bundles for ad-hoc sessions. `pty-manager` looks up this slot when no store record exists for the pane, so settings persist across pane restarts even for never-saved Codex Desktop sessions.
- **PUT route now accepts `provider` in the body** as a fallback when the URL `:id` is not in `store.sessions`. Provider id is validated against `^[a-z][a-z0-9_-]{0,32}$` and the upstream session id against the existing shell-safe regex. Same per-key enum validation runs in both paths.
- **Diagnostic spawn log line.** `pty-manager` now logs `[PTY] spawn provider=... sessionId=... resumeSessionId=... providerSettings=...` once per spawn so `logs/server.log` shows what flags entered the descriptor when a CLI-level "session not found" is reported. Settings keys are enum/short so no sensitive data leaks.

### Tests

- Added 5 new ad-hoc cases to `test/codex-settings-route.test.js` (13 total): 200 on ad-hoc PUT with `body.provider`, 404 on ad-hoc PUT without `body.provider`, 404 on malformed provider id, 400 on enum violation in ad-hoc path, 400 on shell-unsafe url :id.

## [1.2.0-alpha.5] - 2026-05-11

### Fixed

- **"Session id cannot be found" when right-clicking a Codex Desktop session and choosing Open in Terminal.** `showProjectSessionContextMenu` hardcoded the Claude CLI binary for its Open in Terminal action and its Add to Project POST. Right-clicking any Codex (or future-provider) session in Discovered Projects sent `claude resume <codex-uuid>` to the PTY, and Claude rightly refused because the UUID lives in `~/.codex/sessions/`, not `~/.claude/projects/`. The contextmenu dispatcher now forwards `sessionItem.dataset.provider` and the menu factory resolves the CLI via `getProviderCliBinary(provider)`. Drag-drop already did the right thing (Plan 19-02 closed that loop); this closes the right-click loop too. Reported by Arthur. Added regression test `test/project-session-resume-provider.test.js`.

### Added

- **True boot-time auto-start (Windows).** `scripts/setup-autostart.ps1` now registers `Myrlin-Workbook` as a Scheduled Task with `AtStartup` trigger + S4U logon, so the workbook starts the moment the machine boots — no user login needed. Three-strike Task Scheduler restart-on-failure policy covers the rare case where the supervisor itself dies. To install: `powershell -ExecutionPolicy Bypass -File scripts/setup-autostart.ps1`. Cleans up the legacy `CWM-GUI-AutoStart` task on upgrade.
- **Supervisor never gives up (default).** `CWM_MAX_RESTARTS` default raised from `20` to `Infinity` so an unattended autostart session never throws up its hands. Set `CWM_MAX_RESTARTS=20` for debug runs that want to fail loud. Added exponential back-off after 5 consecutive fast-fails (capped at 60s) so a wedged port or bad config doesn't burn CPU.

## [1.2.0-alpha.4] - 2026-05-11

### Added

- **Right-click "Codex settings" submenu on Codex panes.** Surfaces all six per-session knobs in one menu: model (gpt-5-codex / gpt-5 / o3), sandbox (read-only / workspace-write / danger-full-access), approval policy (untrusted / on-failure / on-request / never), reasoning effort (minimal / low / medium / high), bypass toggle, and features (web_search, view_image, plan_tool, apply_patch_tool). Claude panes are unaffected — the menu dispatches on `data-provider`.
- **Per-session provider settings persistence.** New `state.sessions[id].providerSettings.codex` bundle persists each Codex session's knobs. New store helpers `updateSessionProviderSettings()` and `getSessionProviderSettings()` keep the surface narrow.
- **New API: `PUT /api/sessions/:id/provider-settings`.** Validates against per-key enum allow-lists, rejects shell-unsafe values via the same `SHELL_UNSAFE` regex used elsewhere in `server.js`, persists through `store.updateSessionProviderSettings()`. Returns 404 on unknown session id, 400 on validation failure, 401 without auth.
- **Spawn wiring.** `codexProvider.spawnCommand` now consumes an optional `providerSettings` field and emits the canonical Codex CLI argv: `-m <model>`, `-s <sandbox>`, `-a <approvalPolicy>`, `-c model_reasoning_effort="<effort>"`, `--dangerously-bypass-approvals-and-sandbox`, `--enable <feature>` pairs. Unknown values are dropped with a `console.warn` (no throw). Positional `resume <id>` stays last so flag-shaped session ids cannot be misparsed. `pty-manager` reads the per-session bundle from the store on every spawn so settings changes take effect on the next pane restart.
- **Bypass confirmation modal.** Enabling the `--dangerously-bypass-approvals-and-sandbox` flag routes through `showConfirmModal` with a red action button. Turning the flag OFF is a single click (no confirmation needed; weakening the sandbox is dangerous, restoring it is not).

### Tests

- Added `test/codex-settings-route.test.js` (8 tests) — happy-path triple, bypass toggle, features array, unknown key 400, enum-violating value 400, shell-unsafe value 400, unknown session 404, missing auth 401.
- Added `test/pane-context-menu.test.js` (9 tests) — string-match gate asserting `_buildCodexPaneMenu` exists, dispatches by `dataset.provider`, includes all 6 designed items, and routes bypass through `showConfirmModal`.
- Extended `test/codex-spawn.test.js` with 9 new tests covering each providerSettings → CLI flag translation, drop-unknown semantics, and the `resume <id>` last-position invariant.

## [1.2.0-alpha.3] - 2026-05-11

### Changed

- **Codex panes now visually distinct.** Bumped per-provider pane styling from a 1px top accent + 24px fade to a 3px top accent + 2px bottom accent + 64px tint fade + ~4% saturation whole-pane background derived from each provider's Catppuccin token. Claude panes get a mauve treatment, Codex get green; works across all 13 themes via `color-mix()`. The xterm canvas still paints opaque over its own area so text contrast is unaffected (Pitfall F still satisfied). Updated `test/css-tokens.test.js` Pitfall F guard to allow any 16-128px tint cutoff instead of pinning to 24px exactly.

### Planned (deferred to v1.2.0-alpha.4)

- Right-click "Codex settings" submenu on Codex panes surfacing model, sandbox, approval policy, reasoning effort, bypass toggle, and feature flags. Plan written to `.planning/phases/21-codex-pane-customization/21-01-PLAN.md`.

## [1.2.0-alpha.2] - 2026-05-11

### Fixed

- **ChatGPT tab in Discovered Projects showed 0 even with Codex sessions on disk.** `groupProviderSessionsForUI()` built project accordion buckets without a `provider` field on the bucket itself (only the inner session records carried `provider`). The frontend's `renderProjects` filter at `app.js` reads `p.provider` on the bucket with a `|| claude-id` fallback, so every non-Claude bucket was misidentified as Claude and filtered out when the ChatGPT tab was selected. Fixed by setting `bucket.provider = provider.id` in the server helper. Frontend `_mergeProjectsByProvider` now also stamps the provider id from the outer response key as a defense-in-depth fallback for older servers or future providers that bypass the helper. Added regression test in `test/discover-route.test.js`. Reported by Arthur.

## [1.2.0-alpha.1] - 2026-05-11

### Fixed

- **Codex discovery showed subagent threads as conversations.** Codex Desktop spawns explorer-role subagents (Pascal, Linnaeus, Copernicus, etc.) from a parent user thread; each subagent gets its own rollout file with `payload.source.subagent.thread_spawn` set. The discover module was treating these as user conversations and surfacing them in the sidebar, inflating the list (e.g., 34 entries for a user with only 5 actual conversations). Now filtered at session_meta read time in both the fast-path and walk-fallback. Subagent rollouts remain on disk and remain parseable when a parent thread's transcript references them. Added regression test `test/codex-discover.test.js` Test 9. Reported by Arthur.

## [1.2.0-alpha.0] - 2026-05-11

> **Alpha release.** First publishable cut of v1.2 Multi-Provider Chat Discovery. Ships under the `alpha` npm dist-tag; install with `npm i myrlin-workbook@alpha`. Existing users on `latest` (v0.9.36) are unaffected. Production-ready stable v1.2 follows after dogfooding.

### Added

- **Multi-provider session support.** Myrlin now manages sessions from multiple AI coding CLIs through a clean `Provider` abstraction at `src/providers/`. Ships Claude Code (existing) + ChatGPT Codex (new). Gemini and others drop in via the same interface in v1.3.
- **ChatGPT Codex provider.** Discovers Codex sessions from `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl` (default `~/.codex`), parses the RolloutLine envelope schema (`session_meta`, `turn_context`, `event_msg`, `response_item`, `compacted`), supports pre-0.45 bare-JSON fallback, runs `codex resume <id>` as a full PTY pane. Off by default; enable via Settings → Providers.
- **Sidebar provider tabs.** New tab strip in the sidebar header filters discovered sessions by provider (All / Claude / ChatGPT). Tab state persists in localStorage; switching preserves scroll position; badges show per-provider session counts and update live via SSE.
- **Per-provider visual identity.** Each session item, project accordion, and terminal pane carries a `data-provider` attribute. CSS tokens `--provider-claude-accent` (mauve), `--provider-codex-accent` (green), `--provider-gemini-accent` (blue, reserved) cascade through all 13 themes automatically via the existing Catppuccin palette.
- **Settings → Providers section.** One tile per registered provider with toggle switch, accent swatch, and CLI availability check. Disabling a provider with running PTYs shows a confirmation modal warning that sessions will continue but cannot be restarted.
- **Per-provider PTY behaviors.** Idle detection, Shift+Enter key bindings, and bracketed paste are all dispatched per-pane based on the active session's provider. No cross-contamination between Claude and Codex panes.
- **API additions (additive only, no breaking changes):**
  - `GET /api/providers` — returns `[{id, displayName, accentToken, enabled, available, supportsCost, cliBinary}]`
  - `PUT /api/providers/:id/enabled` — toggles a provider; calls `provider.init()` or `provider.dispose()` with 5s timeouts
  - `GET /api/discover` — now returns `{projects: {claude: [...], codex: [...]}}` keyed by provider id; `?legacy=1` retains v1.1 array shape for one release
  - `GET /api/search` — `Promise.allSettled` dispatcher across enabled providers; each result carries `provider` field; response includes `partial: true` + `timedOutProviders: [...]` on timeout
  - All `GET /api/sessions` and `GET /api/workspaces/:id` records now carry a `provider` field (defaults to `'claude'` for backward compat)
- **State migration v1 → v2.** Schema bump with layered defense: explicit `migrateStateV1toV2()` + read-side defensive `provider: 'claude'` default. `_migrateBackupFiles()` runs unconditionally on init. Idempotent on re-launch; refuses to start with clear error on corrupt fixture.
- **Cost tracking discipline.** `Provider.supportsCost()` is mandatory in the interface. Codex sessions show `—` with "Cost not tracked for this provider" tooltip — never $0.00. Aggregate cost totals exclude unsupported providers and disclose "(Claude only)" on aggregates. Real cost tracking for non-Claude providers will follow in v1.3.
- **Grep gate (CI).** `test/grep-gate.test.js` enforces zero `'claude'` or `'codex'` string literals outside `src/providers/`. Legitimate exceptions carry `// gsd:provider-literal-allowed` markers. Prevents the abstraction from rotting as future providers are added.
- **Drag-drop preserves provider.** Dragging a session across workspaces preserves its provider tag in the receiving `/api/sessions` request.

### Changed

- **Internal refactor.** Existing Claude code (~600 LOC) relocated from `src/web/server.js` into `src/providers/claude/{index,discover,parse,path-decode,spawn,search}.js`. No user-facing behavior change.
- **pty-manager pass-through mode.** Provider returns a `SpawnDescriptor`; pty-manager owns `node-pty.spawn`. Non-default-command spawns (scheduler/td/templates) bypass the provider lookup entirely.
- **Search per-provider.** Each provider now implements `search({query, limit, timeBudgetMs})`. The server endpoint dispatches via `Promise.allSettled`. Claude-only search latency unchanged.

### Fixed

- Provider-tagged sessions in mixed-workspace scenarios now correctly route artifact reads through `getProviderForSession(session)`, eliminating the implicit "always Claude" assumption that prevented mixing providers in one workspace.

### Note for users

- **This is an alpha.** Install with `npm i myrlin-workbook@alpha`. The `latest` tag still points at v0.9.36 (Claude-only stable). Feedback welcome via GitHub issues.
- **Codex CLI required for ChatGPT support.** Install `@openai/codex` separately. Myrlin only discovers and runs the CLI; it does not bundle it.
- **State auto-migrates on first launch.** No user action required. Backup files are migrated alongside the live file.

### Note for contributors

- New top-level `src/providers/` directory with one subdirectory per provider. To add a new provider, copy `src/providers/codex/` as a template, implement the 13-method `Provider` interface (see `docs/PROVIDER-INTERFACE.md`), and register in `src/providers/index.js`.
- Test count: 260+ across 24 standalone files (up from 109 in v0.9.36). New phase-specific tests live under `test/<feature>.test.js` and are wired via `test/run.js`.

## [0.9.36] - 2026-05-10

### Changed

- **Slimmed npm tarball** - The v0.9.35 tarball was 2.6 MB across 345 files because `.planning/` (GSD planning docs), `mobile/` (separate React Native app), and `logs/` (runtime logs) were not excluded from npm pack. Added all three to `.npmignore`. Also scrubbed `.planning/` from the full git history via `git filter-repo` (98 files, ~600 KB). The npm package now ships only what is needed to run the workbook.

### Note for contributors

Git history was rewritten on `main` to remove 98 ephemeral planning docs from `.planning/`. Existing clones will need to re-clone or rebase: `git fetch && git reset --hard origin/main`. All substantive commit content (code, docs, mobile app source) is preserved; only `.planning/` artifacts were removed.

## [0.9.35] - 2026-05-09

### Fixed

- **Mobile sidebar and tab strip not scrollable** - The drag-drop-touch polyfill was loaded with `?autoload`, which uses default config (no press-hold mode). Default behavior treats any touch movement on a draggable element as a drag-start. Since sidebar workspace items, session items, kanban cards, and pane tabs are all `draggable="true"`, finger swipes on those areas were intercepted as drag attempts instead of passing through to native scroll. Replaced `?autoload` with explicit `enableDragDropTouch()` call using `isPressHoldMode: true` and a 350ms press-hold delay. Drag now requires a deliberate long-press; ordinary swipes scroll.

## [0.9.34] - 2026-05-06

### Added

- **Cross-tab session pips with click-to-navigate** - Sidebar pips now show one entry per place a session is open across all tab groups (was: only the current tab). Each pip is a 10x10 two-color square: top stripe = tab's global positional color, bottom = pane slot color. Together they uniquely encode pane location. Tabs in the top strip carry a positional rainbow color (red, yellow, green, teal, blue, mauve). Click a pip to navigate to that tab+slot with a pulse animation drawing the eye to the target. Pure-data logic extracted to `instance-colors.js` (UMD wrapper). 13 new tests. Resolves #59. (PR #60 by @lreisinger)

## [0.9.33] - 2026-05-03

### Added

- **Scheduled messages** - Server-side scheduler with per-pane popover for queuing shell commands to fire into a Claude session later. Supports once-after-delay, absolute time, and recurring intervals. Persists to `~/.myrlin/schedules.json` with atomic writes. Boot recovery skips missed once-shots and advances recurring schedules without catch-up. Skip handling when PTY is stopped, with consecutive-skip collapse and 50-row history cap. Floating clock button per pane with Active/History tabs. 32 new tests across two files. (PR #55 by @lreisinger)
- **Header Height slider** - 35-80px range slider in Settings > Interface for live header bar resizing. Introduces a reusable `slider` setting type with configurable min/max/unit suffix. (PR #57 by @lreisinger)

### Fixed

- **Sessions binding to wrong Claude transcript** - Critical correctness fix. Bare spawns auto-added `claude --continue` whenever the cwd had any prior `.jsonl`, so a new Myrlin session in a busy directory resumed whichever transcript Claude considered most recent (often a sibling session's). Post-spawn detector picked the newest-mtime JSONL with no ownership check, so the wrong UUID stuck permanently. Now: drops `--continue` entirely (resume only via explicit `resumeSessionId`), uses pre-spawn JSONL snapshot + birthtime-aware hybrid `fs.watch`+rescan detector, refuses to backfill UUIDs already owned by another session, renames the misnamed `name` field to `claudeSessionId`. 6 new async watcher tests. (PR #58 by @lreisinger)
- **Shift+Enter submitting instead of inserting newline** - Sent `\n` which Ink-based TUIs (Claude Code) treat as submit. Now sends `\x1b\r` (ESC+CR) per Anthropic's `/terminal-setup` recipe, plus calls `e.preventDefault()` so the browser doesn't bypass the custom handler via xterm's hidden textarea. (PR #56 by @lreisinger)

### Internal

- **Test runner integration** - `npm test` now runs the standalone test files (`pty-watcher.test.js`, `scheduler.test.js`, `scheduler-api.test.js`) after the main suite, so CI catches failures in any of them. Total: 96 tests across 4 files.

## [0.9.32] - 2026-05-02

### Added

- **Progressive Web App (PWA) support** - Adds manifest.webmanifest with standalone display mode and a minimal service worker so users can "install" Myrlin on desktop or mobile for a native-like, full-screen experience. Requires HTTPS (typical PWA constraint). (PR #52 by @lreisinger)
- **Mobile virtual keyboard toggle** - New toolbar button toggles `inputmode="none"` on xterm.js helper textareas. For tablet users with hardware keyboards (iPad + Magic Keyboard, Android + Bluetooth) who don't want the on-screen keyboard popping up. Setting persisted to localStorage; no-op on devices without soft keyboards. (PR #53 by @lreisinger)
- **Comprehensive touch support** - Three categories of mobile/tablet fixes: (1) Touch-based pane resizing via touch events on the resize handles with widened hit areas. (2) HTML5 drag-and-drop polyfill (drag-drop-touch) so dragging sessions into panes works on iOS Safari and Android Chrome. (3) Terminal scroll gestures owned by xterm.js via stopImmediatePropagation on `.xterm-viewport` and `passive: false` listeners. Mobile detection upgraded from `innerWidth <= 768` to `navigator.maxTouchPoints` so tablet users in landscape get proper touch handling. (PR #54 by @lreisinger)

### Fixed

- **JS syntax error breaking login** - `const container` shadowed the parameter `container` in `renderTasksFilesPanel` and `renderTasksGitPanel`, causing `Identifier 'container' has already been declared` SyntaxError on login (class bodies are strict mode by default). Now reassigns the parameter directly. (PR #51 by @lreisinger)

## [0.9.31] - 2026-04-28

### Added

- **Pane view system** - Any terminal pane slot can now show a structured view (Worktree Tasks, td Issues, Git Status, Files, or Workspace Doc) instead of or alongside a terminal session. Right-click an empty pane for "Open View" submenu, or right-click an active terminal for "Switch to view" submenu. Terminal sessions keep running hidden when a view is shown and restore instantly via the back button. viewType and viewData persist in layout.json across restarts. Git Status auto-refreshes every 10 seconds. (PR #49 by @croakingtoad)

## [0.9.30] - 2026-04-27

### Fixed

- **posix_spawnp failed on macOS/Linux (reopened #4)** - The Feb fix for node-pty's spawn-helper permissions only worked when node-pty lived at `<package>/node_modules/node-pty/`. With npm hoisting and npx caches it often lives elsewhere, so the chmod was silently skipped. Postinstall now uses `require.resolve('node-pty')` to locate the actual package directory regardless of layout. Added a runtime fallback in `pty-manager.js` that re-checks and chmod's before requiring node-pty, covering `--ignore-scripts` installs and unusual cache layouts.

## [0.9.29] - 2026-04-27

### Added

- **Session titles in discovered panel** - Discovered sidebar now shows Claude's custom session names (e.g. "fix-auth-issues") instead of truncated UUIDs. Reads last 128KB of JSONL via positioned tail read with reverse scan to find the most recent `custom-title` entry. Sidebar filter, Find a Conversation, and "Add to Project" all use the title. (PR #50 by @trevorh)

### Fixed

- **API key, AI session finder, voice punctuation broken** - Three endpoints called `store.getState()` which doesn't exist; the Store exposes `state` as a getter property. Fixed all three call sites. (PR #50 by @trevorh)
- **Project paths with hook attachments resolved as missing** - 4KB head buffer in `getOriginalPathFromJsonl` was too small for hook attachment entries on line 2, truncating JSON.parse and causing path lookup to fail. Raised to 16KB with a string pre-filter. (PR #50 by @trevorh)
- **Greyed-out projects despite existing directories** - Stub sessions (1-line permission-mode only) lack a `cwd` field. Now tries multiple JSONL files in the project directory instead of only the first alphabetical one. (PR #50 by @trevorh)

## [0.9.28] - 2026-04-24

### Added

- **td panel active pane tracking** - Tasks > td tab now defaults to the focused terminal pane's project directory. New project dropdown in the toolbar lets you manually pin a specific td-initialized repo (won't follow pane changes after manual selection). Refresh button forces reload. New endpoints: `GET /api/td/projects` and `GET /api/td/issues?dir=<path>`. (PR #47 by @croakingtoad)
- **Save to Notes + Pinned Notes** - Right-click selected text in a terminal to save it as a note in workspace Docs > Notes with timestamp. Each note can be pinned to a specific terminal session via the pin button. Panes with pinned notes show a badge with count; clicking opens a master/detail modal. Persistent storage in `~/.myrlin/pinned-notes/`. (PR #48 by @croakingtoad)

### Fixed

- **td list crash on empty repos** - `td list --json` returns `null` on repos with no issues, causing `Cannot read properties of null (reading 'issues')`. Added null guard. (PR #47 by @croakingtoad)

## [0.9.27] - 2026-04-21

### Added

- **Workspace icon picker with 2,331 icons** - Workspaces can now display a Lucide (140 curated) or Material Icon (2,191) in place of the color dot. Searchable grid with categories, icon inherits workspace color. Existing workspaces without icons continue to show the color dot unchanged. (PR #44 and #46 by @croakingtoad)
- **Sidebar design polish** - Session count inline as pill badge (reduces vertical noise), active workspace left-bar uses per-workspace color, lighter italic directory group headers, sans-serif session names with inline right-aligned time, single "..." more button replacing separate rename/delete icons. (PR #44 by @croakingtoad)

### Fixed

- **Ctrl+V double-paste in terminal** - `attachCustomKeyEventHandler` returning false doesn't call `e.preventDefault()` on the DOM event, so the browser continued with native paste causing the text to send twice. Now calls `preventDefault()` in the Ctrl+V branch. Separate path from the v0.9.12 fix which only deduplicated beforeinput/paste events. (PR #45 by @croakingtoad)

## [0.9.26] - 2026-04-13

### Added

- **Tasks view with 4 sub-tabs** - New top-level "Tasks" tab with dedicated panels for Worktree Tasks (kanban board), td issues (status-grouped with detail modal and logs), Git (branch indicator, file status with inline diffs, commit log with full git-show viewer), and Files (two-pane explorer + CodeMirror 6 editor with syntax highlighting and atomic save). Switching projects in the sidebar immediately refreshes the active sub-tab. (PR #43 by @croakingtoad)
- **Git commit diff viewer** - Click any commit in the Git tab log to see full stat + patch output. 10-second auto-refresh preserves the diff pane.
- **Local CodeMirror bundle** - CodeMirror 6 served from vendor bundle instead of CDN, fixing failures for users without direct internet access.
- **td "not initialized" state** - Friendly message with "Run td init" button instead of cryptic error string.

### Fixed

- Git endpoints now resolve `workspaceId` via `resolveWorkspaceDir()` instead of failing with "dir parameter required"
- Removed duplicate route registrations that shadowed fixed endpoints
- Sidebar project switching now refreshes the active Tasks sub-tab

## [0.9.25] - 2026-04-10

### Fixed

- **Image upload broken on npx installs** - Upload directory was relative to the npm package location, which is an ephemeral cache path on npx installs. Moved to `~/.myrlin/uploads/` so saved images have a stable, predictable path that Claude Code can always read (fixes #42, reported by @hybridandrew)

## [0.9.22] - 2026-04-06

### Fixed

- **Lazy-connect terminal panes to prevent OOM** - Previously, switching to any tab group (or restoring layout) spawned ALL panes' Claude processes immediately. With 11 tab groups and 22+ panes, visiting each group accumulated 15+ Claude processes (~150MB each), exhausting system memory. Now, only the active tab group's panes auto-connect on load. Non-cached tab groups show a "Click to connect" placeholder that preserves session info in the layout. Users click individual panes to connect on demand. Layout saves preserve disconnected placeholders, so no session mapping is ever lost.

## [0.9.21] - 2026-04-06

### Fixed

- **Reverted PTY session cap and memory watchdog** - The 5-session cap and aggressive memory watchdog were killing PTY sessions and triggering layout saves that wiped pane data. Removed both limits entirely. Raised heap limit to 4GB so the server has room to breathe. The disconnected-pane preservation from v0.9.20 remains as a safety net.

## [0.9.20] - 2026-04-06

### Fixed

- **Terminal pane session info lost on PTY disconnect** - When a PTY session was killed (memory watchdog, spawn cap, or crash), `onFatalError` called `closeTerminalPane()` which set `terminalPanes[idx] = null` and showed "Drop a session here". The next debounced layout save would persist this null, permanently losing which session was assigned to that pane. Now `onFatalError` preserves the session ID, name, and spawn options in a lightweight placeholder and shows a "Disconnected. Click to reconnect." overlay instead. Layout saves include these disconnected panes so no session mapping is ever lost.

## [0.9.19] - 2026-04-06

### Fixed

- **Repeated heap OOM crashes (exit code 134)** - ConPTY on Windows allocates heavy native memory outside V8's heap, so `--max-old-space-size` alone cannot prevent OOM. Reduced max concurrent PTY sessions from 10 to 5. Lowered memory watchdog thresholds (warn at 200MB, critical at 350MB) and increased check frequency to every 15 seconds. Added periodic RSS logging every 60 seconds to `server.log` so memory trajectory is always visible for debugging.

## [0.9.18] - 2026-04-06

### Fixed

- **Daemon mode process still killed when parent shell exits (Windows)** - Node.js `detached: true` does not escape the parent console session's Job Object on Windows. When the launching shell (Git Bash, Claude Code) exits, Windows kills the entire job group including the "detached" supervisor. Now uses `cmd.exe /c start /b` on Windows to create the process in a completely new console session that is truly independent of the parent. Verified: the supervisor's parent PID becomes orphaned (non-existent), so no parent death can cascade.

## [0.9.17] - 2026-04-06

### Fixed

- **Server OOM crash from unbounded PTY sessions** - The frontend auto-reconnects all terminal panes on page load, which could spawn 20-30 Claude processes simultaneously (each 100-200MB). The OS silently killed the entire process tree with no crash log. Added a hard cap of 10 concurrent PTY sessions; spawns beyond the limit are rejected with a message to the client. Also added a memory watchdog that monitors RSS every 30 seconds and kills idle (zero-client) PTY sessions when memory exceeds 350MB, with more aggressive cleanup at 450MB. Supervisor now launches gui.js with `--max-old-space-size=1024`.
- **Login spinner stuck after entering password** - `_initializeApp()` awaited `initTerminalGroups()` which restores all terminal panes synchronously, spawning multiple PTY sessions. The login button stayed in loading state until all terminals connected. Terminal group restore is now non-blocking; the UI appears immediately while terminals reconnect in the background.

## [0.9.15] - 2026-04-06

### Fixed

- **Server crashes when parent shell exits** - On Windows, backgrounding the server with `&` does not detach the process tree. When the parent bash/terminal session ends, the server dies silently (no crash log, no restart). Added `--daemon` mode to the supervisor that re-spawns itself fully detached with stdio redirected to `logs/server.log` and a PID file at `logs/server.pid`. Use `npm run gui:daemon` or `node src/supervisor.js --daemon`.
- **EPIPE cascade kills server** - When stdout/stderr pipe breaks (parent process gone), the `uncaughtException` handler called `console.error()`, which threw another EPIPE, creating an infinite exception loop. Added EPIPE error handlers on `process.stdout` and `process.stderr` in both `gui.js` and `supervisor.js`. Wrapped all console calls in exception handlers with try/catch as a secondary guard.

## [0.9.24] - 2026-04-08

### Removed

- **"Click to connect" disconnected placeholders** - Removed the lazy-connect placeholder system entirely. It caused cascading issues: reconnect opened in wrong pane, panes couldn't be closed, layout saves broke for placeholder entries. Terminal panes now connect directly on restore (initial load and tab group switch). Fatal connection errors close the pane cleanly instead of leaving an unclosable placeholder.

## [0.9.23] - 2026-04-07

### Fixed

- **"Click to connect" opens new pane instead of reconnecting in place** - After restart, clicking the reconnect placeholder opened the session in a different empty pane because `openTerminalInPane` saw the placeholder object as an occupied slot and redirected. Now detects disconnected placeholders and clears them so the session reconnects in the same slot.

## [0.9.14] - 2026-04-02

### Fixed

- **Input lag from sidebar re-renders during cost updates** - When batch cost data arrived, the entire sidebar was rebuilt via `renderWorkspaces()` (every workspace, session, badge, and event handler). With 20+ sessions, this DOM rebuild froze the browser for hundreds of milliseconds. Now patches cost badge text in-place without touching the rest of the DOM.

## [0.9.13] - 2026-04-01

### Added

- **Voice dictation punctuation** - Voice input now adds proper punctuation, capitalization, and grammar before sending text to the terminal. Uses Claude Haiku via the configured Anthropic API key for accurate cleanup. Falls back to basic rule-based capitalization and period insertion when no API key is configured.

## [0.9.12] - 2026-04-01

### Fixed

- **Right-click and menu paste broken in terminal** - The v0.9.4 double-paste fix (PR #34) blocked all native paste events but only provided Ctrl+V/Cmd+V as an alternative. Right-click > Paste, browser Edit > Paste, and touch-paste were completely non-functional. Now intercepts native paste events, extracts the clipboard text, and routes it through the WebSocket with proper bracketed paste sequences. Deduplication flag prevents double-send when both beforeinput and paste events fire.

## [0.9.11] - 2026-04-01

### Fixed

- **App freezes during cost calculation** - All cost endpoints (batch, dashboard, quota overview, workspace cost, session export) were calling `calculateSessionCost()` synchronously, which reads and parses entire JSONL files on the main event loop. With large session files, this blocked all HTTP, SSE, and WebSocket traffic for several seconds, freezing the entire UI. Now uses the existing worker thread (`cost-worker.js`) via `calculateSessionCostAsync()` for all cache-miss calculations, keeping the event loop free. Cache hits (the common case) still return instantly with zero I/O.

## [0.9.10] - 2026-04-01

### Added

- **Android build configuration** - Added package name, SDK targets (API 24-35), permissions (camera, mic, storage, notifications, network), and production AAB build type to unblock EAS Android builds. Fixed Maestro test appId to match the correct package name (PR #40 by @croakingtoad)

## [0.9.9] - 2026-03-28

### Fixed

- **Missing data-dir.js crashes server on startup** - `src/utils/data-dir.js` was referenced by store.js but never committed, causing MODULE_NOT_FOUND on fresh installs. State now persists to `~/.myrlin/` so all launch methods (npm, npx, global) share the same data. Includes one-time migration from legacy project-local `./state/` directory. Override with `CWM_DATA_DIR` env var for custom installs (fixes #39, reported by @inorixu, PR #38 by @b2r66sun)

## [0.9.8] - 2026-03-26

### Fixed

- **Session name in terminal pane titles** - Discovered sessions opened via drag-and-drop or context menu now show the custom renamed title instead of the raw Claude session UUID. Falls back to UUID when no custom name exists (PR #37 by @snmo2546)

## [0.9.7] - 2026-03-19

### Added

- **Home directory expansion** - Session working directories now support `~/path` syntax on all platforms. The `~` is expanded to the user's home directory at session creation time (PR #36 by @inorixu)
- **CJK path support** - Projects with Chinese, Japanese, or Korean characters in their paths are now discovered and displayed correctly. Falls back to reading the original path from JSONL session data when UTF-8 decoding fails (PR #36 by @inorixu)

## [0.9.6] - 2026-03-16

### Fixed

- **Duplicate terminal panes on restart** - Saved pane layouts were restored twice due to an unwaited async race condition. `loadTerminalLayout()` fired without being awaited, so pane restoration raced against subsequent initialization. The second restore found the target slots occupied and spilled into empty slots, doubling the pane count. Fixed by awaiting layout load before continuing init, and adding slot-occupied guards in both restore paths (fixes #35)

## [0.9.5] - 2026-03-16

### Fixed

- **Cost request spam on page load** - Session costs were fetched with individual HTTP requests per session (N+1 pattern), causing 20+ requests on every page load and tab switch. Replaced with a single batch endpoint `GET /api/cost/batch` that returns all session costs in one response. Sidebar only re-renders when cost values actually change, eliminating the render loop.

## [0.9.4] - 2026-03-13

### Fixed

- **Double paste in terminal** - Pasted text was sent twice via WebSocket because both the custom Ctrl+V handler and xterm.js native paste processing fired. Now blocks xterm.js native `insertFromPaste` events since we handle paste manually with bracketed paste sequences (PR #34 by @benoitmidon)

## [0.9.3] - 2026-03-12

### Fixed

- **Header logo broken on npx install** - Header referenced `logo-cropped.png` which was excluded from the npm package. Changed to `logo.png` for consistency with the login page (fixes #33, reported by @dianshu)

## [0.9.2] - 2026-03-12

### Fixed

- **Cost dashboard period totals** - "Last 24 hours", "Last 7 days", and "Last month" were counting the entire lifetime cost of any session active within the window, instead of only the cost incurred during that period. Now apportions cost per message using timestamps, so each period reflects only the spending that actually happened within it.

## [0.9.1] - 2026-03-11

### Added

- **One-time startup token** - Auto-login URL now uses a single-use, 60-second token instead of the plaintext password. Token is consumed on first use and cannot be replayed. The actual password never appears in URLs, terminal scrollback, or process listings (PR #28 by @dianshu)
- **Model aliases** - All model pickers now use official Claude Code aliases (opus, sonnet, haiku, sonnet[1m], opusplan) that auto-resolve to the latest version. Added Sonnet 1M and OpusPlan options (PR #31 by @croakingtoad)

### Fixed

- **Shell glob expansion bug** - `sonnet[1m]` was being mangled by bash before reaching Claude. Model values are now single-quoted in PTY commands (PR #31 by @croakingtoad)
- **Terminal "undefined" prefix** - Write buffers initialized in constructor to prevent "undefinedConnecting to session..." on first mount (PR #31 by @croakingtoad)
- **Missing crash-logger** - `src/crash-logger.js` was never committed, causing MODULE_NOT_FOUND in uncaught exception handlers (fixes #32, reported by @croakingtoad)

## [0.9.0] - 2026-03-10

### Added

- **AI-powered session finder** - "Find a Session" now uses Claude Haiku to semantically match natural language descriptions against all your projects and sessions. Describe what you're looking for ("that React auth project from last week") and get ranked results with AI-generated explanations of why each matches. Results appear as rich cards with confidence scores, project path, last active time, and session count. Click any card to open it in a terminal pane; results stay on screen so you can open multiple sessions. Falls back to keyword matching when no API key is configured.
- **Anthropic API key setting** - New "AI" category in Settings for configuring your Anthropic API key (used by the session finder). Key is stored server-side and displayed masked.

## [0.8.10] - 2026-03-10

### Fixed

- **Launcher "workspaceId is required" error** - Fixed session creation from the Launcher failing when the selected project had no existing sessions. The Launcher now matches workspaces by name as a fallback, and auto-creates a new workspace if no match is found (fixes #30, reported by @falceso)

## [0.8.9] - 2026-03-09

### Added

- **Hidden items management** - Hide projects, categories, and sessions from the sidebar via right-click context menu. Manage all hidden items in Settings > Hidden Items with one-click unhide or "Unhide All". Hidden items shown with dimmed opacity when "Show hidden" is toggled.

## [0.8.8] - 2026-03-09

### Added

- **Two-stage terminal pane expand** - Expand button on each terminal pane header cycles through: normal, grid-fill (stage 1), and full viewport (stage 2). Collapse button returns to normal. Escape key collapses expanded panes as lowest-priority action in the key cascade (PR #29 by @croakingtoad, with fixes)

### Fixed

- **Pane expand z-index collision** - Stage 2 z-index lowered from 1000 to 900 so overlay panels (session manager, conflict center, modals) remain accessible when a pane is expanded
- **Escape handler conflict** - Pane collapse moved from standalone listener into the main Escape cascade, preventing double-firing when overlays are open

### Improved

- **Smooth expand/collapse transitions** - 150ms ease transition on expand/collapse for visual consistency with the rest of the UI

## [0.8.7] - 2026-03-07

### Fixed

- **Terminal input freeze** - Deferred store lastActive updates off the PTY data path with `setImmediate` to prevent synchronous JSON I/O from blocking WebSocket sends during active output
- **CPU waste on background terminals** - Activity detection regex (ANSI strip + tool matching) now skips unfocused terminal panes
- **Image upload unauthorized** - Upload handler referenced `this.authToken` instead of `this.state.token`, causing all image uploads to fail with 401

### Improved

- **Image drag-and-drop UX** - Terminal pane blurs and dims when dragging an image over it, with a labeled pill overlay ("Drop image to send to this session") so it's clear which session receives the file

### Added

- **Restart Session** - Right-click context menu option on terminals to kill and relaunch a session in-place (picks up MCP config changes, settings updates, etc.)

## [0.8.6] - 2026-03-08

### Fixed

- **npx install failure** - `scripts/postinstall.js` was excluded from the npm package by `.npmignore`, causing `MODULE_NOT_FOUND` on `npx myrlin-workbook`. Fixed by excluding only dev scripts instead of the entire `scripts/` directory (#27, reported by @dianshu)

## [0.8.5] - 2026-03-07

### Added

- **td task management integration** - Optional td binary integration for task tracking in the docs panel. Toggle in Settings, configure binary path. Includes issue detail modal and sidebar toggle (PR #26 by @croakingtoad)
- **Initial prompt and flags passthrough** - Worktree sessions now pass through initial prompt and CLI flags (e.g. `--verbose`, `--agent-teams`) to the PTY on first launch (PR #26)
- **Worktree task records** - Track worktree lifecycle (branch, path, status, tags) with dedicated API endpoints (PR #26)

### Fixed

- **createSession workspaceId** - Pass workspaceId inside the options object instead of as a separate argument (PR #22 by @croakingtoad)
- **--continue without history** - Skip `--continue` flag when the working directory has no prior Claude JSONL history (PR #23 by @croakingtoad)
- **Worktree branch collision** - Handle "branch already checked out" error during worktree creation by detecting and skipping (PR #24 by @croakingtoad)
- **Worktree path collision** - Skip `git worktree add` if path is already registered as a worktree (PR #26)
- **Worktree repo root resolution** - Resolve td repo dir to main repo root for git worktrees (PR #26)
- **Flag checkbox values** - Strip leading `--` from flag checkbox values to avoid double-dash when constructing CLI args (PR #26)

## [0.8.3] - 2026-03-07

### Fixed

- **New project "+" button** - The dropdown menu was immediately closing due to an event-bubbling race condition. The document-level click handler dismissed the menu before it could render. Fixed by stopping propagation on the button click (#20)
- **Cross-process state sync** - Projects created in the TUI never appeared in the GUI because each process had its own in-memory state. Added mtime-based disk sync so the GUI re-reads state when another process modifies the file (#20)
- **Concurrent write safety** - Atomic write temp files now use PID-unique filenames to prevent collisions when TUI and GUI write simultaneously

### Added

- **Git concurrency pool** - Limits concurrent git child processes to 3, preventing resource exhaustion when polling many sessions
- **Express error middleware** - Catch-all error handler prevents unhandled route errors from crashing the server
- **Directory validation** - Git status endpoint validates directory exists before spawning git processes
- **Restart Session** - Terminal context menu now has a "Restart Session" option that kills and relaunches in-place

## [0.8.2] - 2026-03-02

### Fixed

- **Sidebar chevrons** - Project directory group arrows now correctly point right (collapsed) and down (expanded), matching the workspace accordion pattern
- **Accordion persistence** - Collapsed workspace accordions no longer randomly re-open on SSE re-renders. Collapse state is persisted to localStorage
- **New session resume bug** - Right-click "New Session Here" on project directories now starts a fresh Claude session instead of resuming the most recent one via `--continue`

### Changed

- **+ button dropdown** - The sidebar + button now offers both "New Project" and "New Category" options via a dropdown menu
- **Visual divider** - Added an "Uncategorized" divider between category groups and ungrouped projects in the sidebar
- **Removed workspace nesting** - Removed "Set Parent" and "Remove Parent" from the workspace context menu. Use Categories for grouping instead, which is simpler and less confusing

## [0.8.1] - 2026-02-24

### Added

- **Change Environment (shell switcher)** -- Right-click any terminal pane to switch the Claude session's shell environment. On Windows: CMD, PowerShell, PowerShell 7 (pwsh), and Git Bash (auto-detected). On macOS/Linux: Bash, Zsh, Fish. The current shell is indicated with a checkmark. Switching kills the PTY and relaunches in the same pane slot with the new shell. Shell preference persists across tab group switches and layout restores. All shell names validated against strict allowlists for security.

## [0.8.0] - 2026-02-23

### Added

- **6-pane terminal grid** -- Expanded from 4 to 6 terminal panes with smart CSS grid layouts. Pane count auto-adapts: 1x1, 2x1, 2+1span, 2x2, 3+2span, 3x2. New `MAX_PANES` constant replaces all hardcoded loop bounds. Slot colors extended with red and pink for panes 5-6.
- **Launch New Session button** -- Sidebar button opens a frecency-ranked project launcher modal. Shows Pinned/Recent/All sections, fuzzy search across project names and paths, pin persistence via localStorage, CLAUDE.md badges, session name input, and model selector. Creates sessions directly and opens them in a terminal pane.
- **Voice/mic input** -- Web Speech API integration for Chrome/Edge. Mic button on each terminal pane header starts speech recognition, shows live interim transcript overlay, and sends final transcript to the terminal WebSocket. Pulses red while listening. Respects `prefers-reduced-motion`. Gracefully hidden on unsupported browsers.
- **Conflict detection** -- JSONL-based global conflict detection across all active sessions. Backend scans the last 50KB of each session's JSONL for `Write` and `Edit` tool_use blocks, identifies overlapping file modifications across sessions. Amber pill badges on terminal pane headers show conflict count. Toast notifications for new conflicts (deduplicated). Context menu "Conflicts (N)" item shows file details. 30-second backend cache, 60-second frontend polling.

### Fixed

- **Tab pane layout bleeding** -- Switching to a new empty tab group no longer shows the previous group's multi-pane grid layout. Added `updateTerminalGridLayout()` call after cache restore/fresh-connect to always reset grid for the new group's pane count.

## [0.7.0] - 2026-02-23

### Added

- **Task Spinoff** -- Right-click any session and select "Spinoff Tasks" to AI-extract independent, actionable tasks from the session's conversation history. The AI analyzes the conversation (via `claude --print`) and returns structured task specs with title, description, relevant files, acceptance criteria, and suggested branch names. Review and edit tasks in a modal with select/deselect checkboxes, inline-editable titles and descriptions, file badges, and criteria lists. Batch-create as worktree tasks (immediate start or backlog). Each spinoff task gets the "spinoff" tag for tracking.
- **Backend endpoints**: `POST /api/sessions/:id/extract-tasks` (AI conversation analysis), `POST /api/sessions/:id/spinoff-context` (rich context package generation with file snippets, project structure, CLAUDE.md, and git history), `POST /api/sessions/:id/spinoff-batch` (batch worktree task creation with worktree init hooks).
- **Spinoff dialog CSS**: Animated loading dots, task cards with deselected state, editable inputs, file badges, acceptance criteria lists.
- **Cloudflare named tunnel integration** -- UI setup guide and configuration for persistent remote access via Cloudflare Tunnels.

### Fixed

- **Notification dot not clearing** -- Tab group notification dots now clear properly when clicking the tab. Root cause: trivial PTY output was re-triggering `terminal-idle` events after the user acknowledged them.
- **CJK composition duplicate input** -- Korean and other CJK IME input no longer duplicates the last composed character. Removed conflicting composition event handlers, letting xterm.js's built-in CompositionHelper own IME handling. (Thanks @ntopia)
- **Linux/macOS path decoding** -- `decodeClaudePath` now correctly resolves Linux/macOS encoded paths (e.g., `-home-vivi-pingterra` to `/home/vivi/pingterra`). Extracted shared `greedyFsWalk` helper. (Thanks @Vidalee)
- **Mobile terminal scroll snap-back** -- Touch scrolling no longer snaps back to the bottom on new PTY output. Switched from direct `scrollTop` manipulation to `term.scrollLines()` API to keep xterm.js internal state in sync. Time-based momentum decay for consistent feel across refresh rates. (Thanks @Vidalee)
- **Null session guard** -- PTY `attachClient` now guards against null sessions from `spawnSession`, preventing crashes on edge-case connection failures.

## [0.7.0-alpha.12] - 2026-02-21

### Added

- **Pull request automation** -- Create GitHub PRs directly from worktree tasks via `gh` CLI. PR creation modal with title, AI-generated description (via `claude --print`), base branch selector, labels, and draft toggle. PR badges on kanban cards link to GitHub with state coloring (green=open, grey=draft, mauve=merged, red=closed). "Create PR" button in review column, kanban context menu, and session detail banner. Auto-advances tasks to Done when PR is merged. "Refresh PR Status" and "View PR" actions for existing PRs.

## [0.7.0-alpha.11] - 2026-02-21

### Added

- **Cross-cutting tag system** -- Add comma-separated tags to tasks and sessions. Tags appear as color-coded badges (Catppuccin palette hash) on kanban cards and session list. Searchable via task filter. Edit tags via right-click context menu on kanban cards or sessions. Tags input in New Task dialog.
- **Multi-model orchestration** -- Change a task's model from the kanban card context menu. Configure default models for Planning and Running stages in Settings > Advanced. Tasks without a model auto-inherit the stage default when dragged between columns. Model dropdown options show cost/speed hints.
- **Agent teams UX** -- New Task dialog includes agent teams checkbox and collapsible "How agent workflows work" panel explaining single-agent vs model-per-stage vs agent teams tradeoffs. Kanban cards show stage progress dots (workflow progression indicator). Settings model dropdowns include descriptive hints.
- **Select-type settings** -- Settings renderer now supports dropdown select inputs in addition to toggles, numbers, and scales.

## [0.7.0-alpha.10] - 2026-02-21

### Added

- **Sidebar Projects/Tasks toggle** -- New toggle pill at the top of the sidebar switches between Projects (project/session tree) and Tasks (compact worktree task list). Tasks view shows running/review/backlog status dots. Click any task to jump to the kanban board.
- **Agent count badges on kanban cards** -- Running task cards now show a teal "N agents" badge when the session has active subagents, using the existing subagent detection cache.

## [0.7.0-alpha.9] - 2026-02-21

### Added

- **Planning kanban column** -- 5-column kanban board: Backlog | Planning | Running | Review | Done. The Planning column (mauve) is for exploration and design work before committing to active development.
- **Worktree init hooks** -- Configure `copy_files` (array of relative paths like CLAUDE.md, .env.example) and `init_script` (shell command) that run automatically when new worktree tasks are created. API: `GET/PUT /api/worktree-init-hooks`.

## [0.7.0-alpha.8] - 2026-02-21

### Added

- **Task dependencies** -- Right-click a kanban card to set "blocked by" relationships with other tasks. Blocked tasks show a red indicator and are visually dimmed. Dependencies are toggled individually or cleared in bulk.
- **Timeline audit trail** -- Every status transition (backlog -> running -> review -> done) is recorded with timestamp. Completed tasks show "N transitions -- Xh Ym total" duration on cards. Full timeline viewable via right-click context menu.
- **Concurrent task limits** -- New "Max Concurrent Tasks" setting (1-8, default 4) in Settings > Advanced. Enforced when starting new tasks and when dragging to the Running column.
- **Kanban card context menu** -- Right-click cards to manage dependencies, view timeline, or delete tasks.
- **Task backlog API** -- Server now supports `startNow: false` to create tasks without provisioning worktree or session, placed directly in backlog.

## [0.7.0-alpha.7] - 2026-02-21

### Added

- **Task search and filtering** -- Filter input in the tasks panel header filters cards by branch, description, model, or status across both board and list layouts.
- **"Open All in Tab" context menu** -- Right-click a project and select "Open All in Tab" to create a new tab group with up to 4 sessions from that project opened automatically.
- **GitHub-style kanban cards** -- Colored left border accent per status column (grey=backlog, green=running, amber=review, blue=done), subtle hover lift animation, and 2-degree rotation during drag.
- **Live session preview** -- Running task cards in the kanban board show the last line of terminal output in a monospace preview strip, updated on each board render.
- **Task backlog support** -- New Task dialog has "Start immediately" checkbox. Uncheck to create a task in the backlog column without provisioning a worktree or session. Start it later by dragging to Running.
- **Task description field** -- New Task dialog now includes an optional description field for additional context.

## [0.7.0-alpha.6] - 2026-02-21

### Added

- **Kanban board view** -- Worktree tasks now display in a horizontal kanban board with 4 columns: Backlog, Running, Review, Done. Cards are draggable between columns to change task status. Each card shows branch name, model badge, relative time, and change statistics. Column-specific action buttons (Open Terminal, Merge, Diff, Push).
- **Tasks layout toggle** -- Switch between board (kanban) and list view via toggle buttons in the tasks panel header. Preference persisted to localStorage. Board is the default.
- **CORS hostname security fix** -- Tightened the LAN/Tailscale CORS hostname check from PR #6 to use exact hostname comparison via URL parsing instead of substring matching, preventing bypass attacks like `192.168.1.100.evil.com`.

## [0.7.0-alpha.5] - 2026-02-21

### Changed

- **Organizational hierarchy renamed** -- "Workspace Groups" are now "Categories", "Workspaces" are now "Projects", child workspaces are "Focuses". The 3-level hierarchy is: Category > Project > Focus > Sessions. All user-visible UI labels updated across ~90 strings (toasts, modals, context menus, command palette, sidebar, cost dashboard, README).
- **"Discovered" section renamed** -- The auto-discovered sessions section (formerly "Projects") is now "Discovered" to avoid collision with the new "Projects" terminology.
- **README updated** -- New hierarchy diagram, terminology throughout, roadmap split into Coming Soon/Shipped, test count updated to 42.

### Added

- **3-pane grid layout fix** -- When 3 terminals are open, the bottom pane now spans both columns (no wasted empty quadrant). Uses CSS `grid-column: span 2` on the last filled pane.

## [0.7.0-alpha.4] - 2026-02-20

### Fixed

- **Mobile input row visible on desktop** -- The "Type here... / Send" input row from PR #6 had no base `display: none` rule, so it showed on desktop browsers. Now hidden by default in `styles.css`, only shown on mobile via `styles-mobile.css`.

## [0.7.0-alpha.3] - 2026-02-20

### Fixed

- **Tab group pane layout bleeding** -- Switching from a multi-pane tab group to a single-pane tab group and back no longer collapses all panes to one. Root cause: CSS `.terminal-pane { display: flex }` overrode the browser UA `[hidden] { display: none }` rule, making `paneEl.hidden = true` ineffective for hiding grid slots during tab switches. Added `.terminal-pane[hidden] { display: none !important; }` override and explicit `paneEl.hidden = false` in the restore-from-cache path.

### Added (merged from PR #6 by @jfrostad)

- **Mobile scrollbar hiding** -- Hides scrollbars on mobile to prevent layout interference.
- **Dedicated mobile input field** -- Touch-friendly input row with Send button replaces unreliable virtual keyboard interaction.
- **IME composition guard** -- Prevents partial input submission during autocorrect/IME composition.
- **xterm textarea attributes** -- Sets `autocomplete=off, autocorrect=off, autocapitalize=off, spellcheck=false` on xterm textareas.
- **LAN/Tailscale CORS** -- Dynamic CORS and CSP headers for local network access.

## [0.7.0-alpha.2] - 2026-02-20

### Added

- **Session item two-line layout** — Session names display on their own line with badges, size, and time on a second row underneath. Removes 22-character name truncation.
- **Auto-trust & question detection** — Automatically accepts safe trust/permission prompts (Y/n, trust folder, proceed, allow tool access) with 12 danger keyword guards (delete, credential, password, etc.). Amber "Needs input" badge on pane header for dangerous prompts. Opt-in via Settings > Automation.
- **Tri-state status dots** — Worktree task sessions show pulsing green (active), amber (idle/waiting), or blue checkmark (done with commits) in sidebar. Server enriches tasks with `branchAhead` and `changedFiles` counts.
- **Worktree Tasks view** — Dedicated "Tasks" sidebar view mode showing tasks grouped by Active/Review/Completed with quick actions (Open, Merge, Diff, Push).
- **New Task dialog** — Full-featured task creation with auto-detected project directories, live branch name preview, model selector, flag checkboxes, and initial prompt.
- **Workspace hover button** — Hover over a workspace to show a `+` button for quick worktree task creation.
- **Changed files API** — `GET /api/worktree-tasks/:id/changes` returns per-file additions, deletions, and status (A/M/D/R).
- **Per-file diff API** — `POST /api/worktree-tasks/:id/diff` now accepts optional `file` field for single-file diffs.
- **Diff viewer modal** — Full diff viewer with file list sidebar (status icons, +/- counts), syntax-highlighted unified diff, hunk headers, and line numbers.
- **Changed files in session detail** — Collapsible "Changed Files" section below worktree task review banner with click-to-open-diff.
- **One-click merge dialog** — Merge dialog with squash toggle, custom commit message, and push-to-remote option. Replaces simple confirm modal.
- **Branch push endpoint** — `POST /api/worktree-tasks/:id/push` pushes branch to remote for PR workflows. Push button in review banner and Tasks view.
- **Workflows documentation** — Comprehensive `docs/WORKFLOWS.md` covering all features with user stories and step-by-step guides.
- **16 new unit tests** — Auto-trust pattern matching (10 tests), diff parsing (4 tests), numstat parsing (2 tests). Total: 42 tests.

## [0.7.0-alpha.1] - 2026-02-20

### Fixed

- **Tab group switch blank canvas** — Switching from a 4-pane tab group to a 1-pane group and back caused all 4 terminals to appear blank. Canvas pixel buffer was cleared when xterm.js DOM was moved to DocumentFragments for caching. Added explicit `term.refresh()` after restoring cached panes.
- **Discover Sessions "Import Selected"** — Clicking "Import Selected" in the Discover Claude Sessions modal did nothing. The confirm button had no click handler wired to resolve the promise.
- **Dead terminal panes filling grid** — Saved layouts with stale sessions showed a multi-pane grid with dead terminals. Panes now auto-close after fatal connection errors (max retries or server error 1011).
- **Mobile terminal scrolling** — Swiping on the terminal body now scrolls with native-feeling momentum. Manual touch-scroll handler bypasses xterm.js's touch event interception that was blocking native scroll. Long-press (400ms) activates text selection without triggering keyboard. Scrollbar now visible and draggable on mobile.

### Added

- **Inspect Element** — Right-click anywhere shows "Inspect Element" and "Copy Selector" for developer access. Uses Chrome DevTools `inspect()` when available, falls back to console logging.
- **Organized context menus** — Session context menu items grouped into submenus (Naming, Insights, Advanced) to reduce clutter from ~18 flat items to ~12 grouped items.

### Removed

- **Weekly usage quota widget** — Fully removed (sidebar progress bars, polling, settings, API endpoint). Code archived to `docs/QUOTA_WIDGET_REFERENCE.md` for future re-implementation. Context window tracking in session detail and Resources panel retained.

## [0.6.0] - 2026-02-20

### Added

- **Command Palette** — Ctrl+K now searches sessions, workspaces, features, actions, settings, and keyboard shortcuts. Type `>` for command mode (actions only), press `?` or `F1` for help mode (browse all features). Color-coded result badges per type (session/workspace/action/feature/setting/shortcut) with keyboard shortcut indicators.
- **Feature Discovery** — 30+ feature catalog entries covering every capability in the app. Users can search "worktree", "template", "cost", etc. to discover features they didn't know existed. Settings are also searchable from the palette.
- **Worktree Task Automation** — Create isolated worktree branches for Claude to work on autonomously. Right-click workspace > "New Worktree Task" (requires opt-in via Settings > Advanced). Auto-creates git worktree + branch + session. When session stops, task auto-transitions to "review" status with View Diff / Merge / Reject / Resume actions in the session detail panel. Merge cleans up the worktree and branch automatically.
- **Worktree Tasks API** — Full CRUD endpoints: GET/POST/PUT/DELETE `/api/worktree-tasks`, plus `/merge`, `/reject`, `/diff` action endpoints. SSE events for real-time updates.

## [0.5.0] - 2026-02-18

### Added

- **Refocus Session** — right-click any session to distill the full conversation into a structured context document, then Reset (clear + reinject) or Compact (compress + reinject) the session. Gives Claude a fresh context window with full project awareness.
- **Unified Context Menus** — terminal pane right-click now includes all session management options (Start/Stop, Model, Flags, Rename, Summarize, Templates, Move to Workspace, etc.) matching the sidebar context menu.
- **Persistent Password Config** — password can now be set in `~/.myrlin/config.json` for automatic startup without prompts.
- **Cross-Platform Support** — merged community PR for WSL/Linux shell spawning. Shell selection, browser launch, and demo paths now work on Windows, Linux, and macOS.
- **Security Hardening** — three-layer input validation (API boundary, WebSocket boundary, spawn point) for command injection prevention. Shell allowlist for safe binary selection. HTML escaping for template chip tooltips.

### Fixed

- **Terminal Scrollback Preserved on Tab Switch** — hidden terminal panes no longer get resized to 1x1 when switching tabs, which was permanently garbling scrollback. All 9 fit() call sites now use visibility-guarded `safeFit()`.
- **Mobile Terminal Scroll** — native compositor-thread scrolling for 60fps smooth mobile scrolling.
- **Session Rename Persistence** — renaming a session (via context menu, inline edit, or auto-title) now syncs the new name to terminal pane tabs, sidebar, and project views globally.

## [0.4.1] - 2026-02-16

### Fixed

- **Login Logo Restored** - login page uses original full logo at 420px. Header and README use cleaned cropped logo (no black background). Separate image files for login vs header.

## [0.4.0] - 2026-02-16

### Added

- **5 New Themes** - Nord, Dracula, Tokyo Night (dark), Rose Pine Dawn, Gruvbox Light (light). Now 13 themes total.
- **Theme Dropdown Sections** - Dark and Light categories with section headers. Official Catppuccin themes marked with star badge.
- **Cropped Logo** - updated app header and README with larger cropped logo (64px header, 250px README).

### Fixed

- **Project Discovery with Spaces** - directories with spaces in names (e.g. "Work AI Project") now correctly discovered. `decodeClaudePath()` tries space-joined candidates alongside hyphen-joined.
- **Marketing Scripts Removed from Repo** - internal scripts and strategy docs properly gitignored and untracked.

## [0.3.0-alpha] - 2026-02-16

### Added

- **Session Manager Overlay** - click running/total session counts in header to open a dropdown panel. Mass-select sessions, batch stop, filter (All/Running/Stopped), one-click terminal open. If session is already in a pane, activates it.
- **Conflict Center UI** - clickable warning badge in header shows conflicting file count. Click to open overlay with per-file breakdown showing which sessions edit each file. Click a session chip to jump to its terminal pane.
- **Tab Close Buttons** - X button on desktop tab group tabs. Confirmation dialog when live sessions exist; kills PTY sessions on confirm.
- **Drag-and-Hold Tab Grouping** - hold a tab over another for 1.2 seconds to auto-create a folder containing both tabs. Pulsing glow visual feedback. Joins existing folder if target is already grouped.
- **Costs Dashboard Tab** - replaced "All" tab with "Costs". Full cost dashboard with period selector (Day/Week/Month/All), summary cards, SVG timeline chart, model/workspace breakdown, sortable session table.
- **Workspace Group Improvements** - groups render at top, tinted backgrounds using `color-mix()`, larger headers, indented children with accent border.
- **4 Additional Themes** - expanded to 8 total Catppuccin flavors.

### Fixed

- **Terminal Flashing** - deduplicated `updatePaneActivity()` DOM writes; skips innerHTML when content unchanged.
- **Bracketed Paste** - pasted text now wrapped in ESC[200~/ESC[201~ so shells correctly handle special characters.
- **Cost Dashboard Accuracy** - raised JSONL file size limit from 10MB to 500MB; large sessions were silently skipped.
- **Terminal Session Restore** - `--continue` fallback when `resumeSessionId` is null; async UUID detection after PTY spawn.
- **Session `lastActive`** - now correctly updates on workspace refresh.

## [0.2.0] - 2026-02-16

### Added

- **Visual QA MCP Server** (`src/mcp/visual-qa.js`) - gives Claude "eyes and hands" for web UI development via Chrome DevTools Protocol. 4 tools: `screenshot`, `query_dom`, `execute_js`, `list_targets`. Works with any browser or Electron app that exposes a CDP debugging port.
- **`--cdp` flag** for GUI launcher - `npm run gui:cdp` launches browser with `--remote-debugging-port=9222` so the Visual QA MCP can connect automatically.
- **`npm run mcp:visual-qa`** script to run the MCP server standalone.
- `chrome-remote-interface` dependency for lightweight CDP access (~50KB).
- Registered `visual-qa` MCP server globally in Claude Code settings.
- Added Visual QA workflow documentation to global CLAUDE.md for use across all web/UI projects.

## [0.1.0] - 2026-02-01

### Added

- Initial release: TUI + GUI workspace manager for Claude Code sessions.
- Session discovery, multi-terminal PTY, cost tracking, templates, docs panel, search.
- 4 Catppuccin themes (Mocha, Macchiato, Frappe, Latte).
- Cross-tab terminal dragging, tab group folders, mobile support.
