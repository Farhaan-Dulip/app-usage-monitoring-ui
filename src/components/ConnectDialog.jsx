import { useCallback, useEffect, useState } from 'react';

const BACKEND_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const ADMIN_TOKEN_KEY = 'usage-portal-admin-token';

export const INTEGRATION_NAMES = {
  claude: 'Claude',
  codex: 'Codex',
  copilot: 'GitHub Copilot',
  slack: 'Slack',
  zoom: 'Zoom',
  cursor: 'Cursor',
  chatgpt: 'ChatGPT Enterprise',
  jetbrains: 'JetBrains (IntelliJ IDEA)',
  figma: 'Figma',
  postman: 'Postman',
  docker: 'Docker',
  vscode: 'Visual Studio Code',
  'visual-studio': 'Visual Studio',
  azure: 'Microsoft Azure',
  snowflake: 'Snowflake',
  datadog: 'Datadog',
  atlassian: 'Atlassian',
};

// Enterprise Infra Platform: dashboards run on sample data in each API's
// format; the read-only connection is the next step.
export const PLATFORM_PLANNED = {
  azure: 'Read-only through a Microsoft Entra ID app with Cost Management Reader, Reader and Reservations Reader roles: actual cost, budgets and forecast, Advisor recommendations, orphaned resources and reservations (including Azure Databricks).',
  snowflake: 'Read-only through a Snowflake service user with key-pair authentication on the SQL API: organization usage in currency, contract items, remaining balance and warehouse credits.',
  datadog: 'Read-only through a Datadog API key and an application key with usage_read and hosts_read: estimated, projected and historical cost, hourly usage and hosts.',
  atlassian: "Read-only through an Atlassian organization admin API key: users with product access and last activity, and the organization's products. Pricing comes from your contract (no public billing API).",
};

// Apps without an admin API: the dialog explains where their seats are managed.
export const NO_API = {
  vscode: 'Visual Studio Code is free and has no licence or usage API. The Tracker measures it on each PC; paid add-ons such as GitHub Copilot connect separately.',
  'visual-studio': "Visual Studio subscriptions are managed in Microsoft's Visual Studio Subscriptions admin portal (manage.visualstudio.com), which has no public admin API to connect. The Tracker measures Visual Studio use on each PC.",
};

// What each vendor needs, shown in the Connect dialog.
const FORMS = {
  claude: {
    intro: 'Paste an Anthropic Admin API key. Create one in the Anthropic Console under Settings > Admin keys (organization admins only).',
    fields: [{ name: 'anthropicAdminKey', label: 'Admin API key', placeholder: 'sk-ant-admin…', secret: true }],
  },
  codex: {
    intro: 'Paste a workspace-scoped OpenAI Admin key with the codex.enterprise.analytics.read scope (OpenAI Admin console > Credentials > Admin keys), and your ChatGPT Enterprise workspace ID.',
    fields: [
      { name: 'codexAdminKey', label: 'Admin key', placeholder: 'sk-admin…', secret: true },
      { name: 'codexWorkspaceId', label: 'Workspace ID', placeholder: 'ws_…' },
      { name: 'codexAnalyticsUrl', label: 'Analytics API URL (optional)', placeholder: 'https://api.chatgpt.com/v1/analytics/codex/workspaces/{workspace_id}/usage' },
    ],
    forceHint: 'The Codex Analytics route has not been verified against OpenAI\'s reference yet, so the test call may fail even with a valid key.',
  },
  slack: {
    intro: 'Paste an admin user token (xoxp-…) from a Slack app installed across your Enterprise Grid org by an Org Owner or Admin, with the admin scope.',
    fields: [{ name: 'slackToken', label: 'Admin user token', placeholder: 'xoxp-…', secret: true }],
  },
  zoom: {
    intro: 'Create a Server-to-Server OAuth app in the Zoom App Marketplace (an account admin must allow it) with user read scopes, and paste its credentials.',
    fields: [
      { name: 'zoomAccountId', label: 'Account ID', placeholder: 'From the app credentials page' },
      { name: 'zoomClientId', label: 'Client ID', placeholder: '' },
      { name: 'zoomClientSecret', label: 'Client secret', placeholder: '', secret: true },
    ],
  },
  cursor: {
    intro: 'Paste a team Admin API key, created by a team admin in the Cursor dashboard (Business or Enterprise plan).',
    fields: [{ name: 'cursorApiKey', label: 'Admin API key', placeholder: 'crsr_…', secret: true }],
  },
  chatgpt: {
    intro: 'Paste a workspace-scoped OpenAI Admin key and your ChatGPT Enterprise workspace ID (OpenAI Admin console > Credentials > Admin keys).',
    fields: [
      { name: 'chatgptAdminKey', label: 'Admin key', placeholder: 'sk-admin…', secret: true },
      { name: 'chatgptWorkspaceId', label: 'Workspace ID', placeholder: 'ws_…' },
    ],
  },
  jetbrains: {
    intro: 'An organization admin enables the JetBrains Account API (Organization > Administration). Paste your customer code and the API token.',
    fields: [
      { name: 'jetbrainsCustomerCode', label: 'Customer code', placeholder: 'From "Copy support information"' },
      { name: 'jetbrainsApiKey', label: 'API token', placeholder: '', secret: true },
    ],
  },
  figma: {
    intro: 'Paste a personal access token of a Figma organization admin (Settings > Security > Personal access tokens). Tokens expire after at most 90 days.',
    fields: [
      { name: 'figmaToken', label: 'Personal access token', placeholder: 'figd_…', secret: true },
      { name: 'figmaScimTenantId', label: 'SCIM tenant ID (optional, for seat types)', placeholder: 'Admin > Settings > SCIM' },
      { name: 'figmaScimToken', label: 'SCIM API token (optional)', placeholder: '', secret: true },
    ],
  },
  postman: {
    intro: 'Paste a Postman API key of a team admin (Postman > Settings > API keys).',
    fields: [{ name: 'postmanApiKey', label: 'API key', placeholder: 'PMAK-…', secret: true }],
  },
  docker: {
    intro: 'Use a Docker personal access token of an organization owner, with your Docker username and the organization name.',
    fields: [
      { name: 'dockerUsername', label: 'Docker username', placeholder: '' },
      { name: 'dockerToken', label: 'Personal access token', placeholder: 'dckr_pat_…', secret: true },
      { name: 'dockerOrg', label: 'Organization', placeholder: 'your-org' },
    ],
  },
  copilot: {
    intro: 'Sign in as a GitHub organization owner or billing manager. The portal needs the manage_billing:copilot and read:org permissions.',
    fields: [
      { name: 'githubOrg', label: 'GitHub organization', placeholder: 'your-org' },
      { name: 'githubToken', label: 'Token', placeholder: 'ghp_… or github_pat_…', secret: true, tokenOnly: true },
      { name: 'githubLoginEmails', label: 'GitHub user = work email (optional)', placeholder: 'octocat=name@company.com, other=…', multiline: true },
    ],
  },
};

function readAdminToken() {
  try { return window.sessionStorage.getItem(ADMIN_TOKEN_KEY) || ''; } catch { return ''; }
}

function rememberAdminToken(value) {
  try { window.sessionStorage.setItem(ADMIN_TOKEN_KEY, value); } catch { /* storage unavailable */ }
}

// Connection status of each vendor (never the credentials themselves).
export function useIntegrations() {
  const [status, setStatus] = useState(null);
  const reload = useCallback(() => {
    fetch(`${BACKEND_BASE_URL}/api/integrations`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => setStatus(payload))
      .catch(() => setStatus(null));
  }, []);
  useEffect(() => reload(), [reload]);
  return [status, reload];
}

export function integrationBadge(vendorStatus, vendor) {
  if (NO_API[vendor]) return { label: 'No admin API', className: 'status-neutral' };
  if (PLATFORM_PLANNED[vendor]) return { label: 'Sample data', className: 'status-observing' };
  if (!vendorStatus) return { label: 'Not connected', className: 'status-neutral' };
  if (vendorStatus.problem) return { label: 'Reconnect needed', className: 'status-reclaimable' };
  if (vendorStatus.connected) return { label: vendorStatus.source === 'portal' ? 'Connected' : 'Connected (server)', className: 'status-active' };
  return { label: 'Not connected', className: 'status-neutral' };
}

export default function ConnectDialog({ vendor, status, canConnect, onClose, onChanged }) {
  if (PLATFORM_PLANNED[vendor]) {
    return (
      <div className="app-catalog-backdrop connect-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <section className="app-catalog-modal connect-dialog" role="dialog" aria-modal="true" aria-labelledby="connect-title">
          <div className="app-catalog-modal-header">
            <div>
              <p className="eyebrow">Connection coming next</p>
              <h2 id="connect-title">{INTEGRATION_NAMES[vendor]}</h2>
              <p>{PLATFORM_PLANNED[vendor]}</p>
              <p>Its Reports &amp; Insights dashboard shows sample data in this API's response format until the connection is built.</p>
            </div>
            <button className="settings-close-button" type="button" aria-label="Close" onClick={onClose}>&times;</button>
          </div>
        </section>
      </div>
    );
  }
  if (NO_API[vendor]) {
    return (
      <div className="app-catalog-backdrop connect-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <section className="app-catalog-modal connect-dialog" role="dialog" aria-modal="true" aria-labelledby="connect-title">
          <div className="app-catalog-modal-header">
            <div>
              <p className="eyebrow">No admin API</p>
              <h2 id="connect-title">{INTEGRATION_NAMES[vendor]}</h2>
              <p>{NO_API[vendor]}</p>
            </div>
            <button className="settings-close-button" type="button" aria-label="Close" onClick={onClose}>&times;</button>
          </div>
        </section>
      </div>
    );
  }
  return <ConnectForm vendor={vendor} status={status} canConnect={canConnect} onClose={onClose} onChanged={onChanged} />;
}

function ConnectForm({ vendor, status, canConnect, onClose, onChanged }) {
  const form = FORMS[vendor];
  const [values, setValues] = useState({});
  const [adminToken, setAdminToken] = useState(readAdminToken);
  const [useToken, setUseToken] = useState(!status?.oauth);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const request = async (method, path, body) => {
    const response = await fetch(`${BACKEND_BASE_URL}/api/integrations${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken.trim() },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.error || `Request failed (${response.status})`), payload);
    return payload;
  };

  const run = async (action) => {
    if (!adminToken.trim()) {
      setMessage({ error: true, text: 'Enter the portal admin token.' });
      return;
    }
    rememberAdminToken(adminToken.trim());
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage({ error: true, text: error.testFailed ? `The test call failed: ${error.message}` : error.message });
    } finally {
      setBusy(false);
    }
  };

  const connect = () => run(async () => {
    const result = await request('POST', `/${vendor}/connect`, { values, force });
    const name = INTEGRATION_NAMES[vendor];
    const checked = result.checked ? 'checked and stored' : `stored without a check (${result.note || 'not checkable yet'})`;
    setMessage({
      text: result.dataConnector
        ? `${name} connected (${checked}). Live data appears on ${result.dataConnector === true ? 'the AI Tools page' : `the ${result.dataConnector} page`}.`
        : `${name} credential ${checked}. Bringing ${name}'s seats and usage into the portal is the next step; it isn't built yet.`,
    });
    onChanged();
  });

  const signInWithGithub = () => run(async () => {
    const { url } = await request('POST', '/copilot/oauth/start', { org: values.githubOrg, githubLoginEmails: values.githubLoginEmails });
    window.location.assign(url);
  });

  const disconnect = () => run(async () => {
    await request('DELETE', `/${vendor}`);
    setMessage({ text: `${INTEGRATION_NAMES[vendor]} disconnected; the AI Tools page shows sample data again.` });
    onChanged();
  });

  return (
    <div className="app-catalog-backdrop connect-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="app-catalog-modal connect-dialog" role="dialog" aria-modal="true" aria-labelledby="connect-title">
        <div className="app-catalog-modal-header">
          <div>
            <p className="eyebrow">Connect admin API</p>
            <h2 id="connect-title">{INTEGRATION_NAMES[vendor]}</h2>
            <p>{form.intro}</p>
          </div>
          <button className="settings-close-button" type="button" aria-label="Close" onClick={onClose}>&times;</button>
        </div>

        {!canConnect ? (
          <p className="ai-tool-note ai-tool-error">
            Connecting from the portal is not set up on this server. Use infra\scripts\setup-ai-tools.ps1 instead.
          </p>
        ) : (
          <form className="connect-form" onSubmit={(event) => { event.preventDefault(); connect(); }}>
            {status?.connected && (
              <p className="ai-tool-note">
                Connected{status.source === 'deployment' ? ' through the server configuration' : ''}{status.updatedAt ? ` since ${new Date(status.updatedAt).toLocaleString()}` : ''}. Connecting again replaces the stored credential.
              </p>
            )}
            {status?.problem && <p className="ai-tool-note ai-tool-error">{status.problem}</p>}

            {form.fields
              .filter((field) => !(field.tokenOnly && !useToken))
              .map((field) => (
                <label key={field.name}>
                  <span>{field.label}</span>
                  {field.multiline ? (
                    <textarea rows={2} placeholder={field.placeholder} value={values[field.name] || ''} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })} />
                  ) : (
                    <input
                      type={field.secret ? 'password' : 'text'}
                      autoComplete="off"
                      placeholder={field.placeholder}
                      value={values[field.name] || ''}
                      onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
                    />
                  )}
                </label>
              ))}

            <label>
              <span>Portal admin token</span>
              <input type="password" autoComplete="off" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} />
              <small>Needed to change credentials (the portal has no sign-in yet). Ask the person who deployed the portal.</small>
            </label>

            {form.forceHint && (
              <label className="connect-checkbox">
                <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
                <span>Save even if the test call fails. {form.forceHint}</span>
              </label>
            )}

            {message && <p className={`ai-tool-note${message.error ? ' ai-tool-error' : ''}`}>{message.text}</p>}

            <div className="connect-actions">
              {vendor === 'copilot' && status?.oauth && !useToken ? (
                <>
                  <button className="deploy-agent-button" type="button" disabled={busy} onClick={signInWithGithub}>Sign in with GitHub</button>
                  <button className="link-button" type="button" onClick={() => setUseToken(true)}>Use a token instead</button>
                </>
              ) : (
                <button className="deploy-agent-button" type="submit" disabled={busy}>{busy ? 'Testing…' : 'Test & connect'}</button>
              )}
              {status?.connected && status.source === 'portal' && (
                <button className="download-link-button" type="button" disabled={busy} onClick={disconnect}>Disconnect</button>
              )}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
