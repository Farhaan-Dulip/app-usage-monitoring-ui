# AI Tools page (Claude, Codex, GitHub Copilot)

The portal's **AI Tools** page shows, per vendor: seats or members, spend or
credits, daily activity, per-user activity, and idle seats (reclaim
candidates). Each vendor card is in one of three modes:

| Mode | When | What is shown |
|---|---|---|
| **Sample data** | No admin credential stored for the vendor | Fictional people (`example.com`), generated in the vendor's documented response format and parsed by the same code as live data |
| **Live** | Credential stored | Your organisation's data from the vendor's admin API (cached 10 minutes; **Refresh** re-fetches) |
| **Connection error** | Credential stored but the call failed | The error only. Sample data is never shown in place of a failed live call |

## APIs used

| Vendor | Endpoints | Credential |
|---|---|---|
| Claude | `GET /v1/organizations/users`, `GET /v1/organizations/cost_report` (amounts are cents as decimal strings), `GET /v1/organizations/usage_report/claude_code` (one day per call, 14 days) on `api.anthropic.com`, header `x-api-key` + `anthropic-version: 2023-06-01` | Admin API key (`sk-ant-admin…`), org admin |
| GitHub Copilot | `GET /orgs/{org}/copilot/billing`, `GET /orgs/{org}/copilot/billing/seats`, `GET /orgs/{org}/copilot/metrics/reports/users-28-day/latest` (signed download links; files fetched without the token), API version `2026-03-10` | Token of an org owner / billing manager with `manage_billing:copilot` or `read:org`. Usage reports also need the "Copilot usage metrics" policy enabled; without it seats still load |
| Codex | Codex Analytics API for ChatGPT Enterprise, default `GET https://api.chatgpt.com/v1/analytics/codex/workspaces/{workspace_id}/usage` | Workspace-scoped OpenAI Admin key with `codex.enterprise.analytics.read` (some workspaces need OpenAI Support to apply it) |

**Codex contract not yet verified.** OpenAI's Admin API reference
(chatgpt.com/public/admin/api-reference) is not publicly fetchable, so the
route and field names follow integrators' documentation (per user per day:
threads, turns, credits, tokens, model and client breakdowns). The card says
so. On the first live call, compare the response with the reference; the
route can be changed without code (`-CodexAnalyticsUrl`) and field-name
differences are a small change in `services/aiTools/codex.js`.

What the data cannot show:
- Claude chat use on claude.ai (the Admin API reports Claude Code only).
- Copilot users by email: seats are GitHub logins.
- Copilot spend: it's estimated from seats × list price ($19 Business / $39 Enterprise).

## People & budgets

The **People & budgets** section on the AI Tools page compares each person's
**month-to-date spend** with their **monthly budget** per tool, and rolls it up
by manager.

| Field | Source |
|---|---|
| Month-to-date spend | Claude: Claude Code estimated cost (USD). Codex: credits. Copilot: `ai_credits_used` from the usage report, which GitHub labels consumption, not invoicing; the 28-day report covers the month up to the 28th |
| Budget | Set in the portal: a default per tool (Claude $100, Codex 200 credits, Copilot 80 AI credits to start) and per-person overrides (**Edit budget**) |
| Flag | Over budget (100%+), near (80%+), low use (under 20%: a reclaim candidate), on track |
| Employee ID, manager, department | A CSV export from HR or Entra ID (**Import people (CSV)**): an `Email` column plus any of `Name`, `Employee ID`, `Manager's Name`, `Manager Email`, `Department`. Rows are matched by email. Until something is imported, the fictional sample people have a sample manager; real people show "Not set" |
| Copilot pattern | The share of Copilot activity in its main mode, Inline (completions), Chat or Agent, from `totals_by_feature` |
| Agentic index | **Our definition**, 0 to 100: half from the share of Copilot activity in agent features, half from the share of active days that used an agent. Other reports may define it differently |

The same person-level data appears on each registered PC's tracker page for
its owner.

## Connect from the portal (Connect button)

**Connect** appears on the AI Tools vendor cards and on catalog cards for apps
with an integration (Claude, Codex, GitHub Copilot). The dialog asks for what
that vendor needs:

| Vendor | The dialog asks for |
|---|---|
| Claude | Admin API key (`sk-ant-admin…`) |
| Codex | Admin key + workspace ID (optional analytics URL; "save even if the test fails", because the route is unverified) |
| GitHub Copilot | **Sign in with GitHub** when a GitHub OAuth app is configured, otherwise an org-owner token; plus the organization and an optional login=email mapping |

Every dialog also asks for the **portal admin token**. The portal has no user
sign-in yet, so the token is what stops anyone with the URL from changing
credentials. On EC2 it's in Secrets Manager (stack output
`PortalAdminTokenSecret`):

```powershell
aws secretsmanager get-secret-value --region us-east-1 --secret-id usage-poc-ec2/portal-admin-token --query SecretString --output text
```

Locally (`docker-compose.full.yml`) it is `local-admin-token`.

What happens on **Test & connect**:
1. The credential is used for a real call to the vendor. If the vendor rejects
   it, nothing is saved and the vendor's error is shown.
2. It is stored **encrypted** (AES-256-GCM) in `integration_credentials`. The key
   is `usage-poc-ec2/credentials-key`, which stays the same across deploys.
3. The browser never gets it back. The page switches to Live within seconds,
   with no restart.

Values connected in the portal take precedence over values from
`setup-ai-tools.ps1`. **Disconnect** removes the portal's copy.

**Sign in with GitHub.** Create a GitHub OAuth app (organization settings >
Developer settings > OAuth apps). Set its callback URL to the stack output
`GithubOAuthCallbackUrl`
(`https://<portal>/api/integrations/copilot/oauth/callback`), then store its
client ID and secret:

```powershell
powershell -ExecutionPolicy Bypass -File infra\scripts\setup-ai-tools.ps1 -Vendor GithubOAuth -GithubOAuthClientId <client id>
```

The sign-in asks for `manage_billing:copilot read:org`. The person signing in
must be an organization owner or billing manager.

## Connect with the script (alternative)

From `app-usage-monitoring-ui`, signed in to the AWS CLI:

```powershell
powershell -ExecutionPolicy Bypass -File infra\scripts\setup-ai-tools.ps1 -Vendor Claude
powershell -ExecutionPolicy Bypass -File infra\scripts\setup-ai-tools.ps1 -Vendor Codex -CodexWorkspaceId <workspace id>
powershell -ExecutionPolicy Bypass -File infra\scripts\setup-ai-tools.ps1 -Vendor Copilot -GithubOrg <org>
```

The script prompts for the key (not shown), merges it into
`usage-poc/shared/ai-tools` (other vendors' values are kept) and restarts the
containers. No redeploy is needed. In about a minute, the vendor's card shows
**Live**. `-Disconnect` returns a vendor to sample data.

**Before connecting live data:** the portal has no login (gap S1) and is open
to any network (G1). Live data includes per-person usage and cost, so restrict
the allow-list or add sign-in first (see G5).
