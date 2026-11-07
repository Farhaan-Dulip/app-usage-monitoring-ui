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

  // Server-to-Server OAuth: account_credentials grant, then one users call.
  async zoom(values, fetchImpl) {
    const token = await postJson(fetchImpl, 'Zoom', 'https://zoom.us/oauth/token', {
      headers: { Authorization: basic(values.zoomClientId, values.zoomClientSecret) },
      form: { grant_type: 'account_credentials', account_id: values.zoomAccountId },
    });
    await getJson(fetchImpl, 'Zoom', 'https://api.zoom.us/v2/users?page_size=1', { Authorization: `Bearer ${token.access_token}` });
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

};
