# Vendor APIs for the recognised apps

What each app's admin API offers, how the portal signs in to it (Connect
dialog), which endpoints the portal calls, and what it uses them for.

**Status** column:
- **Live data**: the portal pulls this vendor's data once connected: AI tools on the AI Tools page (`services/aiTools/<vendor>.js`), the others on their Reports & Insights > End User Apps dashboard (`services/reports/licenseConnectors.js`). Until then the dashboard shows sample data in the same response format.
- **Credential check**: Connect checks and stores the credential; its data is not pulled in yet.
- **Stored, unchecked**: no call could be confirmed, so the credential is stored with a warning.
- **No admin API**: nothing to connect; the Tracker's measurements on each PC are the only data.

**Verified** column: *docs* = checked against the vendor's documentation;
*live* = a real call was made (with a fake credential, the vendor answered with
its own authentication error); *integrator docs* = only third-party integration
guides were available.

## Summary

| App | Admin API | Sign-in (Connect dialog) | Status |
|---|---|---|---|
| Claude | Anthropic Admin API | Admin API key `sk-ant-admin…` | Live data |
| Codex | Codex Analytics API (ChatGPT Enterprise) | Workspace-scoped admin key + workspace ID | Live data (route unverified) |
| GitHub Copilot | GitHub REST API (Copilot) | Sign in with GitHub (OAuth app) or org-owner token | Live data |
| Slack | Slack Web API, admin methods | Admin user token `xoxp-…` | Live data |
| Zoom | Zoom REST API v2 | Server-to-Server OAuth app credentials | Live data |
| Cursor | Cursor Admin API | Team Admin API key | Credential check |
| Figma | Figma REST API | Org admin personal access token | Live data |
| Postman | Postman API | Team admin API key | Live data |
| Docker Desktop | Docker Hub API | Username + personal access token + org | Live data |
| ChatGPT | ChatGPT Enterprise admin/analytics API | Workspace-scoped admin key + workspace ID | Stored, unchecked |
| IntelliJ IDEA | JetBrains Account API | Customer code + API token | Live data (route unverified; stored unchecked) |
| Visual Studio Code | None (free) | — | No admin API |
| Visual Studio | None public (Visual Studio Subscriptions admin portal) | — | No admin API |

## Details

### Claude: Anthropic Admin API (live data)
- **Base:** `https://api.anthropic.com`. **Auth:** header `x-api-key: sk-ant-admin…`, plus `anthropic-version: 2023-06-01`. Org admins create admin keys in the Anthropic Console.
- **Endpoints used:**

| Endpoint | Used for |
|---|---|
| `GET /v1/organizations/users` (cursor `after_id`, `limit` ≤ 1000) | Members: email, name, role. Seat list and email matching |
| `GET /v1/organizations/cost_report` (`bucket_width=1d`, `limit` ≤ 31) | Daily spend. Amounts are **cents as decimal strings** |
| `GET /v1/organizations/usage_report/claude_code?starting_at=YYYY-MM-DD` (one day per call) | Per-user Claude Code sessions, lines added/removed, commits, PRs, tool accept/reject, estimated cost (cents). Activity, idle seats, month-to-date spend |

- **Doesn't cover:** claude.ai chat use (only Claude Code). **Verified:** docs, live (fake key → `invalid x-api-key`).
- Docs: https://platform.claude.com/docs/en/api/admin-api

### Codex: Codex Analytics API (live data, route unverified)
- **Base:** `https://api.chatgpt.com` (configurable). **Auth:** `Authorization: Bearer <admin key>`. A workspace-scoped admin key with `codex.enterprise.analytics.read`; some workspaces need OpenAI Support to apply that scope.
- **Endpoint used:** `GET /v1/analytics/codex/workspaces/{workspace_id}/usage?start_date&end_date`. Per user per day: threads, turns, credits, tokens (uncached/cached input, output), by model and client. Used for activity, credits, month-to-date spend, idle users.
- **Verified:** integrator docs only. OpenAI's reference (chatgpt.com/public/admin/api-reference) isn't publicly fetchable. Check the route and field names on the first live call; the route can be changed with `-CodexAnalyticsUrl` or in the dialog.

### GitHub Copilot: GitHub REST API (live data)
- **Base:** `https://api.github.com`. **Auth:** `Authorization: Bearer <token>`, `X-GitHub-Api-Version: 2026-03-10`. Org owner or billing manager; scopes `manage_billing:copilot` or `read:org`. The OAuth sign-in asks for `manage_billing:copilot read:org`.
- **Endpoints used:**

| Endpoint | Used for |
|---|---|
| `GET /orgs/{org}/copilot/billing` | Seat breakdown (total, active/inactive this cycle, pending), plan type |
| `GET /orgs/{org}/copilot/billing/seats` (`page`, `per_page` ≤ 100) | Per seat: login, `last_activity_at`, editor, plan. Idle seats |
| `GET /orgs/{org}/copilot/metrics/reports/users-28-day/latest` | Signed `download_links` to the per-user report (fetched **without** the token): interactions, generations, acceptances, lines, `ai_credits_used`, `used_agent`, `totals_by_feature`. Gives accept rate, credits, consumption pattern, agentic index. Needs the "Copilot usage metrics" policy |
| `POST` / `DELETE /orgs/{org}/copilot/billing/selected_users` | Not used yet. Would let approvals assign seats and reclaims remove them |

- **Doesn't cover:** emails (seats are GitHub logins; map them with the login=email list), invoices (spend is estimated from seats × list price). **Verified:** docs.
- Docs: https://docs.github.com/en/rest/copilot

### Slack: Web API admin methods (live data)
- **Auth:** `Authorization: Bearer xoxp-…`. An admin user token from an app installed **org-wide** by an Enterprise Grid Org Owner or Admin, with the `admin` scope.
- **Check:** `POST https://slack.com/api/auth.test`. **Verified:** live (fake token → `invalid_auth`).
- **Endpoints used:**

| Endpoint | Used for |
|---|---|
| `users.list` (cursor paging) | Members: name, email. Bots, Slackbot and deactivated users left out |
| `team.billableInfo` | Billable seats (`billing_active`). One Slack page marks it deprecated, so confirm on the first live call |
| `admin.analytics.getFile?type=member&date=YYYY-MM-DD` (one gzipped NDJSON file per day, 30 calls) | Per member per day: `is_active`, `messages_posted_count`. Active members, billable-but-inactive seats. Days not ready yet (`file_not_yet_available`) are skipped; rate limits (429) are retried |

- **Needs:** Enterprise Grid, `admin.analytics:read`. **Verified:** docs; analytics field names unverified until a live call.

### Zoom: REST API v2 (live data)
- **Auth:** Server-to-Server OAuth. `POST https://zoom.us/oauth/token` with `grant_type=account_credentials&account_id=…` and Basic auth (client ID:secret) returns a 1-hour token with no refresh. An account admin must allow the app.
- **Check:** token, then `GET https://api.zoom.us/v2/users?page_size=1`. With Server-to-Server apps, `me` isn't available; use user IDs or emails. **Verified:** docs.
- **Endpoints used:**

| Endpoint | Used for |
|---|---|
| `GET /v2/users?status=active&page_size=300` (`next_page_token` paging) | Users: licence type (`type` 2 = Licensed, 1 = Basic), `last_login_time`, department, client version. Licensed users with no sign-in for 30+ days |
| `GET /v2/report/daily?year&month` (this month and last, trimmed to 30 days) | Meetings, participants and meeting minutes per day |

- **Needs:** scopes to read users and `report:read:admin`. **Verified:** docs; daily report field names unverified until a live call.

### Cursor: Admin API (credential check)
- **Auth:** Basic auth with the **team Admin API key** as the username and an empty password. A team admin creates it in the dashboard (Business/Enterprise).
- **Check:** `GET https://api.cursor.com/teams/members`. **Verified:** docs, live (fake key → `Invalid Team API Key`).
- **For a data connector:** members, daily usage, spend (similar to Claude Code).

### Figma: REST API (live data)
- **Auth:** header `X-Figma-Token: <personal access token>`, from an org admin. Tokens expire after at most 90 days, so plan for renewal.
- **Check:** `GET https://api.figma.com/v1/me`. **Verified:** live (fake token → `Invalid token`). Expiry rule from integrator docs.
- **Endpoints used:**

| Endpoint | Used for |
|---|---|
| `GET /v1/activity_logs?start_time&limit=1000&order=asc` (cursor paging) | File activity per person and day; last activity; paid seats with no activity. Needs Enterprise and an org admin token with `org:activity_log_read` |
| SCIM `GET https://www.figma.com/scim/v2/{tenant_id}/Users` (optional SCIM tenant ID + SCIM token in the Connect dialog) | Seats and seat type (Full, Dev, Collab, View) from the Figma SCIM extension. Without SCIM, seats are the people seen in the activity log and the type shows as Unknown |

- **Verified:** docs for both endpoints; the SCIM seat-type attribute and activity log fields are unverified until a live call.

### Postman: Postman API (live data)
- **Auth:** header `X-API-Key: PMAK-…`, a team admin's key.
- **Check:** `GET https://api.getpostman.com/me`. **Verified:** live (fake key → `Invalid API Key`).
- **Endpoints used:**

| Endpoint | Used for |
|---|---|
| `GET /users` | Team members: name, email, roles, joined date |
| `GET /audit/logs?since&until&limit=300` (cursor paging) | Changes per person and day; members with no activity in 30 days. Enterprise plans |

- **Verified:** `/users` from integrator docs, `/audit/logs` from docs; field names unverified until a live call.

### Docker Desktop: Docker Hub API (live data)
- **Auth:** `POST https://hub.docker.com/v2/auth/token` with `{ identifier: <username>, secret: <personal access token> }` returns a short-lived JWT, sent as `Authorization: Bearer`. SSO-enforced orgs need a PAT.
- **Check:** token, then `GET https://hub.docker.com/v2/orgs/{org}/members?page_size=1`. **Verified:** docs (token exchange); the members path still needs a live confirmation.
- **Endpoint used:** `GET /v2/orgs/{org}/members?page_size=100` (all pages): members (seats), role, teams, last sign-in. `last_seen_at` and `last_desktop_version` depend on the plan's insights; when missing, last sign-in stands in and the version shows as Unknown.

### ChatGPT: ChatGPT Enterprise admin/analytics API (stored, unchecked)
- **Auth:** workspace-scoped OpenAI admin key + workspace ID. The daily usage analytics endpoint needs `enterprise.analytics.usage.read`; `codex.enterprise.analytics.read` doesn't grant it.
- **Check:** none. The reference isn't publicly readable, so the credential is stored with a warning.

### IntelliJ IDEA: JetBrains Account API (live data, route unverified)
- **Auth:** headers `X-Customer-Code` and `X-Api-Key` (a personal API token), with an org admin enabling the API under Organization > Administration. JetBrains' sales help says commercial-licence organisations are moving to the JetBrains Central Console, so check which applies.
- **Check:** none when connecting. **Endpoint used:** `GET https://account.jetbrains.com/api/v1/customer/licenses`: licences, product, assignee, last seen. Route and field names are unverified; the first live call will show an error on the dashboard if they differ.

### Visual Studio Code / Visual Studio (no admin API)
- **VS Code:** free, with no licence or usage API. The Tracker measures it; Copilot inside it connects separately.
- **Visual Studio:** subscriptions are managed in the Visual Studio Subscriptions admin portal (manage.visualstudio.com), with no public admin API found. The Tracker measures it.

## Where this lives in the code
- **Live data connectors:** AI tools in `services/aiTools/claude.js`, `codex.js`, `copilot.js` (sample data in `sampleData.js`); licence apps in `services/reports/licenseConnectors.js` (sample data in `vendorSamples.js`). Samples use the same response formats, so live and sample data go through the same dashboard code. Live results are cached for 10 minutes; a failed call shows an error, never sample data.
- **Credential checks:** `services/aiTools/credentialChecks.js`.
- **Fields per vendor and encrypted storage:** `services/aiTools/credentials.js`.
- **Connect API and GitHub OAuth:** `services/aiTools/integrations.js`.
- **Dialog text per vendor:** `src/components/ConnectDialog.jsx`.

## Enterprise Infrastructure Platform (phase 1: sample data)

Reports & Insights > Enterprise Infrastructure Platform shows cost monitoring,
infra insights, contracts and renewal periods per platform. It is read-only.
The data is **sample data in each API's response format**
(`services/platforms/samples.js`), built by the same code a live connection
will use (`services/platforms/index.js`). Live connectors are the next step.

| Platform | Planned sign-in | Calls the dashboard is built from |
|---|---|---|
| Microsoft Azure | Entra ID app: Cost Management Reader, Reader, Reservations Reader | Cost Management `query` (daily by service, MTD by resource group) and `forecast`; Consumption `budgets`; Advisor `recommendations` (Cost); Resource Graph (orphaned disks, public IPs, snapshots, load balancers); Capacity `reservations` (utilization, expiry, renew) |
| Snowflake | Service user with key-pair (JWT) auth, `ORGADMIN`/`ACCOUNTADMIN` usage views | SQL API `POST /api/v2/statements` on `ORGANIZATION_USAGE.USAGE_IN_CURRENCY_DAILY`, `CONTRACT_ITEMS`, `REMAINING_BALANCE_DAILY`; `SHOW WAREHOUSES` with `WAREHOUSE_METERING_HISTORY` (idle credits) |
| Datadog | API key + application key with `usage_read`, `hosts_read` | `GET /api/v2/usage/estimated_cost`, `projected_cost`, `historical_cost`, `hourly_usage`; `GET /api/v1/hosts` |
| Atlassian | Organization admin API key | `GET /admin/v1/orgs/{orgId}/users` (product access, last active), `GET /admin/v2/orgs/{orgId}/workspaces`. No public billing API: cost comes from the contract's price per user tier |

**Contracts** are contract data: each platform shows a sample contract until
one is saved in the portal (`platform_contracts`). Facts an API returns win
over the sample (Snowflake contract amount and dates, Azure reservation
expiries); a saved contract wins over both. **Renewal status** is by days to
the **notice deadline** (end date minus notice period): due within 30 days,
soon within 90, otherwise later.
