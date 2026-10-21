// Vendor admin credentials connected from the portal (Connect dialog), stored
// encrypted (AES-256-GCM) in `integration_credentials`. The browser can write
// and remove them but never read them back. Values set by the deployment
// (environment, e.g. setup-ai-tools.ps1) are used when the portal has none.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Fields each vendor needs, and the environment names the connectors read.
export const VENDOR_FIELDS = {
  claude: {
    anthropicAdminKey: { env: 'ANTHROPIC_ADMIN_KEY', secret: true, required: true },
  },
  codex: {
    codexAdminKey: { env: 'OPENAI_CODEX_ADMIN_KEY', secret: true, required: true },
    codexWorkspaceId: { env: 'OPENAI_CODEX_WORKSPACE_ID', required: true },
    codexAnalyticsUrl: { env: 'CODEX_ANALYTICS_URL' },
  },
  copilot: {
    githubToken: { env: 'GITHUB_COPILOT_TOKEN', secret: true, required: true },
    githubOrg: { env: 'GITHUB_ORG', required: true },
    githubLoginEmails: { env: 'GITHUB_LOGIN_EMAILS' },
  },
  // Enterprise App Licenses dashboards (services/reports/licenseConnectors.js).
  slack: {
    slackToken: { env: 'SLACK_ADMIN_TOKEN', secret: true, required: true },
  },
  zoom: {
    zoomAccountId: { env: 'ZOOM_ACCOUNT_ID', required: true },
    zoomClientId: { env: 'ZOOM_CLIENT_ID', required: true },
    zoomClientSecret: { env: 'ZOOM_CLIENT_SECRET', secret: true, required: true },
  },
  cursor: {
    cursorApiKey: { env: 'CURSOR_ADMIN_API_KEY', secret: true, required: true },
  },
  chatgpt: {
    chatgptAdminKey: { env: 'CHATGPT_ADMIN_KEY', secret: true, required: true },
    chatgptWorkspaceId: { env: 'CHATGPT_WORKSPACE_ID', required: true },
  },
  jetbrains: {
    jetbrainsCustomerCode: { env: 'JETBRAINS_CUSTOMER_CODE', required: true },
    jetbrainsApiKey: { env: 'JETBRAINS_API_KEY', secret: true, required: true },
  },
  figma: {
    figmaToken: { env: 'FIGMA_TOKEN', secret: true, required: true },
    // Optional: seat types (Full, Dev, Collab, View) come from SCIM.
    figmaScimTenantId: { env: 'FIGMA_SCIM_TENANT_ID' },
    figmaScimToken: { env: 'FIGMA_SCIM_TOKEN', secret: true },
  },
  postman: {
    postmanApiKey: { env: 'POSTMAN_API_KEY', secret: true, required: true },
  },
  docker: {
    dockerUsername: { env: 'DOCKER_USERNAME', required: true },
    dockerToken: { env: 'DOCKER_TOKEN', secret: true, required: true },
    dockerOrg: { env: 'DOCKER_ORG', required: true },
  },
};

// Vendors whose data the AI Tools page pulls (tested with that connector).
export const DATA_CONNECTORS = new Set(['claude', 'codex', 'copilot']);
// Vendors whose data the Enterprise App Licenses dashboards pull (tested with a
// lightweight credential check). Cursor and ChatGPT are stored only.
export const LICENSE_DATA_CONNECTORS = new Set(['slack', 'zoom', 'figma', 'postman', 'docker', 'jetbrains']);

export class CredentialError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

function keyFrom(secret) {
  if (!secret) throw new CredentialError('Credential storage is not configured (CREDENTIALS_KEY).', 503);
  return createHash('sha256').update(String(secret)).digest();
}

export function encrypt(value, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

export function decrypt(record, secret) {
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(record.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

// Validates and trims the submitted fields for a vendor.
export function cleanValues(vendor, values = {}) {
  const fields = VENDOR_FIELDS[vendor];
  if (!fields) throw new CredentialError('This app has no API integration.', 404);
  const clean = {};
  for (const [name, spec] of Object.entries(fields)) {
    const value = String(values[name] ?? '').trim();
    if (spec.required && !value) throw new CredentialError(`${name} is required.`, 400);
    if (value) clean[name] = value.slice(0, 4000);
  }
  if (vendor === 'claude' && !clean.anthropicAdminKey.startsWith('sk-ant-admin')) {
    throw new CredentialError('That is not an Anthropic Admin API key (they start with sk-ant-admin).', 400);
  }
  return clean;
}

// Environment-style values (ANTHROPIC_ADMIN_KEY, ...) for one vendor's fields.
export function toEnv(vendor, values) {
  return Object.fromEntries(
    Object.entries(VENDOR_FIELDS[vendor]).filter(([name]) => values[name]).map(([name, spec]) => [spec.env, values[name]])
  );
}

export async function saveCredentials(collection, secret, vendor, values, now = new Date()) {
  await collection.updateOne(
    { vendor },
    { $set: { vendor, ...encrypt(values, secret), updatedAt: now } },
    { upsert: true }
  );
}

export async function removeCredentials(collection, vendor) {
  await collection.deleteMany({ vendor });
}

// process.env overlaid with portal-connected credentials (portal wins per vendor).
// A record that cannot be decrypted (key changed) is ignored and reported.
export async function credentialEnv(collection, secret, baseEnv = process.env) {
  const env = { ...baseEnv };
  const sources = {};
  const problems = {};
  for (const vendor of Object.keys(VENDOR_FIELDS)) {
    const fromEnv = Object.values(VENDOR_FIELDS[vendor]).some((spec) => spec.required && baseEnv[spec.env]);
    if (fromEnv) sources[vendor] = 'deployment';
  }
  const records = secret ? await collection.find({}).limit(50).toArray() : [];
  for (const record of records) {
    if (!VENDOR_FIELDS[record.vendor]) continue;
    try {
      const values = decrypt(record, secret);
      for (const spec of Object.values(VENDOR_FIELDS[record.vendor])) delete env[spec.env];
      Object.assign(env, toEnv(record.vendor, values));
      sources[record.vendor] = 'portal';
      sources[`${record.vendor}UpdatedAt`] = record.updatedAt;
    } catch {
      problems[record.vendor] = 'Stored credential could not be decrypted (the credentials key changed). Connect again.';
    }
  }
  return { env, sources, problems };
}
