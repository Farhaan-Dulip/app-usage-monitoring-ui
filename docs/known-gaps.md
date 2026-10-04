# Known Gaps Register

Accepted for the AWS **POC** deployment (2026-10-04). Items marked **POC-blocker** are fixed before the POC goes live; everything else is deferred and must be resolved before production. Source: cross-repo review on 2026-10-03 (see also `agentic-architecture-assessment.md`, Appendix).

Repos: `ui` = app-usage-monitoring-ui (portal + worker), `agent` = app-usage-monitor-agent (AI service), `tracker` = app-usage-monitoring (endpoint).

## Security

| # | Gap | Where | POC handling |
|---|---|---|---|
| S1 | No user authentication anywhere; approvals (`PATCH /api/license-requests/:id`) unauthenticated, no `decidedBy`; requester name/email self-declared via localStorage | ui `server.js:584`, `src/ChatAssistant.jsx:133` | Network-level gate (ALB auth or IP allow-list). Identity-based requester/approver deferred |
| S2 | Agent `POST /api/assistant/chat` unauthenticated; portal sends no token | agent `src/server.ts:41`, ui `server.js:210` | **POC-blocker**: bearer token both directions + private security group |
| S3 | `/api/mcp/*` served on public origin; token compared with `!==` (not timing-safe) | ui `server.js:91` | **POC-blocker**: ALB deny rule for `/api/mcp/*`; agent uses internal URL |
| S4 | `/send-email-summary` accepts arbitrary `recipient` (open relay through SES) | ui `server.js:700` | **POC-blocker**: pin recipient server-side |
| S5 | `PUT /api/state` deletes records absent from payload, unauthenticated | ui `server.js:305` area | Covered by network gate only |
| S6 | Portal forwards client-supplied `assistant` turns to the model | ui `server.js:545` | Deferred (read-only assistant) |
| S7 | `src/app_config.json` (contains personal email) baked into image; server exits if missing | ui `Dockerfile`, `server.js:28` | **POC-blocker**: env-only config |
| S8 | RabbitMQ dev credentials `portal/portal_dev` defaults in code | tracker, ui | **POC-blocker**: real credentials via Secrets Manager / env; per-device users deferred |

## Correctness

| # | Gap | Where | POC handling |
|---|---|---|---|
| C1 | MCP endpoints match app names exactly; decisions store process names (`postman.exe`), so decision counts return 0 (regression vs old `.exe`-tolerant matcher); no display-name→process-name mapping | ui `server.js:619-686` | Fix recommended for a credible demo |
| C2 | MCP endpoints load 500 records then filter in JS → wrong counts beyond 500 | ui `server.js:619-686` | Deferred (POC data small) |
| C3 | Keyword trigger creates license requests from ordinary questions ("which license requests are pending…") | ui `server.js:229` | Fix recommended |
| C4 | MCP tool errors (`isError`) passed to model as authoritative results → no DB fallback | agent `src/mcp-tools.ts:89` | Fix recommended |
| C5 | Tracker over-counts AI tokens (cumulative re-reported every interval) | tracker `agent/main.py:75`, `monitor.py:417` | Deferred; don't present token numbers in POC |
| C6 | Reclaim decisions computed in the browser, only while a tab is open, only for latest PC | ui `src/App.jsx:2512` | Deferred (milestone M1) |
| C7 | Partial telemetry ⇒ `Reclaimable` (no telemetry-health check) | ui `src/App.jsx:1174` | Deferred (M2) |
| C8 | Worked-threshold converted with evaluation-window unit | ui `src/App.jsx:66` | Deferred |
| C9 | Tracker non-Windows: undefined `_get_macos_foreground_pid` / `_get_linux_foreground_pid`; idle always 0 | tracker `monitor.py:1159` | POC is Windows-only |

## Robustness / operations

| # | Gap | Where | POC handling |
|---|---|---|---|
| R1 | Timeout mismatch: portal 20 s vs agent up to 4 OpenAI calls (no timeout) + 15 s tool calls | agent `openai-assistant.ts:7`, ui `server.js:214` | Fix recommended (agent deadline < portal timeout) |
| R2 | Hallucinated tool / malformed args throw → whole chat fails | agent `openai-assistant.ts:62` | Deferred |
| R3 | OpenAI tool schemas duplicated by hand vs zod MCP schemas | agent `src/mcp-tools.ts` | Deferred |
| R4 | Telemetry worker stays alive but idle after RabbitMQ disconnect | ui `messaging/telemetryConsumer.js` | **POC-blocker**: exit so ECS restarts |
| R5 | `GET /api/telemetry` returns entire collection every 10 s | ui `server.js:507`, `App.jsx:4335` | Deferred; watch data volume |
| R6 | Portal fallback hides agent outages | ui `server.js:547` | CloudWatch metric filter + alarm |
| R7 | Telemetry dedup on `(device_key, timestamp)` not `event_id` | ui `services/telemetryPersistence.js` | Deferred |

## Repository hygiene

| # | Gap | Where | POC handling |
|---|---|---|---|
| H1 | `agent/device_id.json`, `first_seen.json`, `__pycache__/*.pyc` committed → every install shares one device ID | tracker | **POC-blocker**: untrack + ignore |
| H2 | Agent `src/` entirely untracked in git | agent | **POC-blocker**: commit |
| H3 | Agent compiles `.js` beside `.ts` (drift risk); no Dockerfile | agent | **POC-blocker**: Dockerfile; `dist/` output recommended |
| H4 | Portal Dockerfile omits `workers/`, `messaging/` | ui `Dockerfile` | **POC-blocker** |
| H5 | No automated tests in Node repos | ui, agent | Add `node:test` for fixed items |
