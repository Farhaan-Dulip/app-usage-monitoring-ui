import {
  siClaude,
  siDatadog,
  siFigma,
  siGithubcopilot,
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
  claude: siClaude,
  'claude (web)': siClaude,
  figma: siFigma,
  'figma (web)': siFigma,
  zoom: siZoom,
  'github copilot': siGithubcopilot,
  'github copilot (github.com)': siGithubcopilot,
  snowflake: siSnowflake,
  datadog: siDatadog,
};

const APP_ICON_DETAILS = {
  postman: { label: 'P', color: '#ff6c37' },
  'visual studio code': { label: '⌁', color: '#007acc' },
  claude: { label: 'AI', color: '#cc785c' },
  'claude (web)': { label: 'AI', color: '#cc785c' },
  figma: { label: 'F', color: '#a259ff' },
  'figma (web)': { label: 'F', color: '#a259ff' },
  zoom: { label: 'Z', color: '#2d8cff' },
  'github copilot': { label: '⌘', color: '#24292f' },
  codex: { label: 'C', color: '#10a37f' },
  'github copilot (github.com)': { label: '⌘', color: '#24292f' },
  // Microsoft's brands are not in Simple Icons: a lettered tile in Azure blue.
  'microsoft azure': { label: 'Az', color: '#0078d4' },
  snowflake: { label: 'S', color: '#29b5e8' },
  datadog: { label: 'D', color: '#632ca6' },
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
