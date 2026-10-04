function NavIcon({ type }) {
  const icons = {
    brand: <><path d="M5.5 7.5h5A2.5 2.5 0 0 1 13 10v1.5A2.5 2.5 0 0 1 10.5 14h-5A2.5 2.5 0 0 1 3 11.5V10a2.5 2.5 0 0 1 2.5-2.5Z" /><path d="M8 7.5V4" /><path d="M6.25 11h.01" /><path d="M9.75 11h.01" /><path d="M6.5 14v1" /><path d="M9.5 14v1" /></>,
    dashboard: <><path d="M3 8a5 5 0 0 1 10 0" /><path d="M4.5 12.5h7" /><path d="m8 8 2.6-2.6" /><path d="M8 8h.01" /></>,
    software: <><path d="M3 4.5h10v7H3z" /><path d="M5 14h6" /><path d="M8 11.5V14" /><path d="M5 7h2" /><path d="M5 9h4" /></>,
    tracker: <><path d="M5 5.5h6v5H5z" /><path d="M8 5.5V3.5" /><path d="M4 8H2.5" /><path d="M13.5 8H12" /><path d="M6.5 8h.01" /><path d="M9.5 8h.01" /><path d="M6 12.5h4" /></>,
    reports: <><path d="M4.5 2.75h5.2L12.5 5.6v7.65h-8z" /><path d="M9.5 2.9v3h2.85" /><path d="M6.25 8.25h4" /><path d="M6.25 10.5h2.5" /><path d="M6.25 12.75h3.25" /></>,
    assistant: <><path d="M3 4.25h10v7H8l-3.25 2v-2H3z" /><path d="M5.5 7.75h.01" /><path d="M8 7.75h.01" /><path d="M10.5 7.75h.01" /></>,
    approvals: <><path d="M4 3.25h8v9.5H4z" /><path d="m6 8 1.25 1.25L10 6.5" /><path d="M6 11.5h4" /></>,
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

const navigationItems = [
  ['unified-dashboard', 'dashboard', 'Dashboard'],
  ['dashboard', 'software', 'Software Licsence Management'],
  ['agent-management', 'tracker', 'Tracker Management'],
  ['reporting-insights', 'reports', 'Reporting & Insights'],
  ['license-approvals', 'approvals', 'License Approvals'],
  ['ai-assistant', 'assistant', 'AI Assistant'],
];

export default function AppNavigation({
  activeView,
  collapsed,
  isSettingsOpen,
  onNavigate,
  onOpenSettings,
  onResetCollapse,
}) {
  return (
    <nav
      className={collapsed ? 'top-nav nav-collapsed-after-select' : 'top-nav'}
      aria-label="Primary navigation"
      onMouseLeave={onResetCollapse}
    >
      <div className="brand-mark">
        <span className="brand-icon"><NavIcon type="brand" /></span>
        <span>AgentOps</span>
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
      </div>
    </nav>
  );
}
