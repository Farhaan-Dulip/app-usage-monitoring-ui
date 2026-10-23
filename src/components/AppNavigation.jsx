import { useState } from 'react';
import allionLogo from '../assets/allion-logo.png';
import NetworkCanvas from './NetworkCanvas';

function NavIcon({ type }) {
  const icons = {
    dashboard: <><path d="M3 8a5 5 0 0 1 10 0" /><path d="M4.5 12.5h7" /><path d="m8 8 2.6-2.6" /><path d="M8 8h.01" /></>,
    software: <><path d="M3 4.5h10v7H3z" /><path d="M5 14h6" /><path d="M8 11.5V14" /><path d="M5 7h2" /><path d="M5 9h4" /></>,
    tracker: <><path d="M5 5.5h6v5H5z" /><path d="M8 5.5V3.5" /><path d="M4 8H2.5" /><path d="M13.5 8H12" /><path d="M6.5 8h.01" /><path d="M9.5 8h.01" /><path d="M6 12.5h4" /></>,
    reports: <><path d="M4.5 2.75h5.2L12.5 5.6v7.65h-8z" /><path d="M9.5 2.9v3h2.85" /><path d="M6.25 8.25h4" /><path d="M6.25 10.5h2.5" /><path d="M6.25 12.75h3.25" /></>,
    assistant: <><path d="M3 4.25h10v7H8l-3.25 2v-2H3z" /><path d="M5.5 7.75h.01" /><path d="M8 7.75h.01" /><path d="M10.5 7.75h.01" /></>,
    approvals: <><path d="M4 3.25h8v9.5H4z" /><path d="m6 8 1.25 1.25L10 6.5" /><path d="M6 11.5h4" /></>,
    inventory: <><path d="M3 4.5 8 2.5l5 2-5 2z" /><path d="M3 4.5v6.5l5 2.25 5-2.25V4.5" /><path d="M8 6.5v6.75" /></>,
    aitools: <><path d="M8 2.75 9.2 6.3l3.55 1.2L9.2 8.7 8 12.25 6.8 8.7 3.25 7.5 6.8 6.3z" /><path d="M12.25 11.25v2.5M11 12.5h2.5" /></>,
    signout: <><path d="M6.5 3.25h-2.25a1 1 0 0 0-1 1v7.5a1 1 0 0 0 1 1H6.5" /><path d="M9.75 5.25 12.5 8l-2.75 2.75" /><path d="M12.5 8H6.25" /></>,
    settings: <><circle cx="8" cy="8" r="2.25" /><path d="M8 2.25v1.2M8 12.55v1.2M2.25 8h1.2M12.55 8h1.2" /><path d="m3.95 3.95.85.85m6.4 6.4.85.85m0-8.1-.85.85m-6.4 6.4-.85.85" /></>,
  };

  return (
    <svg aria-hidden="true" className="nav-icon" fill="none" focusable="false" viewBox="0 0 16 16">
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5">
        {icons[type]}
      </g>
    </svg>
  );
}

// Remembered per browser: the panel kept open, or hover-to-open (default).
const PIN_STORAGE_KEY = 'allionone-nav-pinned';

function readPinned() {
  try {
    return window.localStorage.getItem(PIN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

// Drawer icon: the panel outline with an arrow out (keep open) or in (collapse).
function DrawerIcon({ open }) {
  return (
    <svg aria-hidden="true" className="nav-icon" fill="none" focusable="false" viewBox="0 0 16 16">
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4">
        <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2" />
        <path d="M6 2.75v10.5" />
        {open ? <path d="m10.75 6.25-1.75 1.75 1.75 1.75" /> : <path d="m9 6.25 1.75 1.75L9 9.75" />}
      </g>
    </svg>
  );
}

const navigationItems = [
  ['unified-dashboard', 'dashboard', 'Dashboard'],
  ['dashboard', 'software', 'License Utilizations'],
  ['agent-management', 'tracker', 'Tracker Management'],
  ['apps-inventory', 'inventory', 'Enterprise Apps Inventory'],
  ['reporting-insights', 'reports', 'Reporting & Insights'],
  ['license-approvals', 'approvals', 'Request Approvals'],
  ['ai-assistant', 'assistant', 'AI Assistant'],
];

export default function AppNavigation({
  activeView,
  collapsed,
  isSettingsOpen,
  onNavigate,
  onOpenSettings,
  onResetCollapse,
  user,
  onSignOut,
}) {
  const [pinned, setPinned] = useState(readPinned);
  // After "collapse in", stay collapsed until the pointer leaves, like after a menu click.
  const [collapsedByToggle, setCollapsedByToggle] = useState(false);

  const togglePinned = (event) => {
    const next = !pinned;
    setPinned(next);
    setCollapsedByToggle(!next);
    try {
      window.localStorage.setItem(PIN_STORAGE_KEY, String(next));
    } catch {
      // Not remembered across visits when storage is blocked.
    }
    if (!next) event.currentTarget.blur();
  };

  const className = pinned
    ? 'top-nav nav-pinned'
    : collapsed || collapsedByToggle
      ? 'top-nav nav-collapsed-after-select'
      : 'top-nav';

  return (
    <nav
      className={className}
      aria-label="Primary navigation"
      onMouseLeave={() => {
        setCollapsedByToggle(false);
        onResetCollapse();
      }}
    >
      <NetworkCanvas className="nav-network" area={5000} maxNodes={40} reach={90} />
      <div className="brand-mark">
        <span className="brand-icon"><img src={allionLogo} alt="" width="34" height="34" /></span>
        <span className="brand-name">Allion<strong>One</strong></span>
        <button
          className="nav-pin"
          type="button"
          aria-pressed={pinned}
          aria-label={pinned ? 'Collapse navigation' : 'Keep navigation open'}
          title={pinned ? 'Collapse navigation' : 'Keep navigation open'}
          onClick={togglePinned}
        >
          <DrawerIcon open={pinned} />
        </button>
      </div>
      <div className="nav-actions">
        {navigationItems.map(([view, icon, label]) => (
          <button
            className={activeView === view ? 'nav-link active' : 'nav-link'}
            key={view}
            type="button"
            onClick={(event) => onNavigate(event, view)}
          >
            <span className="nav-glyph"><NavIcon type={icon} /></span>
            <span className="nav-label">{label}</span>
          </button>
        ))}
      </div>
      <div className="nav-settings">
        <button
          className="nav-link"
          type="button"
          aria-haspopup="dialog"
          aria-expanded={isSettingsOpen}
          onClick={onOpenSettings}
        >
          <span className="nav-glyph"><NavIcon type="settings" /></span>
          <span className="nav-label">Settings</span>
        </button>
        {onSignOut && (
          <button className="nav-link" type="button" title={user?.email || ''} onClick={onSignOut}>
            <span className="nav-glyph"><NavIcon type="signout" /></span>
            <span className="nav-label">Sign out{user?.name ? ` (${user.name})` : ''}</span>
          </button>
        )}
      </div>
    </nav>
  );
}
