// Reports & Insights > Enterprise Infrastructure Platform (phase 1: read-only
// cost monitoring, infra insights, contracts and renewal periods).
//
// Each platform's raw data is in its vendor API's response format (samples.js
// now; live connectors later, returning the same shape), so the dashboard code
// below is the same for sample and live data. Contracts are mostly contract
// data: a saved record (edited in the portal) replaces the sample one, and
// facts the API knows (Snowflake contract amount and dates, Azure reservation
// expiries) are read from the API data.
import { DAY_MS, isoDay, lastDays } from '../aiTools/http.js';
import { sampleAtlassian, sampleAzure, sampleDatadog, sampleSnowflake } from './samples.js';

export const PLATFORMS = [
  { id: 'azure', name: 'Microsoft Azure', vendor: 'Microsoft', category: 'Cloud infrastructure' },
  { id: 'snowflake', name: 'Snowflake', vendor: 'Snowflake', category: 'Data platform' },
  { id: 'datadog', name: 'Datadog', vendor: 'Datadog', category: 'Observability' },
  { id: 'atlassian', name: 'Atlassian', vendor: 'Atlassian', category: 'Collaboration platform' },
];

export const API_INFO = {
  azure: { name: 'Azure Resource Manager APIs (Entra ID app, read-only)', endpoints: [
    ['POST /providers/Microsoft.CostManagement/query (ActualCost, daily by service; MTD by resource group)', 'docs'],
    ['POST /providers/Microsoft.CostManagement/forecast', 'docs'],
    ['GET /providers/Microsoft.Consumption/budgets', 'docs'],
    ['GET /providers/Microsoft.Advisor/recommendations (Category eq Cost)', 'docs'],
    ['POST /providers/Microsoft.ResourceGraph/resources (orphaned resources query)', 'docs; query fields ours'],
    ['GET /providers/Microsoft.Capacity/reservations (utilization, expiry, renew)', 'docs; fields unverified'],
  ] },
  snowflake: { name: 'Snowflake SQL API (POST /api/v2/statements)', endpoints: [
    ['ORGANIZATION_USAGE.USAGE_IN_CURRENCY_DAILY', 'docs'],
    ['ORGANIZATION_USAGE.CONTRACT_ITEMS', 'docs'],
    ['ORGANIZATION_USAGE.REMAINING_BALANCE_DAILY', 'docs'],
    ['SHOW WAREHOUSES + ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY', 'docs; query ours'],
  ] },
  datadog: { name: 'Datadog Usage Metering and Hosts APIs', endpoints: [
    ['GET /api/v2/usage/estimated_cost', 'docs'],
    ['GET /api/v2/usage/projected_cost', 'docs'],
    ['GET /api/v2/usage/historical_cost', 'docs'],
    ['GET /api/v2/usage/hourly_usage (infra_hosts, apm)', 'docs; fields unverified'],
    ['GET /api/v1/hosts', 'docs'],
  ] },
  atlassian: { name: 'Atlassian Organizations REST API', endpoints: [
    ['GET /admin/v1/orgs/{orgId}/users (product access, last active)', 'docs'],
    ['GET /admin/v2/orgs/{orgId}/workspaces (products, plans)', 'docs; fields unverified'],
    ['Pricing and tiers', 'contract (no public billing API)'],
  ] },
};

const SAMPLES = { azure: sampleAzure, snowflake: sampleSnowflake, datadog: sampleDatadog, atlassian: sampleAtlassian };

// ------------------------------------------------------------------ contracts
const day = (now, offset) => isoDay(now.getTime() + offset * DAY_MS);

export function sampleContract(platformId, now = new Date()) {
  const contracts = {
    azure: { agreement: 'Microsoft Azure Consumption Commitment (MACC), Microsoft Customer Agreement', contractNumber: 'MCA-2025-88213', startDate: day(now, -225), endDate: day(now, 140), commitmentAmount: 600000, consumedAmount: 336400, currency: 'USD', billing: 'Monthly in arrears against the commitment', autoRenew: false, noticeDays: 90, discountPercent: 12, owner: 'Cloud Platform team', notes: 'Azure Databricks and Marketplace purchases count toward the commitment.' },
    snowflake: { agreement: 'Capacity contract, Enterprise edition', contractNumber: '4471', startDate: day(now, -290), endDate: day(now, 75), commitmentAmount: 300000, consumedAmount: null, currency: 'USD', billing: 'Annual prepaid capacity', autoRenew: false, noticeDays: 30, discountPercent: 15, owner: 'Data Engineering', notes: 'Unused capacity can roll over only if renewed at the same or higher amount.' },
    datadog: { agreement: 'Annual committed plan (Pro): 150 infrastructure hosts, 55 APM hosts', contractNumber: 'DD-ORD-2025-1187', startDate: day(now, -325), endDate: day(now, 40), commitmentAmount: 210000, consumedAmount: 189600, currency: 'USD', billing: 'Monthly committed, on-demand billed in arrears', autoRenew: true, noticeDays: 30, discountPercent: 18, owner: 'SRE team', notes: 'Hosts above the commitment are billed at on-demand rates.', units: { infraHosts: 150, apmHosts: 55 } },
    atlassian: { agreement: 'Atlassian Cloud annual subscription: Jira Premium, Confluence Standard, Jira Service Management Standard', contractNumber: 'AT-219-845-662', startDate: day(now, -155), endDate: day(now, 210), commitmentAmount: 69870, consumedAmount: null, currency: 'USD', billing: 'Annual prepaid', autoRenew: true, noticeDays: 30, discountPercent: 0, owner: 'IT Operations', notes: 'Priced by user tier; moving down a tier only takes effect at renewal.', units: { products: [
      { key: 'jira-software', name: 'Jira (Premium)', tier: 250, unitPrice: 15.25 },
      { key: 'confluence', name: 'Confluence (Standard)', tier: 200, unitPrice: 6.05 },
      { key: 'jira-servicedesk', name: 'Jira Service Management (Standard, agents)', tier: 40, unitPrice: 20 },
    ] } },
  };
  return contracts[platformId] ? { ...contracts[platformId], source: 'sample' } : null;
}

const CONTRACT_FIELDS = {
  agreement: 'text', contractNumber: 'text', startDate: 'date', endDate: 'date', commitmentAmount: 'number', consumedAmount: 'number',
  currency: 'text', billing: 'text', autoRenew: 'boolean', noticeDays: 'number', discountPercent: 'number', owner: 'text', notes: 'text',
};

export class ContractError extends Error {}

// Validates an edited contract; unknown fields are dropped.
export function cleanContract(values = {}) {
  const clean = {};
  for (const [field, type] of Object.entries(CONTRACT_FIELDS)) {
    const value = values[field];
    if (value === undefined || value === null || value === '') { clean[field] = type === 'boolean' ? false : null; continue; }
    if (type === 'text') clean[field] = String(value).trim().slice(0, 500);
    if (type === 'boolean') clean[field] = value === true || value === 'true';
    if (type === 'number') {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0) throw new ContractError(`${field} must be a positive number.`);
      clean[field] = number;
    }
    if (type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || Number.isNaN(Date.parse(value))) throw new ContractError(`${field} must be a date (YYYY-MM-DD).`);
      clean[field] = String(value);
    }
  }
  if (!clean.startDate || !clean.endDate) throw new ContractError('Start and end dates are required.');
  if (clean.endDate <= clean.startDate) throw new ContractError('The end date must be after the start date.');
  clean.currency = (clean.currency || 'USD').toUpperCase().slice(0, 3);
  return clean;
}

export async function savedContracts(collection) {
  const records = await collection.find({}).limit(100).toArray();
  return Object.fromEntries(records.map((record) => [record.platformId, record]));
}

export async function saveContract(collection, platformId, values, now = new Date()) {
  if (!PLATFORMS.some((platform) => platform.id === platformId)) throw new ContractError('Unknown platform.');
  const clean = cleanContract(values);
  await collection.updateOne({ platformId }, { $set: { platformId, ...clean, updatedAt: now } }, { upsert: true });
  return clean;
}

export async function deleteContract(collection, platformId) {
  await collection.deleteMany({ platformId });
}

// --------------------------------------------------------------- calculations
const sum = (items, pick = (item) => item) => items.reduce((total, item) => total + (Number(pick(item)) || 0), 0);
const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const daysBetween = (from, to) => Math.ceil((Date.parse(to) - from.getTime()) / DAY_MS);
const monthFraction = (now) => now.getUTCDate() / new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
const fromAzureDay = (value) => { const text = String(value); return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`; };
const fromEpochDays = (value) => isoDay(Number(value) * DAY_MS);

// Azure Cost Management / Snowflake SQL API results -> array of objects.
const azureRows = (query) => query.properties.rows.map((row) => Object.fromEntries(query.properties.columns.map((column, index) => [column.name, row[index]])));
const snowflakeRows = (result) => result.data.map((row) => Object.fromEntries(result.resultSetMetaData.rowType.map((column, index) => [column.name, row[index]])));

// Renewal status from the notice deadline (or expiry when there is no notice period).
export function renewalItem({ name, type, endDate, noticeDays = 0, autoRenew = false, amount = null, currency = 'USD' }, now) {
  const noticeDate = isoDay(Date.parse(endDate) - noticeDays * DAY_MS);
  const daysToNotice = daysBetween(now, noticeDate);
  const daysToEnd = daysBetween(now, endDate);
  let status = 'later';
  if (daysToEnd < 0) status = 'expired';
  else if (daysToNotice < 0) status = autoRenew ? 'locked' : 'due';
  else if (daysToNotice <= 30) status = 'due';
  else if (daysToNotice <= 90) status = 'soon';
  return { id: `${type}:${name}`, name, type, endDate, noticeDate, noticeDays, daysToNotice, daysToEnd, autoRenew: autoRenew ? 'Yes' : 'No', amount, currency, status };
}

// Straight-line pace: where consumption lands at term end if it continues.
export function commitmentPace(contract, consumed, now) {
  if (!contract.commitmentAmount || consumed === null || consumed === undefined) return null;
  const start = Date.parse(contract.startDate);
  const end = Date.parse(contract.endDate);
  const elapsed = Math.min(1, Math.max(0.01, (now.getTime() - start) / (end - start)));
  const projected = consumed / elapsed;
  const ratio = projected / contract.commitmentAmount;
  return {
    consumed,
    remaining: Math.max(0, contract.commitmentAmount - consumed),
    elapsedPercent: elapsed,
    consumedPercent: consumed / contract.commitmentAmount,
    projectedAtEnd: projected,
    projectedPercent: ratio,
    status: ratio < 0.9 ? 'under' : ratio > 1.05 ? 'over' : 'on-track',
    message: ratio < 0.9
      ? `On pace to use ${Math.round(ratio * 100)}% of the commitment: about ${Math.round(contract.commitmentAmount - projected).toLocaleString('en-US')} ${contract.currency} unused at term end. Negotiate the renewal amount down.`
      : ratio > 1.05
        ? `On pace to use ${Math.round(ratio * 100)}% of the commitment: about ${Math.round(projected - contract.commitmentAmount).toLocaleString('en-US')} ${contract.currency} of overage. Negotiate a higher commitment early at the committed rate.`
        : `On pace to use ${Math.round(ratio * 100)}% of the commitment by term end.`,
  };
}

function contractSection(contract, pace, extraKpis = []) {
  const rows = [
    ['Agreement', contract.agreement], ['Contract number', contract.contractNumber], ['Term', `${contract.startDate} to ${contract.endDate}`],
    ['Commitment', contract.commitmentAmount === null ? '—' : `${Number(contract.commitmentAmount).toLocaleString('en-US')} ${contract.currency}`],
    ['Billing', contract.billing], ['Discount', contract.discountPercent ? `${contract.discountPercent}%` : '—'],
    ['Auto-renew', contract.autoRenew ? 'Yes' : 'No'], ['Notice period', contract.noticeDays ? `${contract.noticeDays} days` : '—'],
    ['Owner', contract.owner], ['Notes', contract.notes],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '');
  return {
    id: 'contract',
    title: 'Contract',
    description: contract.source === 'saved' ? 'Saved in the portal.' : 'Sample contract: edit it to enter your own terms.',
    kpis: [
      ...(contract.commitmentAmount ? [{ label: 'Commitment', value: contract.commitmentAmount, format: 'usd' }] : []),
      ...(pace ? [
        { label: 'Consumed to date', value: pace.consumed, format: 'usd', hint: `${Math.round(pace.consumedPercent * 100)}% used, ${Math.round(pace.elapsedPercent * 100)}% of the term elapsed` },
        { label: 'Remaining', value: pace.remaining, format: 'usd' },
        { label: 'Projected at term end', value: pace.projectedPercent, format: 'percent', hint: 'Of the commitment, at the current pace' },
      ] : []),
      ...extraKpis,
    ],
    charts: pace ? [{ id: 'pace', title: 'Commitment pace', type: 'bar', xKey: 'name', series: [{ key: 'value', label: contract.currency, format: 'usd' }], data: [
      { name: 'Commitment', value: round(contract.commitmentAmount) },
      { name: 'Consumed', value: round(pace.consumed) },
      { name: 'Projected at end', value: round(pace.projectedAtEnd) },
    ] }] : [],
    tables: [{ title: 'Terms', columns: [{ key: 'field', label: 'Field', format: 'text' }, { key: 'value', label: 'Value', format: 'text' }], rows: rows.map(([field, value]) => ({ id: field, field, value: String(value) })) }],
    notes: pace ? [pace.message] : [],
  };
}

function renewalsSection(items) {
  return {
    id: 'renewals',
    title: 'Renewal periods',
    description: 'Notice deadlines matter more than end dates: after the deadline, an auto-renewing contract renews on its current terms.',
    kpis: [
      { label: 'Next notice deadline', value: items[0]?.noticeDate || null, format: 'text', hint: items[0] ? `${items[0].name}: ${items[0].daysToNotice} days` : '' },
      { label: 'Renewing in 90 days', value: items.filter((item) => item.daysToEnd >= 0 && item.daysToEnd <= 90).length, format: 'number' },
    ],
    charts: [],
    tables: [renewalsTable(items)],
    notes: [],
  };
}

export function renewalsTable(items, withPlatform = false) {
  return {
    title: 'Renewals',
    columns: [
      ...(withPlatform ? [{ key: 'platform', label: 'Platform', format: 'text' }] : []),
      { key: 'name', label: 'Item', format: 'text' },
      { key: 'type', label: 'Type', format: 'text' },
      { key: 'status', label: 'Status', format: 'status' },
      { key: 'noticeDate', label: 'Notice deadline', format: 'text' },
      { key: 'daysToNotice', label: 'Days to notice', format: 'number' },
      { key: 'endDate', label: 'Ends', format: 'text' },
      { key: 'autoRenew', label: 'Auto-renew', format: 'text' },
      { key: 'amount', label: 'Value', format: 'usd' },
    ],
    rows: items,
  };
}

// ------------------------------------------------------------------- builders
const BUILDERS = {
  azure(raw, contract, now) {
    const daily = azureRows(raw.costByService).map((row) => ({ ...row, date: fromAzureDay(row.UsageDate) }));
    const days = lastDays(now, 30);
    const services = Object.entries(daily.reduce((totals, row) => ({ ...totals, [row.ServiceName]: (totals[row.ServiceName] || 0) + row.Cost }), {})).sort((a, b) => b[1] - a[1]);
    const top = services.slice(0, 5).map(([name]) => name);
    const monthStart = `${isoDay(now).slice(0, 7)}-01`;
    const mtd = sum(daily.filter((row) => row.date >= monthStart), (row) => row.Cost);
    const forecastRest = sum(azureRows(raw.forecast), (row) => row.Cost);
    const budget = raw.budgets.value[0]?.properties;
    const databricksMtd = sum(daily.filter((row) => row.date >= monthStart && row.ServiceName === 'Azure Databricks'), (row) => row.Cost);
    const groups = azureRows(raw.costByResourceGroup);

    const recommendations = raw.recommendations.value.map((item) => ({
      id: item.id,
      name: item.properties.impactedValue,
      impact: item.properties.impact.toLowerCase(),
      resourceType: item.properties.impactedField.split('/').slice(1).join('/'),
      group: item.properties.resourceMetadata.resourceId.split('/resourceGroups/')[1]?.split('/')[0] || '—',
      problem: item.properties.shortDescription.problem,
      savings: Number(item.properties.extendedProperties?.savingsAmount) || 0,
      extended: item.properties.extendedProperties || {},
    })).sort((a, b) => b.savings - a.savings);
    const advisorAction = (item) => (item.resourceType.startsWith('subscriptions')
      ? `Buy reserved instances: ${item.extended.qty || ''} × ${item.extended.vmSize || 'VM'}`.replace(':  ×', ':')
      : `${item.problem.replace(/ virtual machines| SQL databases| node pools/, '')}: ${item.name}`);
    const PRICE_PER_GB = { Premium_LRS: 0.135, StandardSSD_LRS: 0.075, Standard_LRS: 0.045 };
    const orphaned = raw.orphaned.data.map((item) => {
      const estimated = item.type === 'microsoft.compute/snapshots' ? item.sizeGb * 0.05
        : item.sizeGb ? item.sizeGb * (PRICE_PER_GB[item.sku] || 0.075)
          : item.type.includes('publicipaddresses') ? 3.65 : item.type.includes('loadbalancers') ? 18.25 : 0;
      return { id: item.id, name: item.name, kind: item.kind, group: item.resourceGroup, size: item.sizeGb ? `${item.sizeGb} GB` : '—', estimated: round(estimated), ageDays: Math.floor((now.getTime() - Date.parse(item.timeCreated)) / DAY_MS) };
    });
    const reservations = raw.reservations.value.map((item) => ({
      id: item.id,
      name: item.properties.displayName,
      type: item.properties.reservedResourceType,
      sku: item.sku.name,
      quantity: item.properties.quantity,
      utilization: item.properties.utilization ? item.properties.utilization.aggregates.find((entry) => entry.grain === 30)?.value / 100 : null,
      expiry: isoDay(item.properties.expiryDateTime),
      renew: item.properties.renew,
    }));
    const lowReservations = reservations.filter((item) => item.utilization !== null && item.utilization < 0.8);
    const advisorSavings = sum(recommendations, (item) => item.savings);
    const orphanedCost = sum(orphaned, (item) => item.estimated);
    const pace = commitmentPace(contract, contract.consumedAmount, now);

    const renewals = [
      renewalItem({ name: contract.agreement.split(',')[0], type: 'Contract', endDate: contract.endDate, noticeDays: contract.noticeDays, autoRenew: contract.autoRenew, amount: contract.commitmentAmount }, now),
      ...reservations.map((item) => renewalItem({ name: item.name, type: `Reservation (${item.type})`, endDate: item.expiry, autoRenew: item.renew }, now)),
    ].sort((a, b) => a.daysToNotice - b.daysToNotice);

    return {
      summary: { mtdCost: mtd, forecastCost: mtd + forecastRest, savingsMonthly: advisorSavings + orphanedCost, insights: recommendations.length + orphaned.length + lowReservations.length },
      licensing: { unit: 'Spend commitment (MACC)', entitlement: `${Math.round(contract.commitmentAmount / 1000)}k ${contract.currency} over the term`, pace },
      opportunities: [
        ...recommendations.map((item) => ({ id: `azure:${item.id}`, action: advisorAction(item), detail: `Azure Advisor · ${item.problem}`, impact: item.savings })),
        ...(orphaned.length ? [{ id: 'azure:orphaned', action: `Clean up ${orphaned.length} orphaned Azure resources`, detail: 'Unattached disks, unused public IPs, old snapshots (estimated)', impact: round(orphanedCost) }] : []),
      ],
      renewals,
      sections: [
        {
          id: 'cost',
          title: 'Cost monitoring',
          description: 'Actual billed cost (your negotiated prices) from Azure Cost Management, including Azure Databricks and the infrastructure under it.',
          kpis: [
            { label: 'Month to date', value: mtd, format: 'usd' },
            { label: 'Forecast, month end', value: mtd + forecastRest, format: 'usd' },
            ...(budget ? [{ label: 'Monthly budget', value: budget.amount, format: 'usd', hint: `${Math.round(((mtd + forecastRest) / budget.amount) * 100)}% forecast` }] : []),
            { label: 'Last 30 days', value: sum(daily, (row) => row.Cost), format: 'usd' },
            { label: 'Azure Databricks, MTD', value: databricksMtd, format: 'usd' },
          ],
          charts: [
            { id: 'daily', title: 'Daily cost by service', type: 'area', stacked: true, xKey: 'date', series: [...top, 'Other'].map((name) => ({ key: name, label: name, format: 'usd' })), data: days.map((date) => {
              const rows = daily.filter((row) => row.date === date);
              return { date, ...Object.fromEntries(top.map((name) => [name, round(sum(rows.filter((row) => row.ServiceName === name), (row) => row.Cost))])), Other: round(sum(rows.filter((row) => !top.includes(row.ServiceName)), (row) => row.Cost)) };
            }) },
            { id: 'services', title: 'Cost by service, 30 days', type: 'bar', xKey: 'name', series: [{ key: 'value', label: 'Cost', format: 'usd' }], data: services.map(([name, value]) => ({ name, value: round(value) })) },
            { id: 'groups', title: 'Month to date by resource group', type: 'pie', data: groups.map((row) => ({ name: row.ResourceGroupName, value: round(row.Cost) })) },
          ],
          tables: [],
          notes: [],
        },
        {
          id: 'insights',
          title: 'Infra insights',
          description: 'Azure Advisor cost recommendations, orphaned resources (Resource Graph) and reservation utilization.',
          kpis: [
            { label: 'Advisor savings / month', value: advisorSavings, format: 'usd' },
            { label: 'Orphaned resources', value: orphaned.length, format: 'number', hint: `About ${Math.round(orphanedCost)} USD / month (estimated)` },
            { label: 'Reservations under 80% used', value: lowReservations.length, format: 'number' },
            { label: 'Idle VMs flagged', value: recommendations.filter((item) => item.resourceType.startsWith('virtualMachines')).length, format: 'number' },
          ],
          charts: [],
          tables: [
            { title: 'Advisor cost recommendations', columns: [
              { key: 'name', label: 'Resource', format: 'text' }, { key: 'impact', label: 'Impact', format: 'status' }, { key: 'resourceType', label: 'Type', format: 'text' },
              { key: 'group', label: 'Resource group', format: 'text' }, { key: 'problem', label: 'Recommendation', format: 'text' }, { key: 'savings', label: 'Savings / month', format: 'usd' },
            ], rows: recommendations },
            { title: 'Orphaned resources', columns: [
              { key: 'name', label: 'Resource', format: 'text' }, { key: 'kind', label: 'Finding', format: 'text' }, { key: 'group', label: 'Resource group', format: 'text' },
              { key: 'size', label: 'Size', format: 'text' }, { key: 'ageDays', label: 'Age (days)', format: 'number' }, { key: 'estimated', label: 'Est. cost / month', format: 'usd' },
            ], rows: orphaned },
            { title: 'Reservations', columns: [
              { key: 'name', label: 'Reservation', format: 'text' }, { key: 'type', label: 'Type', format: 'text' }, { key: 'sku', label: 'SKU', format: 'text' },
              { key: 'quantity', label: 'Quantity', format: 'number' }, { key: 'utilization', label: 'Used (30 days)', format: 'percent' }, { key: 'expiry', label: 'Expires', format: 'text' },
            ], rows: reservations },
          ],
          notes: lowReservations.length ? [`${lowReservations.map((item) => item.name).join(', ')}: under 80% used. Exchange or reduce before renewing.`] : [],
        },
        contractSection(contract, pace),
        renewalsSection(renewals),
      ],
    };
  },

  snowflake(raw, contract, now) {
    const usage = snowflakeRows(raw.usageDaily).map((row) => ({ account: row.ACCOUNT_NAME, date: fromEpochDays(row.USAGE_DATE), type: row.USAGE_TYPE, quantity: Number(row.USAGE), cost: Number(row.USAGE_IN_CURRENCY) }));
    const days = lastDays(now, 30);
    const monthStart = `${isoDay(now).slice(0, 7)}-01`;
    const mtd = sum(usage.filter((row) => row.date >= monthStart), (row) => row.cost);
    const last30 = sum(usage, (row) => row.cost);
    const types = [...new Set(usage.map((row) => row.type))];
    const item = snowflakeRows(raw.contractItems)[0];
    const balances = snowflakeRows(raw.remainingBalance).map((row) => ({ date: fromEpochDays(row.DATE), balance: Number(row.CAPACITY_BALANCE) }));
    // The API's contract facts win over the sample ones; saved edits win over both.
    const fromApi = item ? { contractNumber: item.CONTRACT_NUMBER, commitmentAmount: Number(item.AMOUNT), startDate: fromEpochDays(item.START_DATE), endDate: fromEpochDays(item.END_DATE), currency: item.CURRENCY } : {};
    const terms = contract.source === 'saved' ? contract : { ...contract, ...fromApi };
    const consumed = terms.commitmentAmount && balances.length ? terms.commitmentAmount - balances[balances.length - 1].balance : terms.consumedAmount;
    const pace = commitmentPace(terms, consumed, now);
    const warehouses = snowflakeRows(raw.warehouses).map((row) => {
      const used = Number(row.CREDITS_USED_COMPUTE);
      const idle = Math.max(0, used - Number(row.CREDITS_ATTRIBUTED_COMPUTE_QUERIES));
      const autoSuspend = Number(row.AUTO_SUSPEND);
      return {
        id: row.WAREHOUSE_NAME, name: row.WAREHOUSE_NAME, size: row.WAREHOUSE_SIZE, autoSuspend, state: row.STATE, credits: used, idleCredits: round(idle), idleShare: used ? idle / used : 0,
        queries: Number(row.QUERY_COUNT), idleCost: round(idle * 3),
        advice: autoSuspend > 600 ? `Lower auto-suspend from ${autoSuspend / 60} min to 1–5 min` : idle / used > 0.3 ? 'Consolidate or downsize: a third of its credits are idle' : 'OK',
      };
    }).sort((a, b) => b.idleCost - a.idleCost);
    const idleCost = sum(warehouses, (row) => row.idleCost);
    const renewals = [renewalItem({ name: terms.agreement, type: 'Contract', endDate: terms.endDate, noticeDays: terms.noticeDays, autoRenew: terms.autoRenew, amount: terms.commitmentAmount }, now)];

    return {
      summary: { mtdCost: mtd, forecastCost: mtd / monthFraction(now), savingsMonthly: idleCost, insights: warehouses.filter((row) => row.advice !== 'OK').length },
      licensing: { unit: 'Capacity (prepaid credits)', entitlement: `${Math.round(terms.commitmentAmount / 1000)}k ${terms.currency} capacity`, pace },
      opportunities: warehouses.filter((row) => row.advice !== 'OK').map((row) => ({
        id: `snowflake:${row.name}`,
        action: row.autoSuspend > 600 ? `Lower ${row.name} auto-suspend to 1–5 min` : `Downsize or consolidate ${row.name}`,
        detail: `Snowflake · ${Math.round(row.idleShare * 100)}% of its credits are idle`,
        impact: row.idleCost,
      })),
      renewals,
      sections: [
        {
          id: 'cost',
          title: 'Cost monitoring',
          description: 'Daily usage in currency for every account in the organization (ORGANIZATION_USAGE).',
          kpis: [
            { label: 'Month to date', value: mtd, format: 'usd' },
            { label: 'Forecast, month end', value: mtd / monthFraction(now), format: 'usd', hint: 'Straight-line from month to date' },
            { label: 'Last 30 days', value: last30, format: 'usd' },
            { label: 'Compute credits, 30 days', value: sum(usage.filter((row) => row.type === 'compute'), (row) => row.quantity), format: 'number' },
            { label: 'Average per day', value: last30 / 30, format: 'usd' },
          ],
          charts: [
            { id: 'daily', title: 'Daily cost by usage type', type: 'area', stacked: true, xKey: 'date', series: types.map((type) => ({ key: type, label: type, format: 'usd' })), data: days.map((date) => ({ date, ...Object.fromEntries(types.map((type) => [type, round(sum(usage.filter((row) => row.date === date && row.type === type), (row) => row.cost))])) })) },
            { id: 'accounts', title: 'Cost by account, 30 days', type: 'bar', xKey: 'name', series: [{ key: 'value', label: 'Cost', format: 'usd' }], data: [...new Set(usage.map((row) => row.account))].map((name) => ({ name, value: round(sum(usage.filter((row) => row.account === name), (row) => row.cost)) })) },
          ],
          tables: [],
          notes: [],
        },
        {
          id: 'insights',
          title: 'Infra insights',
          description: 'Warehouse credits spent while no query was running (credits used minus credits attributed to queries), and auto-suspend settings.',
          kpis: [
            { label: 'Idle warehouse cost, 30 days', value: idleCost, format: 'usd' },
            { label: 'Warehouses to fix', value: warehouses.filter((row) => row.advice !== 'OK').length, format: 'number' },
            { label: 'Auto-suspend over 10 min', value: warehouses.filter((row) => row.autoSuspend > 600).length, format: 'number' },
          ],
          charts: [{ id: 'idle', title: 'Credits by warehouse: used by queries vs idle', type: 'bar', stacked: true, xKey: 'name', series: [{ key: 'busy', label: 'Used by queries' }, { key: 'idle', label: 'Idle' }], data: warehouses.map((row) => ({ name: row.name, busy: round(row.credits - row.idleCredits), idle: row.idleCredits })) }],
          tables: [{ title: 'Warehouses', columns: [
            { key: 'name', label: 'Warehouse', format: 'text' }, { key: 'size', label: 'Size', format: 'text' }, { key: 'autoSuspend', label: 'Auto-suspend (s)', format: 'number' },
            { key: 'credits', label: 'Credits (30d)', format: 'number' }, { key: 'idleShare', label: 'Idle', format: 'percent' }, { key: 'idleCost', label: 'Idle cost', format: 'usd' }, { key: 'advice', label: 'Recommendation', format: 'text' },
          ], rows: warehouses }],
          notes: [],
        },
        { ...contractSection(terms, pace), charts: [{ id: 'balance', title: 'Remaining capacity balance', type: 'area', xKey: 'date', series: [{ key: 'balance', label: 'Balance', format: 'usd' }], data: balances.map((row) => ({ date: row.date, balance: round(row.balance) })) }] },
        renewalsSection(renewals),
      ],
    };
  },

  datadog(raw, contract, now) {
    const mtd = raw.estimatedCost.data[0].attributes;
    const projected = raw.projectedCost.data[0].attributes;
    const byType = (charges, type) => charges.filter((charge) => charge.charge_type === type);
    const onDemand = sum(byType(mtd.charges, 'on_demand'), (charge) => charge.cost);
    const products = byType(mtd.charges, 'total').map((charge) => ({ name: charge.product_name.replace(/_/g, ' '), value: charge.cost, onDemand: byType(mtd.charges, 'on_demand').find((item) => item.product_name === charge.product_name)?.cost || 0 })).sort((a, b) => b.value - a.value);
    const monthly = [
      ...raw.historicalCost.data.map((item) => ({ name: item.attributes.date.slice(0, 7), value: item.attributes.total_cost })),
      { name: `${projected.date.slice(0, 7)} (projected)`, value: projected.projected_total_cost },
    ];
    const peaks = {};
    for (const entry of raw.hourlyUsage.data) {
      const date = entry.attributes.timestamp.slice(0, 10);
      for (const measurement of entry.attributes.measurements) {
        const key = `${date}|${measurement.usage_type}`;
        peaks[key] = Math.max(peaks[key] || 0, measurement.value);
      }
    }
    const units = contract.units || {};
    const days = lastDays(now, 30);
    const hostSeries = days.map((date) => ({ date, hosts: peaks[`${date}|infra_host_count`] || 0, apm: peaks[`${date}|apm_host_count`] || 0, committed: units.infraHosts || null }));
    const maxHosts = Math.max(...hostSeries.map((row) => row.hosts));
    const hosts = raw.hosts.host_list.map((host) => ({ id: String(host.id), name: host.name, cpu: host.metrics.cpu / 100, lastReported: new Date(host.last_reported_time * 1000).toISOString(), hoursSince: round((now.getTime() / 1000 - host.last_reported_time) / 3600, 1), sources: host.sources.join(', ') }));
    const idle = hosts.filter((host) => host.cpu < 0.05 && host.hoursSince < 24);
    const stale = hosts.filter((host) => host.hoursSince >= 24);
    // Pro infrastructure list price per host per month (annual), less the contract discount.
    const idleSaving = idle.length * 15 * (1 - (contract.discountPercent || 0) / 100);
    const pace = commitmentPace(contract, contract.consumedAmount, now);
    const renewals = [renewalItem({ name: contract.agreement.split(':')[0], type: 'Contract', endDate: contract.endDate, noticeDays: contract.noticeDays, autoRenew: contract.autoRenew, amount: contract.commitmentAmount }, now)];

    return {
      opportunities: [
        ...(idle.length ? [{ id: 'datadog:idle-hosts', action: `Remove or consolidate ${idle.length} idle Datadog hosts`, detail: 'Datadog · billed hosts under 5% CPU', impact: round(idleSaving) }] : []),
      ],
      licensing: { unit: 'Committed hosts', entitlement: units.infraHosts ? `${units.infraHosts} infra + ${units.apmHosts} APM hosts (peak ${maxHosts})` : `${maxHosts} hosts`, pace },
      summary: { mtdCost: mtd.total_cost, forecastCost: projected.projected_total_cost, savingsMonthly: idleSaving, insights: idle.length + stale.length + (maxHosts > (units.infraHosts || Infinity) ? 1 : 0) },
      renewals,
      sections: [
        {
          id: 'cost',
          title: 'Cost monitoring',
          description: 'Estimated month-to-date and projected cost from Datadog Usage Metering, split into committed and on-demand (overage) charges.',
          kpis: [
            { label: 'Month to date (estimated)', value: mtd.total_cost, format: 'usd' },
            { label: 'Projected, month end', value: projected.projected_total_cost, format: 'usd' },
            { label: 'On-demand (overage), MTD', value: onDemand, format: 'usd', hint: 'Usage above the commitment, billed at on-demand rates' },
            { label: 'Committed, MTD', value: sum(byType(mtd.charges, 'committed'), (charge) => charge.cost), format: 'usd' },
          ],
          charts: [
            { id: 'monthly', title: 'Monthly cost', type: 'bar', xKey: 'name', series: [{ key: 'value', label: 'Cost', format: 'usd' }], data: monthly },
            { id: 'products', title: 'Month to date by product', type: 'bar', stacked: true, xKey: 'name', series: [{ key: 'committed', label: 'Committed', format: 'usd' }, { key: 'onDemand', label: 'On-demand', format: 'usd' }], data: products.map((product) => ({ name: product.name, committed: round(product.value - product.onDemand), onDemand: round(product.onDemand) })) },
            { id: 'hosts', title: 'Peak infrastructure hosts per day vs commitment', type: 'area', xKey: 'date', series: [{ key: 'hosts', label: 'Infra hosts' }, { key: 'apm', label: 'APM hosts' }, ...(units.infraHosts ? [{ key: 'committed', label: 'Committed infra hosts' }] : [])], data: hostSeries },
          ],
          tables: [],
          notes: [],
        },
        {
          id: 'insights',
          title: 'Infra insights',
          description: 'Hosts that are billed but nearly idle or no longer reporting, and products running above their commitment.',
          kpis: [
            { label: 'Peak hosts vs committed', value: units.infraHosts ? `${maxHosts} / ${units.infraHosts}` : maxHosts, format: 'text' },
            { label: 'Idle hosts (CPU under 5%)', value: idle.length, format: 'number' },
            { label: 'Hosts not reporting (24h+)', value: stale.length, format: 'number' },
            { label: 'Idle host cost / month', value: idleSaving, format: 'usd', hint: 'At the contract rate' },
          ],
          charts: [],
          tables: [
            { title: 'Hosts to review', columns: [
              { key: 'name', label: 'Host', format: 'text' }, { key: 'cpu', label: 'CPU', format: 'percent' }, { key: 'hoursSince', label: 'Hours since report', format: 'number' }, { key: 'sources', label: 'Sources', format: 'text' },
            ], rows: [...idle, ...stale] },
            { title: 'On-demand charges by product (month to date)', columns: [
              { key: 'name', label: 'Product', format: 'text' }, { key: 'onDemand', label: 'On-demand', format: 'usd' }, { key: 'value', label: 'Total', format: 'usd' },
            ], rows: products.filter((product) => product.onDemand > 0).map((product) => ({ ...product, id: product.name })) },
          ],
          notes: maxHosts > (units.infraHosts || Infinity) ? [`Peak infrastructure hosts (${maxHosts}) exceed the ${units.infraHosts} committed. Removing the idle hosts, or raising the commitment at renewal, avoids on-demand rates.`] : [],
        },
        contractSection(contract, pace, units.infraHosts ? [{ label: 'Committed hosts', value: `${units.infraHosts} infra / ${units.apmHosts} APM`, format: 'text' }] : []),
        renewalsSection(renewals),
      ],
    };
  },

  atlassian(raw, contract, now) {
    const users = raw.orgUsers.data.filter((user) => user.account_status === 'active' && user.access_billable);
    const tiers = contract.units?.products || [];
    const ageOf = (value) => (value ? Math.floor((now.getTime() - Date.parse(value)) / DAY_MS) : null);
    const products = raw.workspaces.data.map((workspace) => {
      const key = workspace.attributes.typeKey;
      const tier = tiers.find((item) => item.key === key) || {};
      const access = users.map((user) => user.product_access.find((item) => item.key === key)).filter(Boolean);
      const inactive = access.filter((item) => ageOf(item.last_active) > 90).length;
      const monthly = (tier.tier || access.length) * (tier.unitPrice || 0);
      return {
        id: key, name: tier.name || workspace.attributes.name, plan: workspace.attributes.planKey, licensed: access.length, tier: tier.tier || null,
        active30: access.filter((item) => ageOf(item.last_active) <= 30).length, inactive, monthly: round(monthly), unitPrice: tier.unitPrice || 0,
        saving: round(inactive * (tier.unitPrice || 0)),
      };
    });
    const monthlyCost = sum(products, (product) => product.monthly);
    const inactiveUsers = users
      .map((user) => ({ id: user.account_id, name: user.name, email: user.email, lastActiveAt: user.last_active, days: ageOf(user.last_active), products: user.product_access.map((item) => item.name).join(', ') }))
      .filter((user) => user.days > 90)
      .sort((a, b) => b.days - a.days);
    const saving = sum(products, (product) => product.saving);
    const renewals = [renewalItem({ name: 'Atlassian Cloud subscription', type: 'Contract', endDate: contract.endDate, noticeDays: contract.noticeDays, autoRenew: contract.autoRenew, amount: contract.commitmentAmount }, now)];

    return {
      opportunities: products.filter((product) => product.saving > 0).map((product) => ({ id: `atlassian:${product.id}`, action: `Remove ${product.inactive} inactive ${product.name} users`, detail: 'Atlassian · no activity in 90+ days', impact: product.saving })),
      licensing: { unit: 'User tiers (annual)', entitlement: products.map((product) => `${product.name.split(' (')[0]} ${product.licensed}/${product.tier ?? '—'}`).join(' · '), pace: null },
      summary: { mtdCost: monthlyCost * monthFraction(now), forecastCost: monthlyCost, savingsMonthly: saving, insights: inactiveUsers.length ? products.filter((product) => product.inactive > 0).length : 0 },
      renewals,
      sections: [
        {
          id: 'cost',
          title: 'Cost monitoring',
          description: 'Atlassian has no public billing API: cost is the contract price per user tier. Licensed users come from the Organizations API.',
          kpis: [
            { label: 'Monthly cost (contract)', value: monthlyCost, format: 'usd' },
            { label: 'Annual cost', value: monthlyCost * 12, format: 'usd' },
            { label: 'Billable users', value: users.length, format: 'number' },
            { label: 'Cost per active user / month', value: monthlyCost / Math.max(1, users.filter((user) => ageOf(user.last_active) <= 30).length), format: 'usd' },
          ],
          charts: [
            { id: 'products', title: 'Monthly cost by product', type: 'bar', xKey: 'name', series: [{ key: 'monthly', label: 'Cost', format: 'usd' }], data: products },
            { id: 'tiers', title: 'Licensed users vs user tier', type: 'bar', xKey: 'name', series: [{ key: 'licensed', label: 'Licensed users' }, { key: 'active30', label: 'Active (30 days)' }, { key: 'tier', label: 'Tier' }], data: products },
          ],
          tables: [],
          notes: [],
        },
        {
          id: 'insights',
          title: 'Infra insights',
          description: 'Billable users who have not used a product for 90+ days. Removing them can keep you in, or move you to, a lower user tier at renewal.',
          kpis: [
            { label: 'Inactive billable users (90d+)', value: inactiveUsers.length, format: 'number' },
            { label: 'Potential saving / month', value: saving, format: 'usd' },
            { label: 'Products with inactive users', value: products.filter((product) => product.inactive > 0).length, format: 'number' },
          ],
          charts: [],
          tables: [
            { title: 'By product', columns: [
              { key: 'name', label: 'Product', format: 'text' }, { key: 'plan', label: 'Plan', format: 'text' }, { key: 'licensed', label: 'Licensed users', format: 'number' },
              { key: 'tier', label: 'Tier', format: 'number' }, { key: 'active30', label: 'Active (30d)', format: 'number' }, { key: 'inactive', label: 'Inactive (90d+)', format: 'number' }, { key: 'saving', label: 'Saving / month', format: 'usd' },
            ], rows: products },
            { title: 'Inactive users', columns: [
              { key: 'name', label: 'User', format: 'text' }, { key: 'products', label: 'Products', format: 'text' }, { key: 'lastActiveAt', label: 'Last active', format: 'date' },
            ], rows: inactiveUsers.slice(0, 40) },
          ],
          notes: [],
        },
        contractSection(contract, null),
        renewalsSection(renewals),
      ],
    };
  },
};

function contractFor(platformId, saved, now) {
  const record = saved[platformId];
  if (!record) return sampleContract(platformId, now);
  const { _id, platformId: _ignored, updatedAt, ...fields } = record;
  // Sample-only details (units, tiers) stay until the contract editor covers them.
  return { ...sampleContract(platformId, now), ...fields, units: sampleContract(platformId, now).units, source: 'saved', updatedAt };
}

// One platform's dashboard. Live connectors (phase 1, next) will supply `raw`
// in the same format; until then the data is sample data.
export function buildPlatformDashboard(platformId, { saved = {}, now = new Date() } = {}) {
  const platform = PLATFORMS.find((item) => item.id === platformId);
  if (!platform) return null;
  const contract = contractFor(platformId, saved, now);
  const built = BUILDERS[platformId](SAMPLES[platformId](now), contract, now);
  return {
    platform,
    mode: 'sample',
    api: { name: API_INFO[platformId].name, endpoints: API_INFO[platformId].endpoints.map(([path, verified]) => ({ path, verified })) },
    contract,
    ...built,
  };
}

export function platformOverview({ saved = {}, now = new Date() } = {}) {
  const dashboards = PLATFORMS.map((platform) => buildPlatformDashboard(platform.id, { saved, now }));
  const renewals = dashboards
    .flatMap((dashboard) => dashboard.renewals.map((item) => ({ ...item, id: `${dashboard.platform.id}:${item.id}`, platform: dashboard.platform.name })))
    .filter((item) => item.daysToEnd >= 0)
    .sort((a, b) => a.daysToNotice - b.daysToNotice);
  return {
    mode: 'sample',
    platforms: dashboards.map((dashboard) => ({
      ...dashboard.platform,
      mode: dashboard.mode,
      ...dashboard.summary,
      licensing: dashboard.licensing,
      contract: { agreement: dashboard.contract.agreement, commitmentAmount: dashboard.contract.commitmentAmount, currency: dashboard.contract.currency, endDate: dashboard.contract.endDate, source: dashboard.contract.source },
      nextRenewal: dashboard.renewals.filter((item) => item.daysToEnd >= 0).sort((a, b) => a.daysToNotice - b.daysToNotice)[0] || null,
    })),
    totals: {
      mtdCost: sum(dashboards, (dashboard) => dashboard.summary.mtdCost),
      forecastCost: sum(dashboards, (dashboard) => dashboard.summary.forecastCost),
      savingsMonthly: sum(dashboards, (dashboard) => dashboard.summary.savingsMonthly),
      noticeIn90: renewals.filter((item) => item.daysToNotice >= 0 && item.daysToNotice <= 90).length,
    },
    renewals,
    opportunities: dashboards
      .flatMap((dashboard) => (dashboard.opportunities || []).map((item) => ({ ...item, platform: dashboard.platform.name })))
      .filter((item) => item.impact > 0)
      .sort((a, b) => b.impact - a.impact),
  };
}
