# Myrlin Workbook

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/myrlin-workbook.svg)](https://www.npmjs.com/package/myrlin-workbook)
[![Node](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()
[![Tests](https://img.shields.io/badge/Tests-26%20passing-brightgreen.svg)]()

Open-source workspace manager for Claude Code - cost tracking, conflict detection, 4-pane embedded terminals, per-workspace docs & kanban, session templates, session manager overlay, costs dashboard, 8 themes, [and more](#full-feature-list). Discovers every session you've ever run, organizes them into workspaces. Runs in your browser, everything stays local.

<p align="center">
  <img src="docs/images/hero-demo.gif" alt="4-pane terminal grid with live sessions" width="800">
</p>

---

## Quick Start

### Try it now

```bash
npx myrlin-workbook          # Opens browser, discovers your real Claude sessions
npx myrlin-workbook --demo   # Opens browser with sample data (no real sessions needed)
```

### Install from source

```bash
git clone https://github.com/therealarthur/myrlin-workbook.git
cd myrlin-workbook
npm install
npm run gui                   # Real sessions
npm run gui:demo              # Sample data
```

On first launch, a random password is generated and printed to the console. Saved to `state/config.json`.

**Custom password:**

```bash
# Bash/zsh
CWM_PASSWORD=mypassword npm run gui

# PowerShell
$env:CWM_PASSWORD="mypassword"; npm run gui

# cmd.exe
set CWM_PASSWORD=mypassword && npm run gui
```

### Prerequisites

- **Node.js 18+** ([download](https://nodejs.org))
- **C++ Build Tools** (required by `node-pty` for real terminal emulation):
  - **Windows**: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++" workload
  - **macOS**: `xcode-select --install`
  - **Linux**: `sudo apt install build-essential python3`

> **`npm install` fails?** You're missing the C++ build tools above. See [Troubleshooting](#troubleshooting).

### Run Modes

| Command | Description |
|---------|-------------|
| `npx myrlin-workbook` | Web GUI via npx |
| `npm run gui` | Web GUI (localhost:3456) |
| `npm run gui:demo` | Web GUI with sample data |
| `npm start` | TUI mode (terminal-only, blessed) |
| `npm run demo` | TUI with sample data |

---

## Why

I use Claude Code daily and had a growing list of pet peeves. Can't name sessions, so `/resume` is just picking from a list of IDs. No shift+enter for multiline. If you have a few sessions going at once, the terminal window juggling gets old fast. PC restarts and you have to reopen everything from scratch. No idea what you're spending.

Got fed up and built something for it. Myrlin scans `~/.claude/projects/`, finds every session you've ever run, and you organize them into workspaces with embedded terminals, docs, and cost tracking. Everything runs locally, no cloud, no telemetry.

### Compared to other tools

There are good tools in this space. I tried them. Here's where Myrlin fits:

| Feature | Myrlin | [ClaudeCodeUI](https://github.com/siteboon/claudecodeui) | [Opcode](https://github.com/winfunc/opcode) | [Claude Squad](https://github.com/smtg-ai/claude-squad) |
|---------|--------|-------------|--------|-------------|
| Cost tracking | Yes | No | Yes | No |
| Costs dashboard | Yes | No | Yes | No |
| Session discovery | Yes | Yes | No | No |
| Session manager overlay | Yes | No | No | No |
| Workspace docs/kanban | Yes | No | No | No |
| Themes | 8 (Catppuccin + fun flavors) | No | No | No |
| Session templates | Yes | No | No | No |
| Conflict detection | Yes | No | No | No |
| Embedded terminals | 4-pane grid | Single | No | No |
| Tab grouping | Yes | No | No | No |
| Windows native | Yes | Buggy | Yes (desktop) | No (tmux) |
| TUI mode | Yes | No | No | No |
| Multi-agent | Claude only | Claude+Cursor+Codex | Claude only | 5+ tools |
| File explorer | No | Yes | No | No |
| npx install | Yes | Yes | No | No |
| Build step required | None | Vite | Tauri | None |

**What those tools do better:** ClaudeCodeUI has a file explorer and multi-agent support. Opcode is a polished desktop app with 20k stars. Claude Squad supports 5+ AI tools. Myrlin is workspace-first with cost tracking and per-workspace docs. Different approach to the same problem.

---

## Features

### Cost Tracking

Per-session and per-workspace cost breakdown. Parses Claude's JSONL usage data, applies model-aware pricing (Opus, Sonnet, Haiku), shows input/output/cache tokens. Know exactly what you're spending.

### Session Discovery

- Scans `~/.claude/projects/` and finds all existing Claude sessions
- Shows project directory, session count, size, last active
- Auto-titles sessions from conversation content
- Import sessions into workspaces with one click

### Workspaces & Sessions

![Workspace dashboard with sessions grouped by project](docs/images/hero-dashboard.png)

- Named workspaces with color coding
- Group workspaces under umbrella folders
- Drag-and-drop sessions between workspaces and into terminal panes
- State persists to disk. Survives crashes and restarts
- Auto-recovery on startup (detects orphaned sessions, restores state)

### Embedded Terminals

![4-pane terminal grid with concurrent sessions](docs/images/terminal-grid.png)

- 4-pane terminal grid (xterm.js + node-pty + WebSocket). Real PTY, not fake.
- Tab groups: named sets of terminal panes ("Research", "Debug"), switchable and persistent
- PTY sessions survive page refresh with scrollback replay on reconnect
- Model selection (Opus, Sonnet, Haiku) and session resume
- Right-click context menu with Copy, Stop, Restart, Model picker

### Per-Workspace Docs & Feature Board

![Docs panel with Notes, Goals, Tasks, Roadmap, and Rules](docs/images/docs-panel.png)

![Switching between workspace docs](docs/images/workspace-docs.gif)

- Notes, Goals, Tasks, Rules, and Roadmap sections per workspace
- Kanban-style feature board (Planned -> Active -> Review -> Done)
- Markdown editor with formatting toolbar
- AI Insights tab: auto-generated summaries of workspace sessions

![Feature tracking Kanban board](docs/images/kanban-board.png)

### Session Templates

Save your common launch configurations. Pre-set working directory, model, flags, and spawn options. One click to launch a new session from a template.

### Conflict Detection

Real-time warnings when two or more running sessions are editing the same files. Runs `git status` across active sessions and cross-references modified files. Prevents you from stepping on your own work.

### Quick Switcher

`Ctrl+K` / `Cmd+K` opens a fuzzy search across all sessions and workspaces. Jump to anything instantly.

### Git & Worktree Management

- Full git status per workspace: current branch, dirty/clean, ahead/behind remote
- Branch listing and worktree CRUD
- **"New Feature Session"**: right-click a workspace -> creates a branch + worktree + Claude session in one click
- Branch badges on session rows

### Themes

![All 4 Catppuccin themes: Mocha, Macchiato, Frappe, and Latte](docs/images/theme-showcase.png)

![Theme switching in action](docs/images/theme-switching.gif)

8 themes: 4 classic [Catppuccin](https://github.com/catppuccin/catppuccin) (Mocha, Macchiato, Frappe, Latte) plus 4 fun flavors - Cherry (rose), Ocean (navy), Amber (gold), and Mint (jade). Toggle from the header dropdown. Choice persists in localStorage.

### Port Detection & Resource Monitoring

- Automatic port detection for running sessions (PowerShell on Windows, lsof on Unix)
- Per-session CPU and memory tracking
- System overview (CPU, RAM, uptime)
- Stop, restart, or kill sessions from the Resources tab

### Mobile

<p align="center">
  <img src="docs/images/mobile-dashboard.png" alt="Mobile workspace view" height="400">
  &nbsp;&nbsp;&nbsp;
  <img src="docs/images/mobile-terminal.png" alt="Mobile terminal with toolbar" height="400">
</p>

- Responsive layout with bottom tab bar
- Touch gestures: swipe between terminal panes, edge swipe for sidebar, long-press for context menus
- Mobile terminal toolbar: keyboard toggle, Enter, Tab, Ctrl+C, Ctrl+D, Esc, arrows, Copy, Upload
- Keyboard-aware viewport resizing (terminal stays visible above soft keyboard)

---

## Full Feature List

A comprehensive list of everything Myrlin Workbook offers today.

### Core

- **Session discovery** - scans `~/.claude/projects/`, finds every session you've ever run
- **Workspace management** - named workspaces with color coding, drag-and-drop grouping
- **Auto-recovery** - restores state after crash or restart, detects orphaned sessions
- **State persistence** - JSON on disk, survives everything

### Terminals

- **4-pane terminal grid** - xterm.js + node-pty + WebSocket, real PTY (not fake)
- **Tab groups** - named sets of panes ("Research", "Debug"), switchable and persistent
- **Tab close buttons** - with live session kill confirmation dialog
- **Drag-and-hold tab grouping** - hold 1.2s over another tab to create a folder
- **Cross-tab terminal pane dragging** - drag sessions between panes freely
- **PTY sessions survive page refresh** - scrollback replay on reconnect
- **Model selection** - Opus, Sonnet, Haiku per terminal
- **Right-click context menu** - Copy, Stop, Restart, Model picker
- **Bracketed paste mode** - proper paste handling in terminal sessions

### Cost Tracking

- **Per-session and per-workspace cost breakdown** - input/output/cache tokens
- **Costs dashboard tab** - period selector (Day / Week / Month / All)
- **SVG timeline chart** - visual spend over time, model breakdown
- **Sortable session table** - rank sessions by cost, tokens, or duration
- **Parses JSONL usage data** - model-aware pricing (Opus, Sonnet, Haiku)

### Session Management

- **Session manager overlay** - click header stats to open, full session control
- **Mass selection and batch stop** - select multiple sessions, stop them all at once
- **Filter** - All / Running / Stopped quick filters
- **One-click terminal open** - from session manager rows
- **Session templates** - save launch configs (directory, model, flags), one-click launch
- **Quick switcher** - `Ctrl+K` / `Cmd+K` fuzzy search across sessions and workspaces

### Docs & Planning

- **Per-workspace docs** - Notes, Goals, Tasks, Rules, Roadmap sections
- **Kanban-style feature board** - Planned, Active, Review, Done columns
- **Markdown editor** - with formatting toolbar
- **AI Insights tab** - auto-generated summaries of workspace sessions

### Conflict Detection

- **Real-time file conflict warnings** - detects when two+ sessions edit the same files
- **Conflict center UI** - per-file breakdown with session attribution
- **Click session chips** - jump directly to the terminal pane for that session

### Git & Worktree

- **Git status per workspace** - current branch, dirty/clean, ahead/behind remote
- **Branch listing and worktree CRUD** - create, switch, delete from the UI
- **"New Feature Session"** - creates branch + worktree + Claude session in one click
- **Branch badges** - shown on session rows

### Themes

- **8 themes** - 4 Catppuccin (Mocha, Macchiato, Frappe, Latte) + 4 fun flavors (Cherry, Ocean, Amber, Mint)
- **Header dropdown toggle** - choice persists in localStorage

### Resources & Monitoring

- **Port detection** - automatic discovery for running sessions (PowerShell on Windows, lsof on Unix)
- **Per-session CPU and memory** - live tracking
- **System overview** - CPU, RAM, uptime
- **Stop / restart / kill** - from the Resources tab

### Mobile

- **Responsive layout** - bottom tab bar on small screens
- **Touch gestures** - swipe between panes, edge swipe for sidebar, long-press for context menus
- **Mobile terminal toolbar** - keyboard toggle, Enter, Tab, Ctrl+C, Ctrl+D, Esc, arrows, Copy, Upload
- **Keyboard-aware viewport** - terminal stays visible above soft keyboard

... more to come.

---

## Remote Access

Expose your local instance with a Cloudflare tunnel:

```bash
npm run gui                                      # Start the server
cloudflared tunnel --url http://localhost:3456    # In another terminal
```

Open the URL from any device. All WebSocket terminal connections, SSE streams, and REST API calls route through the tunnel. For a stable URL, see [Cloudflare tunnel docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/).

---

## Architecture

```
Browser (vanilla JS SPA)
  |
  |-- REST API ---------- Express server
  |                         |-- State store (JSON + EventEmitter)
  |                         |-- Session manager (launch/stop/restart)
  |                         |-- Resource monitoring (CPU, RAM, per-PID)
  |                         +-- Workspace groups, discovery, docs
  |
  |-- SSE --------------- Real-time updates (store events -> clients)
  |
  +-- WebSocket --------- Terminal I/O (binary frames)
                             +-- node-pty -> ConPTY / PTY
```

No React, no build step. Vanilla JS SPA, Express backend. ~24 source files, 26 tests.

### Project Structure

```
src/
|-- state/
|   |-- store.js              # Core state (JSON persistence + EventEmitter)
|   +-- docs-manager.js       # Per-workspace markdown docs
|-- core/
|   |-- session-manager.js    # Launch/stop/restart processes
|   |-- workspace-manager.js  # Workspace CRUD
|   |-- process-tracker.js    # PID monitoring
|   |-- recovery.js           # Auto-recovery on startup
|   +-- notifications.js      # Event-based notifications
|-- web/
|   |-- server.js             # Express API + SSE + resources
|   |-- auth.js               # Token auth + rate limiting
|   |-- pty-manager.js        # PTY session lifecycle
|   +-- public/
|       |-- index.html        # SPA shell
|       |-- app.js            # Frontend application
|       |-- styles.css        # Catppuccin themes
|       +-- terminal.js       # TerminalPane (xterm.js + WebSocket)
|-- ui/                       # TUI mode (blessed)
|-- index.js                  # TUI entry point
+-- gui.js                    # GUI entry point
```

---

## Configuration

### Password

Loaded in order:
1. `CWM_PASSWORD` environment variable
2. `state/config.json` -> `{ "password": "..." }`
3. Auto-generated (printed to console, saved to config)

### Port

Default `3456`. Override with `PORT`:

```bash
PORT=8080 npm run gui
```

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+K` / `Cmd+K` | Quick switcher |
| `Escape` | Close modals / menus |
| `Ctrl+Enter` | Save in notes editor |
| Double-click session | Inline rename |
| Right-click session | Context menu (launch, model, rename, hide) |
| Right-click workspace | Context menu (docs, add session, edit, delete) |

---

## Troubleshooting

### `npm install` fails with node-gyp errors
`node-pty` needs C++ build tools to compile native bindings. Install the tools listed in [Prerequisites](#prerequisites).

**Windows quick fix:**
```powershell
npm install -g windows-build-tools
```

### `npx myrlin-workbook` hangs on install
Same issue. node-pty is compiling. If it fails, install the C++ build tools first, then try again.

**Still stuck?** Open an [issue](https://github.com/therealarthur/myrlin-workbook/issues) with your full error output and OS version.

---

## Roadmap

- Multi-provider support (Codex, Cursor, Aider)
- ~~Conflict center~~ shipped
- ~~Session manager overlay~~ shipped
- ~~Costs dashboard~~ shipped
- ~~Tab grouping~~ shipped
- ~~Session templates~~ shipped
- ~~Session search~~ shipped
- ~~Light theme~~ shipped (4 Catppuccin themes)
- ~~Cost tracking~~ shipped (per-session token + cost breakdown)
- ~~Feature board~~ shipped (Kanban per workspace)
- ~~Git worktree management~~ shipped (branch CRUD, "New Feature Session" flow)
- ~~Port detection~~ shipped (auto-discover ports from running sessions)
- Export/import workspaces
- Pinned sessions
- Push notifications for session events

---

## License

**AGPL-3.0.** Use, modify, self-host freely. If you run a modified version as a public service, you must publish source. See [LICENSE](LICENSE).

---

## Contributing

Issues and PRs welcome. No build step. Clone, `npm install`, hack.

```bash
npm test        # 26 tests
npm run gui     # Start dev server
```

---

Built by [Arthur](https://github.com/therealarthur).
