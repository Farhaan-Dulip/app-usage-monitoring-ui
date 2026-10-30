// Recognised apps for the Enterprise Apps Inventory page: templates that
// pre-fill the inventory form (owner, owner email and cost are still entered
// by the admin, so adding an app stays a deliberate decision).
//
// processName is what the Tracker matches. For extensions it is the name the
// portal's detection rules know (github-copilot, codex), not an .exe.
// verified: the detection was confirmed on a real PC in this POC; others
// should be checked once (Task Manager > Details) before relying on them.
// Prices are deliberately left out: they change and depend on contracts.
// product: entries that are one license used through different surfaces
// (desktop app, extension in another app, web). Onboarding one offers the
// rest, and License Utilizations shows every surface under that license.
// connector: the vendor whose admin API the Connect dialog signs in to (or, for
// vscode / visual-studio, explains that there is none).

// Recognised apps modal: three groups, shown one after the other.
export const CATALOG_GROUPS = [
  { id: 'end-user', title: 'End User Apps', description: 'Software people use, licensed per seat, recognised on PCs by process name.' },
  { id: 'platform', title: 'Enterprise Infra Platform', description: 'Cloud and platform services, licensed by consumption or commitment. Tracked through their admin APIs, not on PCs.' },
  { id: 'ai', title: 'AI Agents & Tools', description: 'AI assistants and coding agents: desktop apps and extensions inside another app.' },
];

export function catalogGroup(entry) {
  if (entry.appType === 'Platform') return 'platform';
  return String(entry.category).startsWith('AI') ? 'ai' : 'end-user';
}

export const APP_CATALOG = [
  // Applications
  { id: 'postman', product: 'postman', connector: 'postman', appType: 'Application', appName: 'Postman', processName: 'Postman.exe', publisher: 'Postman', category: 'API tools', verified: true },
  { id: 'vscode', product: 'vscode', connector: 'vscode', appType: 'Application', appName: 'Visual Studio Code', processName: 'Code.exe', publisher: 'Microsoft', category: 'IDE', verified: true },
  { id: 'visual-studio', product: 'visual-studio', connector: 'visual-studio', appType: 'Application', appName: 'Visual Studio', processName: 'devenv.exe', publisher: 'Microsoft', category: 'IDE', verified: false },
  { id: 'intellij', product: 'intellij', connector: 'jetbrains', appType: 'Application', appName: 'IntelliJ IDEA', processName: 'idea64.exe', publisher: 'JetBrains', category: 'IDE', verified: false },
  { id: 'cursor', product: 'cursor', connector: 'cursor', appType: 'Application', appName: 'Cursor', processName: 'Cursor.exe', publisher: 'Anysphere', category: 'AI IDE', verified: false },
  { id: 'claude-desktop', product: 'claude', connector: 'claude', appType: 'Application', appName: 'Claude', processName: 'claude.exe', publisher: 'Anthropic', category: 'AI assistant', verified: true, note: 'Desktop app; the standalone Claude Code CLI also runs as claude.exe.' },
  { id: 'chatgpt-desktop', product: 'chatgpt', connector: 'chatgpt', appType: 'Application', appName: 'ChatGPT', processName: 'ChatGPT.exe', publisher: 'OpenAI', category: 'AI assistant', verified: false },
  { id: 'docker-desktop', product: 'docker', connector: 'docker', appType: 'Application', appName: 'Docker Desktop', processName: 'Docker Desktop.exe', publisher: 'Docker', category: 'Developer tools', verified: false },
  { id: 'figma', product: 'figma', connector: 'figma', appType: 'Application', appName: 'Figma', processName: 'Figma.exe', publisher: 'Figma', category: 'Design', verified: false },
  { id: 'slack', product: 'slack', connector: 'slack', appType: 'Application', appName: 'Slack', processName: 'slack.exe', publisher: 'Salesforce', category: 'Collaboration', verified: false },
  { id: 'zoom', product: 'zoom', connector: 'zoom', appType: 'Application', appName: 'Zoom', processName: 'Zoom.exe', publisher: 'Zoom', category: 'Collaboration', verified: false },

  // Extensions (detected inside the parent app's process tree)
  { id: 'github-copilot', product: 'copilot', connector: 'copilot', appType: 'Extension', appName: 'GitHub Copilot', processName: 'github-copilot', parentApp: 'Visual Studio Code', subscriptionType: 'Copilot Enterprise', publisher: 'GitHub', category: 'AI assistant', verified: false, note: 'Built-in detection rule for the Copilot extension host in VS Code.' },
  { id: 'claude-code-vscode', product: 'claude', connector: 'claude', appType: 'Extension', appName: 'Claude Code', processName: 'claude-code', parentApp: 'Visual Studio Code', subscriptionType: 'Claude', publisher: 'Anthropic', category: 'AI assistant', verified: false, note: 'Detected by the Claude Code binary running from the anthropic.claude-code extension folder.' },
  { id: 'codex-vscode', product: 'chatgpt', connector: 'codex', appType: 'Extension', appName: 'Codex', processName: 'codex', parentApp: 'Visual Studio Code', subscriptionType: 'ChatGPT Enterprise', publisher: 'OpenAI', category: 'AI assistant', verified: false, note: 'Built-in detection rule (codex.exe / codex in VS Code).' },

  // Enterprise infrastructure platforms (admin APIs; no Tracker detection)
  { id: 'azure', connector: 'azure', appType: 'Platform', appName: 'Microsoft Azure', api: 'Azure Cost Management, Advisor, Resource Graph', publisher: 'Microsoft', category: 'Cloud infrastructure', verified: false },
  { id: 'snowflake', connector: 'snowflake', appType: 'Platform', appName: 'Snowflake', api: 'Snowflake SQL API (organization usage)', publisher: 'Snowflake', category: 'Data platform', verified: false },
  { id: 'datadog', connector: 'datadog', appType: 'Platform', appName: 'Datadog', api: 'Datadog Usage Metering API', publisher: 'Datadog', category: 'Observability', verified: false },
  { id: 'atlassian', connector: 'atlassian', appType: 'Platform', appName: 'Atlassian', api: 'Atlassian Organizations REST API', publisher: 'Atlassian', category: 'Collaboration platform', verified: false },

  // Web apps
  { id: 'claude-web', product: 'claude', connector: 'claude', appType: 'Web URL', appName: 'Claude (web)', url: 'claude.ai', publisher: 'Anthropic', category: 'AI assistant', verified: false },
  { id: 'chatgpt-web', product: 'chatgpt', connector: 'chatgpt', appType: 'Web URL', appName: 'ChatGPT (web)', url: 'chatgpt.com', publisher: 'OpenAI', category: 'AI assistant', verified: false },
  { id: 'copilot-web', product: 'copilot', connector: 'copilot', appType: 'Web URL', appName: 'GitHub Copilot (github.com)', url: 'github.com/copilot', publisher: 'GitHub', category: 'AI assistant', verified: false },
  { id: 'slack-web', product: 'slack', connector: 'slack', appType: 'Web URL', appName: 'Slack (web)', url: 'app.slack.com', publisher: 'Salesforce', category: 'Collaboration', verified: false },
  { id: 'zoom-web', product: 'zoom', connector: 'zoom', appType: 'Web URL', appName: 'Zoom (web)', url: 'app.zoom.us', publisher: 'Zoom', category: 'Collaboration', verified: false },
  { id: 'postman-web', product: 'postman', connector: 'postman', appType: 'Web URL', appName: 'Postman (web)', url: 'web.postman.co', publisher: 'Postman', category: 'API tools', verified: false },
  { id: 'vscode-web', product: 'vscode', connector: 'vscode', appType: 'Web URL', appName: 'VS Code (web)', url: 'vscode.dev', publisher: 'Microsoft', category: 'IDE', verified: false },
  { id: 'figma-web', product: 'figma', connector: 'figma', appType: 'Web URL', appName: 'Figma (web)', url: 'figma.com', publisher: 'Figma', category: 'Design', verified: false },
];

const key = (value) => String(value || '').trim().toLowerCase();

// The inventory item a catalog entry corresponds to, if already added.
export function inventoryMatch(entry, inventory) {
  return inventory.find((item) => {
    if (item.appType !== entry.appType) return false;
    if (entry.appType === 'Web URL') return key(item.url) === key(entry.url);
    return key(item.processName) === key(entry.processName) || key(item.appName) === key(entry.appName);
  }) || null;
}

// Display name of each product: the license name its surfaces share.
export const PRODUCTS = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  copilot: 'GitHub Copilot',
  figma: 'Figma',
  slack: 'Slack',
  zoom: 'Zoom',
  postman: 'Postman',
  vscode: 'Visual Studio Code',
  'visual-studio': 'Visual Studio',
  intellij: 'IntelliJ IDEA',
  cursor: 'Cursor',
  docker: 'Docker Desktop',
};

export function productSurfaces(productId) {
  return productId ? APP_CATALOG.filter((entry) => entry.product === productId) : [];
}

const urlKey = (value) => key(value).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');

// The catalog surface a tracked app, extension or URL corresponds to, if any.
export function findCatalogSurface({ appType, processName, appName, url }) {
  return APP_CATALOG.find((entry) => {
    if (!entry.product || entry.appType !== appType) return false;
    if (appType === 'Web URL') return Boolean(url) && urlKey(entry.url) === urlKey(url);
    return (
      (processName && key(entry.processName) === key(processName)) ||
      (appName && key(entry.appName) === key(appName))
    );
  }) || null;
}
