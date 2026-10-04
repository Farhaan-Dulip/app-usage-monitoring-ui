# Agentic Software Asset Intelligence — Repository Assessment & POC Design

Status: analysis only, nothing implemented. Written 2026-10-03 from the working trees of all three repositories (including uncommitted changes).

Repositories:

| Repo | Role | Tech |
|---|---|---|
| `app-usage-monitoring` | Endpoint Tracker (endpoint agent) | Python 3.12/3.14, `psutil`, `pika`, SQLite outbox, Win32 via `ctypes` |
| `app-usage-monitoring-ui` | Admin portal: React SPA + Express API + RabbitMQ→Mongo worker | React 18 + Vite + Recharts; Node/Express 4; MongoDB driver 7; `amqplib`; AWS SES |
| `app-usage-monitor-agent` | Read-only "AgentOps AI" assistant service (port 3002) | TypeScript, Express 5, OpenAI Responses API via `fetch`, in-process MCP server (`@modelcontextprotocol/sdk`), `zod` |

Infrastructure: MongoDB (db `app-usage-monitoring`), RabbitMQ 4 (docker compose, vhost `app_usage`). No auth provider, no scheduler, no CI, no containers for the apps themselves.

---

## A. Repository Understanding

### A.1 Endpoint Tracker (`app-usage-monitoring/agent`)

- `main.py` — loop: `UsageMonitor.poll()` every `polling_interval_seconds` (config.json: **1 s**), and every `telemetry_interval_seconds` (**10 s**) calls `collect_usage(reset=True)` → `build_payload` → `TelemetryPublisher.submit`.
- `config.py` — loads `monitoring-config.json` (hand-placed file). Each licensed app needs `reclaim_policy`; extensions nested under apps with `identifiers` / `match_all` / `model_signatures`. The agent only *uses* `idle_threshold_seconds`; evaluation window / thresholds are parsed with defaults but unused on the endpoint. That is good — the endpoint is already "dumb telemetry".
- `monitor.py` — the telemetry engine:
  - Foreground PID via `GetForegroundWindow` (Windows); walks parents to the nearest licensed process; falls back to window-title matching for packaged apps.
  - Idle via `GetLastInputInfo` (time since last input only, no keystroke content) with a per-policy grace period → `foreground_runtime_seconds`, `worked_runtime_seconds`, `idle_runtime_seconds`.
  - Extensions/"agents": child processes of the licensed parent matched on cmdline/exe substrings; "agent" type counts only when the process consumed ≥0.1 s CPU since last poll → `automation_worked_seconds`; background automation for non-focused parents → `background_automation_worked_seconds`.
  - URLs: tracked URL patterns matched against the foreground window title → `url:<pattern>` rows.
  - AI tool tokens/models: scans local Codex (`~/.codex`) and Copilot (`%APPDATA%/Code|Cursor/User/globalStorage/github.copilot*`) JSONL logs → `consumed_tokens`, `selected_ai_model`, `token_source`.
- `telemetry_publisher.py` — durable at-least-once delivery: SQLite outbox → RabbitMQ topic exchange `tracker.telemetry`, routing key `telemetry.<tenant>.<device>`, publisher confirms, exponential backoff, bounded outbox. Envelope `{event_id, schema_version:1, tenant_id, device_id, device_name, timestamp(UTC), usage:{device_id, device_name, timestamp(local), usage:[rows]}}`. Unit-tested (`tests/test_telemetry_publisher.py`).
- An event is published every interval even when `usage` is empty, so the event stream is an implicit heartbeat.

### A.2 Portal (`app-usage-monitoring-ui`)

- `server.js` — Express on :3000. Collections: `licensed_apps` (inventory), `onboarded_licenses`, `license_policies`, `deployment_records`, `cost_overrides`, `evaluation_decisions`, `report_settings`, `agent_configurations`, `app_settings`, `telemetry_events`.
  - `GET/PUT /api/state` (`server.js:322`, `:349`) — the whole SPA state is bulk-upserted and **records not in the payload are deleted** for that `X-Client-Id` (`server.js:305`).
  - `GET /api/telemetry` (`server.js:407`) — returns *every* telemetry event, unfiltered.
  - `POST /api/telemetry` — legacy HTTP ingest. `POST /api/assistant/chat` — regex/keyword assistant over Mongo (superseded by the 3002 service). `POST /send-email-summary` — SES.
- `workers/telemetryConsumer.js` + `messaging/telemetryConsumer.js` + `services/telemetryPersistence.js` — RabbitMQ consumer, DLQ for malformed, idempotent upsert keyed by `(device_key, timestamp)` (not `event_id`).
- `src/App.jsx` (6,581 lines) — **all domain logic lives here, in the browser**: onboarding, policies, deployment config generation, evaluation windows, reclaim decisions, cost lookup, email summary. Large parts of the UI (fleet devices, cloud inventory, department costs, usage history, reports) are mock data.
- `src/ChatAssistant.jsx` — chat UI pointed at the 3002 service (`App.jsx:4441`).

### A.3 Assistant service (`app-usage-monitor-agent`)

- `src/openai-assistant.ts` — OpenAI Responses API tool loop: `tool_choice:'required'` first, max 3 rounds, `store:false`, instruction "read-only… never claim to reclaim".
- `src/mcp-tools.ts` — 4 tools registered on an in-memory MCP server and mirrored as OpenAI function schemas (strict, zod-validated input, allow-listed names).
- `src/license-metrics.ts` — direct Mongo reads of `onboarded_licenses` + `evaluation_decisions`, opens a new `MongoClient` per call, classifies "reclaimable" by regex over free text.
- Git history shows an earlier Mastra + GitHub/Linear "governance approved license allocation" workflow that was removed (commit `1ca960f`).

### A.4 Things that do not exist today

Authentication/authorization (anywhere), a server-side evaluation engine, a scheduler, a per-user/per-seat license entity, seat counts/contracts/renewals, departments, reclaim actions/outcomes, config delivery to endpoints, telemetry health, audit log, automated tests outside the publisher.

---

## B. Existing Feature Map

| Capability | Where | How it works today |
|---|---|---|
| Application onboarding | `App.jsx:4087` `handleAddEnterpriseInventoryItem` → `licensed_apps` | Admin enters app name, process name (or URL), monthly cost, owner, type (Application / Extension / Web URL), parent app, subscription type. ID = slug of type+name. |
| License management | `App.jsx:4199` `handleOnboardAppLicense` → `onboarded_licenses` | An "onboarded license" = inventory item + attached policy. **One record per app, not per seat/user.** No seat count, assignee, contract or renewal. |
| Evaluation policies | `App.jsx:3945` `handleRegisterPolicy`, defaults in `src/config/licenseDefaults.js` → `license_policies` | `{name, evaluationWindowValue, evaluationWindowUnit (Minutes/Hours/Days), workedThresholdHours}`. Note `worked_threshold_seconds` is computed with the *window's* unit (`App.jsx:66` → `getPolicyWindowSeconds(policy.workedThresholdHours, policy)`), so a "Days" policy turns 1 "hour" into 1 day. |
| Deployment / endpoint assignment | `App.jsx:3893` `handleDeployAgent`, `buildAgentDeploymentConfig` (`:153`), `buildDeploymentPolicyRecords` (`:226`) → `deployment_records`, `agent_configurations.lastDeploymentConfig` | Generates a `monitoring-config.json` and `deployment_records` (target_pc, assigned_user, app, policy, generated_at). **Nothing is sent to the endpoint** ("saved in UI memory"); the file is copied by hand. |
| Evaluation windows | `App.jsx:853` `getDeploymentEvaluationWindowConfig`, `:887` `getCurrentEvaluationWindow`, `:2428–2471` | One window per PC = **minimum** window of all its policies, anchored at the latest deployment `generated_at`, rolling in fixed periods. Computed in the browser against `Date.now()`. |
| Endpoint agent | `app-usage-monitoring/agent/*` | See A.1. Windows-only in practice: `_get_macos_foreground_pid` / `_get_linux_foreground_pid` are referenced (`monitor.py:1159-1161`) but not defined, and idle returns `0.0` off Windows (never idle). |
| Telemetry | Agent → RabbitMQ → `workers/telemetryConsumer.js` → `telemetry_events` | Raw 10 s samples, no rollups, no retention, no user identity (device only). |
| Reclaimability | `App.jsx:1174` `getReclaimDecision`; completion effect `App.jsx:2512–2612`; persisted via `PUT /api/state` → `evaluation_decisions` | When the browser notices a window has rolled over, it sums `worked_runtime_seconds` (apps) or `automation_worked_seconds` (agent extensions) over the completed window and marks `Active` if ≥ threshold (and tokens ≥ token threshold, default 0) else `Reclaimable`. **It only happens while someone has the dashboard open**, and only for the PC of the latest telemetry event (`currentPcName`). |
| AI assistant | `app-usage-monitor-agent/src/*` | Read-only Q&A over `onboarded_licenses` + `evaluation_decisions`. Tools reference seat fields (`totalSeats`, `assignedSeats`) that onboarding never writes, so availability answers are mostly 0-based. |

---

## C. Current End-to-End Flow

```
[Admin, browser]                         [Portal API :3000]            [Mongo]
 Inventory form ── setLicensedApps ─┐
 Onboard form ── setOnboarded... ───┤  debounced PUT /api/state ──►  licensed_apps, onboarded_licenses,
 Policy form ── setLicensePolicies ─┤  (whole state, per client id)   license_policies, deployment_records,
 Deploy form ── deploymentRecords ──┘                                 agent_configurations
        │
        └─► monitoring-config.json shown in UI ──(manual copy)──► [Endpoint]
                                                                     agent/main.py
                                                                     poll 1s: foreground PID, idle, children, CPU
                                                                     every 10s: usage rows → SQLite outbox
                                                                         │ publisher confirms
                                                                         ▼
                                                              RabbitMQ tracker.telemetry (topic)
                                                                         │ telemetry.#
                                                                         ▼
                                                     workers/telemetryConsumer.js → telemetry_events
        ┌──────────────── GET /api/telemetry every 10 s (entire collection) ◄────────┘
        ▼
 [Browser] evaluationWindow (min policy window, anchored to latest deployment)
        → accumulatedUsage per app → getReclaimDecision → status badge, savings
        → on window rollover: completedEvaluationDecisions → PUT /api/state → evaluation_decisions
        → optional SES summary email (POST /send-email-summary)
                                                                         │
 [ChatAssistant] ── POST :3002/api/assistant/chat ── OpenAI tool loop ── reads onboarded_licenses,
                                                                          evaluation_decisions
```

The decisive architectural fact: **the system of record for reclaimability is produced by a browser tab**. Any agentic layer built on `evaluation_decisions` today inherits that fragility.

---

## D. Gap Analysis

Status legend: IMPLEMENTED · PARTIAL · NOT_IMPLEMENTED · NEEDS_REDESIGN · RESEARCH_REQUIRED. Priority: P0 (blocks the POC or is a correctness/safety issue), P1 (needed for a credible POC), P2 (later phases).

| Capability | Status | Existing Implementation | Gap | Priority |
|---|---|---|---|---|
| Application onboarding | IMPLEMENTED | `handleAddEnterpriseInventoryItem`, `licensed_apps` | No server-side validation; ids are name slugs; client-side only | P2 |
| License entity (seat/user/device) | NEEDS_REDESIGN | `onboarded_licenses` = app+policy; `deployment_records` = PC+user+app | No seat count, no assignee entity, no contract/renewal. "License" for the POC must be modelled as a `(device, app)` assignment derived from `deployment_records` | P0 |
| Evaluation policies | PARTIAL | `license_policies` | Threshold unit bug (worked threshold uses window unit); policies copied by value into licenses (edits don't propagate predictably); no versioning | P1 |
| Evaluation window engine | NEEDS_REDESIGN | Browser `useMemo`/`useEffect` (`App.jsx:2428–2612`) | Must run server-side, per license (not min-per-PC), on a schedule, independent of an open tab | P0 |
| Reclaimability determination | NEEDS_REDESIGN | `getReclaimDecision` | Deterministic rule is fine; location, scope (one PC), evidence snapshot and telemetry-health check are missing. Partial telemetry (e.g. agent offline for 25 of 30 days) ⇒ currently "Reclaimable"; only a window with zero samples is skipped | P0 |
| Endpoint config delivery | NOT_IMPLEMENTED | Manual copy of `monitoring-config.json` | Need pull/push of signed config + config version echoed in telemetry | P1 |
| Foreground/focus telemetry | IMPLEMENTED (Windows) | `monitor.py` foreground + idle | macOS/Linux broken (missing methods); no focus *session* count, no per-day distribution | P1 |
| Idle detection | IMPLEMENTED (Windows) | `GetLastInputInfo` + per-policy grace | Off-Windows reports never idle | P1 |
| Focus sessions / usage distribution | NOT_IMPLEMENTED | — | Agent sends 10 s deltas; sessions and daily distributions can be derived server-side from rollups (no agent change needed) | P1 |
| Historical usage | PARTIAL | Raw `telemetry_events` kept forever | No rollups, no retention, `GET /api/telemetry` returns everything; ~8,640 events/device/day at 10 s | P0 |
| Telemetry health | NOT_IMPLEMENTED | Implicit heartbeat (empty usage events) | Need derived HEALTHY/PARTIAL/STALE/AGENT_OFFLINE/INSUFFICIENT/UNKNOWN per device per window; agent/config version not reported; powered-off vs agent-stopped is indistinguishable | P0 |
| Extension/plugin visibility | PARTIAL | Child-process + CPU heuristics; Copilot/Codex log scanning | Process-match ≠ feature use; Copilot in VS Code runs inside the shared extension host, so `match_all:['--extensionprocess','github.copilot']` is a fragile signal | RESEARCH_REQUIRED |
| AI token telemetry | PARTIAL / defect | `_collect_ai_tool_usage` | `main.py:75` calls `collect_usage` with no window start, so each 10 s sample re-reports the *cumulative* tokens of the last 200 log files and the portal then sums them → tokens massively over-counted. Also reads full log lines locally (may contain prompts) | P0 (fix before using as evidence) |
| Cost intelligence | PARTIAL | `monthlyCost` on inventory, `cost_overrides`, static `app_costs.json`, hard-coded `pricingMap`/fallback costs in `App.jsx` | Fallback/invented costs can appear as real savings; no billing frequency, contract, renewal, seats | P1 |
| Departments / org data | NOT_IMPLEMENTED | Mock arrays in `App.jsx` | Needs a directory/HR source | P2 |
| Reclaim action & outcome | NOT_IMPLEMENTED | Status label only; "Reclaim Resource" button is a no-op on mock cloud data | No action, approval, re-request tracking, realized savings | P1 (record-only), P2 (execution) |
| Investigations / evidence / recommendations | NOT_IMPLEMENTED | — | Core of this proposal | P1 |
| Agent tool layer | PARTIAL | 4 strict, zod-validated, allow-listed tools in `mcp-tools.ts` | Tools read free-text decisions via regex; no usage/health/cost/history tools; new Mongo connection per call | P1 |
| Model abstraction | PARTIAL | Raw `fetch` to OpenAI Responses in one file | Needs a `ModelClient` interface; prompt versioning | P1 |
| Agent budgets / failure handling | PARTIAL | 3-round cap; 502 on error | No token/time/cost budget, no persisted trace, no malformed-output handling | P1 |
| AuthN/AuthZ | NOT_IMPLEMENTED | `X-Client-Id` from localStorage (not auth); CORS only | Any caller can read all telemetry or wipe records via `PUT /api/state`. Required before any non-local deployment and before any action APIs | P0 for production, P1 for local POC |
| Audit trail | NOT_IMPLEMENTED | `updated_at`, `source_client_id` | Need append-only audit for decisions, approvals, agent runs | P1 |
| Human-in-the-loop approval | NOT_IMPLEMENTED | Assistant text says "require approval" | Approval entity + API + UI | P1 |
| Feedback loop / metrics | NOT_IMPLEMENTED | — | Outcomes, re-request rate, false-positive rate | P2 |
| Policy intelligence | NOT_IMPLEMENTED | — | Depends on outcomes data | P2 |
| Duplicate/overlap detection | NOT_IMPLEMENTED | Data partly present (Cursor/Code/IDEA + Copilot rows on one device) | Needs capability taxonomy + per-user view across apps | P2 |
| Telemetry dedup by `event_id` | PARTIAL | Dedup on `(device_key, timestamp)` | Contract already carries `event_id`; switch index | P1 |
| Privacy controls | PARTIAL | Only metadata leaves the device; no keystrokes/screens | Window titles and child cmdlines read locally; AI logs read locally; no retention, no employee-facing transparency, no access control on telemetry | P1 |

---

## E. Proposed Target Architecture

Principle: **add, don't replace**. The deterministic evaluation engine becomes a server-side service; the AI layer sits *beside* it, reads its outputs as evidence, and can only *propose*.

```
Endpoint Tracker (unchanged contract, small fixes)
   │  RabbitMQ tracker.telemetry  (existing)
   ▼
Telemetry consumer (existing worker) ──► telemetry_events (raw, TTL e.g. 30–90 d)
   │
   ▼
[NEW] Rollup job (same worker process) ──► usage_hourly / usage_daily per (device, app)
                                         ──► device_health_daily (sample coverage, last_seen, gaps)
   │
   ▼
[NEW, portal server] Evaluation service  (port of getReclaimDecision + window logic, deterministic)
   ──► evaluation_decisions  (+ evidence snapshot, policy version, telemetry health at decision time)
   │
   ▼
[NEW, portal server] Evidence API  /api/v1/... read-only, typed, filtered, paginated
   │                     (the ONLY way the agent service reads data)
   ▼
app-usage-monitor-agent  (evolves into the Software Asset Optimization Agent service)
   ├─ ModelClient interface  (OpenAI Responses impl today; replaceable)
   ├─ Tool registry          (zod in/out schemas, allow-list, per-tool budget, result size cap)
   ├─ Orchestrator           (bounded loop, budgets, trace persistence)
   ├─ Output schema + Guardrails (deterministic post-validation, savings recomputed, risk rules)
   └─ writes via portal API: investigations, investigation_steps, recommendations
   ▼
[NEW, portal] Approval API + UI  ──► approvals, audit_log
   ▼
(later) Action API (deterministic, idempotent) ──► reclaim_actions ──► outcomes ──► feedback metrics
```

Key decisions and trade-offs:

1. **Move evaluation server-side first (prerequisite, not AI work).** The agent must reason over authoritative, reproducible decisions. Port `getReclaimDecision`, window maths and counters into a shared module (`services/evaluation/*.js`) used by a scheduled job in the portal worker; the SPA then *reads* decisions. Keep the SPA's live "Evaluating" view, but it no longer writes `evaluation_decisions`.
2. **Where the agent lives:** evolve `app-usage-monitor-agent` rather than adding AI to `server.js`. It already isolates the model dependency, has strict tool schemas and an allow-list. Trade-off: one more service to run; benefit: model keys, prompts and cost controls stay out of the main API, and it can be scaled/disabled independently.
3. **Agent reads through a portal Evidence API, not Mongo.** Today `license-metrics.ts` queries Mongo with regex. Routing through the portal gives one place for authorization, field minimization and audit. Trade-off: extra hop and endpoints to write; acceptable because the endpoints are also needed by the UI (replacing `GET /api/telemetry`-everything). Interim option for speed: read-only Mongo user + typed query functions inside the agent service, migrated later. Recommendation: Evidence API from the start for the handful of POC endpoints.
4. **No new infrastructure.** Investigations run as async in-process jobs in the agent service, with state in Mongo. RabbitMQ is available if/when a work queue is justified (Phase 5 fan-out). No vector DB, no multi-agent framework.
5. **Single agent, specialized tools** (as the vision recommends). The earlier Mastra experiment is not needed for the POC; the existing hand-rolled loop is ~70 lines and fully observable.
6. **Deterministic guardrails own every number and every permission.** The model chooses which evidence to inspect and interprets it; savings, health, thresholds, approval requirements and allowed recommendation types are computed/enforced in code.

---

## F. POC — "Investigate License" Vertical Slice

### F.1 Scope and explicit assumptions

- "License" = a **license assignment**: one `deployment_records` row of type `application` or `agent` → `(target_pc, assigned_user, app_name, parent_app)`. There is no seat entity today; the POC introduces a read model over `deployment_records`, not a new onboarding flow.
- Depends on Milestones M0–M2 (server-side evaluation, rollups, telemetry health). Without them the agent would only be re-reading browser-produced decisions.
- No reclamation, no user contact, no policy change. Output is a report + a pending approval record that an admin can accept/reject (accept = "recorded decision", not an action).
- Model: whatever `OPENAI_MODEL` is configured (currently `gpt-5-mini`), behind `ModelClient`.

### F.2 Domain model (new Mongo collections)

```ts
// license_assignments (read model, rebuilt from deployment_records)
{ _id: "asg_<hash(target_pc,type,parent_app,app_name)>", target_pc, assigned_user, app_name,
  type: "application"|"agent", parent_app|null, license_id: <onboarded_licenses.id>,
  policy_name, policy_snapshot, monthly_cost, cost_source: "inventory"|"override"|"catalog"|"unknown",
  assigned_at }

// investigations
{ _id: "INV-000123", subject: { kind: "license_assignment", id: "asg_..." },
  objective: string, trigger: "manual"|"evaluation_completed",
  status: "QUEUED"|"RUNNING"|"COMPLETED"|"NEEDS_HUMAN_REVIEW"|"FAILED",
  requested_by, created_at, started_at, completed_at,
  model: { provider, name }, prompt_version: "investigate-license@1",
  budget: { max_tool_calls, max_rounds, max_ms, max_input_tokens, max_output_tokens },
  usage: { tool_calls, rounds, input_tokens, output_tokens, est_cost_usd },
  failure: { code, message } | null,
  recommendation_id | null }

// investigation_steps (append-only trace; one doc per model turn / tool call)
{ investigation_id, seq, kind: "model_turn"|"tool_call"|"guardrail"|"error",
  tool?: { name, args, result_ref, result_digest, duration_ms, status },
  model?: { response_id, input_tokens, output_tokens, finish_reason },
  note?: string,           // model-declared plan/hypothesis text — stored as INTERPRETATION
  at }

// evidence (facts returned by tools — immutable, referenced by id)
{ _id: "EV-…", investigation_id, tool_call_seq, type: "FOCUS_USAGE"|"USAGE_HISTORY"|
  "ALT_APP_USAGE"|"EXTENSION_USAGE"|"TELEMETRY_HEALTH"|"POLICY"|"COST"|"PRIOR_DECISIONS",
  period: { from, to }, data: {...}, source: "deterministic" }

// recommendations
{ _id, investigation_id, subject, recommendation: "RECLAIM_CANDIDATE"|"RETAIN"|"EXTEND_EVALUATION"
  |"INSUFFICIENT_EVIDENCE"|"NEEDS_HUMAN_REVIEW",
  model_recommendation,              // what the model proposed, before guardrails
  confidence, risk: "LOW"|"MEDIUM"|"HIGH",
  findings: [{ statement, supporting_evidence_ids[], contradicting_evidence_ids[] }],
  hypotheses: [{ statement, status: "SUPPORTED"|"REJECTED"|"UNRESOLVED" }],
  missing_evidence: [string], risks: [string], suggested_next_action: string,
  suggested_extension_days|null,
  potential_saving: { monthly, annual, currency, cost_source },   // computed in code
  guardrail_results: [{ rule, outcome: "PASS"|"ADJUSTED"|"BLOCKED", detail }],
  requires_approval: true, approval_id }

// approvals
{ _id, recommendation_id, status: "PENDING"|"APPROVED"|"REJECTED"|"EXPIRED",
  decided_by, decided_at, comment }

// audit_log (append-only)
{ at, actor: {type:"user"|"agent"|"system", id}, action, target, details }
```

Verified facts (`evidence`) are kept separate from model interpretation (`notes`, `findings.statement`, `hypotheses`). Historical case memory later reads `evidence` + `approvals` + outcomes, never past model prose as fact.

### F.3 Supporting deterministic data (Milestones M1–M2)

- `usage_daily { device_id, app_name, date, foreground_s, worked_s, idle_s, automation_s, bg_automation_s, samples, tokens_delta }` built from `telemetry_events`.
- Focus sessions derived server-side: consecutive samples with `worked_s>0` for an app, gap > N minutes ends a session.
- `device_health_daily { device_id, date, expected_samples, received_samples, coverage, first_seen, last_seen, max_gap_s, agent_version?, config_version? }`.
- Health classification (pure function, unit-tested), for a period:
  - `UNKNOWN` – device never reported. `AGENT_OFFLINE` – no event in last 24 h. `STALE` – last event older than the period end minus 2 days.
  - `INSUFFICIENT` – reporting days < `policy.minimum_observation_seconds` (already exists in agent `ReclaimPolicy`, default 7 days). `PARTIAL` – active-day coverage < threshold. `HEALTHY` otherwise. `CORRUPTED` reserved for schema/validation failures (DLQ count).
  - Caveat to state in reports: a powered-off laptop and a stopped agent look identical until the agent reports boot/session events.

### F.4 APIs

Portal (`server.js`, new router `routes/v1/*.js`):

```
GET  /api/v1/assignments?app=&pc=&status=           list license assignments
GET  /api/v1/assignments/:id                        assignment + policy + cost
GET  /api/v1/usage/daily?device=&app=&from=&to=     usage_daily rows (max 400 days)
GET  /api/v1/usage/sessions?device=&app=&from=&to=  derived focus sessions summary
GET  /api/v1/usage/apps?device=&from=&to=           all apps on a device (alt-app evidence)
GET  /api/v1/devices/:id/health?from=&to=           health classification + coverage
GET  /api/v1/decisions?assignment=                  evaluation_decisions history
POST /api/v1/investigations                         { subjectId } → 202 { id }   (proxies to agent svc)
GET  /api/v1/investigations/:id                     report incl. steps summary
GET  /api/v1/investigations?subject=                list
POST /api/v1/approvals/:id/decision                 { decision: APPROVED|REJECTED, comment }
```

Agent service (internal only, service-token protected):

```
POST /internal/investigations          { investigationId }  → starts job
GET  /health
```

### F.5 Agent tools (POC set — each maps to a real endpoint)

| Tool | Backed by | Input (zod, strict) | Output (capped) |
|---|---|---|---|
| `get_license_assignment` | `/assignments/:id` | `{assignmentId}` (bound to the investigation subject) | app, type, parent, user label, policy, monthly cost, cost_source |
| `get_evaluation_policy` | assignment.policy_snapshot | `{assignmentId}` | window, thresholds, min observation |
| `get_usage_summary` | `/usage/daily` + `/usage/sessions` | `{appName, period: "30d"\|"90d"\|"180d"\|"365d"}` | totals, active days, session count, last active, weekly series (≤ 53 points) |
| `get_device_app_usage` | `/usage/apps` | `{period}` | other licensed/known apps on the same device with focus minutes (alt-app/migration evidence) |
| `get_extension_usage` | `/usage/daily` for extension rows | `{extensionName, period}` | automation seconds, active days, `tokens_delta`, `token_source`, a `signal_reliability` label |
| `get_telemetry_health` | `/devices/:id/health` | `{period}` | state, coverage, last_seen, gaps |
| `get_decision_history` | `/decisions` | `{}` | prior deterministic decisions for this assignment |
| `get_license_cost` | assignment cost fields | `{}` | monthly cost + `cost_source` (agent is told `catalog`/`unknown` is unreliable) |
| `submit_investigation_report` | terminal tool | strict JSON schema (F.7) | — ends the loop |

Tool rules: device/assignment ids are **injected by the orchestrator from the investigation subject**, never taken from model arguments (scope restriction). Unknown tool names → recorded as `HALLUCINATED_TOOL` step and the model is told it is unavailable. Every result is persisted as `evidence` and the model receives the evidence id with the data so it can cite it.

`get_previous_reclaim_events`, department usage, contact-user and action tools are deliberately **not** in the POC — the data/action does not exist yet.

### F.6 Orchestration

```
startInvestigation(id):
  inv = load(id); assert status == QUEUED; set RUNNING
  ctx = { subject, evidence: [], steps: [], budget }
  messages = [system(prompt v1), user(objective + subject summary + available periods)]
  loop while within budget:
     resp = modelClient.respond({ messages, tools, toolChoice: round==0 ? "required" : "auto" })
     record model_turn (tokens, response id)
     if resp has submit_investigation_report call → break
     for each tool call (max N per turn):
        if not allow-listed → record HALLUCINATED_TOOL, return error message to model
        validate args (zod) → on failure return validation error (counts toward budget)
        run tool with timeout → persist evidence → append result {evidence_id, data}
     if no tool calls and no report → one nudge "submit a report or call a tool"; second time → NEEDS_HUMAN_REVIEW
  if budget exhausted → status NEEDS_HUMAN_REVIEW, recommendation INSUFFICIENT_EVIDENCE (deterministic fallback)
  report = parse + validate schema (one repair attempt on malformed output, else NEEDS_HUMAN_REVIEW)
  final = guardrails(report, ctx.evidence)          // deterministic
  persist recommendation + PENDING approval + audit entries; status COMPLETED
```

POC budgets (env-configurable): `MAX_TOOL_CALLS=12`, `MAX_ROUNDS=8`, `MAX_INVESTIGATION_MS=90000`, `MAX_INPUT_TOKENS=60000`, `MAX_OUTPUT_TOKENS=4000`, per-tool timeout 5 s, per-tool result cap ~4 KB. Concurrency cap of 2 running investigations; one active investigation per subject (idempotent POST returns the existing one).

Guardrails (code, run after the model):

1. Every `supporting_evidence_ids` / `contradicting_evidence_ids` must exist in this investigation → otherwise finding is dropped and flagged.
2. Telemetry health ∉ {HEALTHY} ⇒ `RECLAIM_CANDIDATE` is downgraded to `INSUFFICIENT_EVIDENCE` (or `EXTEND_EVALUATION`), confidence capped at 0.5.
3. Required evidence for `RECLAIM_CANDIDATE`: usage summary for ≥ policy window, telemetry health, policy. Missing ⇒ downgrade.
4. `potential_saving` recomputed from `monthly_cost` × 12; if `cost_source` is `catalog`/`unknown`, saving is marked `ESTIMATED` and risk floor is MEDIUM.
5. Model's recommendation must be consistent with the deterministic decision *or* include contradicting-evidence rationale; disagreement is surfaced, not hidden ("Policy says Reclaimable; agent recommends EXTEND because …").
6. `requires_approval` forced `true`; no action tools exist.
7. Confidence clamped to [0,1]; the report stores both model and final values.

### F.7 Prompt (v1) and structured output

System prompt `investigate-license@1` (stored in repo, version recorded per investigation):

```
You are the Software Asset Optimization Agent for an enterprise license platform.
Objective: determine whether ONE license assignment is a reasonable reclamation candidate.

Rules:
- You can only gather evidence through the provided tools. Tool results are facts; your conclusions are interpretations.
- Plan before acting: state your initial hypotheses, then call the tools that would confirm or refute them.
  Choose tools based on what you have learned so far; you do not need to call every tool.
- Distinguish "no usage observed" from "no evidence": always check telemetry health before concluding that
  low usage means the license is unused.
- Consider alternative explanations: migration to another tool, seasonal/project-cycle usage, recent
  assignment, extension usage inside a free host application.
- Do not compute money; the platform computes savings. Do not invent data, users, or tools.
- You cannot reclaim, contact users, or change policies. Never say an action was taken.
- Cite evidence ids for every finding. List contradicting evidence and missing evidence explicitly.
- Finish by calling submit_investigation_report exactly once.
The data describes software utilisation, not employee performance. Do not comment on individuals' productivity.
```

`submit_investigation_report` schema (strict JSON Schema, mirrored in zod):

```json
{
  "recommendation": "RECLAIM_CANDIDATE | RETAIN | EXTEND_EVALUATION | INSUFFICIENT_EVIDENCE | NEEDS_HUMAN_REVIEW",
  "confidence": 0.0,
  "summary": "≤ 600 chars",
  "hypotheses": [{ "statement": "", "status": "SUPPORTED | REJECTED | UNRESOLVED" }],
  "findings": [{ "statement": "", "supporting_evidence_ids": ["EV-…"], "contradicting_evidence_ids": [] }],
  "missing_evidence": [""],
  "risks": [""],
  "risk_level": "LOW | MEDIUM | HIGH",
  "suggested_extension_days": null,
  "suggested_next_action": ""
}
```

### F.8 UI

- New component `src/components/InvestigationPanel.jsx` (do **not** grow `App.jsx` further); a thin API client `src/api/investigations.js`.
- Entry point: an "Investigate with AI" action on each row of the license usage table (`App.jsx` around line 5035, `sortedUsageByApp`), enabled only when a matching `license_assignment` exists.
- Panel layout: header (INV id, status, model, duration, tool calls) → Recommendation card (final vs model recommendation, confidence, risk, potential saving with `ESTIMATED` badge) → Findings with expandable supporting/contradicting evidence (rendered from `evidence.data`, not model text) → Hypotheses → Missing evidence → Guardrail adjustments → Approve / Reject with comment → collapsible "Investigation trace" (tool sequence with timings).
- Polls `GET /api/v1/investigations/:id` every 2 s while RUNNING.

### F.9 Security & privacy

- Agent service: binds to localhost/internal network; requires `AGENT_SERVICE_TOKEN` from the portal; no CORS for `/internal/*`.
- Portal v1 routes: interim `ADMIN_API_TOKEN` (header) for the POC; real OIDC (e.g. Entra ID) + roles (`viewer`, `analyst`, `approver`) is a pre-production milestone. Approvals record the authenticated actor.
- Data minimization to the model: user shown as `assigned_user` display label only (no email), device as id; no window titles, URLs beyond configured patterns, or raw log content. Token counts only.
- Rate limit `POST /investigations` (e.g. 10/min per admin) and the concurrency cap above.
- OpenAI `store:false` retained; prompts and tool results persisted in our Mongo, not relied on from the provider.
- Model output is never interpolated into queries; all tool inputs pass zod; ids come from the subject.

### F.10 Audit trail

`audit_log` entries for: investigation requested, started, each guardrail adjustment, completed/failed, approval decided. `investigation_steps` gives the full machine trace (tool, args, evidence id, durations, tokens). Together these answer "what did the agent look at, what did it conclude, what did code change, who approved".

### F.11 Failure handling

| Failure | Behaviour |
|---|---|
| Model unavailable / 5xx / timeout | Retry ×2 with backoff; then `FAILED` with `MODEL_UNAVAILABLE`; deterministic decision still shown |
| Malformed final report | One repair turn; then `NEEDS_HUMAN_REVIEW` |
| Hallucinated tool / bad args | Step recorded, error returned to model, counts toward budget |
| Tool failure / timeout | Step recorded; model told evidence unavailable; listed as missing evidence |
| Stale/insufficient telemetry | Guardrail 2 — never a reclaim candidate |
| Budget/time exceeded | `NEEDS_HUMAN_REVIEW` + `INSUFFICIENT_EVIDENCE` |
| Repeated identical tool calls | Orchestrator returns cached evidence id; 3 repeats ⇒ stop (circularity) |
| Service restart mid-run | On boot, `RUNNING` older than `MAX_INVESTIGATION_MS` ⇒ `FAILED (INTERRUPTED)` |
| Approval timeout | `EXPIRED` after N days (no action either way) |

No failure path can create an action, because no action API exists in the POC.

### F.12 Tests

No test runner exists in the Node repos; use the built-in `node:test` (no new dependency).

- Portal: unit tests for the ported evaluation engine (parity cases taken from current `getReclaimDecision` behaviour), rollup builder, session derivation, health classifier (offline/stale/partial/insufficient boundaries), v1 route validation.
- Agent service: `FakeModelClient` scripting turns to test — happy path; hallucinated tool; malformed report + repair; budget exhaustion; tool timeout; guardrail downgrade when health=STALE; evidence-id validation; idempotent start; subject-scoped ids ignore model-supplied ids.
- Tracker (Python `unittest`): token delta fix; platform guard for macOS/Linux.
- Manual acceptance scenario with seeded data: the "John" case (IntelliJ 3 min, VS Code 4,320 min, Copilot 0) and a seasonal spike case.

### F.13 Acceptance criteria

1. Admin clicks "Investigate with AI" on an assignment → an `INV-…` is created and completes in < 90 s typically.
2. Report shows recommendation, confidence, risk, findings with clickable evidence, contradicting and missing evidence, computed saving.
3. With the agent stopped for the window, the result is never `RECLAIM_CANDIDATE`.
4. Every finding cites evidence that exists; trace shows every tool call.
5. No license state changes occur from an investigation; approve/reject only records a decision with actor and timestamp.
6. Killing the model key mid-run yields `FAILED` with a clear message; the dashboard still works.

---

## G. Implementation Roadmap

Each milestone is a shippable, testable slice. M0–M3 constitute the "Investigate License" POC.

| # | Milestone | Objective / business value | Main changes | Tests / acceptance |
|---|---|---|---|---|
| **M0** | Evidence correctness & hygiene | Make telemetry trustworthy before reasoning over it | Tracker: report per-interval token **deltas** (pass window start / track per-file offsets); make non-Windows explicit (implement or fail fast instead of missing methods). Portal: dedup on `event_id` (unique index); fix worked-threshold unit bug; `GET /api/telemetry` gains `device/from/to/limit`. Remove invented fallback costs from savings totals (show "cost unknown"). | Python tests for token deltas; node tests for persistence dedup; savings no longer include fallback prices |
| **M1** | Server-side deterministic evaluation | Reclaimability becomes authoritative, reproducible, independent of a browser | `services/evaluation/` (ported logic), per-assignment windows, scheduled job in the worker; `license_assignments` read model; `evaluation_decisions` gains evidence snapshot + policy snapshot; SPA reads decisions (stops writing them via `PUT /api/state`) | Parity tests vs current rule; decision created with no browser open |
| **M2** | Rollups & telemetry health | Historical evidence and "insufficient evidence" as a first-class outcome | `usage_daily`, sessions, `device_health_daily`, health classifier; health check added to M1 rule (unhealthy ⇒ `Insufficient evidence`, not `Reclaimable`); raw telemetry TTL; v1 read endpoints; UI shows health per device | Health boundary tests; stopped-agent scenario no longer yields Reclaimable |
| **M3** | AI License Review POC (Phase 3 + early Phase 4) | First explainable AI investigation, admin-approved | Agent service: `ModelClient`, tool registry, orchestrator, guardrails, trace; portal: investigation/approval routes, collections, audit_log, `ADMIN_API_TOKEN`; UI `InvestigationPanel` | F.12 / F.13 |
| **M4** | Config delivery & endpoint telemetry v2 | Close the deploy loop; richer, reliable signals | Signed config pulled by the Tracker (HTTPS) or pushed over RabbitMQ per device; telemetry carries `agent_version`, `config_version`, boot/session heartbeat; telemetry interval to 60 s; research spike on reliable extension signals (VS Code extension host, vendor seat APIs e.g. GitHub Copilot seat activity) | Config round-trip test; health can distinguish powered-off vs agent-stopped |
| **M5** | Outcomes & feedback | Measure whether recommendations were right | `reclaim_actions` (recorded manually at first), re-request capture, `RECLAIM_OUTCOME`, metrics: acceptance rate, re-request rate, false-positive rate, realized savings; `get_previous_reclaim_events` tool | Outcome metrics computed from seeded cases |
| **M6** | Find Optimization Opportunities (Phase 5) | Goal-directed, portfolio-level investigation | Aggregate tools (app utilization distribution, spend vs utilization, overlap candidates by capability tag), parent investigation that spawns child license investigations within budget; opportunity report | Scripted-model tests for planning/fan-out caps; report ranks by computed savings |
| **M7** | Cost & policy intelligence | Contracts, renewals, policy tuning suggestions | Contract/seat/renewal fields on licenses; policy-effectiveness analysis over outcomes; agent suggests policy changes as recommendations (never applied automatically) | Policy suggestion requires approval and creates no policy change |
| **M8** | Production hardening | Safe for real tenants | OIDC + RBAC, tenant isolation (the envelope already has `tenant_id`), secrets management, retention config, employee transparency notice, DPIA inputs | Security review; authorization tests on every route |
| **M9** | Controlled autonomy (Phase 6) | Low-risk actions auto-executed under explicit deterministic policy | Action API (idempotent, reversible), autonomy policy engine, kill switch | Only after M5 metrics show acceptable false-positive rate |

Suggested first coding step after you approve this document: **M0** (small, isolated, removes a real data-quality defect), then **M1**.

---

## Appendix — Defects found during discovery (not yet fixed)

1. Token over-counting: `agent/main.py:75` calls `collect_usage(reset=True)` without a window start, so `_collect_ai_tool_usage` (`monitor.py:417`) re-sums all recent log tokens every interval; the portal sums them again (`App.jsx` `accumulatedUsage`).
2. `_get_macos_foreground_pid` / `_get_linux_foreground_pid` are called but undefined (`monitor.py:1159-1161`) → `AttributeError` on non-Windows; non-Windows idle is always 0.
3. Worked threshold unit: `buildPortalReclaimPolicy` converts `workedThresholdHours` with the *window* unit (`App.jsx:66`).
4. Evaluation decisions are written only by an open browser tab and only for the latest telemetry PC (`App.jsx:2512`).
5. `PUT /api/state` deletes any records of that client id not present in the payload (`server.js:305`); unauthenticated.
6. `GET /api/telemetry` returns the full collection on every 10 s poll (`server.js:407`, `App.jsx:4337`).
7. Partial telemetry yields `Reclaimable` — there is no health check in `getReclaimDecision` (`App.jsx:1174`); the completion effect only skips windows with zero samples (`App.jsx:2541`).
8. Assistant tools read seat fields (`totalSeats`, `assignedSeats`) that onboarding never writes (`app-usage-monitor-agent/src/license-metrics.ts`).
9. `buildReclaimPolicy(extension.policy, { includeTokenThreshold: true })` passes an option the function ignores (`App.jsx:203`).
