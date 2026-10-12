# Email license requests (AI agent mailbox)

Employees email the license agent's shared mailbox, for example
`license-agent@alliontechnologies.com`. The AI agent raises the request on the
portal's **License Approvals** page, routed to the onboarded app's owner, and
replies in the same email thread.

```
Employee email ──► M365 shared mailbox ◄── AI agent polls every 30 s (Microsoft Graph)
                                              │ 1. check sender: allowed domain, internal / DMARC pass
                                              │ 2. OpenAI picks the app from the onboarded list (or NONE)
                                              │ 3. POST /api/mcp/license-requests (service token)
                                              ▼
                         Portal: pending_approval, approver = app owner ──► License Approvals page
                                              │
                         Reply to the sender: app, approver, reference, status
```

## What happens to each email

| Email | Agent action | Outlook category on the message |
|---|---|---|
| Request for an onboarded app | Raises the request, replies with the approver and reference | `License agent: request raised` |
| App not onboarded / unclear | Replies with the list of apps it can request | `License agent: needs info` |
| App has no owner configured | Replies with the portal's error | `License agent: needs info` |
| Not a license request | Replies with an example request | `License agent: not a request` |
| Outside sender, forged or unauthenticated | **No reply**, no request | `License agent: rejected sender` |
| Out-of-office, bounce | Nothing | `License agent: ignored` |
| Portal or OpenAI down | Left unread, retried; after 5 tries | `License agent: failed` |

Processed messages are marked read. The same email never creates two requests:
the portal deduplicates on the email's Message-ID.

**Safety model.** The email is untrusted input. The model has no tools here.
It can only choose an app from a fixed list of onboarded apps and summarise
the reason. The portal then validates the app and looks up its owner. Nothing
is approved, assigned or reclaimed by the agent; the app owner decides on the
License Approvals page, as for chat requests.

## One-time setup (Microsoft 365 admin)

The agent uses an Entra ID app registration that can read and send mail **only
in this one mailbox**, via Exchange Online RBAC for Applications.

1. **Shared mailbox.** In the Exchange admin center, go to Recipients →
   Mailboxes → *Add a shared mailbox*. Name it `License Agent`, with address
   `license-agent@alliontechnologies.com`. A shared mailbox needs no license.
2. **App registration.** In the Entra admin center, go to App registrations →
   *New registration*: `usage-poc license agent`, single tenant, no redirect
   URI. Then:
   - note the **Application (client) ID** and the **Directory (tenant) ID**;
   - under Certificates & secrets, create a **client secret** (expiry: 6
     months) and copy its value;
   - **do not** add Microsoft Graph `Mail.*` application permissions here.
     Those would cover every mailbox in the company.
3. **Service principal object ID.** Under Enterprise applications, open
   `usage-poc license agent` and note its **Object ID**.
4. **Scope the app to the mailbox** (Exchange Online PowerShell):

   ```powershell
   Connect-ExchangeOnline
   New-ServicePrincipal -AppId <client ID> -ObjectId <enterprise app object ID> -DisplayName 'usage-poc license agent'
   New-ManagementScope -Name 'License agent mailbox' -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'license-agent@alliontechnologies.com'"
   New-ManagementRoleAssignment -App <client ID> -Role 'Application Mail.ReadWrite' -CustomResourceScope 'License agent mailbox'
   New-ManagementRoleAssignment -App <client ID> -Role 'Application Mail.Send' -CustomResourceScope 'License agent mailbox'
   # Expect InScope = True for the agent mailbox and False for any other mailbox:
   Test-ServicePrincipalAuthorization -Identity <client ID> -Resource license-agent@alliontechnologies.com
   ```

   Role assignments can take up to about 2 hours to take effect.

## Turn it on (AWS)

From `app-usage-monitoring-ui`, signed in to the AWS CLI:

```powershell
powershell -ExecutionPolicy Bypass -File infra\scripts\setup-graph-mail.ps1 -TenantId <tenant ID> -ClientId <client ID> -Mailbox license-agent@alliontechnologies.com
```

The script prompts for the client secret, stores it in
`usage-poc/shared/graph-mail` and restarts the EC2 stack's containers. The
agent log `/usage-poc-ec2/agent` then shows
`mail-intake: watching license-agent@… every 30 s`.

- **Test:** send an email from your work account, e.g. *"Hi, I need a Postman
  license to test our APIs."* A reply arrives within about a minute, and the
  request appears on the License Approvals page.
- **Rotate the client secret:** rerun the script with the new value.
- **Turn it off:** delete the secret, then restart:
  `aws secretsmanager delete-secret --secret-id usage-poc/shared/graph-mail --force-delete-without-recovery`.

## Troubleshooting

- **Your own emails are filed as `rejected sender`:** the agent log says why.
  Internal mail is recognised by Exchange's `X-MS-Exchange-Organization-AuthAs:
  Internal` header; external mail needs `dmarc=pass` or `compauth=pass` in
  `Authentication-Results`. Mail sent *on behalf of* someone else is refused.
- **`Graph token request failed`:** the tenant ID, client ID or secret is wrong,
  or the secret has expired.
- **`Graph GET … failed (403)`:** the RBAC role assignment is missing, still
  propagating, or scoped to another mailbox.

## Not in this phase

Requests for someone else, reclaiming idle seats, purchase requests, emailing
the approver, and the decision email back to the requester. See "License
request workflow" phases 2–4.
