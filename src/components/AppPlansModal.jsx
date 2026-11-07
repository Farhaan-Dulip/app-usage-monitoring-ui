import { useEffect, useId, useRef, useState } from 'react';
import { PRODUCT_PLANS, findCatalogSurface } from '../data/appCatalog';
import { BILLING_CYCLES, emptyPlan, normalizePlan, planError } from '../utils/appPlans';
import AppInventoryIcon from './AppInventoryIcon';
import ConnectDialog, { integrationBadge, useIntegrations } from './ConnectDialog';

// Plans and tracker detection for one inventory app, opened from its row.
// Plans are entered by hand for now; a connected vendor shows its status here.
export default function AppPlansModal({ app, bundledApps, onClose, onSave }) {
  const titleId = useId();
  const listId = useId();
  const dialogRef = useRef(null);
  const [plans, setPlans] = useState(() => (app.plans?.length ? app.plans.map((plan) => ({ ...plan })) : []));
  const [noPlanNeeded, setNoPlanNeeded] = useState(Boolean(app.noPlanNeeded));
  const [processName, setProcessName] = useState(app.processName || '');
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(null);
  const [integrations, reloadIntegrations] = useIntegrations();

  const catalog = findCatalogSurface(app);
  const vendor = catalog?.connector;
  const vendorStatus = integrations?.vendors.find((item) => item.vendor === vendor);
  const badge = vendor ? integrationBadge(vendorStatus, vendor) : null;
  const planOptions = PRODUCT_PLANS[catalog?.product] || [];
  const needsProcess = app.appType !== 'Web URL';

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const updatePlan = (id, field, value) => {
    setError('');
    setPlans((current) => current.map((plan) => (plan.id === id ? { ...plan, [field]: value } : plan)));
  };

  const save = (event) => {
    event.preventDefault();
    if (needsProcess && !processName.trim()) {
      setError('Enter the process name so the tracker can find this app.');
      return;
    }
    if (!noPlanNeeded) {
      const failing = plans.map((plan, index) => ({ index, problem: planError(plan) })).find((item) => item.problem);
      if (failing) {
        setError(plans.length > 1 ? `Plan ${failing.index + 1}: ${failing.problem}` : failing.problem);
        return;
      }
    }
    onSave({
      processName: processName.trim(),
      noPlanNeeded,
      plans: noPlanNeeded ? [] : plans.map(normalizePlan),
    });
  };

  return (
    <div
      className="app-catalog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="app-catalog-modal app-plans-modal"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !connecting) onClose();
        }}
      >
        <form onSubmit={save}>
          <div className="app-plans-header">
            <AppInventoryIcon appName={app.appName} className="inventory-list-icon" />
            <div>
              <h2 id={titleId}>{app.appName}</h2>
              <p>{app.appType}{app.parentApp ? ` in ${app.parentApp}` : ''}</p>
            </div>
            <button aria-label="Close" className="app-plans-close" type="button" onClick={onClose}>×</button>
          </div>

          <div className="app-plans-body">
            {vendor && (
              <div className="app-plans-connection">
                <span className={`status-badge ${badge.className}`}>{badge.label}</span>
                <span>
                  {vendorStatus?.connected
                    ? 'Enter plans below for now. Filling them in from the vendor comes next.'
                    : 'Enter plans below, or connect the vendor to bring in its seats and activity.'}
                </span>
                {!vendorStatus?.connected && (
                  <button className="download-link-button" type="button" onClick={() => setConnecting(vendor)}>
                    Connect vendor
                  </button>
                )}
              </div>
            )}

            <section className="app-plans-section">
              <div className="app-plans-section-title">
                <h3>Plans</h3>
                <label className="app-plans-free">
                  <input
                    checked={noPlanNeeded}
                    type="checkbox"
                    onChange={(event) => {
                      setError('');
                      setNoPlanNeeded(event.target.checked);
                    }}
                  />
                  Free, no plan needed
                </label>
              </div>
              {!noPlanNeeded && (
                <>
                  <datalist id={listId}>
                    {planOptions.map((option) => <option key={option} value={option} />)}
                  </datalist>
                  {plans.length === 0 && <p className="app-plans-empty">Add the plans your company has bought for this app.</p>}
                  {plans.map((plan, index) => (
                    <fieldset className="app-plan" key={plan.id}>
                      <legend>Plan {index + 1}</legend>
                      <button
                        aria-label={`Remove plan ${index + 1}`}
                        className="policy-icon-button policy-icon-button-remove app-plan-remove"
                        type="button"
                        onClick={() => setPlans((current) => current.filter((item) => item.id !== plan.id))}
                      >
                        <span aria-hidden="true">×</span>
                      </button>
                      <label>
                        <span>Plan name</span>
                        <input
                          list={listId}
                          placeholder={planOptions[0] || 'Business'}
                          type="text"
                          value={plan.planName}
                          onChange={(event) => updatePlan(plan.id, 'planName', event.target.value)}
                        />
                      </label>
                      <label>
                        <span>Seats</span>
                        <input min="1" placeholder="50" step="1" type="number" value={plan.seats} onChange={(event) => updatePlan(plan.id, 'seats', event.target.value)} />
                      </label>
                      <label>
                        <span>Price per seat</span>
                        <input min="0" placeholder="25" step="0.01" type="number" value={plan.pricePerSeat} onChange={(event) => updatePlan(plan.id, 'pricePerSeat', event.target.value)} />
                      </label>
                      <label>
                        <span>Billing cycle</span>
                        <select value={plan.billingCycle} onChange={(event) => updatePlan(plan.id, 'billingCycle', event.target.value)}>
                          {BILLING_CYCLES.map((cycle) => <option key={cycle}>{cycle}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>Start date</span>
                        <input type="date" value={plan.startDate} onChange={(event) => updatePlan(plan.id, 'startDate', event.target.value)} />
                      </label>
                      <label>
                        <span>Renewal date</span>
                        <input type="date" value={plan.renewalDate} onChange={(event) => updatePlan(plan.id, 'renewalDate', event.target.value)} />
                      </label>
                      <label>
                        <span>Notice period (days)</span>
                        <input min="0" placeholder="30" step="1" type="number" value={plan.noticeDays} onChange={(event) => updatePlan(plan.id, 'noticeDays', event.target.value)} />
                      </label>
                      <label className="app-plan-renew">
                        <input checked={Boolean(plan.autoRenew)} type="checkbox" onChange={(event) => updatePlan(plan.id, 'autoRenew', event.target.checked)} />
                        <span>Auto-renews</span>
                      </label>
                    </fieldset>
                  ))}
                  <button
                    className="download-link-button app-plans-add"
                    type="button"
                    onClick={() => setPlans((current) => [...current, emptyPlan()])}
                  >
                    + Add plan
                  </button>
                </>
              )}
            </section>

            <section className="app-plans-section">
              <div className="app-plans-section-title"><h3>Tracker detection</h3></div>
              {needsProcess ? (
                <label className="app-plans-process">
                  <span>Process name</span>
                  <input
                    placeholder="code.exe"
                    type="text"
                    value={processName}
                    onChange={(event) => {
                      setError('');
                      setProcessName(event.target.value);
                    }}
                  />
                  <small>The program the tracker looks for on each PC.</small>
                </label>
              ) : (
                <p className="app-plans-empty">Web address: {app.url}</p>
              )}
              {bundledApps.length > 0 && (
                <p className="app-plans-empty">Also tracked with this license: {bundledApps.map((item) => item.appName).join(', ')}</p>
              )}
            </section>
          </div>

          <div className="app-plans-footer">
            {error && <p className="app-plans-error" role="alert">{error}</p>}
            <button className="download-link-button" type="button" onClick={onClose}>Cancel</button>
            <button className="deploy-agent-button" type="submit">Save</button>
          </div>
        </form>
        {connecting && (
          <ConnectDialog
            vendor={connecting}
            status={vendorStatus}
            canConnect={Boolean(integrations?.canConnect)}
            onClose={() => setConnecting(null)}
            onChanged={reloadIntegrations}
          />
        )}
      </section>
    </div>
  );
}
