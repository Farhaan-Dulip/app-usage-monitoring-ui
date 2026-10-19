import { useMemo, useState } from 'react';
import { APP_CATALOG, inventoryMatch } from '../data/appCatalog';
import AppInventoryIcon from './AppInventoryIcon';
import ConnectDialog, { integrationBadge, useIntegrations } from './ConnectDialog';

const TYPE_ICON = { Application: '▣', Extension: '⧉', 'Web URL': '◎' };

// Recognised apps: how the Tracker detects each one, whether it is already in
// the inventory, and Connect for apps whose vendor admin API is integrated.
export default function AppCatalog({ inventory, isOpen, onClose }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [connecting, setConnecting] = useState(null);
  const [integrations, reloadIntegrations] = useIntegrations();
  const vendorStatus = (vendor) => integrations?.vendors.find((item) => item.vendor === vendor);
  const categories = useMemo(
    () => [...new Set(APP_CATALOG.filter((entry) => entry.appType === 'Application').map((entry) => entry.category))].sort(),
    []
  );

  const matches = (entry) => {
    const text = `${entry.appName} ${entry.publisher} ${entry.processName || ''} ${entry.url || ''}`.toLowerCase();
    return (!search || text.includes(search.trim().toLowerCase())) && (!category || entry.category === category);
  };

  if (!isOpen) return null;

  return (
    <div
      className="app-catalog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="app-catalog-modal" role="dialog" aria-modal="true" aria-labelledby="app-catalog-title">
      <div className="app-catalog-modal-header">
        <div>
          <p className="eyebrow">App catalog</p>
          <h2 id="app-catalog-title">Recognised apps</h2>
          <p>Start from a known app: the detection details are filled in for you. Adding it to the inventory is still your decision, with your owner and cost.</p>
        </div>
        <button className="settings-close-button" type="button" aria-label="Close recognised apps" onClick={onClose}>&times;</button>
      </div>
      <div className="app-catalog-modal-content">
        <div className="catalog-filters">
          <label className="filter-control">
            <span>Search</span>
            <input type="search" placeholder="Postman, Copilot…" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <label className="filter-control">
            <span>Category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">All categories</option>
              {categories.map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
        </div>
      <div className="catalog-section">
        <div className="catalog-section-header">
          <h3>Applications</h3>
          <small>Desktop apps the Tracker recognises by process name.</small>
        </div>
        <div className="catalog-grid">
          {APP_CATALOG.filter((entry) => entry.appType === 'Application' && matches(entry)).map((entry) => {
                const existing = inventoryMatch(entry, inventory);
                return (
                  <article className={`catalog-card${existing ? ' catalog-card-added' : ''}`} key={entry.id}>
                    <div className="catalog-card-details">
                    <div className="catalog-card-head">
                        <AppInventoryIcon appName={entry.appName} className="catalog-icon" />
                      <div>
                        <strong>{entry.appName}</strong>
                        <small>{entry.publisher} · {entry.category}</small>
                      </div>
                    </div>
                    <dl className="catalog-detection">
                      <dt>{entry.appType === 'Web URL' ? 'Site' : entry.appType === 'Extension' ? 'Detected as' : 'Process'}</dt>
                      <dd><code>{entry.url || entry.processName}</code></dd>
                      {entry.parentApp && (<><dt>Runs in</dt><dd>{entry.parentApp}</dd></>)}
                    </dl>
                    {entry.note && <small className="catalog-note">{entry.note}</small>}
                    </div>
                    <div className="catalog-card-actions">
                      <span className={`status-badge ${integrationBadge(vendorStatus(entry.connector), entry.connector).className}`}>
                        {integrationBadge(vendorStatus(entry.connector), entry.connector).label}
                      </span>
                      {existing && <span className="status-badge status-active">In inventory</span>}
                      <button className="download-link-button" type="button" onClick={() => setConnecting(entry.connector)}>
                        Connect
                      </button>
                    </div>
                  </article>
                );
          })}
        </div>
      </div>
      </div>
    </section>
    {connecting && (
      <ConnectDialog
        vendor={connecting}
        status={vendorStatus(connecting)}
        canConnect={Boolean(integrations?.canConnect)}
        onClose={() => setConnecting(null)}
        onChanged={reloadIntegrations}
      />
    )}
    </div>
  );
}
