# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
