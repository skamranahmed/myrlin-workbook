# Always-on `workbook.myrlin.dev` Cloudflare Tunnel (PC-hosted)

**Date:** 2026-05-11
**Status:** approved, ready for writing-plans
**Target release:** v1.2.0-alpha.8

## Problem

The Myrlin workbook should be reachable at `https://workbook.myrlin.dev/` from any device, anywhere on the internet, regardless of whether the host PC is currently logged in. Today the workbook only binds to `localhost:3456` on the Windows PC; there is no public ingress. Three independent failure domains need to self-heal:

1. The workbook process (alpha.5 supervisor already handles this).
2. The supervisor itself (alpha.5 Scheduled Task restart-on-failure handles this).
3. The Cloudflare Tunnel — currently nonexistent.

## Goals

- `workbook.myrlin.dev` resolves and serves the workbook from any internet client.
- Auto-starts on system boot, no user login required.
- Auto-restarts every layer on crash.
- Authenticated via Cloudflare Access (OAuth) for browser routes; Service Token bypass for mobile pairing + scripts.

## Non-goals

- Mac Mini hosting (explicitly out of scope per user direction).
- Multi-machine workbook replication / state sync (deferred).
- TLS cert management (Cloudflare handles edge TLS).
- Workbook rewrite to support multi-host (single instance is fine for v1.2).

## Architecture

```
internet
   │
   ▼
workbook.myrlin.dev
   │  (Cloudflare DNS CNAME → <tunnel-uuid>.cfargotunnel.com)
   │  zone: myrlin.dev (045577a5aec0099cf1e99c2f1db188cd)
   ▼
Cloudflare Access (Zero Trust)
   │  • Browser routes (/, /index.html, /static/*): OAuth required (Google/GitHub)
   │  • /api/* and /pty WebSocket: Service Token bypass
   ▼
Cloudflared Windows service (cerberus-2)
   │  • Service name: Cloudflared
   │  • Account: LOCAL SYSTEM (no login required)
   │  • start=auto, recovery=restart/restart/restart
   │  • Config: C:\Users\Arthur\.cloudflared\config.yml
   ▼
http://localhost:3456
   │  • myrlin-workbook supervised by alpha.5 Scheduled Task
   │  • Process: node supervisor.js → node gui.js
```

## Components

### 1. cloudflared install on PC

- Source: `winget install --id Cloudflare.cloudflared` OR the windows-amd64 msi from `https://github.com/cloudflare/cloudflared/releases/latest`.
- Path: `C:\Program Files (x86)\cloudflared\cloudflared.exe`.
- Verified by: `cloudflared --version`.

### 2. PC-local auth (fresh cert; no cross-machine copy)

- Command: `cloudflared tunnel login`.
- Browser flow: pick the `myrlin.dev` zone, approve.
- Result: `C:\Users\Arthur\.cloudflared\cert.pem` written.
- Independent from any other machine's cert; revocable per-machine.

### 3. Named tunnel + DNS route

- Create: `cloudflared tunnel create myrlin-workbook`.
- Resulting UUID stored at `C:\Users\Arthur\.cloudflared\<uuid>.json`.
- Route: `cloudflared tunnel route dns myrlin-workbook workbook.myrlin.dev`.
- This writes the CNAME via Cloudflare API. Wrangler is OAuth'd zone:read only and CAN'T do this; cloudflared has the full token.

### 4. Config file

`C:\Users\Arthur\.cloudflared\config.yml`:

```yaml
tunnel: <new-uuid>
credentials-file: C:\Users\Arthur\.cloudflared\<new-uuid>.json
ingress:
  - hostname: workbook.myrlin.dev
    service: http://localhost:3456
    originRequest:
      connectTimeout: 30s
  - service: http_status:404
```

### 5. Windows service

- Install: `cloudflared service install` (admin shell, run-as-administrator).
- Runs as `LOCAL SYSTEM`, no login required.
- `start=auto` so it fires on boot.
- `recovery=restart/restart/restart/0/0/0` for crash-resilience.

### 6. Cloudflare Access policy (Zero Trust dashboard)

- Application: `workbook.myrlin.dev`.
- Identity providers: Google or GitHub (one-time login per device per 24h).
- Allow rule: `emails == arthurdmouradian@gmail.com`.
- Service Token: generated, stored in `~/.claude/credentials.md`. Mobile app + scripts attach `CF-Access-Client-Id` + `CF-Access-Client-Secret`.
- Bypass paths: `/api/*` and `/pty` use service-auth (allows Bearer-only flows).

### 7. Mobile pairing client (post-cutover)

- Add the Service Token headers to the workbook fetch client + WS client.
- One-time change, no protocol modification. Tracked separately in `mobile/`.

## Failure modes + recovery

| Failure | Recovery | Time to heal |
|---|---|---|
| workbook.js crash | supervisor restarts | 2-5s |
| supervisor.js crash | Scheduled Task restart-on-failure (3x) | 30-60s |
| Whole node process tree dies | Scheduled Task fires at next minute | 60s |
| cloudflared.exe crash | Windows SCM restart (sc.exe `restart` policy) | 5s |
| Network blip | cloudflared internal reconnect | 5-30s |
| Cloudflare edge issue | cloudflared retry; user sees brief 5xx | varies |
| PC reboot | All layers fire at boot | 30-90s |
| PC sleep | NOTHING REACHES IT — user accepted trade-off | n/a |

## Risks

- **PC sleep blackout.** Set Windows Power Options to "Never sleep" on AC, disable wake-on-LAN sleep. `powercfg -h off` (admin) to disable hibernate. Documented in the plan.
- **Cert sits on PC.** Single-machine secret. Acceptable since cloudflared service runs locally and the user owns the PC.
- **Cloudflare Access first-time OAuth.** One-time browser flow per device. After that, the CF cookie carries the session for 24h.
- **Service Token leak.** Cloudflare Access logs every request; revoking the token + reissuing is a 30s dashboard task. Document in operations notes.

## Testing

- `curl -H "CF-Access-Client-Id: <id>" -H "CF-Access-Client-Secret: <secret>" https://workbook.myrlin.dev/api/health` → 200.
- Browser hit → Cloudflare OAuth → workbook login → app loads.
- Kill `myrlin-workbook` task in Task Manager → wait 5s → `curl` returns 200 (supervisor restart).
- `sc.exe stop Cloudflared` → wait 10s → service auto-restarts (SCM recovery policy).
- Reboot PC → wait 90s → `curl` returns 200 with no manual login.

## Phasing

Single plan `23-01-PLAN.md` covers the full Cloudflare setup. The mobile client Service Token change is tracked as a follow-up plan when we next touch `mobile/`.
