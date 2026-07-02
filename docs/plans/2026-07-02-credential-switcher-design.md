# Credential Switcher: Design Spec

Date: 2026-07-02
Status: BUILD READY (rev 2, folds in second recon pass: rotation write-back, claude-profile Mac bridge, accountUuid store, labels)
Target release: 1.2.0-alpha.12 (next alpha)
Author: Fable 5 architecture advisor session
Scope: Myrlin Workbook GUI (src/web). New feature, greenfield in this repo.

Formatting note for builders: this document and all code built from it use NO em dashes and NO double hyphens, per global rules. Markdown tables here use single-hyphen delimiter rows on purpose. CSS custom properties require a double-hyphen prefix in real code; this doc therefore names tokens bare (mantle, surface0, mauve) and builders write them as custom-property references exactly like the adjacent rules in styles.css (see the .theme-dropdown rule at styles.css L8120 for the exact syntax).

## 1. Summary and architecture decisions

Arthur has several Claude Code logins (about 6 accounts). He wants a dropdown in the TOP LEFT of the workbook header that lists every saved credential with its 5-hour and weekly reset times, lets him stage a selection, and commit it with a Save button that makes that account the machine-wide Claude login. Optionally the same swap mirrors to the Mac Mini, whose Myrlin Jobs bridge burns the Max subscription. It must look and work well on mobile, and every credential must be nameable (editable friendly labels), including unnamed ones.

A credential is a PAIR, never a single file:

- Token file: `~/.claude/.credentials.json` (only `claudeAiOauth: { accessToken, refreshToken, expiresAt (epoch ms), scopes[], subscriptionType, rateLimitTier }`, no identity).
- Identity blob: the `oauthAccount` object inside `~/.claude.json` (`accountUuid, emailAddress, organizationUuid, organizationType, organizationRateLimitTier, displayName, organizationName, billingType, organizationRole, ...`).

Swapping must write BOTH, identity first, token file LAST and atomically, with backup and rollback, or the CLI and every usage report disagree about who is logged in.

### Decision 1: Port the primitives to Node inside src/. Do not shell out to claude-swap.ps1.

RECOMMENDED: a new server-side module set, `src/web/credential-manager.js` plus `src/web/mac-bridge.js` plus `src/web/credential-routes.js`, porting the proven primitives from `C:\Users\Arthur\Desktop\claude-swap\claude-swap.ps1` (usage fetch L556 to 623, credentials-file text builder L626, profile store L166 to 335, PC apply L845 to 938).

Justification:

- The workbook is `myrlin-workbook`, an npm-published cross-platform Node app. PowerShell 5.1 exists only on Windows; a hardcoded `Desktop\claude-swap` path exists only on Arthur's PC. Shelling out breaks every other install.
- The PowerShell tool itself already spawns Node for every `.claude.json` parse and edit (PS 5.1 ConvertFrom-Json hard-fails on that file past 2 MB and on case-duplicate keys). In-process Node removes that double hop: `JSON.parse` handles the real file faithfully (duplicate keys collapse last-wins, byte-identical behavior to the `node -e` path claude-swap already uses in production).
- The rotation write-back loop (Decision 3, the make-or-break mechanism) requires a long-lived in-process watcher; a shelled-out script cannot provide one.
- The workbook's test harness, atomic-write lessons (store.js L450 to 516), auth, SSE, and error conventions are all Node. A port slots into all of them.

Rejected alternatives:

- Shell out to claude-swap.ps1: Windows-only, external out-of-project path, couples the published product to a personal Desktop folder, doubles process-spawn fragility, and its interactive TUI is not a callable API.
- Middle path (Node owns PC apply and usage; shell out only for the Mac mirror): still ships a platform fork and cannot host the watcher. The Mac mirror in Node calls the same `ssh`/`scp` binaries anyway (Windows OpenSSH client), execFile with argv arrays, no shell interpolation.

### Decision 2: Workbook-owned snapshot store keyed by accountUuid; claude-swap is a read-only seed source.

Store location: `<getDataDir()>/claude-accounts/<accountUuid>.json` (src/utils/data-dir.js L24 to 51: `~/.myrlin/claude-accounts/` in production, the sandbox tmpdir under `CWM_DATA_DIR` in tests). Keyed by `accountUuid` (stable, filename-safe UUID), labeled by `emailAddress` plus a user-editable label. The repo `.gitignore` already ignores `/state/` (leading slash); add an explicit belt-and-suspenders line for any repo-local layout (section 2.4).

Why not adopt claude-swap's store as the live store (rev 1 of this doc proposed that): second recon confirmed there is exactly ONE live token file on Windows, re-auth overwrites it, and all four claude-swap PC profiles from 2026-06-23 are tokenDead (a byte-identical token was synced across machines and rotated to death). There is nothing live to share; adopting an external Desktop path as the canonical store would couple the published product to it for no benefit. Instead:

- First run: snapshot the CURRENTLY ACTIVE account (capture-current) so the dropdown is never empty.
- Discovery seed ("try to find them first"): if `<home>/Desktop/claude-swap/profiles/pc/` exists, one-time import converts each profile (parse `credentialsFileText` and `oauthAccountJson`, extract accountUuid, carry `label` and `tokenDead`) into our schema. The four dead ones arrive flagged "needs re-login" so the known roster is visible immediately, honestly marked.
- After the seed, the workbook store is CANONICAL. claude-swap remains a standalone terminal tool but must not be used to refresh the same accounts' tokens concurrently (refresh rotation would invalidate the workbook's copies; documented in section 10).

### Decision 3: Rotation write-back loop (CRITICAL; without it the feature silently dies in about 12 hours)

OAuth tokens ROTATE. The Claude CLI auto-refreshes with the refreshToken and writes a NEW pair into `~/.claude/.credentials.json` every few hours (the live token's `expiresAt` sits about 12h out). Any static snapshot therefore goes stale within hours, and a used refresh token may be invalidated server-side. The store MUST continuously write rotated tokens back into the matching snapshot:

- `startCredentialWatcher()` watches the `~/.claude` DIRECTORY with `fs.watch` filtered to `.credentials.json` (watching the file itself drops on Windows when the file is replaced by rename), debounced (500ms), with a low-frequency mtime poll fallback (30s) because Windows watchers can silently die. Pattern precedent: the debounced provider watcher at src/providers/codex/index.js L171 (Plan 22-03).
- On change, `syncActiveTokenToProfile()`: parse the live file (malformed = skip silently, next event retries), read the active `accountUuid` from `~/.claude.json` `oauthAccount`, find the snapshot by accountUuid, and write the rotated `credentials` blob back (with `updatedAt`) ONLY when the incoming `expiresAt` is strictly newer than the stored one. No snapshot for that accountUuid yet = auto-capture one (this is also how the active account self-registers on first run and after any /login).
- Self-write guard: `applyCredential` sets a guard window (`_selfWriteUntil = now + 3000ms`); watcher events inside it are ignored, and apply ends with one explicit `syncActiveTokenToProfile()` to reconcile. The strictly-newer `expiresAt` compare is the second, independent guard against writing an older pair back over a fresher one.
- Robustness: every handler is wrapped; a watcher error logs once and falls back to polling; the watcher can never crash the server. `stopCredentialWatcher()` on shutdown.

This is a first-class part of credential-manager, started from server boot, not an optional extra.

## 2. Data model

### 2.1 Snapshot schema (exact)

One JSON file per account at `<dataDir>/claude-accounts/<accountUuid>.json`:

```json
{
  "accountUuid": "3f1c9a2e-1111-2222-3333-444455556666",
  "email": "arthurdmouradian@gmail.com",
  "label": "Personal",
  "savedAt": "2026-07-02T18:00:00Z",
  "updatedAt": "2026-07-02T21:40:00Z",
  "credentials": { "accessToken": "...", "refreshToken": "...", "expiresAt": 1751500000000, "scopes": ["user:inference"], "subscriptionType": "max", "rateLimitTier": "default_claude_max_20x" },
  "identity": { "accountUuid": "...", "emailAddress": "...", "organizationUuid": "...", "organizationType": "claude_max", "displayName": "...", "organizationName": "...", "billingType": null, "organizationRole": "admin" },
  "usage": {
    "five_hour": { "utilization": 34, "resets_at": "2026-07-02T21:00:00Z" },
    "seven_day": { "utilization": 61, "resets_at": "2026-07-08T07:00:00Z" },
    "fetchedAt": "2026-07-02T18:00:00Z"
  },
  "tokenDead": false
}
```

Rules:

- `credentials` is the parsed `claudeAiOauth` object, refreshed continuously by the write-back loop (Decision 3) and on inactive-token refresh. Serialization back to file text at apply time is `JSON.stringify({ claudeAiOauth: credentials })` compact (same shape claude-swap's New-CredentialsFileText writes in production).
- `identity` is the full `oauthAccount` snapshot; email/accountUuid are IMMUTABLE identity, never editable.
- `usage` mirrors the API's snake_case inner keys exactly; null until first fetch; `usage.limits` may additionally hold the sanitized raw `limits[]` array (`{kind, group, percent, severity, resets_at, is_active, scope?}`), additive.
- `tokenDead: true` means the last refresh attempt failed; not applyable until the user runs /login as that account (any /login makes it live, and the watcher auto-recaptures).
- Writes are atomic (section 3.1) and chmod 0600 best effort (ignored on Windows).
- `accountUuid` is validated `^[0-9a-fA-F-]{8,64}$` before any path construction. It IS the API `profileId`.

### 2.2 Labels are mutable metadata (and unnamed credentials are first-class)

- `label` is user-editable, trimmed, max 60 chars; empty string clears it (falls back to display rules below). It survives re-capture and rotation write-back untouched.
- Display fallback chain, used EVERYWHERE (chip, rows, toasts): `label` if non-empty, else `email`, else `accountUuid.slice(0, 8) + ' unnamed'`. A credential is NEVER hidden for lacking a label.
- The email always renders as a secondary line even when a label is set, so identity is visible at a glance.
- Rename is exposed via `PUT /api/credentials/:profileId/label` (section 4.5) and a per-row pencil affordance (section 6). Renames broadcast `credentials:changed` so every open client updates live.
- Capture-current prompts for an OPTIONAL label (default: the email); never required.

### 2.3 Config (workbook store settings, not a new file)

Stored under `settings.credentialSwitcher` in the existing store, managed via `store.updateSettings`:

```json
{
  "mac": { "enabled": false, "host": "arthurs-mac-mini", "user": "arthur", "profileTool": "$HOME/.local/bin/claude-profile", "postSwapCommand": "" },
  "usageCacheMinutes": 10,
  "httpTimeoutSec": 5,
  "sshTimeoutSec": 8,
  "backupKeep": 20,
  "claudeSwapSeedDir": ""
}
```

`host`/`user` validated against `^[A-Za-z0-9._@-]+$`, no leading dash (ssh option injection guard). `claudeSwapSeedDir` empty means probe the default `<home>/Desktop/claude-swap` once.

### 2.4 Runtime read/write targets and gitignore

- PC token file: `path.join(os.homedir(), '.claude', '.credentials.json')`, env override `CWM_CLAUDE_DIR` (tests).
- PC identity file: `path.join(os.homedir(), '.claude.json')`, env override `CWM_CLAUDE_JSON` (tests).
- Mac targets: reached only through mac-bridge (section 3.4).
- Gitignore: `/state/` (leading slash) already covers a repo-local legacy layout; ADD two explicit lines so no data-dir misconfiguration can ever leak tokens:

```
# Claude account snapshots (plaintext OAuth tokens; never commit)
state/claude-accounts/
**/claude-accounts/
```

Note for reviewers: runtime writes to `~/.claude/*` are the FEATURE working (the app doing what the user clicked), not a dev agent editing outside the project. All source code stays inside this repo.

## 3. Backend module design

### 3.1 `src/web/credential-manager.js` (new file)

File header comment + `SPDX-License-Identifier: AGPL-3.0-only` (push.js convention). Docstring on every function. Factory with injected dependencies so tests never touch the real HOME or network:

```js
function createCredentialManager(opts = {}) {
  // opts: { claudeDir, claudeJsonPath, accountsDir, settingsProvider, fetchImpl,
  //         usageUrl, tokenUrl, clock, watchDebounceMs, pollIntervalMs, log }
  // Defaults: os.homedir() paths honoring CWM_CLAUDE_DIR / CWM_CLAUDE_JSON,
  // accountsDir = path.join(getDataDir(), 'claude-accounts'), global fetch,
  // real endpoints (env overrides CWM_CRED_USAGE_URL / CWM_CRED_TOKEN_URL for
  // hermetic route tests), Date.now, 500, 30000.
}
module.exports = { createCredentialManager, serializeCredentialsFile, validateAccountUuid, writeFileAtomic, displayNameFor };
```

Endpoint and header constants (named at module top, never inlined; ported from claude-swap L554 to 558):

```js
const ANTHROPIC_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const ANTHROPIC_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const ANTHROPIC_OAUTH_BETA = 'oauth-2025-04-20';
const ANTHROPIC_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'; // Claude Code's own public OAuth client id
```

Functions (signature, one-line purpose):

| Function | Purpose |
| - | - |
| `validateAccountUuid(id) -> bool` | Gate every profileId before path construction; `^[0-9a-fA-F-]{8,64}$`. |
| `displayNameFor(snapshot) -> string` | The fallback chain of section 2.2; single source of truth, exported for tests and reused conceptually by the frontend. |
| `writeFileAtomic(filePath, text, {mode})` | Temp file in same dir (pid + random suffix), verify re-read non-empty, `fs.renameSync` with Windows EPERM/EBUSY/EACCES retry (5 attempts, 50ms x attempt backoff; antivirus and concurrent readers hold Windows renames, same lesson as store.js save()), unlink temp in finally, chmod 0600 best effort. |
| `readActiveCredential() -> {credText, oauth} or null` | Read PC `.credentials.json` verbatim + parsed `claudeAiOauth`; null-safe, never throws. |
| `readActiveIdentity() -> {account} or null` | Read PC `.claude.json` via `JSON.parse` (handles the multi-MB file, duplicate keys last-wins), return the `oauthAccount` object; null-safe. |
| `getActiveAccountUuid() / getActiveEmail()` | Convenience over `readActiveIdentity()`. |
| `snapshotPath(accountUuid) -> string` | `<accountsDir>/<accountUuid>.json`. |
| `readSnapshot(accountUuid) -> snapshot or null` | Missing/corrupt degrades to null (next capture self-heals). |
| `saveSnapshot(snapshot, {preserveLabel})` | Atomic persist; label/usage/tokenDead carry-forward per sections 2.1 and 2.2. |
| `listSnapshots() -> snapshot[]` | Every valid file in accountsDir; skip unparseable. |
| `startCredentialWatcher() / stopCredentialWatcher()` | Decision 3 loop: dir-scoped `fs.watch` + debounce + mtime poll fallback; wraps `syncActiveTokenToProfile`; crash-proof. |
| `syncActiveTokenToProfile() -> accountUuid or null` | Match live token to snapshot via active identity accountUuid; write back only when live `expiresAt` strictly newer; auto-capture when no snapshot exists; honor the self-write guard. |
| `captureCurrent({label}) -> snapshot` | Explicit snapshot of the live PC pair (first run, post /login). Throws CRED_LIVE_STATE_UNREADABLE when either half is missing. Optional label, default email. |
| `seedFromClaudeSwap(dir) -> {imported, skipped}` | One-time read-only conversion of `dir/profiles/pc/*.json` (parse credentialsFileText and oauthAccountJson, carry label and tokenDead); never writes to the source dir; runs only when accountsDir has no snapshots. |
| `setLabel(accountUuid, label)` | Trim, cap 60, empty clears; updates label only; returns updated snapshot. |
| `serializeCredentialsFile(credentials) -> string` | `JSON.stringify({ claudeAiOauth: credentials })` compact; the ONLY writer format for `.credentials.json`. |
| `fetchUsage(accessToken) -> usage or null` | Read-only GET `ANTHROPIC_USAGE_URL`, headers `Authorization: Bearer` + `anthropic-beta: oauth-2025-04-20`, AbortController timeout `httpTimeoutSec`; maps `five_hour`/`seven_day` `{utilization, resets_at}` + sanitized `limits[]`; null on any failure. Safe for the ACTIVE account's live token. |
| `refreshInactiveToken(refreshToken) -> {accessToken, refreshToken, expiresAt} or null` | POST `ANTHROPIC_TOKEN_URL` `{grant_type:'refresh_token', refresh_token, client_id}`; response without `refresh_token` keeps the old one; `expires_in` seconds converted to absolute epoch ms; null on failure. MUST NEVER be called for the account active on this machine (races the CLI's own rotation). |
| `updateSnapshotUsage(accountUuid, {force}) -> snapshot` | Full ported token policy: cache younger than `usageCacheMinutes` and no force = zero network; active-here account = read-only live token, never refresh; inactive + expired stored token = refresh, PERSIST THE ROTATED PAIR IMMEDIATELY (before the usage call; the old refresh token dies server-side the instant the new one exists), refresh failure = `tokenDead:true` + skip usage; usage success writes usage + clears tokenDead; usage failure keeps prior cache. |
| `backupLiveFile(livePath) -> backupPath or null` | Timestamped copy into `<accountsDir>/../claude-accounts-backups/<basename>.<yyyyMMdd-HHmmss>[.n].bak`, prune oldest beyond `backupKeep` per basename, exclude the just-created file from prune candidates (NTFS tunneling lesson). |
| `applyCredential(accountUuid) -> {applied, alreadyActive, email}` | The transaction, section 3.2. |
| `deleteSnapshot(accountUuid)` | Remove the snapshot file only (never live files). |
| `getSafeList() -> row[]` | Browser-safe projection (section 4.1). THE ONLY SHAPE ROUTES MAY SERIALIZE. |

Concurrency: a module-level promise-chain mutex (`serialize(fn)`) wraps `applyCredential`, `captureCurrent`, `syncActiveTokenToProfile`, `updateSnapshotUsage`, `setLabel`, and `seedFromClaudeSwap` so two GUI clients and the watcher can never interleave writes.

### 3.2 The apply transaction (exact order, load-bearing, ported from Invoke-PcSwap L845 to 938)

```
applyCredential(accountUuid):
  0. validateAccountUuid; load snapshot
     missing             -> throw CRED_NOT_FOUND
     tokenDead           -> throw CRED_TOKEN_DEAD ("/login as <email> once; it recaptures automatically")
     missing either blob -> throw CRED_INCOMPLETE
     already active (accountUuid match vs live identity)
                         -> return { applied:false, alreadyActive:true }
  a. arm the self-write guard (_selfWriteUntil = now + 3000ms) so the watcher
     ignores our own file events
  1. syncActiveTokenToProfile()  (capture the CURRENT account's freshest
     rotated tokens before anything is replaced; no-op on unreadable state)
  2. backupLiveFile(.credentials.json); jsonBackup = backupLiveFile(.claude.json)
  3. IDENTITY FIRST: read .claude.json text, JSON.parse, set
     obj.oauthAccount = snapshot.identity,
     writeFileAtomic(claudeJsonPath, JSON.stringify(obj, null, 2))
  4. TOKENS LAST: writeFileAtomic(credPath, serializeCredentialsFile(snapshot.credentials))
     on throw: restore .claude.json from jsonBackup via writeFileAtomic
       (a live Claude process may be mid-read; atomic restore only);
       rollback ok           -> throw CRED_APPLY_FAILED (".claude.json restored")
       rollback fails        -> throw CRED_ROLLBACK_FAILED (points at backups dir)
       no jsonBackup existed -> throw CRED_APPLY_FAILED ("nothing restored")
  5. VERIFY: getActiveAccountUuid() must equal accountUuid; mismatch ->
     attempt the same rollback -> throw CRED_VERIFY_FAILED
  6. final syncActiveTokenToProfile() to reconcile, then return { applied:true, email }
```

Restart semantics (stated assumption, communicated in the UI): Claude Code reads `.credentials.json` at process start and manages the token in memory afterwards. NEW terminals and newly launched sessions use the new account immediately; ALREADY-RUNNING Claude processes keep the previous account until restarted. The workbook already has the exact restart affordance: `restartAllSessions()` at app.js L7978, whose confirm copy (L7985 to L7990) literally says "picking up any new login credentials" and POSTs `/api/sessions/:id/restart` per session. The post-apply flow wires into it (section 6.2) instead of inventing a new restart path.

### 3.3 Reset times: live API primary, JSONL heuristic as offline fallback

Primary: the usage endpoint per 3.1 (`five_hour.resets_at` = 5-hour session reset, `seven_day.resets_at` = weekly reset), cached `usageCacheMinutes` (10) per snapshot, fetched only on explicit triggers (section 4.2), countdowns ticked client-side.

Rendering: REUSE `_formatResetText(resetAt, absolute)` archived in `docs/QUOTA_WIDGET_REFERENCE.md` L481 (the removed quota widget); the UI task pastes it back into app.js verbatim rather than writing a new formatter.

Offline fallback (ACTIVE account only, stretch item, not required for v1): the same reference doc archives a local JSONL-scan heuristic (5-hour rolling window bucketing plus `nextThursdayAt()` L53 for the Anthropic-style weekly reset) that ESTIMATES windows from `~/.claude/projects/**/*.jsonl` with no network. It only works for the account whose sessions produced the local JSONLs and is not authoritative; if implemented, estimated values render with a leading tilde and a tooltip saying "estimated offline". Inactive accounts have no offline signal; they show "usage unavailable" when the API is unreachable.

### 3.4 `src/web/mac-bridge.js` (new file, optional, config-gated)

Decision: REUSE the Mac-native `~/.local/bin/claude-profile` script (snapshots in `~/.claude-profiles/`, chmod 600, `claude-profile save <name>` / `claude-profile use <name>`). It is the mechanism the LIVE Myrlin Jobs bridge (bridge.myrlin.io to Mac claude CLI on the Max sub) already consumes, so the mirror lands in the exact format the bridge picks up. claude-swap's Invoke-MacSwap (scp payloads + remote python3 edit + atomic ssh mv, claude-swap.ps1 L1082 to 1255) is the documented FALLBACK mechanism if the script's snapshot format proves incompatible (see the hard precondition in section 9, T1 step 0).

| Function | Purpose |
| - | - |
| `validateMacTarget({host, user})` | Charset allowlist + no leading dash; throw on violation. |
| `sshExec(cfg, remoteCommand, timeoutSec) -> {code, stdout, timedOut}` | `execFile('ssh', ['-o','ConnectTimeout='+t,'-o','BatchMode=yes','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2', user+'@'+host, remoteCommand], {timeout})`; exit 255 = client/link error; never throws. |
| `scpSend(cfg, localPath, remotePath, timeoutSec) -> bool` | Same option set via `execFile('scp', ...)`; secret payloads always travel as files, never on remote command lines (visible in Mac process listings). |
| `readMacLiveState(cfg) -> {email, accountUuid} or null` | One SSH round-trip: `python3 -c 'json.load(open(...)).get("oauthAccount")'` on the remote `~/.claude.json`; used for verify. |
| `mirrorToMac(manager, cfg, accountUuid) -> {mirrored, warning?}` | (1) load snapshot, reject tokenDead (MAC_TOKEN_DEAD) or missing (CRED_NOT_FOUND); (2) build the snapshot payload in claude-profile's save format, write to a local temp file, scp to a Mac `/tmp/<guid>` path; (3) ssh: `mkdir -p ~/.claude-profiles && mv /tmp/<guid> ~/.claude-profiles/<name> && chmod 600 ~/.claude-profiles/<name>` (name = slugified label or accountUuid first 8); (4) ssh `export PATH=$HOME/.local/bin:$PATH; claude-profile use <name>` (the script owns backup + atomic apply on the Mac); (5) verify via `readMacLiveState` email/uuid match (mismatch = MAC_VERIFY_FAILED warning, PC apply NOT rolled back); (6) run `postSwapCommand` when non-empty, e.g. the bridge LaunchAgent restart (nonzero exit = WARNING string, never a failure). Local temp files deleted in finally. |

Design notes: the mirror pushes the CURRENT PC snapshot, which starts a second rotation lineage on the Mac (the Mac CLI refreshes its copy independently; this is exactly how Arthur operates today and exactly why cross-machine copies eventually die, see section 10 risk 3). Mirror failures NEVER roll back a successful PC apply; the mirror is a secondary, opt-in step. If no Mac profile tooling exists on the host (script missing), the mirror fails cleanly with MAC_TOOL_MISSING and guidance.

### 3.5 `src/web/credential-routes.js` (new file) and server.js wiring

```js
function setupCredentialRoutes(app, { requireAuth, getStore, broadcast, structuredError, manager, macBridge }) { ... }
module.exports = { setupCredentialRoutes };
```

server.js changes (the ONLY edits to server.js, all in the foundation task):

1. Require + register near the other setup calls (after `setupDeviceRoutes`, around L368): pass `broadcast: (type, data) => broadcastSSE(type, data)` as a lazy closure (function declarations hoist, so runtime calls resolve even though `broadcastSSE` is declared at L5826). Call `manager.startCredentialWatcher()` here; hook `stopCredentialWatcher` into the existing shutdown path.
2. Add `'credentials:changed'` and `'credentials:usage'` to `GLOBAL_EVENT_TYPES` (L5710). CRITICAL: `broadcastSSE` extracts a workspaceId from `data.workspaceId || data.workspace?.id || data.id` (L5832) and filters subscribed mobile clients on it. Payloads below deliberately use `profileId`, never a bare `id` key, AND the event types are registered global, so paired devices with workspace subscriptions still receive them.

## 4. API contract

All routes `requireAuth` (Bearer token; the workbook's OWN app-login from src/web/auth.js; completely unrelated to the Claude OAuth credentials being managed; never conflate). All errors go through `structuredError(res, status, code, message, retryable)` (server.js L229), which serializes exactly:

```json
{ "error": "CRED_TOKEN_DEAD", "code": 409, "message": "human readable", "retryable": false }
```

### 4.1 GET /api/credentials

List the roster. Side effects: first-call seed (`seedFromClaudeSwap` when accountsDir is empty and the seed dir exists) and `syncActiveTokenToProfile()` (cheap, guarded) so the active account always appears. NO network usage calls (pure cache read).

200 response (THE safe projection; tokens never appear):

```json
{
  "activeProfileId": "3f1c9a2e-1111-2222-3333-444455556666",
  "profiles": [
    {
      "profileId": "3f1c9a2e-1111-2222-3333-444455556666",
      "email": "gayane.mouradian@gmail.com",
      "label": "Gayane",
      "displayName": "Gayane",
      "isActive": true,
      "tokenDead": false,
      "savedAt": "2026-07-02T18:00:00Z",
      "updatedAt": "2026-07-02T21:40:00Z",
      "subscriptionType": "max",
      "rateLimitTier": "default_claude_max_20x",
      "organizationType": "claude_max",
      "organizationName": "",
      "usage": {
        "five_hour": { "utilization": 34, "resets_at": "2026-07-02T21:00:00Z" },
        "seven_day": { "utilization": 61, "resets_at": "2026-07-08T07:00:00Z" },
        "fetchedAt": "2026-07-02T18:00:00Z"
      }
    }
  ],
  "mac": { "configured": true, "enabled": true, "host": "arthurs-mac-mini", "user": "arthur" }
}
```

`displayName` is the server-computed fallback chain (section 2.2) so every client renders identically. `subscriptionType`/`rateLimitTier` come from the stored `credentials` metadata; org fields from `identity`. `usage` is null when never fetched. `activeProfileId` is null when the machine has no oauthAccount (API-key-only setups); the UI then shows an "Unknown account" chip.

### 4.2 POST /api/credentials/refresh-usage

Body: `{ "profileId": "<uuid>" }` or `{}` (refresh every snapshot whose cache is stale). Runs `updateSnapshotUsage` per target (serialized), then broadcasts `credentials:usage` and returns the 4.1 shape. An explicit `profileId` bypasses the TTL; `{}` honors it. Errors: 400 VALIDATION, 404 CRED_NOT_FOUND. Per-profile usage failure is NOT a route error (the row keeps its stale `usage.fetchedAt`; dead tokens surface as `tokenDead:true` in the returned list).

### 4.3 POST /api/credentials/apply

Body: `{ "profileId": "<uuid>", "mirrorToMac": false }`.

Flow: `applyCredential` (3.2); on success and `mirrorToMac:true` and mac configured+enabled, run `mirrorToMac` (3.4). Broadcast `credentials:changed` AFTER the PC commit regardless of mirror outcome. 200:

```json
{
  "applied": true,
  "alreadyActive": false,
  "activeProfileId": "<uuid>",
  "restartNote": "New sessions use this account immediately. Running Claude sessions keep the previous account until restarted.",
  "mac": { "attempted": true, "mirrored": false, "error": "MAC_UNREACHABLE", "message": "ssh failed; check Tailscale" }
}
```

`alreadyActive:true` short-circuits as a 200 no-op. Errors: 400 VALIDATION, 404 CRED_NOT_FOUND, 409 CRED_TOKEN_DEAD, 422 CRED_INCOMPLETE, 500 CRED_APPLY_FAILED / CRED_VERIFY_FAILED / CRED_ROLLBACK_FAILED (message includes the backups dir path), all with actionable messages. Mac mirror failures NEVER fail the route when the PC apply succeeded; they ride in the `mac` object as a warning (codes: MAC_UNREACHABLE, MAC_TOOL_MISSING, MAC_TOKEN_DEAD, MAC_VERIFY_FAILED).

### 4.4 POST /api/credentials/capture

Body: `{ "label": "Work Team" }` (optional). Snapshots the live PC pair (`captureCurrent`). 200: the 4.1 list shape. Errors: 500 CRED_LIVE_STATE_UNREADABLE.

### 4.5 PUT /api/credentials/:profileId/label

Body `{ "label": "Household 2" }`. Trim; cap 60 chars (400 VALIDATION beyond); empty string clears the label (display falls back per 2.2). Updates ONLY the label field. 200: the 4.1 list shape. Broadcasts `credentials:changed` with `{ renamed: true, profileId }` so all clients re-render live. 404 CRED_NOT_FOUND.

### 4.6 DELETE /api/credentials/:profileId

Removes the snapshot file only (never live files, never remote files). 200: list shape. 404 CRED_NOT_FOUND.

### 4.7 GET and PUT /api/credentials/mac-config

GET returns `{ enabled, host, user, profileTool, postSwapCommand }`. PUT validates host/user charset (400 VALIDATION), persists via `store.updateSettings`, returns the saved object. No connectivity probe on PUT (probe happens naturally at mirror time with a clean MAC_UNREACHABLE).

## 5. SSE events

Transport: existing `/api/events` EventSource (token as query param). `broadcastSSE(type, data)` wraps as `{ type, data, timestamp }`; the frontend switch in `handleSSEEvent` (app.js L9399) reads payloads at `data.data` (see the `docs:updated` case).

| Event | Payload (`data.data`) | When |
| - | - | - |
| `credentials:changed` | `{ activeProfileId, email, appliedAt, renamed?, profileId?, mac: { attempted, mirrored } }` | After every successful apply; after capture (`{ captured:true }`); after rename (`{ renamed:true, profileId }`); after delete (`{ deleted:true, profileId }`). |
| `credentials:usage` | `{ profiles: [safe rows as in 4.1] }` | After a refresh-usage run completes. Only ever in response to an explicit client trigger, never on a server timer (bounds blast radius for stale cached frontends). The rotation watcher does NOT broadcast (it changes tokens, not anything a browser displays). |

Frontend subscription: add explicit `case 'credentials:changed'` and `case 'credentials:usage'` to the `handleSSEEvent` switch BEFORE the `default` branch. THIS IS MANDATORY: the default branch calls `this.loadAll()` for unknown event types, so shipping the server without the client cases would turn every credentials broadcast into a full-app reload storm. `credentials:changed` re-fetches the list (or applies the payload), clears staging when the active account changed, updates chip + rows + any status line, and toasts when the change came from another client. `credentials:usage` merges rows and re-renders countdowns.

## 6. Frontend design

### 6.1 Mount point (top left, as Arthur specified)

`index.html`: inside `<div class="header-left">` (L99 to L109), insert the switcher between `.header-brand` (closes L108) and the closing `</div>` (L109):

```html
<div class="account-switcher" id="account-switcher" hidden>
  <button class="account-chip" id="account-chip" aria-haspopup="listbox" aria-expanded="false" title="Claude account">
    <span class="account-chip-avatar" id="account-chip-avatar">G</span>
    <span class="account-chip-label" id="account-chip-label">Gayane</span>
    <span class="account-chip-meta" id="account-chip-meta">resets 2h 14m</span>
    <svg class="account-chip-chevron" width="10" height="10" viewBox="0 0 10 10"><path d="M2 4l3 3 3-3" stroke="currentColor" fill="none" stroke-width="1.4" stroke-linecap="round"/></svg>
  </button>
  <div class="account-panel" id="account-panel" role="listbox" hidden>
    <div class="account-panel-header">
      <span>Claude account</span>
      <button class="btn btn-ghost btn-icon btn-sm" id="account-refresh-btn" title="Refresh usage">&#8635;</button>
    </div>
    <div class="account-panel-list" id="account-panel-list"></div>
    <div class="account-panel-footer">
      <label class="account-mac-toggle" id="account-mac-toggle" hidden>
        <input type="checkbox" id="account-mac-checkbox"> Also apply on Mac Mini
      </label>
      <div class="account-panel-actions">
        <button class="btn btn-ghost btn-sm" id="account-cancel-btn">Cancel</button>
        <button class="btn btn-primary btn-sm" id="account-save-btn" disabled>Save</button>
      </div>
    </div>
  </div>
</div>
```

The `hidden` on `#account-switcher` is removed once the first roster load succeeds (feature self-hides on servers without the routes, keeping old-server/new-frontend mixes graceful). Rows are rendered by JS; the panel shell above is static.

### 6.2 app.js component structure (all inside CWMApp)

- `els` additions in the header block (L283 to L293): `accountSwitcher, accountChip, accountChipAvatar, accountChipLabel, accountChipMeta, accountPanel, accountPanelList, accountRefreshBtn, accountSaveBtn, accountCancelBtn, accountMacToggle, accountMacCheckbox`.
- `state.credentials = { list: [], activeId: null, stagedId: null, loading: false, applying: false, lastListAt: 0, mac: null }`.
- Methods (each with a docstring):
  - `initAccountSwitcher()` from init: chip click toggles panel; refresh; cancel; Save; document-level outside-click close (mirror the theme-dropdown pattern at app.js L594 to L608); Escape close; ArrowUp/ArrowDown + Enter keyboard nav.
  - `loadCredentials({refresh})` GET list (or POST refresh-usage when refresh), fill state, `renderAccountSwitcher()`. First load renders skeletons.
  - `renderAccountSwitcher()` renders the chip: avatar initial of `displayName`, `displayName` text, next 5-hour reset countdown; and, when open, the row list + footer. Save enabled only when `stagedId && stagedId !== activeId`.
  - `renderAccountRow(p)` per profile: avatar initial; PRIMARY line = `p.displayName` plus plan badge (`subscriptionType 'max'` + tier containing `20x` renders "max 20x"; `organizationType` team variants render "team"; fallback subscriptionType); SECONDARY line = the email, ALWAYS shown (even when a label exists, identity stays visible; for unnamed accounts primary is already the email and secondary shows `accountUuid.slice(0,8)`); 5h and week usage lines with mini bars and reset text via `_formatResetText`; ACTIVE pill; staged radio state; dead state (amber icon, "needs re-login", not selectable); a per-row pencil affordance (`.account-row-edit`, appears on hover on desktop, always visible on mobile) that stops propagation and calls `renameAccount(p)`.
  - `renameAccount(p)` opens `showPromptModal` (L8763) with one text field prefilled with the current label (placeholder: the email), maxlength 60; PUT the label route; the SSE `credentials:changed` re-render updates every client; empty submit clears back to fallback.
  - `stageAccount(profileId)` sets stagedId (ignores dead rows), re-renders.
  - `applyStagedAccount()` confirm via `showConfirmModal` (L8738): title "Switch Claude account?", message = target displayName + email + the restart note, confirmText "Switch". POST apply with `mirrorToMac` from the checkbox (persisted in localStorage `cwm_credMirrorMac`, shown only when `mac.configured && mac.enabled`). In flight: panel inert, Save label "Applying" (no spinner). Success: close panel, success toast, then OFFER RESTART: a second `showConfirmModal` ("Restart running sessions now so they pick up the new login?", confirmText "Restart sessions") that on confirm calls `restartAllSessions({ skipConfirm: true })`. This wires into the EXISTING flow at app.js L7978 whose own confirm copy already says "picking up any new login credentials"; the UI task adds the additive `{ skipConfirm = false }` options parameter to `restartAllSessions` (default preserves current behavior for the header button) so the user is not double-prompted. Mac warning from the response = separate warning toast. Failure: error toast from server `message`, panel stays open, staging preserved.
  - `_formatResetText(resetAt, absolute)` pasted back VERBATIM from docs/QUOTA_WIDGET_REFERENCE.md L481 (do not rewrite it). A single 60s interval (`_accountTickTimer`) re-renders countdowns while chip or panel is visible; cleared on logout.
  - SSE cases per section 5.
- Empty state: "No saved credentials yet" + "Capture current account" button wired to POST capture, with an optional-label prompt (default: the active email) via `showPromptModal`.
- Loading: 3 skeleton rows using the existing `.skeleton-line` shimmer (see the ai-find skeleton usage at app.js L11163 to L11173). Never a spinner.
- The switcher exists only inside `#app` (post app-login); the login screen is untouched.

### 6.3 CSS (styles.css + styles-mobile.css)

Desktop (append near the theme-picker block, styles.css L8116 region, following its conventions exactly; every color via theme tokens, transitions 150 to 200ms, respect prefers-reduced-motion):

- `.account-switcher` position relative (anchor).
- `.account-chip`: height 30px, padding 4px 10px, radius 8px, background token surface0 at rest hover mantle, border 1px token border-subtle, font 12px, gap 8px; countdown meta in JetBrains Mono. Avatar: 18px circle, background token mauve, color token base, 10px bold initial.
- `.account-panel`: absolute, top 100%, LEFT 0 (left-anchored, unlike the right-anchored theme-dropdown), margin-top 6px, width 380px, max-height 70vh, overflow-y auto, background token mantle, border 1px token surface0, radius 10px, shadow and z-index matching `.theme-dropdown` (L8120), 150ms opacity + translateY(4px to 0) enter.
- `.account-row`: full-width button, grid `auto 1fr auto`, padding 10px 12px, radius 8px, hover token surface0; `.is-staged` outline 1px token mauve; `.is-active` ACTIVE pill (token green on green-tinted background); `.is-dead` opacity .55, amber icon token yellow, cursor not-allowed. `.account-row-edit` pencil: 24px ghost icon button, opacity 0 until row hover (desktop), token overlay1 hover text.
- `.account-usage-bar`: 4px track token surface0, fill token green below 60 pct, token yellow 60 to 85, token red above 85; width transitions 200ms.
- `.account-panel-footer`: sticky bottom, background token mantle, border-top 1px token surface0, padding 10px 12px.

Mobile (styles-mobile.css, inside the existing max-width 768px scope plus a 480px refinement, following the bottom-sheet recipe at L120 to L153 and the action-sheet look at L263 to L400):

- At max-width 768px: `.account-panel` becomes `position: fixed; left: 0; right: 0; bottom: 0; top: auto; width: auto; max-height: 75vh; border-radius: 18px 18px 0 0; padding-bottom: env(safe-area-inset-bottom, 0px); animation: sheet-up .25s cubic-bezier(0.16, 1, 0.3, 1);` plus a drag-handle bar styled like `.action-sheet-handle`. Opening adds `body.sheet-open` (scroll lock exists at L89); closing removes it. A dim backdrop (`.account-panel-backdrop`, fixed, token crust at 60 pct alpha) sits behind the sheet on mobile only and closes on tap.
- Rows min-height 56px (44px tap floor is global at L17); `.account-row-edit` always visible at full opacity; footer buttons full-width stacked (mirror `.modal-footer` treatment at L143 to L152), Save on top.
- The chip: at max-width 768px hide `.account-chip-meta`; at max-width 480px hide `.account-chip-label` too (avatar + chevron only) so the 50px header (L103 to L111) never overflows next to the brand.

### 6.4 UI states summary

| State | Treatment |
| - | - |
| Loading roster | 3 skeleton rows, footer disabled |
| Empty | "No saved credentials yet" + Capture current account CTA (optional label prompt) |
| Normal | Rows, active pill, staged outline, Save disabled until staged differs |
| Unnamed credential | Listed normally; primary = email (or uuid8 + "unnamed"), pencil to name it |
| Dead token row | Amber icon, "needs re-login", not selectable; tooltip: run /login as this account in a terminal; the watcher recaptures it automatically |
| Applying | Panel inert, Save label "Applying", chip pulses |
| Success | Toast + restart offer wired to restartAllSessions({skipConfirm:true}) |
| Mac warning | Second toast, warning level, with the mac error message |
| Error | Error toast with server `message`; staging preserved |
| Usage stale (fetchedAt older than 10 min) | Countdown dimmed; opening the panel auto-fires refresh-usage once per open if stale |
| Usage unavailable | "usage unavailable" line; active account may show tilde-prefixed offline estimate (3.3, stretch) |

### 6.5 ASCII wireframes

Desktop (dropdown anchored under the chip, top-left of the header):

```
┌ Header ─────────────────────────────────────────────────────────────────┐
│ [≡] [logo] Myrlin's Workbook  (G Gayane · resets 2h 14m ▾)   ...tabs... │
└─────────────┬───────────────────────────────────────────────────────────┘
              │
┌─────────────┴──────────────────────────────────┐
│ CLAUDE ACCOUNT                              ⟳  │
├────────────────────────────────────────────────┤
│ (G) Gayane                  [max 20x] ACTIVE ✎ │
│     gayane.mouradian@gmail.com                 │
│     5h   ▓▓▓▓▓▓░░░░ 62%   resets in 2h 14m     │
│     week ▓▓▓░░░░░░░ 31%   resets Tue 9:00 AM   │
├────────────────────────────────────────────────┤
│ (A) Personal                [max 20x]      ◉ ✎ │  <- staged (outlined)
│     arthurdmouradian@gmail.com                 │
│     5h   ▓░░░░░░░░░  8%   resets in 4h 51m     │
│     week ▓▓░░░░░░░░ 17%   resets Mon 3:00 AM   │
├────────────────────────────────────────────────┤
│ (b) blazingscope1@gmail.com  [max 20x]       ✎ │  <- unnamed: email as primary
│     3f1c9a2e unnamed                           │
├────────────────────────────────────────────────┤
│ (!) Work Team               [team]           ✎ │
│     arthur.mouradian@soc-usa.com               │
│     needs re-login (stored token is dead)      │
├────────────────────────────────────────────────┤
│ ☑ Also apply on Mac Mini                       │
│ Selected: Personal        [ Cancel ] [ Save ]  │
└────────────────────────────────────────────────┘
```

Mobile (full-width bottom sheet, header chip is avatar-only):

```
┌ Header (50px) ───────────────────────────┐
│ [≡] [logo] Myrlin's Workbook   (G ▾)     │
└──────────────────────────────────────────┘
        ... dimmed app content ...
┌──────────────────────────────────────────┐
│                 ────                     │  <- drag handle
│ CLAUDE ACCOUNT                       ⟳   │
│ ┌──────────────────────────────────────┐ │
│ │ (G) Gayane        [max 20x] ACTIVE ✎ │ │
│ │ gayane.mouradian@gmail.com           │ │
│ │ 5h  ▓▓▓▓▓▓░░░░ 62%  in 2h 14m        │ │
│ │ wk  ▓▓▓░░░░░░░ 31%  Tue 9:00 AM      │ │
│ ├──────────────────────────────────────┤ │
│ │ (A) Personal      [max 20x]      ◉ ✎ │ │
│ │ arthurdmouradian@gmail.com           │ │
│ │ 5h  ▓░░░░░░░░░  8%  in 4h 51m        │ │
│ ├──────────────────────────────────────┤ │
│ │ (!) Work Team     [team]  re-login ✎ │ │
│ └──────────────────────────────────────┘ │
│ ☑ Also apply on Mac Mini                 │
│ ┌──────────────────────────────────────┐ │
│ │                Save                  │ │
│ └──────────────────────────────────────┘ │
│ ┌──────────────────────────────────────┐ │
│ │               Cancel                 │ │
│ └──────────────────────────────────────┘ │
└──────────── safe-area inset ─────────────┘
```

## 7. Security posture (CRITICAL, non-negotiable)

1. **Tokens never reach the browser.** `credentials`, `identity` beyond the whitelisted org/display fields, access tokens, refresh tokens: none are ever serialized into any HTTP response, SSE payload, or client state. Routes may ONLY send `getSafeList()` rows. Apply takes a `profileId` (accountUuid), never token material. Code-review gate for the build agent: grep the route file for `accessToken|refreshToken|credentials\b` in any `res.json` path; none may appear.
2. **No token logging.** Manager and bridge never log token values or credential blobs; paths, emails, and uuids only. The request logger (server.js L316) logs method+URL only.
3. **Store hygiene.** Snapshot and backup files 0600 best effort; store dir outside the repo (`~/.myrlin/claude-accounts/`); gitignore additions per 2.4.
4. **Never refresh the active account's token.** Read-only GET with its live token only; refresh rotates server-side and races the CLI's own rotation, bricking the live login. Enforced inside `updateSnapshotUsage` (the only caller of `refreshInactiveToken`), locked by a dedicated unit test. The rotation WATCHER only ever reads the live file and writes snapshots; it never calls any network endpoint.
5. **Backups + rollback.** Both live files backed up before mutation; token write last; failed token write restores identity atomically; verify re-reads live identity. Mac side delegates backup/atomicity to claude-profile (verified precondition, section 9 T1 step 0).
6. **Injection surfaces.** accountUuid charset-validated before path construction; ssh host/user allowlisted (option injection); secret payloads travel via scp temp files, never interpolated into remote command lines; local child processes use execFile argv arrays. Labels are stored as data and HTML-escaped at render (existing `escapeHtml` convention).
7. **App-login separation.** These routes use the workbook's existing bearer auth (src/web/auth.js). The feature manages CLAUDE OAuth credentials; it never touches the workbook's own password/token store beyond `settings.credentialSwitcher`.

## 8. Testing plan

All tests are standalone node scripts in `test/` (exit 0 green, 1 red), hermetic: `require('./_test-data-dir')` first, `CWM_CLAUDE_DIR`/`CWM_CLAUDE_JSON` at per-test tmp fixtures, `usageUrl`/`tokenUrl` at a local `http.createServer` stub (manager opts; routes honor env `CWM_CRED_USAGE_URL`/`CWM_CRED_TOKEN_URL`). No real HOME writes, no real API calls, no corpus scans (provider-test lesson).

### test/credential-manager.test.js (unit)

1. `serializeCredentialsFile` round-trip: parses back to the same object; carries scopes/subscriptionType/rateLimitTier; expiresAt numeric.
2. Snapshot save/read round-trip; label + usage + tokenDead carry-forward on re-capture.
3. `setLabel`: trims, caps at 60 (throws VALIDATION beyond), empty clears; label survives a subsequent rotation write-back untouched.
4. `displayNameFor` fallback chain: label wins; else email; else uuid8 + "unnamed"; never empty.
5. ROTATION WRITE-BACK: with `watchDebounceMs: 20`, rewrite the fixture `.credentials.json` with a newer expiresAt pair and assert the matching snapshot's `credentials` and `updatedAt` update; an OLDER pair does NOT overwrite; an unknown accountUuid auto-captures a new snapshot; a malformed live file neither crashes nor writes; events inside the self-write guard window are ignored; `stopCredentialWatcher` stops updates.
6. `updateSnapshotUsage`: fresh cache = zero fetch calls (stub hit-count 0); ACTIVE account uses the live token and NEVER hits the token endpoint (hit-count 0); inactive expired = refresh, rotated pair persisted BEFORE the usage fetch (assert file content between stubbed calls), tokenDead on refresh failure, cleared on usage success, prior cache kept on usage failure.
7. `applyCredential` happy path: identity written before token file (wrapped-writer order assert), verify passes, backups exist, `applied:true`; alreadyActive no-op touches nothing.
8. Rollback: pre-create a DIRECTORY at the `.credentials.json` target (rename over a directory fails on Windows and POSIX alike); assert `.claude.json` byte-restored from backup and CRED_APPLY_FAILED thrown.
9. `writeFileAtomic` EPERM retry: wrap renameSync to throw EPERM twice then succeed; assert 3 attempts, correct final content.
10. `seedFromClaudeSwap`: fixture dir with one live-shaped and one tokenDead claude-swap profile; both convert (label + tokenDead carried, accountUuid extracted); unparseable file skipped; second call is a no-op (store non-empty).
11. Backup prune keeps `backupKeep` per basename and never deletes the just-created backup.
12. `validateAccountUuid` rejects path separators and junk; accepts real UUIDs.

### test/credential-routes.test.js (integration, real Express app)

Boot pattern copied from test/codex-settings-route.test.js (require cache reset, `auth.addToken`, ephemeral port). Cases: 401 without token on every route; GET list returns safe rows only (assert NO `accessToken`/`refreshToken` substring anywhere in the raw response body, the load-bearing security test); capture creates a snapshot from fixture HOME with the optional label; label PUT round-trip (set, list shows it, clear restores fallback `displayName`, over-60 chars 400s) and broadcasts `credentials:changed` (subscribe a raw SSE client); apply swaps fixture files in order and broadcasts; apply 404/409/422 error shapes match `structuredError`; refresh-usage against local stubs updates usage and broadcasts `credentials:usage`; mac-config PUT validates charset (400) and persists; DELETE removes the file. Mac mirror is stubbed (dependency injection through setup opts or `CWM_CRED_DISABLE_MAC=1`); no real SSH in tests.

### Gates

Run the existing `test/grep-gate.test.js`: new src files must not contain bare quoted provider literals. Verified against the gate regex `['"]\b(claude|codex)\b['"]`: path strings like `'.claude'`, `'.credentials.json'`, `'claudeAiOauth'`, `'claude-accounts'`, and `'credentials:changed'` do NOT match (no quote immediately precedes the bare word); only an exact quoted `claude`/`codex` literal would, and none is needed. Also verify no em dashes / double hyphens in new code and doc text.

### Adjacent-instance smoke (manual, orchestrator at integration)

`CWM_PASSWORD=test123 PORT=3458 CWM_DATA_DIR=<tmp> CWM_CLAUDE_DIR=<fixture> CWM_CLAUDE_JSON=<fixture> node src/gui.js` (pattern from test/e2e-api.js L4 to L11), then: login, GET /api/credentials, capture, rename, apply to a second fixture profile, confirm fixture files swapped + SSE fired + restart offer appears; overwrite the fixture credentials file by hand and confirm the watcher writes the rotation back into the snapshot within a few seconds; exercise the dropdown at desktop and 390px mobile viewport (visual-qa MCP screenshots before/after per global rules). Never point the smoke at the real `~/.claude`.

## 9. Build plan (ordered, one owner per shared file)

Feature branch workflow per project CLAUDE.md (worktrees; feature sessions commit, orchestrator merges). File ownership is exclusive:

| Task | Owner agent | Files owned |
| - | - | - |
| T1 Foundation | Agent A (feat/credential-switcher-core) | NEW: src/web/credential-manager.js, src/web/mac-bridge.js, src/web/credential-routes.js, test/credential-manager.test.js, test/credential-routes.test.js. EDIT: src/web/server.js (require + setup call + watcher start + GLOBAL_EVENT_TYPES only), .gitignore (2 lines) |
| T2 UI | Agent B (feat/credential-switcher-ui) | EDIT: src/web/public/index.html, src/web/public/app.js (switcher methods + SSE cases + restartAllSessions additive skipConfirm param + pasted _formatResetText), src/web/public/styles.css, src/web/public/styles-mobile.css |
| T3 Integration | Orchestrator | EDIT: package.json (version 1.2.0-alpha.12), CHANGELOG.md ([Unreleased] entry), merge both branches, full test suite + grep gate, port-3458 smoke incl. watcher check, visual QA screenshots (desktop + mobile), commit AND push |

Ordering: T1 and T2 run in PARALLEL; this document is the contract (API in section 4, SSE in 5, DOM ids in 6.1). T2 degrades gracefully (switcher stays hidden if GET /api/credentials 404s). T3 strictly last.

T1 step 0 (hard precondition for mac-bridge): read the Mac script before implementing the mirror payload format: `ssh arthur@arthurs-mac-mini 'cat ~/.local/bin/claude-profile'` (try `alloy` / 100.111.181.106 if the name drifted). Confirm the `~/.claude-profiles/<name>` snapshot format `claude-profile save` writes and match it exactly in `mirrorToMac`. If the host is unreachable during the build, implement the bridge behind the config gate with the format marked TODO-VERIFY, keep `mac.enabled` defaulting to false, and note it in the PR; the claude-swap Invoke-MacSwap sequence (L1082 to 1255) is the documented fallback mechanism if the script format proves incompatible.

T1 checklist: manager + watcher + bridge + routes per sections 3 to 5; server.js wiring exactly as 3.5 (nothing else in server.js); tests green; grep gate green; JSDoc everywhere; zero token logging.

T2 checklist: markup at the 6.1 anchor; els + methods per 6.2 (including rename affordance and the restart offer); SSE cases added BEFORE the default branch of handleSSEEvent (reload-storm guard); `_formatResetText` pasted verbatim from docs/QUOTA_WIDGET_REFERENCE.md L481; CSS per 6.3 with theme tokens only (all 13 themes inherit via the token cascade); keyboard nav + aria; mobile sheet + scroll lock + backdrop; all 11 states of 6.4; skeletons not spinners; 150 to 200ms motion, honor prefers-reduced-motion.

T3 checklist: contract verification (hit every route from the built UI), rotation-watcher smoke, CHANGELOG entry (Added: Claude account switcher: top-left select-then-save dropdown with per-account 5-hour and weekly reset times, editable labels, rotation write-back keeping snapshots alive, optional Mac Mini mirror via claude-profile, mobile bottom sheet; WHY: multi-account swap pain + the Mac bridge workflow), version bump, `.claude/sessions.md` entry, handoff note, push. Ships as the next alpha.

## 10. Open questions and risks

1. **claude-profile snapshot format is unverified from this session.** The Mac script's on-disk format for `~/.claude-profiles/<name>` must be read before the mirror is implemented (T1 step 0). Fallback mechanism documented (claude-swap's scp + python3 + atomic mv path).
2. **Mac host drift.** Config seeds `arthurs-mac-mini`; project memory records the Tailscale node renamed to `alloy` at 100.111.181.106. mac-config PUT exists precisely so Arthur fixes it from Settings without code changes; mirror fails soft with MAC_UNREACHABLE until then.
3. **Cross-machine token lineage.** Mirroring pushes the PC snapshot to the Mac, starting a second rotation lineage there; the Mac CLI then keeps its own copy fresh locally, and the copies diverge by design. This is Arthur's current working practice, but it is also exactly what killed the June captures. The PC-side rotation watcher keeps OUR snapshots on the PC lineage; the Mac copy is the bridge's problem after handoff. If an account is later /login'd fresh anywhere, the watcher recaptures on the PC.
4. **Running Claude processes keep the old account** and may later rotate the OLD account's refresh token, staling its snapshot. The watcher only tracks the ACTIVE account's file; a backgrounded old-account process rotates in memory and writes to the same live file only if it is still the active login (it is not, post-swap), so its lineage can die silently. tokenDead + "needs re-login" + auto-recapture-on-login is the designed recovery. The post-apply restart offer (existing restartAllSessions flow) is the mitigation the UI actively pushes.
5. **Old stored roster is mostly dead on day one.** The four claude-swap seeds arrive tokenDead ("needs re-login"); the active account self-captures. Expect an amber-heavy first render; this is honest, not a bug.
6. **Undocumented API surfaces.** The usage endpoint (beta header `oauth-2025-04-20`) and the OAuth client id are Claude Code internals. Parsers stay null-tolerant; drift degrades to "usage unavailable", never to a crash or failed swap.
7. **macOS Keychain.** Current ground truth (the live bridge + claude-profile) is that the Mac honors file-based credentials. If a future CLI release moves macOS to Keychain-only, the mirror needs a postSwapCommand extension (e.g. `security` CLI import). Watch item.
8. **fs.watch reliability on Windows.** Known-flaky under AV and network drives; the 30s mtime poll fallback is mandatory, not optional, and the watcher must survive ENOSPC/EPERM watcher errors by degrading to poll-only.
9. **Should apply auto-restart sessions without asking?** Deliberately no: destructive surprise. The offer-based flow reuses the existing confirm whose copy already sets expectations.
10. **Usage for accounts whose stored token is dead.** No usable token = no usage fetch; rows show "usage unavailable" until re-login. The offline JSONL estimate (3.3) only ever applies to the active account and is a stretch item.
