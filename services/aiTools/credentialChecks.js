// One lightweight authenticated call per vendor that has no data connector
// yet, so the Connect dialog can say whether a credential works. Returns
// { checked: true } on success, { checked: false, reason } when the vendor
// can't be checked yet, and throws with the vendor's message on failure.
import { getJson, VendorApiError } from './http.js';

async function postJson(fetchImpl, vendor, url, { headers = {}, body, form } = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: form ? new URLSearchParams(form) : body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    throw new VendorApiError(vendor, `request failed (${error.message})`);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new VendorApiError(vendor, `HTTP ${response.status}: ${payload.reason || payload.message || payload.error || payload.detail || response.statusText}`, response.status);
  }
  return payload;
}

const basic = (user, password = '') => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

export const CREDENTIAL_CHECKS = {
  // https://docs.slack.dev/reference/methods/auth.test
  async slack(values, fetchImpl) {
    const result = await postJson(fetchImpl, 'Slack', 'https://slack.com/api/auth.test', { headers: { Authorization: `Bearer ${values.slackToken}` } });
    if (!result.ok) throw new VendorApiError('Slack', result.error || 'token rejected');
    return { checked: true };
  },

  // Server-to-Server OAuth: account_credentials grant, then one users call.
  async zoom(values, fetchImpl) {
    const token = await postJson(fetchImpl, 'Zoom', 'https://zoom.us/oauth/token', {
      headers: { Authorization: basic(values.zoomClientId, values.zoomClientSecret) },
      form: { grant_type: 'account_credentials', account_id: values.zoomAccountId },
    });
    await getJson(fetchImpl, 'Zoom', 'https://api.zoom.us/v2/users?page_size=1', { Authorization: `Bearer ${token.access_token}` });
    return { checked: true };
  },

  // Admin API key as the Basic-auth username, empty password.
  async cursor(values, fetchImpl) {
    await getJson(fetchImpl, 'Cursor', 'https://api.cursor.com/teams/members', { Authorization: basic(values.cursorApiKey) });
    return { checked: true };
  },

  async figma(values, fetchImpl) {
    await getJson(fetchImpl, 'Figma', 'https://api.figma.com/v1/me', { 'X-Figma-Token': values.figmaToken });
    return { checked: true };
  },

  async postman(values, fetchImpl) {
    await getJson(fetchImpl, 'Postman', 'https://api.getpostman.com/me', { 'X-API-Key': values.postmanApiKey });
    return { checked: true };
  },

  // Personal access token -> short-lived JWT, then the organization's members.
  async docker(values, fetchImpl) {
    const token = await postJson(fetchImpl, 'Docker', 'https://hub.docker.com/v2/auth/token', {
      body: { identifier: values.dockerUsername, secret: values.dockerToken },
    });
    await getJson(fetchImpl, 'Docker', `https://hub.docker.com/v2/orgs/${encodeURIComponent(values.dockerOrg)}/members?page_size=1`, {
      Authorization: `Bearer ${token.access_token}`,
    });
    return { checked: true };
  },

  // OpenAI's ChatGPT Enterprise reference is not publicly readable, and no
  // read-only JetBrains Account API endpoint is confirmed yet: store unchecked.
  async chatgpt() {
    return { checked: false, reason: "ChatGPT Enterprise's API reference isn't publicly available, so the key could not be checked." };
  },
  async jetbrains() {
    return { checked: false, reason: 'No read-only JetBrains Account API call is confirmed yet, so the token could not be checked.' };
  },
};
