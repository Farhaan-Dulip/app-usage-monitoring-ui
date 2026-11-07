import { useEffect, useMemo, useState } from 'react';
import { APP_CATALOG, CATALOG_GROUPS, catalogGroup, inventoryMatch } from '../data/appCatalog';
import AppInventoryIcon from './AppInventoryIcon';
import { apiAccessAvailable, useIntegrations } from './ConnectDialog';

// Recognised apps in three groups (End User Apps, Enterprise Infra Platform,
// AI Agents & Tools): how each is detected, and whether its vendor admin API is
// connected (connecting happens in the app's plans modal).
export default function AppCatalog({ inventory, isOpen, onClose, onSelect, plansOpen = false }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [integrations, reloadIntegrations] = useIntegrations();
  // A vendor may have been connected from the plans modal over this catalog.
  useEffect(() => {
    if (!plansOpen) reloadIntegrations();
  }, [plansOpen, reloadIntegrations]);
  const vendorStatus = (vendor) => integrations?.vendors.find((item) => item.vendor === vendor);
  const categories = useMemo(
    () => [...new Set(APP_CATALOG.map((entry) => entry.category))].sort(),
    []
  );

  const matches = (entry) => {
    const text = `${entry.appName} ${entry.publisher} ${entry.processName || ''} ${entry.url || ''} ${entry.api || ''}`.toLowerCase();
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
          <p>Click an app to open its plans. Detection details are filled in for you, and apps not in your inventory yet are added when you save.</p>
        </div>
        <button className="settings-close-button" type="button" aria-label="Close recognised apps" onClick={onClose}>&times;</button>
      </div>
      <div className="app-catalog-modal-content">
        <div className="catalog-filters">
          <label className="filter-control">
            <span>Search</span>
            <input type="search" placeholder="Postman, Azure, Copilot…" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <label className="filter-control">
            <span>Category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">All categories</option>
              {categories.map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
        </div>
      {CATALOG_GROUPS.map((group) => {
        // Web apps and surfaces of another app (Claude Code under Claude) aren't cards of their own.
        const entries = APP_CATALOG.filter((entry) => entry.appType !== 'Web URL' && !entry.autoDetected && catalogGroup(entry) === group.id && matches(entry));
        if (!entries.length) return null;
        return (
      <div className="catalog-section" key={group.id}>
        <div className="catalog-section-header">
          <h3>{group.title}</h3>
          <small>{group.description}</small>
        </div>
        <div className="catalog-grid">
          {entries.map((entry) => {
                const existing = inventoryMatch(entry, inventory);
                // Platforms are tracked through their admin APIs, not the inventory form.
                const selectable = entry.appType !== 'Platform';
                return (
                  <article
                    className={`catalog-card${existing ? ' catalog-card-added' : ''}${selectable ? ' catalog-card-selectable' : ''}`}
                    key={entry.id}
                    onClick={selectable ? () => onSelect(entry) : undefined}
                  >
                    <div className="catalog-card-details">
                    <div className="catalog-card-head">
                        <AppInventoryIcon appName={entry.appName} className="catalog-icon" />
                      <div>
                        {selectable ? (
                          <button className="catalog-card-open" type="button">
                            {entry.appName}
                          </button>
                        ) : (
                          <strong>{entry.appName}</strong>
                        )}
                        <small title={`${entry.publisher} · ${entry.category}`}>{entry.publisher} · {entry.category}</small>
                      </div>
                    </div>
                    <dl className="catalog-detection">
                      <dt>{entry.appType === 'Platform' ? 'API' : entry.appType === 'Web URL' ? 'Site' : entry.appType === 'Extension' ? 'Detected as' : 'Process'}</dt>
                      {entry.appType === 'Platform'
                        ? <dd className="catalog-api" title={entry.api}>{entry.api}</dd>
                        : <dd title={entry.url || entry.processName}><code>{entry.url || entry.processName}</code></dd>}
                      {entry.parentApp && (<><dt>Runs in</dt><dd title={entry.parentApp}>{entry.parentApp}</dd></>)}
                    </dl>
                    {entry.note && <small className="catalog-note">{entry.note}</small>}
                    </div>
                    <span className={`catalog-api-access${apiAccessAvailable(vendorStatus(entry.connector), entry.connector) ? ' available' : ''}`}>
                      API access {apiAccessAvailable(vendorStatus(entry.connector), entry.connector) ? 'available' : 'not available'}
                    </span>
                  </article>
                );
          })}
        </div>
      </div>
        );
      })}
      {!APP_CATALOG.some((entry) => entry.appType !== 'Web URL' && !entry.autoDetected && matches(entry)) && <p className="muted-value">No recognised app matches your search.</p>}
      </div>
    </section>
    </div>
  );
}
