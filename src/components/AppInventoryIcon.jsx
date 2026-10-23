import {
  siAtlassian,
  siClaude,
  siDatadog,
  siCursor,
  siDocker,
  siFigma,
  siGithubcopilot,
  siIntellijidea,
  siPostman,
  siSnowflake,
  siZoom,
} from 'simple-icons';

// Real logos from Simple Icons (CC0 brand SVGs), drawn in white on the brand
// colour. Visual Studio Code, Visual Studio, ChatGPT/Codex (OpenAI) and Slack
// are not in Simple Icons at their owners' request, and their official assets
// come with brand terms, so they keep a lettered tile in the brand colour.
const LOGOS = {
  postman: siPostman,
  'intellij idea': siIntellijidea,
  cursor: siCursor,
  claude: siClaude,
  'claude (web)': siClaude,
  'docker desktop': siDocker,
  figma: siFigma,
  'figma (web)': siFigma,
  zoom: siZoom,
  'github copilot': siGithubcopilot,
  'github copilot (github.com)': siGithubcopilot,
  snowflake: siSnowflake,
  datadog: siDatadog,
  atlassian: siAtlassian,
};

const APP_ICON_DETAILS = {
  postman: { label: 'P', color: '#ff6c37' },
  'visual studio code': { label: '⌁', color: '#007acc' },
  'visual studio': { label: 'VS', color: '#5c2d91' },
  'intellij idea': { label: 'IJ', color: '#111111' },
  cursor: { label: 'C', color: '#171717' },
  claude: { label: 'AI', color: '#cc785c' },
  'claude (web)': { label: 'AI', color: '#cc785c' },
  chatgpt: { label: '◎', color: '#10a37f' },
  'chatgpt (web)': { label: '◎', color: '#10a37f' },
  'docker desktop': { label: 'D', color: '#2496ed' },
  figma: { label: 'F', color: '#a259ff' },
  'figma (web)': { label: 'F', color: '#a259ff' },
  slack: { label: 'S', color: '#4a154b' },
  zoom: { label: 'Z', color: '#2d8cff' },
  'github copilot': { label: '⌘', color: '#24292f' },
  codex: { label: 'C', color: '#10a37f' },
  'github copilot (github.com)': { label: '⌘', color: '#24292f' },
  // Microsoft's brands are not in Simple Icons: a lettered tile in Azure blue.
  'microsoft azure': { label: 'Az', color: '#0078d4' },
  snowflake: { label: 'S', color: '#29b5e8' },
  datadog: { label: 'D', color: '#632ca6' },
  atlassian: { label: 'A', color: '#0052cc' },
};

export default function AppInventoryIcon({ appName, className = '' }) {
  const key = String(appName || '').toLowerCase();
  const details = APP_ICON_DETAILS[key] || {
    label: String(appName || '?').trim().charAt(0).toUpperCase() || '?',
    color: '#52708f',
  };
  const logo = LOGOS[key];

  return (
    <span
      aria-hidden="true"
      className={`app-inventory-icon ${logo ? 'app-inventory-logo' : ''} ${className}`.trim().replace(/\s+/g, ' ')}
      style={{ '--app-icon-color': details.color }}
    >
      {logo ? (
        <svg viewBox="0 0 24 24" focusable="false">
          <path d={logo.path} />
        </svg>
      ) : (
        details.label
      )}
    </span>
  );
}
