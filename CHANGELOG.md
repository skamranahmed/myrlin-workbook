# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.5.0] - 2026-02-17

### Added

- **Refocus Session** — right-click any session to distill the full conversation into a structured context document, then Reset (clear + reinject) or Compact (compress + reinject) the session. Gives Claude a fresh context window with full project awareness.
- **Unified Context Menus** — terminal pane right-click now includes all session management options (Start/Stop, Model, Flags, Rename, Summarize, Templates, Move to Workspace, etc.) matching the sidebar context menu.
- **Persistent Password Config** — password can now be set in `~/.myrlin/config.json` for automatic startup without prompts.

### Fixed

- **Terminal Scrollback Preserved on Tab Switch** — hidden terminal panes no longer get resized to 1x1 when switching tabs, which was permanently garbling scrollback. All 9 fit() call sites now use visibility-guarded `safeFit()`.
- **Mobile Terminal Scroll** — native compositor-thread scrolling for 60fps smooth mobile scrolling.

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
