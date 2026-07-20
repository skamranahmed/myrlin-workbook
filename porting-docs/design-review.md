# Phase 4 — Architecture Design Review

> **Objective:** Identify which design choices from the reference repository should **not** be copied into a from-scratch product.
>
> **Priority scale:**
> - **Critical:** Foundational choice that creates systemic risk or large future rework.
> - **High:** Material security, correctness, scalability, or maintainability concern.
> - **Medium:** Significant ongoing cost or conceptual complexity, but survivable at small scale.
> - **Low:** Localized debt, duplication, or specialized complexity.
>
> This review distinguishes between choices that were reasonable for an organically grown personal tool and choices that remain appropriate foundations for a new product.

## Executive Assessment

The repository has a coherent architectural idea: a local, host-authoritative control plane that sits between AI coding CLIs, Git repositories, and multiple user interfaces. Its strongest boundaries—provider adapters, server-owned PTYs, transport specialization, provider-owned transcripts, human review for agent output, and local-first operation—are worth retaining.

The primary weakness is that these conceptual boundaries are not consistently reflected in the physical structure of the codebase. Three large artifacts have become de facto system boundaries:

- A single coordination-state JSON document.
- An approximately 8,700-line web server/composition file.
- An approximately 22,600-line browser application file.

As the product expanded, resilience and compatibility mechanisms accumulated around these monoliths: tiered backups, shape-drift detection, frontend fallback copies, source-scanning tests, provider-literal grep gates, cross-process mtime checks, and duplicated client behavior. Many of these mechanisms are thoughtful responses to real incidents, but a new product should avoid inheriting the conditions that made them necessary.

The short conclusion is:

> **Copy the architectural boundaries and product insights; do not copy the storage model, monolithic server/client structure, shell execution contract, integration sprawl, or duplicated product surfaces.**

## Strengths

The following decisions are strong and should inform a new design.

### 1. Host-authoritative local architecture

The host machine owns processes, credentials, repositories, and coordination state. Browser and mobile clients control the host rather than pretending to be independent peers. This is well aligned with a local-first developer tool.

### 2. Separation of Workbook, provider, process, and Git identities

The architecture correctly distinguishes:

- Workbook session record.
- Provider conversation/session identity.
- Live PTY/process identity.
- Git branch/worktree identity.

That separation supports discovery without execution, reconnectable terminals, stale-process recovery, and worktree review.

### 3. Explicit provider registry and capability gating

The provider registry validates required behaviors and exposes optional capabilities such as cost, mirror parsing, and resume behavior. Unsupported features can be represented honestly instead of appearing as zero or silently failing (`src/providers/index.js`).

### 4. Server-owned PTYs

PTY processes outlive individual browser connections. Bounded scrollback, reconnect replay, viewport ownership, and backpressure handling demonstrate appropriate ownership of long-lived terminal resources (`src/web/pty-manager.js`).

### 5. Specialized transports

Using REST for commands/snapshots, SSE for server-to-client state changes, and WebSockets for terminal bytes is a sound division of responsibilities.

### 6. Observe versus control separation

The mirror service reads provider transcripts without resuming or taking over the session. This is an important product and architecture distinction. The ref-counted tailer and provider-specific parsing boundary are good patterns (`src/web/mirror-service.js`, `src/web/jsonl-tailer.js`).

### 7. Provider-owned canonical transcripts

Workbook does not attempt to become a second canonical conversation store. It organizes and interprets provider records while leaving resume/history compatibility with the provider.

### 8. Human review boundary for agent work

Worktree creation, execution, completion, review, and integration are separate states. Agent completion does not automatically equal accepted code.

### 9. Worker isolation for expensive analytics

Cost parsing is moved off the main event loop so transcript scanning cannot directly block terminal traffic (`src/web/cost-worker.js`).

### 10. Defensive persistence thinking

Atomic replacement, backup tiers, schema migration, post-write checks, and crash-loop containment demonstrate serious attention to data loss. The concern is the single-document storage choice, not the reliability intent.

### 11. Mobile state ownership split

The mobile app's division between local Zustand state, secure storage, TanStack Query server data, SSE invalidation, and push notifications is clearer than the browser client's state model.

### 12. Reuse of established external tools

Git, `gh`, `td`, provider CLIs, and `cloudflared` remain separate authorities. Adapters normalize their behavior rather than reimplementing those domains.

## Weaknesses

## Critical Issues

### DR-01 — Single-document coordination store

**Problem**

All major coordination entities are loaded into one in-memory object and persisted by serializing the entire state document. Session status, workspaces, task metadata, templates, settings, devices, provider overrides, and other records share the same physical persistence boundary (`src/state/store.js`). Cross-process synchronization is based on file modification checks and whole-document reloads.

**Impact**

- Write cost grows with total state size rather than the changed entity.
- Frequent status changes can block the same event loop serving API and terminal traffic.
- GUI and TUI writers can overwrite one another through last-writer-wins behavior.
- One malformed or truncated document threatens every coordination domain.
- Backup tiers, shape-drift guards, rejected-state files, and post-write verification become necessary to compensate for the blast radius.
- Entity-level migration, querying, indexing, and retention are harder than they need to be.

**Suggested Alternative**

Use an embedded transactional database, preferably SQLite, as the authoritative coordination store. Keep local-first and single-file deployment, but model workspaces, sessions, tasks, settings, devices, and templates as separate tables with transactions and indexes. Provide JSON export/import for portability and inspection. Store large project documents separately only when human-editable files are an explicit requirement.

**Priority:** **Critical**

**Why the current choice was understandable:** A JSON file was simple, inspectable, dependency-light, and adequate for the original small, single-process TUI.

**Evidence:** `src/state/store.js:39-77`, `src/state/store.js:336-352`, `src/state/store.js:451-517`, `src/state/store.js:700-742`.

---

### DR-02 — Web server as composition root, route layer, and domain layer

**Problem**

`src/web/server.js` is approximately 8,700 lines and combines application assembly, middleware, SSE clients, numerous inline routes, cost coordination, Git/worktree operations, provider-facing behavior, transcript-derived operations, process/resource inspection, tunnel management, and optional integrations.

**Impact**

- Domain logic is difficult to test without constructing the entire HTTP runtime.
- Shared closure state creates hidden dependencies.
- Changes in unrelated product areas collide in one file.
- Route handlers become the business-service layer instead of translating HTTP into domain calls.
- Parallel development produces frequent merge conflicts in the same integration surface.
- Security-sensitive operations and ordinary CRUD share one very large review boundary.

**Suggested Alternative**

Keep a thin composition root that creates services and mounts feature routers. Organize modules by domain, for example:

```text
application/
  sessions/
  workspaces/
  terminals/
  tasks/
  providers/
  costs/
  devices/
  integrations/
```

Each domain should expose a service interface and a small HTTP adapter. Cross-domain workflows should be orchestrated by application services rather than inline route handlers. The server entrypoint should assemble dependencies and own listener lifecycle, not implement product behavior.

**Priority:** **Critical**

**Why the current choice was understandable:** A local single-process Express server makes shared access to the store, broadcast function, and local services convenient; gradual extraction is visible in auth, pairing, devices, push, PTY, mirror, and credentials modules.

**Evidence:** `src/web/server.js`; extracted setup boundaries around `src/web/server.js:350-397`.

---

### DR-03 — Browser SPA as a single application object

**Problem**

The canonical browser UI is concentrated in an approximately 22,600-line `src/web/public/app.js`, with state, rendering, event delegation, modals, discovery, costs, docs, tasks, settings, and server synchronization handled imperatively. Terminal behavior is partly separated, but most product behavior is not componentized.

**Impact**

- UI behavior cannot be isolated easily for unit or component testing.
- Shared mutable state creates broad regression risk.
- Feature work repeatedly touches one artifact.
- Source-scanning tests verify the presence of strings rather than user behavior.
- Initial load and parse cost grows with every feature.
- The mobile client must reimplement the same product logic because the browser client has no reusable typed domain/client layer.
- A full fallback copy of frontend assets becomes part of the recovery strategy.

**Suggested Alternative**

Use a component-based web architecture with route-level modules, a typed API client, a small state/query layer, and isolated terminal components. Svelte, Preact, React, Solid, or another lightweight framework would all provide better boundaries than one application object. Share API schemas, event types, validation, and domain selectors with the mobile client through a common package.

**Priority:** **Critical**

**Why the current choice was understandable:** A no-build vanilla frontend minimized dependencies and was efficient when the UI was small and terminal-focused.

**Evidence:** `src/web/public/app.js`, `src/web/public/terminal.js`, `test/pane-context-menu.test.js`, `src/web/public/.backup/`.

---

### DR-04 — Shell-string process launch contract

**Problem**

The terminal layer ultimately constructs a command string and executes it through a platform shell. Provider adapters therefore own quoting and escaping responsibilities for user-influenced values such as prompts, model names, flags, directories, and resume identifiers.

**Impact**

- Correctness depends on every provider understanding several shell quoting models.
- Adding a provider can accidentally introduce command injection.
- Windows, POSIX shells, PowerShell, and login-shell behavior multiply edge cases.
- The provider contract exposes rendering/quoting concerns rather than a neutral executable-plus-arguments model.
- Tests must cover combinations of provider, shell, and special characters.

**Suggested Alternative**

Make the provider spawn contract return:

```text
{
  executable,
  args[],
  cwd,
  env
}
```

Spawn without a shell. Resolve CLI binaries explicitly and construct environment variables separately. Use a shell only for a narrowly defined “user command” feature where shell semantics are the purpose, not for normal provider execution.

**Priority:** **Critical**

**Why the current choice was understandable:** Login shells simplify PATH discovery for CLIs installed through user-specific Node/tool managers, and command strings were expedient for cross-platform terminal launching.

**Evidence:** `src/web/pty-manager.js`, `src/providers/claude/spawn.js`, provider spawn contract notes in `src/providers/index.js`.

## High-Priority Issues

### DR-05 — Provider abstraction leakage

**Problem**

The provider registry is a good abstraction, but provider-format and provider-specific behavior still leaks into server and PTY paths. The repository uses a source grep gate to prevent bare provider-name literals outside approved locations, indicating that the boundary is being enforced textually rather than structurally.

**Impact**

- Adding a provider requires more than implementing one adapter.
- Transcript title generation, summarization, artifact lookup, and special-case behavior can diverge across server modules.
- A grep exception can bypass the intended architecture without a type/interface failure.
- Provider-neutral modules become aware of provider storage assumptions.

**Suggested Alternative**

Expand the provider contract to include every behavior that depends on provider data or semantics: discovery, parsing, search, spawn, idle classification, mirror conversion, artifact lookup, usage extraction, title inputs, summary/context extraction, and supported controls. Core modules should receive only a provider interface and normalized domain records.

**Priority:** **High**

**Why the current choice was understandable:** The product began as Claude-only, so provider-neutral boundaries were added after many Claude-shaped flows already existed.

**Evidence:** `src/providers/index.js`, `test/grep-gate.test.js`, provider-specific logic remaining in `src/web/server.js` and `src/web/pty-manager.js`.

---

### DR-06 — Plaintext secret storage mixed with ordinary state

**Problem**

The instance password is resolved from local configuration in plaintext, and optional API credentials can be persisted in ordinary settings/state. Coordination-state backup behavior can therefore duplicate secrets alongside non-secret product records.

**Impact**

- A leaked state/config backup exposes credentials rather than only project metadata.
- Secret rotation and access policy are tied to generic settings persistence.
- The threat model becomes weaker when LAN or tunnel access is enabled.
- Debugging, copying, anonymizing, or sharing state carries additional security risk.

**Suggested Alternative**

Store only a slow password hash for local login. Keep API/OAuth credentials in the platform credential store—Keychain, Windows Credential Manager, or libsecret—or in a separate permissions-restricted secrets file that is excluded from ordinary state backups and exports. Domain state should hold secret references, not secret material.

**Priority:** **High**

**Why the current choice was understandable:** A personal local application often treats the user's home directory as trusted, and plaintext config is simple to bootstrap.

**Evidence:** `src/web/auth.js:80-163`; key/settings routes in `src/web/server.js`; backup behavior in `src/state/store.js`.

---

### DR-07 — Provider-internal credential management embedded in the product

**Problem**

The account-switching subsystem directly understands Claude credential files and provider OAuth behavior. It also contains an optional Mac credential bridge tailored to a specific multi-host workflow (`src/web/credential-manager.js`, `src/web/mac-bridge.js`).

**Impact**

- Undocumented provider credential formats and endpoints can change without notice.
- A bug can damage the user's primary provider login state.
- Security-sensitive logic becomes one of the largest services in the repository.
- A highly specialized personal workflow becomes part of the general product's maintenance and test surface.
- Credential propagation to a second host expands the blast radius of mistakes.

**Suggested Alternative**

Treat provider CLIs as credential owners. Prefer supported provider login/account-switch commands. If provider-internal switching is unavoidable, isolate it as an optional integration package with a narrow interface, explicit compatibility versioning, and no dependency from the core session manager. Replace the machine-specific bridge with a generic post-switch hook or omit it from the core product.

**Priority:** **High**

**Why the current choice was understandable:** The functionality solves a real workflow for the repository's author and provider CLIs may not expose a sufficient supported account API.

**Evidence:** `src/web/credential-manager.js`, `src/web/credential-routes.js`, `src/web/mac-bridge.js`; feature inventory K1/K2.

---

### DR-08 — Process-global exceptions are logged while the process continues

**Problem**

The GUI and store install broad `uncaughtException`/`unhandledRejection` handling that favors remaining alive after logging or attempting persistence.

**Impact**

- The process may continue after an invariant has been violated or a mutation is half-complete.
- Subsequent writes can persist corrupted in-memory state.
- The outer supervisor cannot restart into a clean process if the child never exits.
- Failure behavior depends on which global handler runs and what state it observes.

**Suggested Alternative**

Catch and handle expected request/process errors at their service boundaries. For genuinely uncaught exceptions, record diagnostics, attempt a bounded safe flush, and exit non-zero. Let the supervisor restart the process. Suppress only explicitly recognized benign failures such as a closed stdout pipe.

**Priority:** **High**

**Why the current choice was understandable:** An always-on local tool prioritizes uptime, and broken pipe errors can otherwise create noisy crash cycles.

**Evidence:** process handlers in `src/gui.js` and `src/state/store.js`; restart behavior in `src/supervisor.js`.

---

### DR-09 — Untyped event contracts and inferred workspace scope

**Problem**

Store events, SSE event names, payload shapes, and workspace filtering are coordinated manually. Some routing logic infers scope from fields such as `workspaceId`, nested workspace objects, or generic `id` values.

**Impact**

- A new event can be omitted from broadcasting or filtered incorrectly.
- `id` can refer to a session, task, group, template, or workspace.
- Mobile subscriptions may silently miss or receive unrelated events.
- Clients frequently refetch after an event because payloads are not guaranteed to contain a complete typed change.
- Event evolution lacks compile-time or schema validation.

**Suggested Alternative**

Define one shared event schema:

```text
{
  type,
  scope: { kind, workspaceId?, entityId? },
  revision,
  payload
}
```

Validate it at emit time and generate TypeScript types for web/mobile clients. Forward events generically and use explicit scope only. Include enough normalized data for clients to patch simple updates while retaining refetch for complex invalidation.

**Priority:** **High**

**Why the current choice was understandable:** Event payloads grew feature by feature, and desktop clients receiving all events concealed many scoping inconsistencies.

**Evidence:** SSE broadcast and store-event attachment in `src/web/server.js` around `broadcastSSE` and `attachStoreEvents`.

---

### DR-10 — Full mobile parity duplicates the entire product surface

**Problem**

The repository maintains a large vanilla browser SPA and a separate Expo/React Native client while project rules require every desktop feature to be reproduced on mobile.

**Impact**

- Every feature creates at least two UI implementations.
- Domain/view behavior drifts because little browser code is reusable by mobile.
- Desktop-specific concepts such as multi-pane terminal grids require awkward mobile reinterpretation.
- Native-client work consumes substantial effort even when the primary mobile use case is monitoring and intervention.
- Testing and release coordination multiply across platforms.

**Suggested Alternative**

Define mobile as a deliberately bounded supervisory client: status, notifications, input intervention, review summaries, and essential controls. Use a responsive web client for broader parity, or share typed domain/query packages between a modern web client and native app. Native-only work should justify itself through secure storage, biometrics, push, and device integration rather than a blanket parity mandate.

**Priority:** **High**

**Why the current choice was understandable:** The product vision explicitly values full control away from the desk, and native capabilities improve that experience.

**Evidence:** mobile parity requirements in `CLAUDE.md`; separate browser and `mobile/` implementations; parity uncertainty in `feature-inventory.md`.

---

### DR-11 — Deep dependence on undocumented provider filesystem formats

**Problem**

Discovery, mirroring, cost, search, working-directory inference, and session metadata depend on provider-owned JSONL layouts and known filesystem paths.

**Impact**

- A provider release can break several features simultaneously.
- Silent fallback can produce incorrect working directories or missing cost/history.
- Format assumptions spread into runtime hot paths.
- Compatibility failures are difficult for users to distinguish from missing sessions.

**Suggested Alternative**

The dependency cannot be removed if external-session discovery is required, but it should be contained. Put all path and format knowledge in versioned provider adapters. Add format probing and explicit compatibility status. Cache normalized metadata at import time. Degrade individual capabilities with clear diagnostics instead of falling back silently.

**Priority:** **High**

**Why the current choice was understandable:** Providers do not expose a stable discovery API, and local transcript inspection is the only way to deliver the product's headline discovery feature.

**Evidence:** `src/providers/claude/`, `src/providers/codex/`, `src/web/jsonl-tailer.js`, provider-related logic in `src/web/pty-manager.js`.

---

### DR-12 — PID-only process reconciliation

**Problem**

Recovery and process tracking use stored PIDs and host liveness checks without a durable process identity that includes start time or server ownership.

**Impact**

- A recycled PID can make an unrelated process appear to be the original session.
- Recovery can incorrectly skip or classify a session.
- Persisted “running” state can outlive the process model that made it true.

**Suggested Alternative**

Treat live process ownership as in-memory server state. Persist historical PID/start metadata for diagnostics, not as proof of liveness. On restart, default previous live records to stopped/recoverable unless a supervised child identity can be verified by PID plus process start time and expected executable.

**Priority:** **High**

**Why the current choice was understandable:** `kill(pid, 0)` is cheap and broadly available, and PID reuse is uncommon in short local sessions.

**Evidence:** `src/core/recovery.js`, `src/core/process-tracker.js`.

## Medium-Priority Issues

### DR-13 — Hidden global-store coupling

**Problem**

Many services and routes reach the complete store through global accessors or injected `getStore()` closures rather than narrow domain repositories/interfaces.

**Impact**

- Dependencies are broader than module signatures imply.
- Tests must configure or replace global state.
- Services can mutate unrelated domains.
- It is difficult to identify transaction boundaries.

**Suggested Alternative**

Construct the object graph once at startup and inject narrow interfaces such as `SessionRepository`, `WorkspaceRepository`, `DeviceRepository`, and `SettingsRepository`. Application services should receive only the capabilities they use.

**Priority:** **Medium**

**Why the current choice was understandable:** One singleton is convenient in a single-process app and was consistent with the original JSON-store model.

**Evidence:** `getStore()` usage and setup closures throughout `src/web/server.js`.

---

### DR-14 — Structural/source-scanning tests for high-risk behavior

**Problem**

The test suite contains valuable coverage, but some tests for the largest artifacts assert that source strings, provider attributes, or menu fragments exist instead of exercising behavior in a browser or isolated module.

**Impact**

- Tests can pass while interaction behavior is broken.
- Refactoring changes text and structure even when behavior remains correct.
- The most complex UI/server areas have the weakest behavioral isolation.
- Textual gates become permanent substitutes for enforceable module boundaries.

**Suggested Alternative**

After decomposing server and frontend modules, test pure services with unit tests, route contracts with an in-memory HTTP harness, UI components with DOM/component tests, terminal behavior with focused integration tests, and critical flows with Playwright. Keep source scans only for very small policy checks.

**Priority:** **Medium**

**Why the current choice was understandable:** Monolithic, global browser code is difficult to instantiate under a test runner, so source scans provide a cheap regression net.

**Evidence:** `test/run.js`, `test/pane-context-menu.test.js`, `test/grep-gate.test.js`.

---

### DR-15 — Overlapping feature and task models

**Problem**

The product contains a four-column project feature board, a five-column orchestration board, worktree tasks, docs tasks, and optional `td` tasks. Their boundaries are not consistently documented.

**Impact**

- Users may not know where work should be created or tracked.
- Similar lifecycle states and drag/drop logic are implemented multiple times.
- Relationships between a planned feature, executable task, and repository issue require translation.
- Future integrations must choose among several competing work-item concepts.

**Suggested Alternative**

Use one `WorkItem` model with optional execution metadata. A planned feature is a work item without an execution; promoting it creates an execution/worktree. Boards become views over the same entities and lifecycle rather than separate stores. External `td` issues map through an explicit integration reference.

**Priority:** **Medium**

**Why the current choice was understandable:** Planning and executable worktree orchestration arrived in different product generations.

**Evidence:** `features` and `worktreeTasks` domains in `src/state/store.js`; Phase 1 and Phase 2 overlap notes.

---

### DR-16 — Legacy TUI creates a second execution and write model

**Problem**

The Blessed TUI uses the shared store but launches native OS terminals through a different session path than the server-owned PTY model used by the GUI.

**Impact**

- Session launch, status, recovery, and permission behavior must remain correct in two architectures.
- TUI and GUI can act as competing state writers.
- The de-emphasized client increases test and maintenance burden.
- Feature parity is unlikely, creating ambiguous support expectations.

**Suggested Alternative**

Choose server-owned PTYs as the only execution model. If a terminal-only client remains valuable, make it an API/WebSocket client of the same server rather than an independent launcher and store writer.

**Priority:** **Medium**

**Why the current choice was understandable:** The TUI was the original product, and retaining it preserved compatibility for terminal-first users.

**Evidence:** `src/index.js`, `src/ui/`, `src/core/session-manager.js`, `src/web/pty-manager.js`.

---

### DR-17 — Heuristic idle and prompt automation treated as product state

**Problem**

Idle/completion and safe/dangerous prompt detection are inferred from unstructured PTY output through patterns.

**Impact**

- False positives produce premature completion notifications or auto-input.
- False negatives leave sessions stalled.
- Provider output changes can silently alter behavior.
- A probabilistic signal can appear authoritative in task state and notifications.

**Suggested Alternative**

Keep heuristics inside provider adapters and return a structured classification with confidence and evidence. Use them for UI hints and notifications, not irreversible actions. Safe-prompt auto-accept should remain explicitly opt-in, narrow, and unable to authorize destructive operations by itself.

**Priority:** **Medium**

**Why the current choice was understandable:** Current CLIs do not expose reliable structured idle/approval events.

**Evidence:** provider `isIdleSignal` contract; auto-trust behavior described in `docs/WORKFLOWS.md` and `feature-inventory.md`.

---

### DR-18 — Markdown as the mutable record format for structured project items

**Problem**

Goals, tasks, and roadmap entries are represented in Markdown and manipulated by section/index rather than stable record identity.

**Impact**

- Reordering or external edits can invalidate positional operations.
- Linking a roadmap item to a task/session is difficult.
- Concurrent edits and synchronization are brittle.
- Parsing/rendering concerns enter domain operations.

**Suggested Alternative**

Persist structured project items with stable IDs and render/export them as Markdown. Preserve a separate freeform Markdown notes area when human editability is the primary requirement.

**Priority:** **Medium**

**Why the current choice was understandable:** Markdown is portable, inspectable, and compatible with the local-first philosophy.

**Evidence:** `src/state/docs-manager.js`; docs mutations in `src/state/store.js`.

---

### DR-19 — Polling full Git status for conflict detection

**Problem**

Conflict detection repeatedly inspects Git status across active sessions/worktrees and relies on short-lived caching to control cost.

**Impact**

- Work scales with active sessions and repository size.
- Short cache lifetimes increase host load; longer lifetimes produce stale warnings.
- Git operations compete with review, task, and repository commands.

**Suggested Alternative**

Track changed paths incrementally per known worktree using filesystem events and targeted Git queries. Reconcile with a full Git status at bounded checkpoints rather than using it as the primary continuous signal.

**Priority:** **Medium**

**Why the current choice was understandable:** Git status is portable and authoritative, while filesystem events are platform-specific and imperfect.

**Evidence:** `src/web/git-status-cache.js`, conflict routes/services in `src/web/server.js`.

---

### DR-20 — Fragmented persistence outside the main store

**Problem**

Layouts, pinned notes, docs, frontend fallback assets, provider transcripts, and other records use separate file helpers with differing atomicity, migration, and backup behavior.

**Impact**

- “What is backed up?” has no simple answer.
- Some state benefits from store safeguards while other state does not.
- Migration and corruption handling vary by feature.
- Export/import and portability remain ambiguous.

**Suggested Alternative**

Define an explicit persistence catalog. Store structured app data in one transactional database, project documents in clearly named user files, secrets in a credential store, provider artifacts as external references, and generated/cache/fallback assets in disposable storage. Give each class a documented retention and backup policy.

**Priority:** **Medium**

**Why the current choice was understandable:** Features were added independently and some data, especially Markdown and provider transcripts, intentionally belongs outside the coordination store.

**Evidence:** store, docs manager, pinned-note/layout helpers in `src/web/server.js`, and `src/web/backup.js`.

---

### DR-21 — Optional integration and feature sprawl

**Problem**

The core repository includes or directly supports credential switching, a Mac bridge, quick and named tunnels, Cloudflare Access deployment, `td`, GitHub PR automation, a file editor, scheduled terminal messages, multiple Kanban systems, resource monitoring, native mobile parity, and legacy TUI support.

**Impact**

- The product's primary session/worktree value becomes harder to understand.
- Security and operational dependencies expand substantially.
- Optional features still impose test, documentation, compatibility, and release costs.
- Author-specific workflows influence core architecture.
- A from-scratch team could spend significant time reproducing low-frequency capabilities before validating the central loop.

**Suggested Alternative**

Define a small core:

1. Project/session discovery and organization.
2. Server-owned terminals.
3. Persistence and recovery.
4. Worktree task isolation and review.
5. Search, notifications, and basic cost visibility.

Place provider account switching, remote tunnel control, `td`, PR automation, mobile native features, file editing, and scheduling behind optional integration packages or defer them entirely. Keep the core service unaware of machine-specific bridges.

**Priority:** **Medium**

**Why the current choice was understandable:** The repository is a personal productivity tool and naturally accumulated features that solved the author's immediate problems.

**Evidence:** optional/deployment-specific features identified in `feature-inventory.md` and `architecture-analysis.md`.

## Low-Priority Issues

### DR-22 — Committed fallback duplicate of frontend assets

**Problem**

A complete fallback copy of the large frontend exists under the source tree and is used for self-healing.

**Impact**

- Search results and repository size are duplicated.
- Copies can drift.
- The fallback mechanism compensates for a monolithic frontend rather than isolating failures.

**Suggested Alternative**

Build versioned frontend artifacts and retain the previous deployed artifact outside the source tree. Recovery should switch between build versions rather than maintain a second editable source copy.

**Priority:** **Low**

**Why the current choice was understandable:** With no build pipeline, a copied known-good frontend is a direct and practical recovery mechanism.

**Evidence:** `src/web/public/.backup/`, `src/web/backup.js`.

---

### DR-23 — Custom cross-platform daemonization and watchdog stack

**Problem**

The repository contains custom supervisor, daemon-detach, watchdog, autostart, tunnel, and power-management behavior, including Windows-specific process discovery.

**Impact**

- Process ownership varies by platform.
- Lifecycle behavior is difficult to test.
- Product code and one deployment's operational setup become intertwined.
- Multiple restart layers can obscure the true failure owner.

**Suggested Alternative**

Keep a small in-process supervisor only where it materially improves development/runtime behavior. Delegate persistent service management to documented OS-native mechanisms or packaged service definitions. Treat deployment scripts as separate examples/profiles rather than universal product architecture.

**Priority:** **Low**

**Why the current choice was understandable:** Native Windows support and an always-on personal workstation are explicit project requirements.

**Evidence:** `src/supervisor.js`, `scripts/watchdog.js`, `scripts/setup-autostart.ps1`, `docs/OPERATIONS.md`.

## Risk Areas

| Risk Area | Failure Trigger | Likely Impact | Related Issues | Overall Risk |
|---|---|---|---|---|
| **Coordination data integrity** | Concurrent writers, partial write, oversized state, crash during mutation | Lost or rejected workspace/session/task/device state | DR-01, DR-08, DR-16, DR-20 | **Critical** |
| **Command execution security** | Provider or shell quoting error; new unvalidated launch field | Command injection or unintended process launch | DR-04, DR-05 | **Critical** |
| **Credential exposure** | State/config/backup leak; provider credential manipulation bug | Host access, API cost, provider-account compromise | DR-06, DR-07 | **High** |
| **Provider compatibility** | Claude/Codex transcript or credential format change | Discovery, mirror, cost, cwd, or account-switch failure | DR-05, DR-07, DR-11 | **High** |
| **Realtime consistency** | Event payload shape changes; reconnect; filtered subscriptions | Missing or duplicated UI/mobile updates | DR-09, DR-13 | **High** |
| **Frontend regression** | Change in shared global UI state | Broad browser breakage with weak behavioral test coverage | DR-03, DR-14, DR-22 | **High** |
| **Runtime correctness** | Uncaught fault, PID reuse, race between persisted and live state | Zombie process, incorrect status, unsafe continued operation | DR-08, DR-12 | **High** |
| **Parallel Git scaling** | Many agents on large repositories | Host load, stale conflict detection, delayed review | DR-19 | **Medium** |
| **Cross-client parity** | Feature added to one client or platform | Behavioral drift and ambiguous support | DR-10, DR-16 | **High** |
| **Product scope dilution** | Optional integrations become core commitments | Slow delivery and high maintenance cost | DR-15, DR-21, DR-23 | **Medium** |

## Technical Debt

| Debt Item | Why it Exists | Cost Today | What Not to Copy |
|---|---|---|---|
| `src/web/server.js` monolith | Incremental feature growth around shared closures | Broad change surface and poor domain isolation | Inline route/domain logic in one composition file |
| `src/web/public/app.js` monolith | Initial no-build, low-dependency SPA | Weak testability and mobile logic duplication | One global application object for all views |
| Whole-state JSON persistence | Original single-user simplicity | O(total state) writes and corruption blast radius | One document as every domain's transaction boundary |
| Source-scan tests | Large artifacts cannot be instantiated cleanly | Structural confidence rather than behavioral confidence | Tests that assert implementation text for user behavior |
| Provider literal grep gate | Provider abstraction was introduced after Claude-specific code | Policy enforced through text exceptions | String policing as a permanent architecture boundary |
| Frontend `.backup` source copy | Runtime self-heal without a build artifact model | Duplicate source and drift risk | Committing full fallback copies alongside active code |
| Two terminal execution paths | TUI origin followed by web PTY architecture | Divergent lifecycle/recovery behavior | Multiple process-ownership models |
| Multiple work-item models | Feature board and orchestration board evolved separately | User/model ambiguity and duplicate workflows | Separate feature/task stores where views would suffice |
| Provider-internal account switching | Missing supported provider account API | Fragile security-sensitive compatibility burden | Core dependence on private credential formats/endpoints |
| Ad hoc persistence files | Features added independently | Inconsistent backup, migration, and recovery | Uncatalogued file-based state with varying guarantees |
| Deployment-specific bridges/scripts | Personal always-on workflow | Platform-specific maintenance | Treating one deployment profile as product core |

## Possible Simplifications

### 1. Use one transactional local store

SQLite can retain the local-first, single-file property while removing whole-document writes, most custom corruption guards, and cross-process mtime synchronization.

### 2. Establish domain modules before adding features

Keep the composition root thin and create explicit services for sessions, workspaces, terminals, tasks, providers, costs, devices, and integrations.

### 3. Use one work-item model

Represent features, tasks, and executions through one model with optional worktree execution data. Boards become filtered views.

### 4. Use one terminal execution model

Server-owned PTYs should be authoritative. Browser, TUI, and mobile terminal surfaces should attach as clients rather than launch processes differently.

### 5. Narrow mobile scope

Prioritize monitoring, notifications, needs-input intervention, task review summaries, and essential session controls. Avoid reproducing every desktop administration screen unless usage validates it.

### 6. Isolate optional integrations

Move provider credentials, Mac bridging, Cloudflare control, `td`, GitHub automation, and scheduling behind stable optional interfaces. The core should operate without importing them.

### 7. Share API and event contracts

Generate or share typed schemas among server, web, and mobile. Use explicit event envelopes and capability descriptions.

### 8. Spawn providers without a shell

Executable-plus-argv removes quoting responsibilities from adapters and dramatically reduces command-launch risk.

### 9. Separate secrets from state

Use password hashes, OS credential storage, and explicit secret references. Exclude secrets from normal backups and exports.

### 10. Replace runtime source fallback with versioned builds

Keep previous built assets as deployment artifacts instead of duplicate source trees.

### 11. Contain provider-format assumptions

Use versioned adapter parsers, compatibility probes, explicit diagnostics, and normalized metadata caches.

### 12. Make heuristics advisory

Idle/prompt pattern matching should yield confidence-rated hints, not authoritative or destructive state transitions.

## Recommendations

### Priority 1 — Foundational constraints for a new build

1. **Choose SQLite or an equivalent transactional embedded store.**
2. **Define domain/service boundaries before building routes.**
3. **Adopt a modular web client with a typed shared API package.**
4. **Define an argv-based provider process contract.**
5. **Separate secrets from coordination state from the beginning.**

These choices eliminate the four Critical issues before they become migration projects.

### Priority 2 — Contracts and runtime ownership

1. Define the provider interface as the only owner of provider-format knowledge.
2. Define explicit event schemas and workspace/entity scope.
3. Keep PTYs server-owned and make every UI a client of the same execution layer.
4. Treat process liveness as server runtime state rather than trusting persisted PIDs.
5. Fail fast on unrecoverable process-global errors and let supervision restart cleanly.

### Priority 3 — Product-model simplification

1. Use one work-item/task model and separate planning views from execution metadata.
2. Keep the mobile app intentionally supervisory unless full parity is proven necessary.
3. Treat TUI support as a client, not a second runtime.
4. Keep project notes freeform, but store structured tasks/goals/roadmap items as records with IDs.
5. Define one persistence/backup catalog covering state, docs, secrets, provider references, caches, and generated assets.

### Priority 4 — Optional ecosystem boundaries

1. Make `td`, GitHub PR automation, tunnels, account switching, scheduling, and machine bridges optional adapters.
2. Avoid depending on private provider OAuth and credential formats in the core.
3. Publish deployment profiles separately from the universal runtime.
4. Add integrations only after the core session → terminal → worktree → review loop is stable.

## Final Keep / Avoid Summary

| Keep | Avoid |
|---|---|
| Host-authoritative local control plane | Whole-domain JSON document as a database |
| Provider adapters and capability gating | Provider-specific logic leaking into server/runtime modules |
| Provider-owned canonical transcripts | Silent dependence on unversioned provider formats |
| Server-owned PTYs with replay/backpressure | Shell-string provider execution |
| REST + SSE + WebSocket specialization | Untyped, inferred event scope |
| Read-only mirror distinct from resume/control | Treating observation and execution as one operation |
| Human review boundary for worktree agents | Multiple overlapping task/feature models |
| Worker isolation for expensive parsing | Heavy parsing in the main event loop |
| Atomicity, backups, and recovery discipline | Resilience machinery compensating for avoidable monoliths |
| Secure mobile pairing and scoped supervision | Mandatory full feature duplication across web/mobile |
| Mature external tools behind adapters | Author-specific integrations embedded in core |
| Clear local-first ownership | Plaintext secrets in ordinary state and backups |
