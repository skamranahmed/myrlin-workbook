# Myrlin Server: Mobile Support Infrastructure

> **Purpose:** Everything the Myrlin server needs to fully support the mobile app end-to-end.
> **Date:** 2026-03-29
> **Prerequisite:** Mobile app codebase exists in `mobile/` (all 7 phases complete).
> **Scope:** Server-side only. Changes to `src/web/`, `src/state/`, `src/core/`, and desktop web UI.

---

## 1. The Problem

The mobile app is built but the server was designed for a single browser client on localhost. Mobile introduces fundamentally different requirements:

- **Persistent connections from untrusted networks** (not localhost)
- **Intermittent connectivity** (cellular, backgrounding, network switches)
- **Multiple concurrent clients** (desktop browser + 1-N mobile devices)
- **Push-based notifications** (server must actively reach out to devices)
- **Token persistence** (current in-memory tokens die on server restart)
- **Bandwidth sensitivity** (cellular data, not LAN)
- **Device lifecycle management** (pair, track, revoke, expire)

Every item below exists because a real user would hit a wall without it.

---

## 2. Critical Path (Must Have for MVP)

### 2.1 Token Persistence (Server Restart Survival)

**The Problem:** All auth tokens live in an in-memory `Set` in `auth.js`. When the server restarts (crash, update, reboot), every mobile device is silently logged out. The user must re-scan the QR code. This is unacceptable.

**The Solution:** Persist paired device tokens to disk alongside the main state.

**Implementation:**

```javascript
// In store.js state shape, add:
pairedDevices: [
  {
    deviceId: string,        // UUID, generated server-side on pair
    token: string,           // Bearer token (64-char hex)
    deviceName: string,      // "Arthur's iPhone" (from pair request)
    platform: 'ios' | 'android',
    appVersion: string,      // "1.0.0" (from pair request)
    pairedAt: string,        // ISO timestamp
    lastSeenAt: string,      // ISO timestamp, updated on each API call
    expiresAt: string,       // ISO timestamp, 90 days from pairedAt
    pushToken: string | null, // Expo push token
    pushPreferences: {
      sessionComplete: true,
      sessionNeedsInput: true,
      fileConflicts: true,
      taskReview: true,
      serverOnline: false     // Push when server comes back online
    }
  }
]
```

**On server startup:**
1. Read `pairedDevices` from state
2. For each device where `expiresAt > now`: add `token` to `activeTokens` Set
3. For expired devices: remove from array, log cleanup
4. Result: mobile devices stay authenticated across restarts

**On each authenticated API request:**
1. Update `lastSeenAt` for the device matching the token
2. Debounce the state save (don't save on every request)

**Files:** `src/state/store.js`, `src/web/auth.js`

---

### 2.2 Pairing Flow Enhancement

**Current gaps:**
- No `deviceId` returned in pair response (mobile has no server-side identity)
- Device metadata (name, platform) not persisted
- QR payload URL detection is naive (`req.get('host')` fails behind proxies)

**Implementation:**

**Pair endpoint enhancement (`POST /api/auth/pair`):**
```javascript
// Request
{ pairingToken: string, deviceName: string, platform: 'ios' | 'android', appVersion?: string }

// Response (enhanced)
{
  success: true,
  token: string,
  deviceId: string,       // NEW: server-generated UUID
  serverName: string,
  serverVersion: string,
  capabilities: {         // NEW: tells mobile what features are available
    push: true,
    sse: true,
    terminal: true,
    search: true,
    aiSearch: boolean,     // true if Anthropic API key configured
    costTracking: true
  }
}
```

**Server URL detection for QR (`GET /api/auth/pairing-code`):**
```javascript
// Detect all reachable URLs
const urls = {
  local: `http://localhost:${port}`,
  lan: detectLanIP(),           // os.networkInterfaces() non-internal IPv4
  tailscale: detectTailscaleIP(), // 100.x.x.x from interfaces
  tunnel: store.state.settings?.tunnelUrl || null,
  custom: store.state.settings?.externalUrl || null
};

// QR payload includes all URLs so mobile can try each
{
  urls,                          // All available connection URLs
  primaryUrl: urls.custom || urls.tunnel || urls.lan || urls.local,
  pairingToken,
  serverName,
  version
}
```

**LAN IP detection:**
```javascript
function detectLanIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return `http://${iface.address}:${port}`;
      }
    }
  }
  return null;
}
```

**Files:** `src/web/pairing.js`, `src/gui.js`

---

### 2.3 CORS for Mobile Requests

**The Problem:** Current CORS only allows `localhost` and `127.0.0.1`. Mobile apps make requests from LAN IPs, Tailscale IPs, or tunnel URLs.

**The Solution:** Trust Bearer tokens, not origins. If the request has a valid Bearer token, allow it regardless of origin.

**Implementation:**
```javascript
// In server.js CORS middleware
function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  const hasValidToken = req.headers.authorization?.startsWith('Bearer ');

  if (isAllowedOrigin(origin) || hasValidToken) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}
```

**Files:** `src/web/server.js`

---

### 2.4 Device Management API

**Endpoints needed for desktop UI to manage paired devices:**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/devices` | Bearer | List all paired devices |
| GET | `/api/devices/:deviceId` | Bearer | Get single device details |
| PUT | `/api/devices/:deviceId` | Bearer | Update device (name, push prefs) |
| DELETE | `/api/devices/:deviceId` | Bearer | Revoke device (invalidate token) |
| POST | `/api/devices/:deviceId/test-push` | Bearer | Send test push notification |

**Response shapes:**
```javascript
// GET /api/devices
{
  devices: [
    {
      deviceId: string,
      deviceName: string,
      platform: 'ios' | 'android',
      appVersion: string,
      pairedAt: string,
      lastSeenAt: string,
      expiresAt: string,
      pushRegistered: boolean,
      pushPreferences: { ... },
      isOnline: boolean         // Has active SSE connection
    }
  ]
}
```

**Revocation flow (DELETE /api/devices/:deviceId):**
1. Find device in `pairedDevices`
2. Remove token from `activeTokens` Set
3. Remove device from `pairedDevices` array
4. Close any active SSE connections for this token
5. Close any active WebSocket connections for this token
6. Save state

**Files:** New `src/web/device-manager.js`, `src/web/server.js`

---

### 2.5 Desktop Web UI: Pair Mobile

**The desktop web UI needs a way for users to pair their phone.**

**New UI elements:**

1. **"Pair Mobile" button** in the header (next to settings gear)
   - Icon: phone with QR code
   - Badge: shows paired device count

2. **Pair Mobile modal:**
   - QR code (generated from `/api/auth/pairing-code`)
   - Auto-refreshes every 4 minutes (tokens expire at 5)
   - Below QR: "Or enter this URL on your phone: [copyable URL]"
   - Connection info: detected LAN IP, Tailscale IP, tunnel URL
   - Tab: "Paired Devices" showing device list with revoke buttons

3. **Paired Devices list (in modal):**
   - Device name + platform icon (Apple/Android)
   - "Paired X days ago"
   - "Last seen X minutes ago" (or "Online" with green dot)
   - Push status (registered/not registered)
   - "Test Push" button
   - "Revoke" button (red, with confirmation)

**QR code rendering:** Use a lightweight QR library (qrcode or qr-image). Generate on the server as SVG or PNG, or generate client-side from the JSON payload.

**Files:** `src/web/public/app.js`, `src/web/public/index.html`, `src/web/public/styles.css`

---

### 2.6 Push Notification Enhancement

**Current gaps in `push.js`:**
- Fire-and-forget (no retry on failure)
- No receipt verification
- No per-device preferences
- No throttling (100 sessions stopping = 100 pushes)
- No batching (5 events in 1 second = 5 separate pushes)

**Implementation:**

**Retry with backoff:**
```javascript
async function sendPushWithRetry(message, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await sendToExpoAPI(message);
      if (response.data?.status === 'ok') return { sent: true };
      if (response.data?.details?.error === 'DeviceNotRegistered') {
        removeStaleToken(message.to);
        return { sent: false, reason: 'unregistered' };
      }
    } catch (err) {
      if (attempt < maxRetries - 1) {
        await sleep(1000 * Math.pow(2, attempt)); // 1s, 2s, 4s
      }
    }
  }
  return { sent: false, reason: 'max_retries' };
}
```

**Throttling and batching:**
```javascript
// Accumulate events for 2 seconds, then send batch summary
const pushQueue = new Map(); // deviceToken -> pendingEvents[]
let flushTimer = null;

function queuePush(deviceToken, event) {
  if (!pushQueue.has(deviceToken)) pushQueue.set(deviceToken, []);
  pushQueue.get(deviceToken).push(event);

  if (!flushTimer) {
    flushTimer = setTimeout(flushPushQueue, 2000);
  }
}

function flushPushQueue() {
  for (const [token, events] of pushQueue) {
    if (events.length === 1) {
      sendPushWithRetry({ to: token, ...formatSingleEvent(events[0]) });
    } else {
      sendPushWithRetry({ to: token, ...formatBatchSummary(events) });
    }
  }
  pushQueue.clear();
  flushTimer = null;
}
```

**Per-device preferences:**
```javascript
function shouldNotify(device, eventType) {
  const prefs = device.pushPreferences;
  switch (eventType) {
    case 'session:complete': return prefs.sessionComplete;
    case 'session:needs-input': return prefs.sessionNeedsInput;
    case 'conflict:detected': return prefs.fileConflicts;
    case 'task:review': return prefs.taskReview;
    default: return true;
  }
}
```

**Rich notification payloads:**
```javascript
// Session complete
{
  to: pushToken,
  title: 'Session Complete',
  body: '"API refactor" finished successfully',
  data: {
    type: 'session:complete',
    sessionId: 'abc-123',
    route: '/(tabs)/sessions/abc-123'  // Deep link target
  },
  sound: 'default',
  badge: runningSessionCount,
  categoryId: 'session'  // For iOS notification actions
}
```

**iOS notification categories (for action buttons):**
```javascript
// Register categories in push.js for mobile to configure
{
  categories: [
    {
      id: 'session',
      actions: [
        { id: 'restart', title: 'Restart', foreground: true },
        { id: 'view', title: 'View', foreground: true }
      ]
    },
    {
      id: 'input_needed',
      actions: [
        { id: 'open', title: 'Open Terminal', foreground: true }
      ]
    }
  ]
}
```

**Files:** `src/web/push.js`, `src/state/store.js`

---

### 2.7 SSE Enhancement for Mobile

**The Problem:** Every SSE client gets every event. A mobile device on cellular getting 50 events/second for workspaces it doesn't care about wastes bandwidth and battery.

**Implementation:**

**Client-level SSE registration:**
```javascript
// Enhanced SSE client tracking
const sseClients = new Map(); // clientId -> { res, token, deviceId?, subscriptions? }

app.get('/api/events', (req, res) => {
  const token = req.query.token;
  const deviceId = req.query.deviceId; // Optional, for mobile filtering

  // ... SSE headers ...

  const clientId = generateId();
  const client = { res, token, deviceId };

  // If mobile device, load subscriptions
  if (deviceId) {
    const device = store.findDevice(deviceId);
    client.subscriptions = device?.syncState?.subscriptions || null;
  }

  sseClients.set(clientId, client);

  // Send heartbeat every 30s
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); }
    catch { clearInterval(heartbeat); sseClients.delete(clientId); }
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(clientId);
  });
});
```

**Filtered broadcast:**
```javascript
function broadcastSSE(eventType, data) {
  const workspaceId = data?.workspaceId || data?.workspace?.id || null;

  for (const [clientId, client] of sseClients) {
    // If client has subscriptions, filter
    if (client.subscriptions && workspaceId) {
      if (!client.subscriptions.includes(workspaceId)) continue;
    }

    // Global events always sent (settings, server status)
    try {
      client.res.write(`data: ${JSON.stringify({ type: eventType, data })}\n\n`);
    } catch {
      sseClients.delete(clientId);
    }
  }
}
```

**Heartbeat:** 30-second `: heartbeat\n\n` comment keeps the connection alive through proxies and NAT.

**Files:** `src/web/server.js`

---

## 3. High Priority (Should Have for Good UX)

### 3.1 Initial Sync Endpoint

**The Problem:** When a mobile device connects, it needs workspaces, sessions, groups, settings, and device info. That's 5+ API calls on a potentially slow connection.

**Solution:** Single endpoint that returns everything needed for first render.

```javascript
// GET /api/mobile/sync
// Returns all data needed for mobile app bootstrap
{
  server: {
    name: string,
    version: string,
    uptime: number
  },
  workspaces: Workspace[],
  workspaceOrder: string[],
  workspaceGroups: WorkspaceGroup[],
  sessions: Session[],           // All sessions with sparse fields
  recentSessions: string[],     // IDs only
  templates: SessionTemplate[],
  settings: Settings,
  device: PairedDevice,         // This device's info
  stats: {
    runningCount: number,
    totalCount: number,
    totalCost: number
  },
  syncVersion: number,          // For delta sync later
  timestamp: string
}
```

**Session sparse fields (for list view):**
```javascript
// Only fields needed for SessionCard rendering
{
  id, name, workspaceId, status, topic, tags,
  lastActive, pid, resumeSessionId
  // Omitted: logs, workingDir, command, flags, initialPrompt, createdAt
}
```

**Files:** `src/web/server.js`

---

### 3.2 Session Pagination

**The Problem:** A power user might have 500+ sessions. Loading all of them in one API call is wasteful on mobile.

**Solution:** Add pagination to session list endpoint.

```javascript
// GET /api/sessions?limit=20&offset=0&status=running&sort=lastActive&search=refactor
{
  sessions: Session[],
  pagination: {
    total: 487,
    limit: 20,
    offset: 0,
    hasMore: true
  }
}
```

**Query parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| limit | number | 50 | Max results (1-100) |
| offset | number | 0 | Skip N results |
| status | string | all | Filter: running, stopped, error, idle |
| sort | string | lastActive | Sort: lastActive, name, created, cost |
| order | string | desc | asc or desc |
| search | string | - | Filter by name/topic substring |
| workspaceId | string | - | Filter by workspace |
| tags | string | - | Comma-separated tag filter |
| fields | string | - | Sparse fields: id,name,status,lastActive |

**Files:** `src/web/server.js`

---

### 3.3 Server Info Endpoint

**The Problem:** Mobile needs to know server capabilities before showing features.

```javascript
// GET /api/server-info (no auth required, for connection testing)
{
  name: string,              // Server name
  version: string,           // Myrlin version
  platform: string,          // 'win32' | 'darwin' | 'linux'
  uptime: number,            // Seconds
  capabilities: {
    push: boolean,           // Push notifications configured
    aiSearch: boolean,       // Anthropic API key present
    costTracking: boolean,   // JSONL files accessible
    terminal: boolean,       // node-pty available
    worktreeTasks: boolean,  // Git available
    tunnel: boolean          // Cloudflare tunnel configured
  },
  urls: {
    local: string,
    lan: string | null,
    tailscale: string | null,
    tunnel: string | null,
    custom: string | null
  },
  stats: {
    workspaceCount: number,
    sessionCount: number,
    runningCount: number
  }
}
```

**Files:** `src/web/server.js`

---

### 3.4 Token Refresh

**The Problem:** Tokens should expire (security best practice), but expiration means the user has to re-pair. Token refresh lets the mobile app silently get a new token before the old one expires.

```javascript
// POST /api/auth/refresh
// Authorization: Bearer <current-token>
// Response:
{
  token: string,         // New bearer token
  expiresAt: string,     // New expiration (90 days from now)
  deviceId: string       // Same device ID
}
```

**Server logic:**
1. Find device by current token
2. Generate new token
3. Remove old token from `activeTokens`
4. Add new token to `activeTokens`
5. Update device record in `pairedDevices`
6. Save state

**Mobile logic:**
- Check token expiration on app launch
- If < 7 days remaining, refresh silently
- If expired, show re-pair flow

**Files:** `src/web/auth.js`, `src/web/server.js`

---

### 3.5 Push Notification Preferences API

```javascript
// GET /api/push/preferences
// Authorization: Bearer <token>
{
  deviceId: string,
  preferences: {
    sessionComplete: boolean,
    sessionNeedsInput: boolean,
    fileConflicts: boolean,
    taskReview: boolean,
    serverOnline: boolean,
    docsUpdated: boolean
  }
}

// PUT /api/push/preferences
// Authorization: Bearer <token>
// Body: { sessionComplete: false, ... }
// Response: updated preferences object
```

**Files:** `src/web/push.js`, `src/web/server.js`

---

### 3.6 Scrollback Pagination

**The Problem:** Terminal scrollback can be 100KB+. Mobile shouldn't load it all at once.

```javascript
// GET /api/sessions/:id/scrollback
// Query: ?lines=100&from=end (last 100 lines)
// Query: ?lines=100&from=0 (first 100 lines)
{
  lines: string[],
  total: number,
  from: number,
  hasMore: boolean
}
```

**Files:** `src/web/pty-manager.js`, `src/web/server.js`

---

## 4. Medium Priority (Nice to Have for v1.1)

### 4.1 Delta Sync

Instead of fetching everything on reconnect, fetch only what changed.

```javascript
// GET /api/mobile/delta?since=2026-03-29T10:00:00Z
{
  changes: [
    { type: 'session:updated', id: 'abc', data: { status: 'stopped' }, at: '...' },
    { type: 'workspace:created', id: 'def', data: { name: 'New' }, at: '...' },
  ],
  deletions: [
    { type: 'session', id: 'xyz', at: '...' }
  ],
  syncVersion: 42,
  timestamp: '2026-03-29T10:05:00Z'
}
```

**Server tracks:** Circular buffer of last 1000 state changes with timestamps. If `since` is older than the buffer, return `fullSyncRequired: true`.

**Files:** New `src/web/sync-manager.js`

---

### 4.2 Workspace Subscriptions

Let mobile devices subscribe to specific workspaces to reduce SSE traffic.

```javascript
// POST /api/devices/:deviceId/subscriptions
// Body: { workspaceIds: ['ws-1', 'ws-2'] }
// Response: { subscriptions: ['ws-1', 'ws-2'] }

// GET /api/devices/:deviceId/subscriptions
// Response: { subscriptions: ['ws-1', 'ws-2'] }
```

SSE events for sessions/docs/features are filtered by workspace subscription. Global events (settings, groups, server status) are always sent.

**Files:** `src/web/device-manager.js`, `src/web/server.js`

---

### 4.3 Offline Bundle

Generate a compressed snapshot for offline use.

```javascript
// GET /api/mobile/offline-bundle
// Accept-Encoding: gzip
// Response: gzip-compressed JSON blob
{
  workspaces: [...],
  sessions: [...],       // Sparse fields only
  docs: { [wsId]: DocContent },
  timestamp: string,
  expiresAt: string      // Bundle valid for 24h
}
```

**Files:** `src/web/server.js`

---

### 4.4 Session Logs Pagination

```javascript
// GET /api/sessions/:id/logs?limit=50&offset=0
{
  logs: [{ time, message }],
  total: number,
  hasMore: boolean
}
```

**Files:** `src/web/server.js`

---

### 4.5 Connection Quality Reporting

Mobile reports connection quality back to server for adaptive behavior.

```javascript
// POST /api/devices/:deviceId/connection-quality
// Body: { latency: 150, bandwidth: 'cellular', signalStrength: 'weak' }

// Server adjusts:
// - SSE event frequency (batch more aggressively on slow connections)
// - Response compression (enable gzip for cellular)
// - Push vs SSE preference (prefer push if SSE is unreliable)
```

**Files:** `src/web/device-manager.js`

---

## 5. Error Handling and Response Standards

### 5.1 Standardized Error Response

All mobile-facing endpoints should return structured errors:

```javascript
// Error response shape
{
  error: string,           // Machine-readable code: 'INVALID_TOKEN', 'RATE_LIMITED', 'NOT_FOUND'
  message: string,         // Human-readable message
  code: number,            // HTTP status code (redundant but convenient for mobile)
  retryable: boolean,      // Can the client retry this request?
  retryAfter?: number      // Seconds to wait before retry (for rate limits)
}
```

### 5.2 API Versioning

Add `X-API-Version` header to all responses. Start at `1`. Mobile app sends `X-API-Version` in requests; server can handle version-specific behavior.

---

## 6. Security Considerations

### 6.1 Rate Limiting (Mobile Endpoints)

| Endpoint Group | Limit | Window |
|---------------|-------|--------|
| Auth (login, pair) | 5 req | 60s |
| Token refresh | 1 req | 60s |
| Push register | 3 req | 60s |
| Read endpoints (GET) | 60 req | 60s |
| Write endpoints (POST/PUT/DELETE) | 30 req | 60s |
| SSE connect | 3 req | 60s |
| Batch/sync | 5 req | 60s |

### 6.2 Token Security

- Tokens are 64-char hex (256-bit entropy), cryptographically random
- Tokens stored hashed in `pairedDevices` (bcrypt or SHA-256)
- Token comparison uses timing-safe equality
- Revoked tokens immediately removed from active set
- Expired tokens cleaned up on startup and hourly

### 6.3 Input Validation

All mobile endpoints validate:
- `deviceId`: UUID format
- `deviceName`: max 100 chars, alphanumeric + spaces + common punctuation
- `platform`: enum ('ios', 'android')
- `pushToken`: Expo push token format (ExponentPushToken[...])
- `workspaceIds`: array of valid UUIDs, max 50 entries

---

## 7. Implementation Phases

### Phase A: Token Persistence + Device Registry (CRITICAL)
**Must be first. Nothing else works without persistent tokens.**
- Persistent token storage in store.js
- pairedDevices array with full metadata
- Token reload on server startup
- Token expiration and cleanup
- Device management API (list, revoke)
- CORS update for mobile origins

### Phase B: Pairing Enhancement + Desktop UI
- Enhanced pair response (deviceId, capabilities)
- Server URL auto-detection (LAN, Tailscale, tunnel)
- Desktop web UI: "Pair Mobile" button, QR modal, paired devices list
- QR code generation (SVG or PNG)
- Test push button

### Phase C: Push Enhancement
- Retry with exponential backoff
- Throttling and batching (2s window)
- Per-device preferences API
- Rich notification payloads with deep link data
- iOS notification categories (action buttons)
- Dead token cleanup via Expo receipts

### Phase D: SSE + Sync Optimization
- SSE heartbeat (30s)
- SSE client registry with device tracking
- Workspace subscription filtering
- Initial sync endpoint (/api/mobile/sync)
- Server info endpoint (/api/server-info)

### Phase E: API Enhancement
- Session pagination (limit, offset, sort, filter)
- Sparse field selection
- Scrollback pagination
- Session logs pagination
- Token refresh endpoint

### Phase F: Advanced (v1.1)
- Delta sync (changes since timestamp)
- Offline bundle generation
- Connection quality reporting
- Standardized error codes
- API versioning headers

---

## 8. Files Modified/Created Summary

### Modified Files
| File | Changes |
|------|---------|
| `src/state/store.js` | Add pairedDevices, token persistence, device CRUD methods |
| `src/web/auth.js` | Token reload on startup, token refresh, expiration check, device tracking |
| `src/web/pairing.js` | Enhanced pair response, deviceId, capabilities, URL detection |
| `src/web/push.js` | Retry logic, batching, per-device preferences, rich payloads |
| `src/web/server.js` | CORS, device API routes, sync endpoint, pagination, SSE enhancement |
| `src/web/pty-manager.js` | Scrollback pagination, PTY session list API |
| `src/gui.js` | LAN/Tailscale IP detection on startup |
| `src/web/public/app.js` | Pair Mobile modal, QR code display, device management UI |
| `src/web/public/index.html` | Pair Mobile modal HTML |
| `src/web/public/styles.css` | Pair Mobile modal styles |

### New Files
| File | Purpose |
|------|---------|
| `src/web/device-manager.js` | Device registry, subscriptions, lifecycle management |

### Dependencies to Add
| Package | Purpose |
|---------|---------|
| `qrcode` | QR code generation for desktop web UI (SVG output) |

---

## 9. Testing Requirements

### Integration Tests (add to `test/`)
- `test/device-manager.test.js` - Device CRUD, token persistence, expiration
- `test/push-enhanced.test.js` - Retry, batching, preferences, dead token cleanup
- `test/mobile-sync.test.js` - Initial sync, pagination, sparse fields
- `test/sse-filtering.test.js` - Workspace subscription filtering, heartbeat
- `test/token-refresh.test.js` - Refresh flow, expiration, revocation

### Manual Testing Checklist
- [ ] Pair phone via QR code on LAN
- [ ] Pair phone via QR code over Tailscale
- [ ] Pair phone via manual URL entry
- [ ] Server restart: phone stays authenticated
- [ ] Revoke device from desktop: phone gets logged out
- [ ] Push notification delivery within 5 seconds
- [ ] Push batching: 5 events in 1 second = 1 push
- [ ] SSE reconnection after phone backgrounding
- [ ] Session list pagination with 100+ sessions
- [ ] Token refresh before expiration

---

## 10. Success Metrics

| Metric | Target |
|--------|--------|
| Token persistence across restart | 100% (zero re-pairs after reboot) |
| Push delivery latency | < 5 seconds from event to notification |
| Push delivery rate | > 95% (retries handle transient failures) |
| Initial sync response time | < 1 second (for < 100 sessions) |
| SSE reconnection time | < 3 seconds after phone foreground |
| QR pairing time | < 10 seconds end-to-end |
| Concurrent mobile devices | 10+ without degradation |
| API response size (mobile) | 50% smaller than desktop (sparse fields) |

---

*Document authored by Claude Opus 4.6 as preparation for GSD server mobile support build.*
*All implementation phases reference existing codebase patterns and conventions.*
