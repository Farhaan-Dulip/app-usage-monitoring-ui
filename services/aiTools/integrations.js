// Connect / disconnect vendor admin APIs from the portal.
//
//   GET    /api/integrations                       status per vendor (never the secrets)
//   POST   /api/integrations/:vendor/connect       { values, force } -> test, then store encrypted
//   DELETE /api/integrations/:vendor               remove the portal-stored credential
//   POST   /api/integrations/copilot/oauth/start   { org, githubLoginEmails } -> GitHub sign-in URL
//   GET    /api/integrations/copilot/oauth/callback  GitHub redirects here; stores the token
//
// Changing credentials needs the portal admin token (X-Admin-Token), because the
// portal has no user sign-in yet. Without PORTAL_ADMIN_TOKEN these routes refuse.
import { randomBytes } from 'node:crypto';
import { serviceTokenMatches } from '../serviceAuth.js';
import { CREDENTIAL_CHECKS } from './credentialChecks.js';
import {
  CredentialError,
  DATA_CONNECTORS,
  VENDOR_FIELDS,
  cleanValues,
  credentialEnv,
  removeCredentials,
  saveCredentials,
  toEnv,
} from './credentials.js';
import { vendorDefinitions } from './index.js';

const OAUTH_STATE_MS = 10 * 60 * 1000;
export const GITHUB_SCOPES = 'manage_billing:copilot read:org';

export function githubAuthorizeUrl({ clientId, redirectUri, state }) {
  const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, scope: GITHUB_SCOPES, state, allow_signup: 'false' });
  return `https://github.com/login/oauth/authorize?${query}`;
}

export async function exchangeGithubCode({ fetch: fetchImpl = fetch, clientId, clientSecret, code, redirectUri }) {
  const response = await fetchImpl('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new CredentialError(`GitHub sign-in failed: ${payload.error_description || payload.error || response.status}`, 400);
  }
  return payload.access_token;
}

// Calls the vendor with the submitted credentials: the live connector the AI
// Tools page uses where there is one, otherwise a lightweight check. Returns
// { checked, reason }; throws with the vendor's message when it is rejected.
export async function testCredentials(vendor, values, { fetch: fetchImpl = fetch, now = new Date() } = {}) {
  if (DATA_CONNECTORS.has(vendor)) {
    const definition = vendorDefinitions(toEnv(vendor, values)).find((item) => item.id === vendor);
    await definition.loadLive({ fetch: fetchImpl, now });
    return { checked: true };
  }
  return CREDENTIAL_CHECKS[vendor](values, fetchImpl);
}

export function createIntegrationsRouter({ express, collection, env = process.env, fetch: fetchImpl = fetch, onChange = () => {} }) {
  const router = express.Router();
  const secret = () => env.CREDENTIALS_KEY;
  const oauthStates = new Map();
  const oauthConfigured = () => Boolean(env.GITHUB_OAUTH_CLIENT_ID && env.GITHUB_OAUTH_CLIENT_SECRET && env.PUBLIC_PORTAL_URL);
  const redirectUri = () => `${String(env.PUBLIC_PORTAL_URL).replace(/\/$/, '')}/api/integrations/copilot/oauth/callback`;

  const requireAdmin = (req, res, next) => {
    if (!env.PORTAL_ADMIN_TOKEN || !env.CREDENTIALS_KEY) {
      return res.status(503).json({ error: 'Connecting from the portal is not set up on this server (PORTAL_ADMIN_TOKEN / CREDENTIALS_KEY).' });
    }
    if (!serviceTokenMatches(req.get('X-Admin-Token'), env.PORTAL_ADMIN_TOKEN)) {
      return res.status(401).json({ error: 'The portal admin token is not correct.' });
    }
    return next();
  };

  const fail = (res, error) => {
    if (error instanceof CredentialError) return res.status(error.statusCode).json({ error: error.message });
    return res.status(400).json({ error: error.message || 'The vendor rejected the credentials.' });
  };

  router.get('/', async (_req, res) => {
    try {
      const { sources, problems } = await credentialEnv(collection, secret(), env);
      return res.json({
        canConnect: Boolean(env.PORTAL_ADMIN_TOKEN && env.CREDENTIALS_KEY),
        vendors: Object.keys(VENDOR_FIELDS).map((vendor) => ({
          vendor,
          connected: Boolean(sources[vendor]),
          source: sources[vendor] || null,
          updatedAt: sources[`${vendor}UpdatedAt`] || null,
          problem: problems[vendor] || null,
          oauth: vendor === 'copilot' && oauthConfigured(),
          dataConnector: DATA_CONNECTORS.has(vendor),
        })),
      });
    } catch (error) {
      return res.status(500).json({ error: 'Unable to load integrations' });
    }
  });

  router.post('/:vendor/connect', requireAdmin, async (req, res) => {
    const { vendor } = req.params;
    try {
      const values = cleanValues(vendor, req.body?.values);
      let check = { checked: false, reason: 'Saved without a check (forced).' };
      try {
        check = await testCredentials(vendor, values, { fetch: fetchImpl });
      } catch (error) {
        if (!req.body?.force) return res.status(400).json({ error: error.message, testFailed: true });
      }
      await saveCredentials(collection, secret(), vendor, values);
      onChange();
      return res.json({ connected: true, checked: check.checked, note: check.reason || null, dataConnector: DATA_CONNECTORS.has(vendor) });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.delete('/:vendor', requireAdmin, async (req, res) => {
    if (!VENDOR_FIELDS[req.params.vendor]) return res.status(404).json({ error: 'Unknown integration' });
    await removeCredentials(collection, req.params.vendor);
    onChange();
    return res.json({ connected: false });
  });

  router.post('/copilot/oauth/start', requireAdmin, (req, res) => {
    if (!oauthConfigured()) return res.status(503).json({ error: 'GitHub sign-in is not set up on this server; connect with a token instead.' });
    const org = String(req.body?.org || '').trim();
    if (!org) return res.status(400).json({ error: 'Enter the GitHub organization.' });
    const state = randomBytes(24).toString('hex');
    oauthStates.set(state, { org, githubLoginEmails: String(req.body?.githubLoginEmails || '').trim(), at: Date.now() });
    for (const [key, value] of oauthStates) if (Date.now() - value.at > OAUTH_STATE_MS) oauthStates.delete(key);
    return res.json({ url: githubAuthorizeUrl({ clientId: env.GITHUB_OAUTH_CLIENT_ID, redirectUri: redirectUri(), state }) });
  });

  // GitHub sends the browser back here; the state ties it to an admin-started sign-in.
  router.get('/copilot/oauth/callback', async (req, res) => {
    const pending = oauthStates.get(String(req.query.state || ''));
    oauthStates.delete(String(req.query.state || ''));
    const back = (result, message = '') =>
      res.redirect(`/?view=apps-inventory&integration=copilot&result=${result}${message ? `&message=${encodeURIComponent(message.slice(0, 200))}` : ''}`);
    if (!pending || Date.now() - pending.at > OAUTH_STATE_MS) return back('error', 'The sign-in expired or was not started here. Try again.');
    if (req.query.error) return back('error', String(req.query.error_description || req.query.error));
    try {
      const token = await exchangeGithubCode({
        fetch: fetchImpl,
        clientId: env.GITHUB_OAUTH_CLIENT_ID,
        clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
        code: String(req.query.code || ''),
        redirectUri: redirectUri(),
      });
      const values = cleanValues('copilot', { githubToken: token, githubOrg: pending.org, githubLoginEmails: pending.githubLoginEmails });
      await testCredentials('copilot', values, { fetch: fetchImpl });
      await saveCredentials(collection, secret(), 'copilot', values);
      onChange();
      return back('connected');
    } catch (error) {
      return back('error', error.message);
    }
  });

  return router;
}
