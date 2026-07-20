# Repository Discovery

> **Scope:** This report describes the reference repository from a product and domain perspective. It does not treat the repository as the implementation to reproduce, and it makes no implementation recommendations.

## Executive Summary

Myrlin Workbook is a local-first workspace manager and control plane for developers who use AI coding command-line tools. It addresses the point at which one AI coding session becomes many: conversations become difficult to find, terminal windows multiply, project context becomes fragmented, simultaneous agents can conflict, and the developer loses visibility into activity, cost, and review status.

The product organizes provider-owned conversations around durable projects, gives users embedded terminals for running several sessions, preserves workspace state across restarts, and adds project documentation, search, cost visibility, conflict detection, and task tracking. Its more advanced workflow creates isolated Git worktrees for autonomous agent tasks and guides those tasks through execution, human review, and integration.

The repository began with a Claude Code-specific, tmux-inspired goal (`CLAUDE.md:13-25`) and now describes a broader multi-provider product. Claude Code remains the primary provider; ChatGPT Codex is presented as alpha/opt-in, while other providers are roadmap items (`README.md:11-18`). The product also supports responsive browser access and contains a native mobile client intended to monitor and control the host workstation.

The clearest product position is therefore:

> **A project-first, locally hosted command center for discovering, running, organizing, monitoring, and reviewing work performed through AI coding CLIs.**

Its primary value is not terminal emulation alone. It combines session continuity, project context, parallel-agent supervision, Git isolation, and human review in one workspace.

## Problem Statement

AI coding CLIs are effective as individual terminal sessions, but their default interaction model becomes difficult to manage when a developer works across multiple conversations, projects, and branches.

The repository explicitly identifies several problems (`README.md:104-108`):

- Provider resume interfaces expose opaque or weakly identified session records.
- Running several sessions creates terminal-window clutter.
- Restarting a machine or process requires reconstructing the working environment.
- Basic terminal interaction can be awkward for sustained agent use.
- The user has limited visibility into model usage and cost.

The broader product surface reveals additional coordination problems:

- Sessions are conversations, processes, and project work, but those identities are not naturally organized together.
- Multiple agents may edit the same files without the operator realizing it.
- Parallel tasks need separate branches and working directories to avoid interference.
- The developer needs to know whether an agent is active, waiting for input, idle, failed, or ready for review.
- Agent output must be inspected and deliberately accepted, rejected, merged, or turned into a pull request.
- Project intent—goals, rules, notes, planned work, and decisions—can become scattered across transcripts.
- Remote or mobile supervision requires a secure connection back to the machine where the sessions actually run.

Myrlin treats these as a loss-of-context and loss-of-control problem. The durable unit is the project/workspace; AI sessions are working units within it. The product attempts to preserve operational context around each session: what it belongs to, where it is running, what state it is in, what it changed, how much it used, and what should happen next.

## Target Users

### 1. Developers who use AI coding CLIs regularly

The primary user is a software developer who uses Claude Code or a similar terminal-based coding agent as part of everyday development. The motivating account is explicitly from a daily Claude Code user (`README.md:104-108`).

This user is likely to:

- Work in local code repositories.
- Be comfortable with terminals, Git, branches, and development tooling.
- Maintain several AI conversations over time.
- Want meaningful names and project grouping instead of provider session IDs.
- Need to resume work after browser, process, or machine restarts.
- Prefer local ownership of workspace state and transcripts.

### 2. Developers supervising multiple concurrent agents

A second, more advanced persona runs several agent tasks in parallel. This user needs isolation, status visibility, conflict detection, dependency tracking, diffs, and an explicit review step (`docs/WORKFLOWS.md:90-155`; `README.md:315-328`).

This could be:

- A solo developer delegating independent tasks to agents.
- A technical lead using agents to increase implementation throughput.
- A developer handling several repositories or several areas of one large repository.

The product assumes this user remains responsible for reviewing and integrating agent output.

### 3. Remote or mobile supervisors

The responsive UI and native mobile work target users who want to monitor or control sessions away from the host computer. The expected use is supervision rather than moving execution to the phone: the workstation remains authoritative, while the mobile device connects back to it (`README.md:66-80`, `README.md:246-258`).

### 4. Likely non-target users

There is little evidence that the repository is designed for multi-tenant enterprise use. It does not present organizations, team accounts, roles, shared cloud workspaces, or administrative policy as core concepts. Authentication appears to protect a locally hosted personal instance rather than support a collaborative SaaS model.

## Core Concepts

### Provider

A **provider** is an AI coding CLI that Myrlin can discover, launch, resume, search, and interpret through a common product experience. Claude Code is the primary provider. ChatGPT Codex is described as an alpha/optional provider, and Gemini or other tools are prospective additions (`docs/PROVIDER-INTERFACE.md:5-7`; `README.md:11-18`).

Provider capabilities are not assumed to be identical. Transcript formats, session locations, keyboard behavior, idle signals, and cost data may vary.

### Project / Workspace

A **project** or **workspace** is the durable container for a codebase and its related activity. It can hold sessions, tasks, documentation, templates, cost summaries, and project-specific status.

The repository uses both terms. The README increasingly says “project,” while the workflow guide, UI, and original brief often say “workspace” (`README.md:153-172`; `docs/WORKFLOWS.md:40-54`). Their exact relationship is not explicitly resolved.

### Category and Focus

A **category** is an optional grouping above projects, such as “Work” or “Side Projects.” A **focus** is described as an area within a project, such as frontend, backend, or research. The documented hierarchy is:

```text
Category
  Project
    Focus
      Session
```

Evidence: `README.md:153-172`.

Focus is less consistently represented than category, project, and session, so its current product status is uncertain.

### Session

A **session** is an AI coding conversation associated with a provider and usually a working directory. It may be discovered from existing provider data, created manually, launched from a template, or created as part of a worktree task.

From the user’s perspective, a session may have:

- A meaningful name or generated title.
- A provider and model.
- A project/workspace association.
- A working directory and branch.
- A transcript and searchable history.
- A live terminal process.
- Activity, idle, stopped, error, or review-related status.
- Usage and estimated cost when the provider exposes enough data.

### Terminal Pane and Tab Group

A **terminal pane** is a live embedded terminal connected to a coding session. Desktop layouts support multiple panes so the user can operate and observe several agents at once.

A **tab group** is a named, persistent arrangement of panes. It lets users organize terminals by purpose—such as research, implementation, or debugging—without requiring every pane to belong to the same project (`README.md:174-182`; `docs/WORKFLOWS.md:65-86`).

### Activity and Completion State

The product distinguishes between a session that is actively producing output, one that is idle or waiting, and work that appears ready for human review. These states drive visual indicators and notifications (`docs/WORKFLOWS.md:75-80`, `docs/WORKFLOWS.md:149-155`).

“Idle,” “done,” and “ready for review” are related but not necessarily equivalent; their exact semantics are an open question.

### Worktree Task

A **worktree task** is an isolated unit of agent work. It combines:

- A task description or prompt.
- A dedicated Git branch.
- A separate Git working directory.
- A corresponding AI coding session.
- A lifecycle from creation and execution to review and integration.

This concept is central to parallel-agent orchestration because it prevents independent agents from sharing one checkout (`docs/WORKFLOWS.md:90-155`).

### Feature / Kanban Card

The repository also describes planned work as cards on a board. One description uses a project feature board with Planned, Active, Review, and Done; another uses an orchestration board with Backlog, Planning, Running, Review, and Done (`README.md:184-195`, `README.md:315-328`).

The relationship between feature cards and executable worktree tasks is not fully clear. They may be separate planning and execution concepts, or overlapping generations of the same concept.

### Project Documents

A project can hold durable context outside individual conversations, including:

- Notes
- Goals
- Tasks
- Rules
- Roadmap items
- AI-generated insights or summaries
- Feature planning

Evidence: `README.md:184-195`.

These documents preserve project intent and make the workspace more than a process monitor.

### Template

A **template** is a reusable session launch configuration. It can prefill a working directory, command/model choices, permission behavior, and related flags (`README.md:212-215`; `docs/WORKFLOWS.md:219-232`).

### Cost and Usage

**Cost and usage** are derived from provider transcript data where available. They can be viewed by session, project, model, or time period. The product treats these as estimates and not all providers necessarily support them (`README.md:140-145`, `README.md:284-290`).

### Local Persisted State

Myrlin maintains its own durable organizational state separately from the provider’s conversation files. This allows project grouping, settings, terminal arrangements, task metadata, and recovery behavior to survive application restarts.

## Supported Workflows

### 1. Start and authenticate a local Workbook instance

1. Run the application locally.
2. Open the browser interface.
3. Authenticate with the configured/generated credential or startup token.
4. Create or select a project/workspace.
5. Discover existing sessions or create a new one.

The exact first-run password experience differs between documents and is listed as an unknown (`README.md:26-64`; `docs/WORKFLOWS.md:22-37`).

### 2. Discover and organize existing AI conversations

1. Scan a provider’s local session store.
2. Review discovered sessions and their working directories or recency.
3. Import sessions into projects/workspaces.
4. Apply generated titles or rename them manually.
5. Group them by category, project, and possibly focus.
6. Search across projects, sessions, directories, and transcript content.

This workflow addresses the opaque-session problem and is one of the product’s clearest headline capabilities (`README.md:142-172`).

### 3. Create and run sessions

1. Create a session manually or from a saved template.
2. Select the project, working directory, provider/model, and launch options.
3. Open the session in an embedded terminal pane.
4. Interact with the underlying coding CLI normally.
5. Stop, restart, resume, or change the session’s operating options.

### 4. Supervise multiple sessions

1. Open several sessions in a multi-pane terminal grid.
2. Arrange related panes into tab groups.
3. Observe active, idle, waiting, or completion indicators.
4. Receive notifications when attention is needed.
5. Return after a browser refresh and reconnect to retained terminal state.
6. Restore or reconcile sessions after an application or machine restart.

Evidence: `README.md:174-182`; `docs/WORKFLOWS.md:65-86`.

### 5. Plan and document a project

1. Open the project’s documentation area.
2. Record notes, goals, rules, tasks, and roadmap items.
3. Track planned work or features on a board.
4. Review summaries or insights derived from project sessions.

This keeps project-level context independent of any one conversation.

### 6. Create an isolated agent task

1. Define a task and select its repository, model, and launch options.
2. Create a dedicated branch and Git worktree.
3. Launch an AI coding session inside that worktree.
4. Monitor the task as it runs.
5. Inspect changed files, commits, and diffs.
6. Decide whether to reject, merge, push, or create a pull request.

Evidence: `docs/WORKFLOWS.md:90-155`, `docs/WORKFLOWS.md:183-216`.

### 7. Manage a portfolio of agent tasks

The broader board workflow supports:

- Moving work through planning, running, review, and completion stages.
- Declaring blocking relationships.
- Limiting concurrent tasks.
- Assigning models by task or stage.
- Monitoring live execution.
- Tracking GitHub pull-request status.

Evidence: `README.md:315-328`.

### 8. Detect conflicting parallel work

1. Observe files changed by active sessions.
2. Detect when multiple sessions touch the same file.
3. Identify the sessions involved.
4. Jump to the relevant terminal or review context.

This gives the operator early warning before parallel work becomes an integration problem (`README.md:216-218`, `README.md:309-313`).

### 9. Track usage and estimated cost

1. Read token/usage data from supported provider transcripts.
2. Estimate cost using model-aware pricing.
3. Inspect totals per session or project.
4. Compare usage by time period, model, or session.

An older quota-window widget is explicitly archived and should not be treated as a current feature (`docs/QUOTA_WIDGET_REFERENCE.md:1-8`).

### 10. Promote repository-native tasks into agent work

With the optional `td` integration, users can view repository-stored issues, promote an issue into a worktree task, pass the issue context to the new session, and continue using `td` for granular task/handoff state while Myrlin tracks orchestration and review (`README.md:197-210`, `README.md:506-523`).

### 11. Monitor and control work remotely

Users can access the responsive web UI over a local network or an optionally configured secure tunnel. The repository also contains a mobile application flow based on pairing with a host server. The host computer continues to run the actual sessions (`README.md:66-80`, `README.md:246-258`).

### 12. Derive new tasks from an existing conversation

The repository describes a “spinoff tasks” workflow that extracts actionable tasks and structured context from a running conversation, then launches isolated worktree sessions. However, README placement labels it “Next Up,” while other repository evidence suggests partial or active implementation. Its shipped status is therefore unclear and it should not be assumed to be a stable current workflow (`README.md:463-469`).

## External Integrations

| Integration | Product role | Status |
|---|---|---|
| **Claude Code** | Discover, search, launch, resume, and monitor coding conversations; derive supported usage/cost data | Core provider |
| **ChatGPT Codex CLI** | Second provider under the same workspace experience | Alpha/opt-in according to current product text |
| **Gemini / other coding CLIs** | Potential future providers | Roadmap, not established as current |
| **Git** | Branches, worktrees, diffs, changed files, conflict detection, merges, and task isolation | Core for advanced task workflows |
| **GitHub CLI (`gh`)** | Push branches and create/track pull requests | Optional |
| **`td` CLI** | Repository-native issue and handoff tracking; promotion of issues into worktree sessions | Optional |
| **Cloudflare Tunnel** | Expose the locally hosted application for remote access | Optional deployment path |
| **Cloudflare Access** | Add an external access-control layer to a remotely exposed instance | Optional/deployment-specific |
| **Expo services** | Pairing and push-notification support for the native mobile client | Optional/mobile-specific |
| **Desktop notification APIs** | Alert the user when sessions become idle, complete, fail, or need attention | Optional/user-configurable |
| **Provider-local transcript stores** | Source of discoverable conversations, search content, usage, and cost data | Foundational local dependency |
| **Anthropic API access** | Appears to support selected AI-generated product functions beyond the CLI sessions | Optional; exact product boundary is not fully documented |

The product’s “local-first” claim means that Myrlin stores and manages its own state locally and does not present itself as a hosted telemetry service. It does not mean that no data can ever leave the machine: AI providers, GitHub, Cloudflare, and push services are external when the user enables or uses them.

## Feature Summary

### Primary value proposition

1. **Session discovery and project organization**  
   Turns provider-owned conversations and opaque IDs into named, searchable sessions organized around real codebases.

2. **Embedded multi-session workspace**  
   Replaces terminal-window sprawl with persistent terminal panes, tab groups, activity indicators, and session controls.

3. **Continuity and recovery**  
   Preserves workspace organization and helps restore interrupted sessions after refreshes, crashes, or restarts.

4. **Isolated parallel-agent orchestration**  
   Gives each autonomous task its own Git worktree and branch, then exposes status, changes, review, merge, and pull-request actions.

5. **Project context outside transcripts**  
   Keeps goals, rules, notes, tasks, roadmap items, and feature planning alongside sessions.

6. **Operational visibility**  
   Surfaces activity, idle/completion state, changed files, conflicts, resource information, usage, and estimated cost.

7. **Human-controlled integration**  
   Treats agent output as work to inspect and approve rather than automatically accepting it.

8. **Provider unification**  
   Aims to offer one organizational model across multiple AI coding CLIs despite differing capabilities.

9. **Remote and mobile supervision**  
   Lets a user observe and control the workstation-hosted environment from another browser or a phone.

### Supporting features

- Global and transcript search.
- Quick project/session switching.
- Session templates.
- Model and launch-option selection.
- Notifications and attention indicators.
- Conflict detection for parallel edits.
- Optional safe-prompt auto-accept behavior.
- Themes and interface customization.
- AI-generated project insights or PR descriptions.
- Optional integration with repository-native `td` tasks.

## Assumptions

The following are assumptions inferred from the repository rather than confirmed product requirements:

1. **The primary deployment is personal and single-user.**  
   The local host, shared instance credential, and absence of tenant/team concepts suggest one developer per Workbook instance.

2. **The host workstation is authoritative.**  
   Browser and mobile clients control sessions running on the machine that hosts Myrlin; they do not move execution or synchronize full state between computers.

3. **Users already have supported AI CLIs installed and authenticated.**  
   Myrlin manages and launches those tools but is not itself an AI model provider.

4. **Provider session history is readable on local disk.**  
   Discovery, transcript search, auto-titling, and some cost calculations depend on provider-owned local files and formats.

5. **Git is the expected version-control system for autonomous tasks.**  
   General session management may work outside Git, but worktree isolation, conflict detection, review, and integration depend on Git concepts.

6. **The intended user understands development tooling.**  
   Branches, worktrees, terminals, models, permissions, diffs, and pull requests are presented as normal workflow elements.

7. **Human review remains part of the operating model.**  
   Task states and merge/reject actions imply that an agent finishing execution is not automatically equivalent to accepted work.

8. **Provider parity is intentionally partial.**  
   Some providers may lack cost data, idle signals, resume behavior, or equivalent keyboard controls.

9. **Local-first is a privacy and ownership position, not a strict offline guarantee.**  
   External AI providers and optional GitHub, Cloudflare, and push integrations may transmit data when used.

10. **Desktop is the canonical interaction model.**  
    Mobile aims to preserve capabilities, but physically desktop-specific interactions such as multi-pane grids must be adapted.

11. **Windows support is a first-class requirement.**  
    The initial brief requires native Windows operation without WSL, even though macOS and Linux are also supported (`CLAUDE.md:21-25`).

12. **The reference repository contains multiple product generations.**  
    Stable, alpha, implemented, archived, and roadmap material coexist, so documentation labels cannot always be interpreted as one synchronized release description.

## Questions / Unknowns

### Product vocabulary and structure

1. Are **project** and **workspace** intended to be exact synonyms, or are they distinct concepts?
2. Is **focus** currently a first-class entity, an older naming concept, or a planned addition?
3. Are the four-column feature board and five-column worktree-task board separate products, separate views of one system, or documentation from different generations?
4. What is the intended boundary between a normal session, a feature, a task card, and a worktree task?

### Current release boundary

5. Which feature set represents the current product: v0.9 stable, v1.2 alpha, or the full repository state?
6. Is Codex support considered usable alpha, experimental, or merely preparatory for a later release?
7. Is Gemini the next provider, or is Aider still part of the active roadmap?
8. Is the native mobile app currently functional for users, or primarily an in-progress parity target?
9. Is conversation-to-task spinoff currently shipped, partially implemented, or only planned?

### Status and workflow semantics

10. What precisely differentiates **idle**, **waiting for input**, **complete**, and **ready for review**?
11. How is a task classified when an agent exits without a commit, makes partial changes, fails, or waits indefinitely?
12. What happens to branches, worktrees, and uncommitted changes when a task is rejected or deleted?
13. What user workflow is expected when a merge produces conflicts?
14. How are secrets and machine-specific files handled when a new worktree is initialized or context is handed to another agent?

### Provider and cost behavior

15. Which capabilities are guaranteed across providers, and which are Claude-specific?
16. How are unsupported provider values—especially cost—represented without implying zero usage?
17. How accurate are cost estimates for subscriptions, credits, cached tokens, pricing changes, or incomplete transcripts?
18. What happens when a provider changes its local transcript format or storage location?

### Persistence, access, and ownership

19. Exactly which state is backed up, exportable, or portable to another machine?
20. What happens to Myrlin records when an underlying provider session is deleted or a project directory moves?
21. What is the intended security model for access outside a trusted local network?
22. How are simultaneous browser and mobile clients coordinated when both can control the same terminal?
23. Is multi-user collaboration intentionally out of scope, or simply not yet represented in the repository?
