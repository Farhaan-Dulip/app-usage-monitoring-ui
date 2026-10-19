import { useCallback, useEffect, useState } from 'react';

const BACKEND_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

const FLAG = {
  over: { label: 'Over budget', className: 'status-reclaimable' },
  near: { label: 'Near budget', className: 'status-observing' },
  low: { label: 'Low use', className: 'status-neutral' },
  ok: { label: 'On track', className: 'status-active' },
};

function formatSpend(value, unit) {
  if (value === null || value === undefined) return '—';
  if (unit === 'USD') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value < 100 ? 2 : 0 }).format(value);
  }
  const amount = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
  return `${amount} ${unit === 'AI credits' ? 'AI cr' : 'cr'}`;
}

async function saveBudget(vendor, email, monthlyBudget) {
  const response = await fetch(`${BACKEND_BASE_URL}/api/ai-tools/budgets`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vendor, email, monthlyBudget }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Unable to save the budget');
}

// Month-to-date spend against budget for one person and tool; budget editable inline.
function BudgetCell({ vendorId, email, tool, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  if (!tool) return <td><span className="muted-value">No account</span></td>;
  const flag = FLAG[tool.flag];
  const width = `${Math.min(100, Math.round((tool.used || 0) * 100))}%`;

  const submit = async (value) => {
    try {
      await saveBudget(vendorId, email, value);
      setEditing(false);
      setError('');
      onSaved();
    } catch (saveError) {
      setError(saveError.message);
    }
  };

  return (
    <td>
      <div className="budget-cell">
        <strong>{formatSpend(tool.spend, tool.unit)}</strong>
        <small>of {formatSpend(tool.budget, tool.unit)}{tool.budgetIsDefault ? ' (default)' : ''}</small>
        <div className="budget-bar"><span className={flag ? flag.className : ''} style={{ width }} /></div>
        {flag && <span className={`status-badge ${flag.className}`}>{flag.label}</span>}
        {editing ? (
          <form className="budget-edit" onSubmit={(event) => { event.preventDefault(); submit(draft); }}>
            <input aria-label="Monthly budget" type="number" min="0" step="any" value={draft} onChange={(event) => setDraft(event.target.value)} />
            <button className="download-link-button" type="submit">Save</button>
            {!tool.budgetIsDefault && <button className="download-link-button" type="button" onClick={() => submit(null)}>Use default</button>}
            <button className="download-link-button" type="button" onClick={() => setEditing(false)}>Cancel</button>
          </form>
        ) : (
          <button className="link-button" type="button" onClick={() => { setDraft(String(tool.budget ?? '')); setEditing(true); }}>Edit budget</button>
        )}
        {error && <small className="ai-tool-error">{error}</small>}
      </div>
    </td>
  );
}

// Budgets vs month-to-date spend per person and tool, with the directory
// (employee ID, manager) and a manager roll-up.
export default function PeopleBudgets() {
  const [report, setReport] = useState(null);
  const [manager, setManager] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(() => {
    fetch(`${BACKEND_BASE_URL}/api/ai-tools/people`)
      .then((response) => {
        if (!response.ok) throw new Error(`People report failed with status ${response.status}`);
        return response.json();
      })
      .then(setReport)
      .catch((loadError) => setStatus(loadError.message));
  }, []);

  useEffect(() => load(), [load]);

  const importCsv = async (file) => {
    if (!file) return;
    try {
      const response = await fetch(`${BACKEND_BASE_URL}/api/ai-tools/directory`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: await file.text(),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Import failed');
      const skipped = payload.rejectedRows.length ? ` Skipped rows without a valid email: ${payload.rejectedRows.join(', ')}.` : '';
      setStatus(`Imported ${payload.imported} people.${skipped}`);
      load();
    } catch (importError) {
      setStatus(importError.message);
    }
  };

  const setDefault = async (vendor, current) => {
    const value = window.prompt(`Default monthly budget for ${vendor.name} (${vendor.unit})`, String(current));
    if (value === null) return;
    try {
      await saveBudget(vendor.id, '*', value);
      load();
    } catch (saveError) {
      setStatus(saveError.message);
    }
  };

  if (!report) return status ? <p className="ai-tool-note ai-tool-error">{status}</p> : null;
  const managers = report.managers.map((team) => team.managerName);
  const people = report.people.filter((person) => !manager || (person.managerName || 'No manager on record') === manager);
  const teams = report.managers.filter((team) => !manager || team.managerName === manager);

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>People &amp; budgets</h2>
          <p>Month-to-date spend against each person&apos;s monthly budget, with their manager and employee ID.</p>
        </div>
        <label className="filter-control">
          <span>Manager</span>
          <select value={manager} onChange={(event) => setManager(event.target.value)}>
            <option value="">All managers</option>
            {managers.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </div>

      {!report.directoryImported && (
        <p className="ai-tool-note">
          No people directory imported yet, so sample people have a sample manager and employee ID and real people show none.
          Import a CSV export from HR or Entra ID with an <strong>Email</strong> column and any of
          {' '}<strong>Name, Employee ID, Manager&apos;s Name, Manager Email, Department</strong>.
        </p>
      )}
      <div className="ai-tool-actions">
        <label className="download-link-button">
          Import people (CSV)
          <input hidden type="file" accept=".csv,text/csv" onChange={(event) => { importCsv(event.target.files?.[0]); event.target.value = ''; }} />
        </label>
        {report.vendors.map((vendor) => (
          <button className="download-link-button" key={vendor.id} type="button" onClick={() => setDefault(vendor, report.defaults[vendor.id])}>
            {vendor.name} default: {formatSpend(report.defaults[vendor.id], vendor.unit)}
          </button>
        ))}
      </div>
      {status && <p className="ai-tool-note">{status}</p>}

      <h3 className="ai-tool-subheading">Manager roll-up</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Manager</th>
              <th>People</th>
              {report.vendors.map((vendor) => <th key={vendor.id}>{vendor.name}: spend / budget</th>)}
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <tr key={team.managerName}>
                <td><strong>{team.managerName}</strong>{team.managerEmail && <small>{team.managerEmail}</small>}</td>
                <td>{team.people}</td>
                {report.vendors.map((vendor) => {
                  const totals = team.tools[vendor.id];
                  return (
                    <td key={vendor.id}>
                      {totals ? (
                        <>
                          <strong>{formatSpend(totals.spend, totals.unit)} / {formatSpend(totals.budget, totals.unit)}</strong>
                          <small>{totals.users} users{totals.over ? `, ${totals.over} over` : ''}{totals.low ? `, ${totals.low} low use` : ''}</small>
                        </>
                      ) : <span className="muted-value">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="ai-tool-subheading">People</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Employee ID</th>
              <th>Manager</th>
              {report.vendors.map((vendor) => <th key={vendor.id}>{vendor.name} (MTD)</th>)}
              <th>Copilot pattern</th>
              <th title="Our definition: share of Copilot activity in agent features, blended with the share of active days that used an agent (0-100)">Agentic index</th>
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.email}>
                <td><strong>{person.name}</strong>{person.name !== person.email && <small>{person.email}</small>}</td>
                <td>{person.employeeId || <span className="muted-value">—</span>}</td>
                <td>{person.managerName || <span className="muted-value">Not set</span>}{person.department && <small>{person.department}</small>}</td>
                {report.vendors.map((vendor) => (
                  <BudgetCell key={vendor.id} vendorId={vendor.id} email={person.email} tool={person.tools[vendor.id]} onSaved={load} />
                ))}
                <td>{person.tools.copilot?.pattern || <span className="muted-value">—</span>}</td>
                <td>{person.tools.copilot?.agenticIndex ?? <span className="muted-value">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
