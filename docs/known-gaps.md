# Known Gaps Register

Accepted for the AWS **POC** deployment (2026-10-04). Status updated after the `poc/aws-deploy` fixes the same day. Items marked **POC-blocker** are fixed before the POC goes live; everything else is deferred and must be resolved before production. Source: cross-repo review on 2026-10-03 (see also `agentic-architecture-assessment.md`, Appendix).

Repos: `ui` = app-usage-monitoring-ui (portal + worker), `agent` = app-usage-monitor-agent (AI service), `tracker` = app-usage-monitoring (endpoint).

## Security

| # | Gap | Where | POC handling |
|---|---|---|---|
| S1 | No user authentication anywhere; approvals (`PATCH /api/license-requests/:id`) unauthenticated, no `decidedBy`; requester name/email self-declared via localStorage | ui `server.js:584`, `src/ChatAssistant.jsx:133` | Network-level gate (ALB auth or IP allow-list). Identity-based requester/approver deferred |
| S2 | Agent `POST /api/assistant/chat` unauthenticated; portal sends no token | agent `src/server.ts:41`, ui `server.js:210` | **Fixed** (poc/aws-deploy): agent requires `X-MCP-Service-Token` (timing-safe); portal sends it; agent SG accepts only the portal |
| S3 | `/api/mcp/*` served on public origin; token compared with `!==` (not timing-safe) | ui `server.js:91` | **Fixed**: ALB returns 403 for `/api/mcp/*`; ALB is internal behind CloudFront; agent calls `http://portal:3000` via Service Connect; timing-safe compare |
| S4 | `/send-email-summary` accepts arbitrary `recipient` (open relay through SES) | ui `server.js:700` | **Fixed**: recipient must be in `SES_RECIPIENT_EMAIL` allow-list |
| S5 | `PUT /api/state` deletes records absent from payload, unauthenticated | ui `server.js:305` area | Covered by network gate only |
| S6 | Portal forwards client-supplied `assistant` turns to the model | ui `server.js:545` | Deferred (read-only assistant) |
| S7 | `src/app_config.json` (contains personal email) baked into image; server exits if missing | ui `Dockerfile`, `server.js:28` | **Fixed** for the server (file optional, not in image). Still bundled into the SPA via `src/App.jsx` import (email visible in JS) — deferred |
| S8 | RabbitMQ dev credentials `portal/portal_dev` defaults in code | tracker, ui | **Fixed** in AWS: generated `admin`/`tracker`/`worker` passwords in Secrets Manager, least-privilege permissions, `guest` deleted, TLS with private CA. Code defaults remain for local dev; per-device users deferred |

## Correctness

| # | Gap | Where | POC handling |
|---|---|---|---|
| C1 | MCP endpoints match app names exactly; decisions store process names (`postman.exe`), so decision counts return 0 (regression vs old `.exe`-tolerant matcher); no display-name→process-name mapping | ui `server.js:619-686` | **Fixed**: inventory aliases (display ↔ process name, `.exe`-tolerant) + Mongo-side filtering |
| C2 | MCP endpoints load 500 records then filter in JS → wrong counts beyond 500 | ui `server.js:619-686` | **Fixed** for `/api/mcp/*` (query in Mongo, 5000 cap); DB fallback still samples 500 |
| C3 | Keyword trigger creates license requests from ordinary questions ("which license requests are pending…") | ui `server.js:229` | **Fixed**: explicit-instruction detection with question exclusions (tests) |
| C4 | MCP tool errors (`isError`) passed to model as authoritative results → no DB fallback | agent `src/mcp-tools.ts:89` | **Fixed**: portal failures throw (portal falls back); model mistakes returned as JSON errors |
| C10 | Agent follow-up OpenAI turns omitted `instructions` (system prompt lost after first tool call) | agent `openai-assistant.ts` | **Fixed** (found during POC work) |
| C5 | Tracker over-counts AI tokens (cumulative re-reported every interval) | tracker `agent/main.py:75`, `monitor.py:417` | Deferred; don't present token numbers in POC |
| C6 | Reclaim decisions computed in the browser, only while a tab is open, only for latest PC | ui `src/App.jsx:2512` | Deferred (milestone M1) |
| C7 | Partial telemetry ⇒ `Reclaimable` (no telemetry-health check) | ui `src/App.jsx:1174` | Deferred (M2) |
| C8 | Worked-threshold converted with evaluation-window unit | ui `src/App.jsx:66` | Deferred |
| C9 | Tracker non-Windows: undefined `_get_macos_foreground_pid` / `_get_linux_foreground_pid`; idle always 0 | tracker `monitor.py:1159` | POC is Windows-only |

## Robustness / operations

| # | Gap | Where | POC handling |
|---|---|---|---|
| R1 | Timeout mismatch: portal 20 s vs agent up to 4 OpenAI calls (no timeout) + 15 s tool calls | agent `openai-assistant.ts:7`, ui `server.js:214` | **Fixed**: agent 20 s overall deadline with abort signals; portal 25 s; CloudFront 30 s |
| R2 | Hallucinated tool / malformed args throw → whole chat fails | agent `openai-assistant.ts:62` | **Fixed**: returned to the model as tool errors |
| R3 | OpenAI tool schemas duplicated by hand vs zod MCP schemas | agent `src/mcp-tools.ts` | Deferred |
| R4 | Telemetry worker stays alive but idle after RabbitMQ disconnect | ui `messaging/telemetryConsumer.js` | **Fixed**: worker exits on connection/channel close (verified locally) |
| R5 | `GET /api/telemetry` returns entire collection every 10 s | ui `server.js:507`, `App.jsx:4335` | Deferred; watch data volume |
| R6 | Portal fallback hides agent outages | ui `server.js:547` | **Fixed**: `AgentFallbacks` alarm on portal logs |
| R7 | Telemetry dedup on `(device_key, timestamp)` not `event_id` | ui `services/telemetryPersistence.js` | Deferred |

## Repository hygiene

| # | Gap | Where | POC handling |
|---|---|---|---|
| H1 | `agent/device_id.json`, `first_seen.json`, `__pycache__/*.pyc` committed → every install shares one device ID | tracker | **Fixed**: untracked and ignored (also `__pycache__`) |
| H2 | Agent `src/` entirely untracked in git | agent | **Fixed** by you on `master` |
| H3 | Agent compiles `.js` beside `.ts` (drift risk); no Dockerfile | agent | **Fixed**: Dockerfile added; in-place JS emit kept (`dist/` still recommended) |
| H4 | Portal Dockerfile omits `workers/`, `messaging/` | ui `Dockerfile` | **Fixed**: includes worker + messaging, runs as `node` user |
| H5 | No automated tests in Node repos | ui, agent | **Partly fixed**: portal 12, agent 10, infra 3, Tracker 14 tests |
