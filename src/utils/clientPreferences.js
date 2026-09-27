const PORTAL_CLIENT_ID_STORAGE_KEY = 'app-usage-monitoring-client-id';
export const SEND_EVALUATION_EMAIL_STORAGE_KEY =
  'app-usage-monitoring-send-evaluation-email';

export function getPortalClientId() {
  const stored = window.localStorage.getItem(PORTAL_CLIENT_ID_STORAGE_KEY);
  if (stored) return stored;

  const created =
    window.crypto?.randomUUID?.() ||
    `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(PORTAL_CLIENT_ID_STORAGE_KEY, created);
  return created;
}

export function getStoredSendEvaluationEmailSetting() {
  return window.localStorage.getItem(SEND_EVALUATION_EMAIL_STORAGE_KEY) !== 'false';
}
