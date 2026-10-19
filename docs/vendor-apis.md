# Vendor APIs for the recognised apps

What each app's admin API offers, how the portal signs in to it (Connect
dialog), which endpoints the portal calls, and what it uses them for.

**Status** column:
- **Live data**: the AI Tools page pulls this vendor's data (`services/aiTools/<vendor>.js`).
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
| Slack | Slack Web API, admin methods | Admin user token `xoxp-…` | Credential check |
| Zoom | Zoom REST API v2 | Server-to-Server OAuth app credentials | Credential check |
| Cursor | Cursor Admin API | Team Admin API key | Credential check |
| Figma | Figma REST API | Org admin personal access token | Credential check |
| Postman | Postman API | Team admin API key | Credential check |
| Docker Desktop | Docker Hub API | Username + personal access token + org | Credential check |
| ChatGPT | ChatGPT Enterprise admin/analytics API | Workspace-scoped admin key + workspace ID | Stored, unchecked |
| IntelliJ IDEA | JetBrains Account API | Customer code + API token | Stored, unchecked |
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

### Slack: Web API admin methods (credential check)
- **Auth:** `Authorization: Bearer xoxp-…`. An admin user token from an app installed **org-wide** by an Enterprise Grid Org Owner or Admin, with the `admin` scope.
- **Check:** `POST https://slack.com/api/auth.test`. **Verified:** live (fake token → `invalid_auth`).
- **For a data connector:** `team.billableInfo` (billable members; one Slack page marks it deprecated, so check before relying on it) and admin analytics (member activity).

### Zoom: REST API v2 (credential check)
- **Auth:** Server-to-Server OAuth. `POST https://zoom.us/oauth/token` with `grant_type=account_credentials&account_id=…` and Basic auth (client ID:secret) returns a 1-hour token with no refresh. An account admin must allow the app.
- **Check:** token, then `GET https://api.zoom.us/v2/users?page_size=1`. With Server-to-Server apps, `me` isn't available; use user IDs or emails. **Verified:** docs.
- **For a data connector:** users (licence type: licensed or basic), usage reports.

### Cursor: Admin API (credential check)
- **Auth:** Basic auth with the **team Admin API key** as the username and an empty password. A team admin creates it in the dashboard (Business/Enterprise).
- **Check:** `GET https://api.cursor.com/teams/members`. **Verified:** docs, live (fake key → `Invalid Team API Key`).
- **For a data connector:** members, daily usage, spend (similar to Claude Code).

### Figma: REST API (credential check)
- **Auth:** header `X-Figma-Token: <personal access token>`, from an org admin. Tokens expire after at most 90 days, so plan for renewal.
- **Check:** `GET https://api.figma.com/v1/me`. **Verified:** live (fake token → `Invalid token`). Expiry rule from integrator docs.
- **For a data connector:** activity logs (Enterprise), seats via SCIM.

### Postman: Postman API (credential check)
- **Auth:** header `X-API-Key: PMAK-…`, a team admin's key.
- **Check:** `GET https://api.getpostman.com/me`. **Verified:** live (fake key → `Invalid API Key`).
- **For a data connector:** team members, audit logs (Enterprise).

### Docker Desktop: Docker Hub API (credential check)
- **Auth:** `POST https://hub.docker.com/v2/auth/token` with `{ identifier: <username>, secret: <personal access token> }` returns a short-lived JWT, sent as `Authorization: Bearer`. SSO-enforced orgs need a PAT.
- **Check:** token, then `GET https://hub.docker.com/v2/orgs/{org}/members?page_size=1`. **Verified:** docs (token exchange); the members path still needs a live confirmation.
- **For a data connector:** org members and seats (Business).

### ChatGPT: ChatGPT Enterprise admin/analytics API (stored, unchecked)
- **Auth:** workspace-scoped OpenAI admin key + workspace ID. The daily usage analytics endpoint needs `enterprise.analytics.usage.read`; `codex.enterprise.analytics.read` doesn't grant it.
- **Check:** none. The reference isn't publicly readable, so the credential is stored with a warning.

### IntelliJ IDEA: JetBrains Account API (stored, unchecked)
- **Auth:** headers `X-Customer-Code` and `X-Api-Key` (a personal API token), with an org admin enabling the API under Organization > Administration. JetBrains' sales help says commercial-licence organisations are moving to the JetBrains Central Console, so check which applies.
- **Check:** none. No read-only endpoint is confirmed yet. **For a data connector:** licences and assignments.

### Visual Studio Code / Visual Studio (no admin API)
- **VS Code:** free, with no licence or usage API. The Tracker measures it; Copilot inside it connects separately.
- **Visual Studio:** subscriptions are managed in the Visual Studio Subscriptions admin portal (manage.visualstudio.com), with no public admin API found. The Tracker measures it.

## Where this lives in the code
- **Live data connectors:** `services/aiTools/claude.js`, `codex.js`, `copilot.js` (sample data in `sampleData.js` uses the same response formats).
- **Credential checks:** `services/aiTools/credentialChecks.js`.
- **Fields per vendor and encrypted storage:** `services/aiTools/credentials.js`.
- **Connect API and GitHub OAuth:** `services/aiTools/integrations.js`.
- **Dialog text per vendor:** `src/components/ConnectDialog.jsx`.
