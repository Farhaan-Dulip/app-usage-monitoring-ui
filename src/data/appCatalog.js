// Recognised apps for the Enterprise Apps Inventory page: templates that
// pre-fill the inventory form (owner, owner email and cost are still entered
// by the admin, so adding an app stays a deliberate decision).
//
// processName is what the Tracker matches. For extensions it is the name the
// portal's detection rules know (github-copilot, codex), not an .exe.
// verified: the detection was confirmed on a real PC in this POC; others
// should be checked once (Task Manager > Details) before relying on them.
// Prices are deliberately left out: they change and depend on contracts.
// connector: the vendor whose admin API the Connect dialog signs in to (or, for
// vscode / visual-studio, explains that there is none).

export const CATALOG_SECTIONS = [
  { type: 'Application', title: 'Applications', description: 'Desktop apps the Tracker recognises by process name.' },
  { type: 'Extension', title: 'Extensions', description: 'AI assistants that run inside another app (the parent app must be in your inventory first).' },
  { type: 'Web URL', title: 'Web Apps', description: 'Browser-based tools the Tracker recognises by site address.' },
];

export const APP_CATALOG = [
  // Applications
  { id: 'postman', connector: 'postman', appType: 'Application', appName: 'Postman', processName: 'Postman.exe', publisher: 'Postman', category: 'API tools', verified: true },
  { id: 'vscode', connector: 'vscode', appType: 'Application', appName: 'Visual Studio Code', processName: 'Code.exe', publisher: 'Microsoft', category: 'IDE', verified: true },
  { id: 'visual-studio', connector: 'visual-studio', appType: 'Application', appName: 'Visual Studio', processName: 'devenv.exe', publisher: 'Microsoft', category: 'IDE', verified: false },
  { id: 'intellij', connector: 'jetbrains', appType: 'Application', appName: 'IntelliJ IDEA', processName: 'idea64.exe', publisher: 'JetBrains', category: 'IDE', verified: false },
  { id: 'cursor', connector: 'cursor', appType: 'Application', appName: 'Cursor', processName: 'Cursor.exe', publisher: 'Anysphere', category: 'AI IDE', verified: false },
  { id: 'claude-desktop', connector: 'claude', appType: 'Application', appName: 'Claude', processName: 'claude.exe', publisher: 'Anthropic', category: 'AI assistant', verified: true, note: 'Desktop app; the standalone Claude Code CLI also runs as claude.exe.' },
  { id: 'chatgpt-desktop', connector: 'chatgpt', appType: 'Application', appName: 'ChatGPT', processName: 'ChatGPT.exe', publisher: 'OpenAI', category: 'AI assistant', verified: false },
  { id: 'docker-desktop', connector: 'docker', appType: 'Application', appName: 'Docker Desktop', processName: 'Docker Desktop.exe', publisher: 'Docker', category: 'Developer tools', verified: false },
  { id: 'figma', connector: 'figma', appType: 'Application', appName: 'Figma', processName: 'Figma.exe', publisher: 'Figma', category: 'Design', verified: false },
  { id: 'slack', connector: 'slack', appType: 'Application', appName: 'Slack', processName: 'slack.exe', publisher: 'Salesforce', category: 'Collaboration', verified: false },
  { id: 'zoom', connector: 'zoom', appType: 'Application', appName: 'Zoom', processName: 'Zoom.exe', publisher: 'Zoom', category: 'Collaboration', verified: false },

  // Extensions (detected inside the parent app's process tree)
  { id: 'github-copilot', connector: 'copilot', appType: 'Extension', appName: 'GitHub Copilot', processName: 'github-copilot', parentApp: 'Visual Studio Code', subscriptionType: 'Copilot Enterprise', publisher: 'GitHub', category: 'AI assistant', verified: false, note: 'Built-in detection rule for the Copilot extension host in VS Code.' },
  { id: 'codex-vscode', connector: 'codex', appType: 'Extension', appName: 'Codex', processName: 'codex', parentApp: 'Visual Studio Code', subscriptionType: 'ChatGPT Enterprise', publisher: 'OpenAI', category: 'AI assistant', verified: false, note: 'Built-in detection rule (codex.exe / codex in VS Code).' },

  // Web apps
  { id: 'claude-web', connector: 'claude', appType: 'Web URL', appName: 'Claude (web)', url: 'claude.ai', publisher: 'Anthropic', category: 'AI assistant', verified: false },
  { id: 'chatgpt-web', connector: 'chatgpt', appType: 'Web URL', appName: 'ChatGPT (web)', url: 'chatgpt.com', publisher: 'OpenAI', category: 'AI assistant', verified: false },
  { id: 'copilot-web', connector: 'copilot', appType: 'Web URL', appName: 'GitHub Copilot (github.com)', url: 'github.com/copilot', publisher: 'GitHub', category: 'AI assistant', verified: false },
  { id: 'figma-web', connector: 'figma', appType: 'Web URL', appName: 'Figma (web)', url: 'figma.com', publisher: 'Figma', category: 'Design', verified: false },
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
