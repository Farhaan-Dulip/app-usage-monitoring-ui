// Sample responses for the Enterprise Infrastructure Platform dashboards, in
// each vendor API's response format (see API_INFO in index.js for the calls
// and how sure the field names are). Values are invented but realistic for a
// mid-size enterprise, stable within a day, and go through the same
// normalizers a live connection will use.
import { DAY_MS, isoDay, lastDays } from '../aiTools/http.js';
import { sampleRandom, sampleSeed } from '../aiTools/sampleData.js';

const round2 = (value) => Math.round(value * 100) / 100;
const plusDays = (now, days) => new Date(now.getTime() + days * DAY_MS);
const isoAt = (now, days) => plusDays(now, days).toISOString();
const dayNumber = (day) => Number(day.replace(/-/g, ''));
const weekend = (day) => [0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay());
const SUBSCRIPTION = '6f1c2a90-4b7e-4d2a-9c11-2e8f5b3a7d40';
const uuid = (rand) => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(rand() * 16).toString(16));

// ----------------------------------------------------------------------- Azure
const AZURE_SERVICES = [
  ['Virtual Machines', 640],
  ['Azure Databricks', 330],
  ['SQL Database', 212],
  ['Azure Kubernetes Service', 174],
  ['Storage', 138],
  ['Azure App Service', 86],
  ['Log Analytics', 54],
  ['Virtual Network', 42],
  ['Azure Cosmos DB', 39],
];
const AZURE_GROUPS = [
  ['rg-data-platform', 0.31],
  ['rg-prod-apps', 0.24],
  ['rg-aks-prod', 0.17],
  ['rg-analytics-dev', 0.12],
  ['rg-shared-network', 0.07],
  ['rg-dev-sandbox', 0.09],
];

function costQuery(rand, columns, rows) {
  const name = uuid(rand);
  return {
    id: `subscriptions/${SUBSCRIPTION}/providers/Microsoft.CostManagement/query/${name}`,
    name,
    type: 'Microsoft.CostManagement/query',
    location: null,
    sku: null,
    eTag: null,
    properties: { nextLink: null, columns, rows },
  };
}

export function sampleAzure(now) {
  const rand = sampleRandom(sampleSeed(now, 31));
  const days = lastDays(now, 30);
  // POST /subscriptions/{id}/providers/Microsoft.CostManagement/query
  // (ActualCost, Daily, grouped by ServiceName)
  const dailyRows = [];
  for (const day of days) {
    for (const [service, base] of AZURE_SERVICES) {
      const factor = weekend(day) && service !== 'Storage' ? 0.8 : 1;
      dailyRows.push([round2(base * factor * (0.9 + rand() * 0.2)), dayNumber(day), service, 'USD']);
    }
  }
  const costByService = costQuery(rand, [
    { name: 'Cost', type: 'Number' },
    { name: 'UsageDate', type: 'Number' },
    { name: 'ServiceName', type: 'String' },
    { name: 'Currency', type: 'String' },
  ], dailyRows);

  const monthStart = `${isoDay(now).slice(0, 7)}-01`;
  const mtd = dailyRows.filter((row) => String(row[1]) >= monthStart.replace(/-/g, '')).reduce((total, row) => total + row[0], 0);
  // Same query, MonthToDate, grouped by ResourceGroupName
  const costByResourceGroup = costQuery(rand, [
    { name: 'Cost', type: 'Number' },
    { name: 'ResourceGroupName', type: 'String' },
    { name: 'Currency', type: 'String' },
  ], AZURE_GROUPS.map(([group, share]) => [round2(mtd * share * (0.95 + rand() * 0.1)), group, 'USD']));

  // POST .../Microsoft.CostManagement/forecast (rest of the month)
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const forecastRows = [];
  const dailyAverage = AZURE_SERVICES.reduce((total, [, base]) => total + base, 0);
  for (let time = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1); time <= monthEnd.getTime(); time += DAY_MS) {
    const day = isoDay(time);
    forecastRows.push([round2(dailyAverage * (weekend(day) ? 0.82 : 1.02)), dayNumber(day), 'Forecast', 'USD']);
  }
  const forecast = costQuery(rand, [
    { name: 'Cost', type: 'Number' },
    { name: 'UsageDate', type: 'Number' },
    { name: 'CostStatus', type: 'String' },
    { name: 'Currency', type: 'String' },
  ], forecastRows);

  const forecastSpend = mtd + forecastRows.reduce((total, row) => total + row[0], 0);
  // GET /subscriptions/{id}/providers/Microsoft.Consumption/budgets
  const budgets = {
    value: [{
      id: `subscriptions/${SUBSCRIPTION}/providers/Microsoft.Consumption/budgets/monthly-platform-budget`,
      name: 'monthly-platform-budget',
      type: 'Microsoft.Consumption/budgets',
      eTag: '"1d9a3c2b5e7f0a1"',
      properties: {
        category: 'Cost',
        amount: 50000,
        timeGrain: 'Monthly',
        timePeriod: { startDate: `${now.getUTCFullYear()}-01-01T00:00:00Z`, endDate: `${now.getUTCFullYear() + 1}-12-31T00:00:00Z` },
        currentSpend: { amount: round2(mtd), unit: 'USD' },
        forecastSpend: { amount: round2(forecastSpend), unit: 'USD' },
        notifications: { Actual_GreaterThan_90_Percent: { enabled: true, operator: 'GreaterThan', threshold: 90, contactEmails: ['cloud-finops@example.com'], thresholdType: 'Actual' } },
      },
    }],
  };

  // GET /subscriptions/{id}/providers/Microsoft.Advisor/recommendations?$filter=Category eq 'Cost'
  const advisor = (name, impact, type, resource, group, problem, monthly, extra = {}) => ({
    id: `/subscriptions/${SUBSCRIPTION}/resourceGroups/${group}/providers/${type}/${resource}/providers/Microsoft.Advisor/recommendations/${uuid(rand)}`,
    name: uuid(rand),
    type: 'Microsoft.Advisor/recommendations',
    properties: {
      category: 'Cost',
      impact,
      impactedField: type,
      impactedValue: resource,
      lastUpdated: isoAt(now, -1),
      recommendationTypeId: uuid(rand),
      shortDescription: { problem, solution: problem },
      extendedProperties: { savingsAmount: String(monthly), annualSavingsAmount: String(round2(monthly * 12)), savingsCurrency: 'USD', ...extra },
      resourceMetadata: { resourceId: `/subscriptions/${SUBSCRIPTION}/resourceGroups/${group}/providers/${type}/${resource}`, source: name },
    },
  });
  const recommendations = {
    value: [
      advisor('vm', 'High', 'Microsoft.Compute/virtualMachines', 'vm-analytics-02', 'rg-analytics-dev', 'Right-size or shutdown underutilized virtual machines', 412.3, { currentSku: 'Standard_E16s_v5', targetSku: 'Standard_E8s_v5', MaxCpuP95: '7' }),
      advisor('vm', 'High', 'Microsoft.Compute/virtualMachines', 'vm-build-agent-07', 'rg-dev-sandbox', 'Right-size or shutdown underutilized virtual machines', 286.15, { currentSku: 'Standard_D8s_v5', targetSku: 'Shutdown', MaxCpuP95: '2' }),
      advisor('ri', 'High', 'Microsoft.Subscriptions/subscriptions', SUBSCRIPTION, 'rg-prod-apps', 'Buy virtual machine reserved instances to save money over pay-as-you-go costs', 702.4, { vmSize: 'Standard_D8s_v5', term: 'P1Y', qty: '4' }),
      advisor('sql', 'Medium', 'Microsoft.Sql/servers/databases', 'sqldb-reporting', 'rg-data-platform', 'Right-size underutilized SQL databases', 184.0, { currentSku: 'GP_Gen5_8', targetSku: 'GP_Gen5_4' }),
      advisor('aks', 'Medium', 'Microsoft.ContainerService/managedClusters', 'aks-prod-sea', 'rg-aks-prod', 'Enable cluster autoscaler on underutilized node pools', 158.6, { nodePool: 'userpool2' }),
      advisor('snap', 'Low', 'Microsoft.Compute/snapshots', 'snap-migration-2024', 'rg-shared-network', 'Use Standard Storage to store Managed Disks snapshots', 21.4),
      advisor('ahb', 'High', 'Microsoft.Sql/servers/databases', 'sqldb-orders-prod', 'rg-prod-apps', 'Use Azure Hybrid Benefit for SQL Server licences you already own', 1148.6, { currentLicense: 'LicenseIncluded', vCores: '16' }),
      advisor('aks-dev', 'High', 'Microsoft.ContainerService/managedClusters', 'aks-dev-sea', 'rg-dev-sandbox', 'Stop or scale down an underutilized AKS cluster outside working hours', 1236.0, { nodePool: 'devpool', avgCpu: '4' }),
      advisor('vmss', 'Medium', 'Microsoft.Compute/virtualMachineScaleSets', 'vmss-batch-workers', 'rg-data-platform', 'Right-size or shutdown underutilized virtual machine scale sets', 982.4, { currentSku: 'Standard_D16s_v5', targetSku: 'Standard_D8s_v5' }),
      advisor('sql-ri', 'Medium', 'Microsoft.Subscriptions/subscriptions', SUBSCRIPTION, 'rg-data-platform', 'Buy SQL Database reserved capacity to save money over pay-as-you-go costs', 612.0, { vmSize: 'SQL GP Gen5 vCore', term: 'P1Y', qty: '8' }),
      advisor('logs', 'Medium', 'Microsoft.OperationalInsights/workspaces', 'log-platform-sea', 'rg-shared-network', 'Move the Log Analytics workspace to a commitment tier', 418.5, { currentTier: 'PerGB2018', targetTier: '200 GB/day' }),
      advisor('cosmos', 'Low', 'Microsoft.DocumentDB/databaseAccounts', 'cosmos-catalog', 'rg-prod-apps', 'Configure autoscale throughput on underused Cosmos DB containers', 552.2),
    ],
  };

  // POST /providers/Microsoft.ResourceGraph/resources (orphaned resources query)
  const orphaned = {
    totalRecords: 9,
    count: 9,
    resultTruncated: 'false',
    facets: [],
    data: [
      { id: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-analytics-dev/providers/Microsoft.Compute/disks/disk-etl-old-01`, name: 'disk-etl-old-01', type: 'microsoft.compute/disks', resourceGroup: 'rg-analytics-dev', location: 'southeastasia', kind: 'Unattached disk', sku: 'Premium_LRS', sizeGb: 1024, timeCreated: isoAt(now, -210) },
      { id: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-dev-sandbox/providers/Microsoft.Compute/disks/disk-buildcache-03`, name: 'disk-buildcache-03', type: 'microsoft.compute/disks', resourceGroup: 'rg-dev-sandbox', location: 'southeastasia', kind: 'Unattached disk', sku: 'Premium_LRS', sizeGb: 512, timeCreated: isoAt(now, -95) },
      { id: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod-apps/providers/Microsoft.Compute/disks/disk-legacy-app-data`, name: 'disk-legacy-app-data', type: 'microsoft.compute/disks', resourceGroup: 'rg-prod-apps', location: 'southeastasia', kind: 'Unattached disk', sku: 'StandardSSD_LRS', sizeGb: 256, timeCreated: isoAt(now, -400) },
      { id: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-shared-network/providers/Microsoft.Network/publicIPAddresses/pip-old-gateway`, name: 'pip-old-gateway', type: 'microsoft.network/publicipaddresses', resourceGroup: 'rg-shared-network', location: 'southeastasia', kind: 'Unused public IP', sku: 'Standard', sizeGb: null, timeCreated: isoAt(now, -330) },
      { id: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-dev-sandbox/providers/Microsoft.Network/publicIPAddresses/pip-test-vm-11`, name: 'pip-test-vm-11', type: 'microsoft.network/publicipaddresses', resourceGroup: 'rg-dev-sandbox', location: 'southeastasia', kind: 'Unused public IP', sku: 'Standard', sizeGb: null, timeCreated: isoAt(now, -60) },
      { id: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-shared-network/providers/Microsoft.Compute/snapshots/snap-migration-2024`, name: 'snap-migration-2024', type: 'microsoft.compute/snapshots', resourceGroup: 'rg-shared-network', location: 'southeastasia', kind: 'Snapshot older than 90 days', sku: 'Premium_LRS', sizeGb: 2048, timeCreated: isoAt(now, -520) },
      { id: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-data-platform/providers/Microsoft.Compute/disks/disk-dw-archive-01`, name: 'disk-dw-archive-01', type: 'microsoft.compute/disks', resourceGroup: 'rg-data-platform', location: 'southeastasia', kind: 'Unattached disk', sku: 'Premium_LRS', sizeGb: 4096, timeCreated: isoAt(now, -280) },
      { id: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-analytics-dev/providers/Microsoft.Compute/disks/disk-spark-scratch-02`, name: 'disk-spark-scratch-02', type: 'microsoft.compute/disks', resourceGroup: 'rg-analytics-dev', location: 'southeastasia', kind: 'Unattached disk', sku: 'Premium_LRS', sizeGb: 2048, timeCreated: isoAt(now, -120) },
      { id: `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-data-platform/providers/Microsoft.Network/loadBalancers/lb-staging-unused`, name: 'lb-staging-unused', type: 'microsoft.network/loadbalancers', resourceGroup: 'rg-data-platform', location: 'southeastasia', kind: 'Load balancer with no backend', sku: 'Standard', sizeGb: null, timeCreated: isoAt(now, -150) },
    ],
  };

  // GET /providers/Microsoft.Capacity/reservations (utilization and expiry)
  const reservation = (displayName, sku, type, quantity, term, effectiveDays, expiryDays, renew, utilization) => {
    const order = uuid(rand);
    const id = uuid(rand);
    return {
      id: `/providers/microsoft.capacity/reservationOrders/${order}/reservations/${id}`,
      name: `${order}/${id}`,
      type: 'microsoft.capacity/reservationOrders/reservations',
      location: 'southeastasia',
      sku: { name: sku },
      properties: {
        displayName,
        reservedResourceType: type,
        quantity,
        term,
        billingPlan: 'Monthly',
        appliedScopeType: 'Shared',
        provisioningState: 'Succeeded',
        effectiveDateTime: isoAt(now, effectiveDays),
        expiryDateTime: isoAt(now, expiryDays),
        renew,
        ...(utilization ? { utilization: { trend: utilization[0] < utilization[1] ? 'DOWN' : 'UP', aggregates: [
          { grain: 7, grainUnit: 'days', value: utilization[0], valueUnit: 'percentage' },
          { grain: 30, grainUnit: 'days', value: utilization[1], valueUnit: 'percentage' },
        ] } } : {}),
      },
    };
  };
  const reservations = {
    value: [
      reservation('VM_RI_D8sv5_prod', 'Standard_D8s_v5', 'VirtualMachines', 6, 'P1Y', -340, 25, false, [68.4, 72.1]),
      reservation('SQL_RI_GP_Gen5_16', 'SQL_GP_Gen5', 'SqlDatabases', 16, 'P1Y', -270, 95, true, [94.2, 93.6]),
      reservation('VM_RI_E8sv5_databricks', 'Standard_E8s_v5', 'VirtualMachines', 4, 'P3Y', -760, 335, false, [88.9, 90.3]),
      reservation('Databricks_DBCU_prepurchase', 'Databricks_DBCU', 'Databricks', 150000, 'P1Y', -175, 190, true, null),
    ],
  };
  return { costByService, costByResourceGroup, forecast, budgets, recommendations, orphaned, reservations };
}

// ------------------------------------------------------------------- Snowflake
// SQL API (POST /api/v2/statements) result sets: every value is a string,
// DATE values are days since 1970-01-01.
const epochDays = (day) => String(Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS));

function sqlResult(rand, rowType, data) {
  return {
    resultSetMetaData: { numRows: data.length, format: 'jsonv2', partitionInfo: [{ rowCount: data.length, uncompressedSize: data.length * 120 }], rowType: rowType.map(([name, type]) => ({ name, type, nullable: true, database: 'SNOWFLAKE', schema: 'ORGANIZATION_USAGE', table: '' })) },
    data,
    code: '090001',
    statementStatusUrl: `/api/v2/statements/${uuid(rand)}?requestId=${uuid(rand)}`,
    requestId: uuid(rand),
    sqlState: '00000',
    statementHandle: uuid(rand),
    message: 'Statement executed successfully.',
    createdOn: Date.now(),
  };
}

export function sampleSnowflake(now) {
  const rand = sampleRandom(sampleSeed(now, 32));
  const days = lastDays(now, 30);
  const CREDIT = 3.0;
  // SELECT ACCOUNT_NAME, USAGE_DATE, USAGE_TYPE, USAGE, USAGE_IN_CURRENCY, CURRENCY
  //   FROM SNOWFLAKE.ORGANIZATION_USAGE.USAGE_IN_CURRENCY_DAILY
  const usage = [];
  for (const day of days) {
    const busy = weekend(day) ? 0.45 : 1;
    const rows = [
      ['PROD_ANALYTICS', 'compute', 205 * busy * (0.85 + rand() * 0.3), CREDIT],
      ['PROD_ANALYTICS', 'cloud services', 9 * busy * (0.8 + rand() * 0.4), CREDIT],
      ['PROD_ANALYTICS', 'storage', 41.6 / 30, 23],
      ['DEV_SANDBOX', 'compute', 48 * busy * (0.6 + rand() * 0.8), CREDIT],
      ['DEV_SANDBOX', 'storage', 6.2 / 30, 23],
      ['PROD_ANALYTICS', 'data transfer', 0.9 * (0.7 + rand() * 0.6), 20],
    ];
    for (const [account, type, quantity, price] of rows) {
      usage.push([account, epochDays(day), type, quantity.toFixed(4), (quantity * price).toFixed(2), 'USD']);
    }
  }
  const usageDaily = sqlResult(rand, [['ACCOUNT_NAME', 'text'], ['USAGE_DATE', 'date'], ['USAGE_TYPE', 'text'], ['USAGE', 'fixed'], ['USAGE_IN_CURRENCY', 'fixed'], ['CURRENCY', 'text']], usage);

  // SELECT CONTRACT_NUMBER, CONTRACT_ITEM, CURRENCY, AMOUNT, START_DATE, END_DATE
  //   FROM SNOWFLAKE.ORGANIZATION_USAGE.CONTRACT_ITEMS
  const start = isoDay(plusDays(now, -290));
  const end = isoDay(plusDays(now, 75));
  const contractItems = sqlResult(rand, [['CONTRACT_NUMBER', 'fixed'], ['CONTRACT_ITEM', 'text'], ['CURRENCY', 'text'], ['AMOUNT', 'fixed'], ['START_DATE', 'date'], ['END_DATE', 'date']], [
    ['4471', 'Capacity', 'USD', '300000.00', epochDays(start), epochDays(end)],
  ]);

  // SELECT DATE, CURRENCY, CAPACITY_BALANCE, ROLLOVER_BALANCE, FREE_USAGE_BALANCE, ON_DEMAND_CONSUMPTION_BALANCE
  //   FROM SNOWFLAKE.ORGANIZATION_USAGE.REMAINING_BALANCE_DAILY
  const consumedBefore = 214000;
  const balance = [];
  let spent = consumedBefore - usage.reduce((total, row) => total + Number(row[4]), 0);
  for (const day of days) {
    spent += usage.filter((row) => row[1] === epochDays(day)).reduce((total, row) => total + Number(row[4]), 0);
    balance.push([epochDays(day), 'USD', (300000 - spent).toFixed(2), '0.00', '0.00', '0.00']);
  }
  const remainingBalance = sqlResult(rand, [['DATE', 'date'], ['CURRENCY', 'text'], ['CAPACITY_BALANCE', 'fixed'], ['ROLLOVER_BALANCE', 'fixed'], ['FREE_USAGE_BALANCE', 'fixed'], ['ON_DEMAND_CONSUMPTION_BALANCE', 'fixed']], balance);

  // SHOW WAREHOUSES joined with ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY (30 days)
  const warehouses = sqlResult(rand, [['WAREHOUSE_NAME', 'text'], ['WAREHOUSE_SIZE', 'text'], ['AUTO_SUSPEND', 'fixed'], ['STATE', 'text'], ['CREDITS_USED_COMPUTE', 'fixed'], ['CREDITS_ATTRIBUTED_COMPUTE_QUERIES', 'fixed'], ['QUERY_COUNT', 'fixed']], [
    ['BI_REPORTING_WH', 'Large', '600', 'STARTED', '2140.50', '1386.20', '48210'],
    ['ETL_WH', 'X-Large', '60', 'SUSPENDED', '2610.75', '2402.10', '9120'],
    ['DATA_SCIENCE_WH', 'Medium', '3600', 'STARTED', '712.40', '214.60', '3880'],
    ['DEV_WH', 'Small', '1800', 'STARTED', '486.10', '121.40', '6105'],
    ['ADHOC_WH', 'Medium', '300', 'SUSPENDED', '264.30', '205.80', '2240'],
    ['LEGACY_ETL_WH', 'Large', '3600', 'STARTED', '498.20', '91.40', '410'],
  ]);
  return { usageDaily, contractItems, remainingBalance, warehouses };
}

// --------------------------------------------------------------------- Datadog
export function sampleDatadog(now) {
  const rand = sampleRandom(sampleSeed(now, 33));
  const org = { org_name: 'Allion Production', public_id: 'a1b2c3d4e5', region: 'us' };
  const month = `${isoDay(now).slice(0, 7)}-01T00:00:00+00:00`;
  const fraction = now.getUTCDate() / new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const products = [
    ['infra_host', 5280, 720],
    ['apm_host', 2490, 310],
    ['logs_indexed_15day', 2860, 940],
    ['logs_ingested', 640, 0],
    ['custom_timeseries', 410, 285],
    ['synthetics_api_tests', 180, 0],
  ];
  const charges = (scale) => products.flatMap(([product, committed, onDemand]) => [
    { product_name: product, charge_type: 'committed', cost: round2(committed * scale) },
    { product_name: product, charge_type: 'on_demand', cost: round2(onDemand * scale * (0.85 + rand() * 0.3)) },
    { product_name: product, charge_type: 'total', cost: 0 },
  ]).map((charge, index, all) => (charge.charge_type === 'total' ? { ...charge, cost: round2(all[index - 2].cost + all[index - 1].cost) } : charge));
  const withTotal = (list) => round2(list.filter((charge) => charge.charge_type === 'total').reduce((total, charge) => total + charge.cost, 0));

  // GET /api/v2/usage/estimated_cost (month to date)
  const mtdCharges = charges(fraction);
  const estimatedCost = { data: [{ type: 'cost_by_org', id: org.public_id, attributes: { ...org, date: month, total_cost: withTotal(mtdCharges), charges: mtdCharges } }] };
  // GET /api/v2/usage/projected_cost (end of month)
  const projectedCharges = charges(1);
  const projectedCost = { data: [{ type: 'projected_cost', id: org.public_id, attributes: { ...org, date: month, projected_total_cost: withTotal(projectedCharges), charges: projectedCharges } }] };
  // GET /api/v2/usage/historical_cost (previous months)
  const historicalCost = { data: [3, 2, 1].map((back) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const list = charges(0.92 + back * 0.02 + rand() * 0.04);
    return { type: 'cost_by_org', id: `${org.public_id}-${back}`, attributes: { ...org, date: date.toISOString().replace('.000Z', '+00:00'), total_cost: withTotal(list), charges: list } };
  }) };

  // GET /api/v2/usage/hourly_usage (infra_hosts, apm) - hourly for 30 days
  const hourly = [];
  for (const day of lastDays(now, 30)) {
    const base = weekend(day) ? 0.9 : 1;
    for (let hour = 0; hour < 24; hour += 1) {
      const timestamp = `${day}T${String(hour).padStart(2, '0')}:00:00+00:00`;
      const daytime = hour >= 2 && hour <= 14 ? 1.06 : 0.97;
      hourly.push({ type: 'usage_timeseries', id: `${day}-${hour}-infra`, attributes: { ...org, product_family: 'infra_hosts', timestamp, measurements: [{ usage_type: 'infra_host_count', value: Math.round(158 * base * daytime + rand() * 6) }, { usage_type: 'container_count', value: Math.round(640 * base * daytime + rand() * 40) }] } });
      hourly.push({ type: 'usage_timeseries', id: `${day}-${hour}-apm`, attributes: { ...org, product_family: 'apm', timestamp, measurements: [{ usage_type: 'apm_host_count', value: Math.round(57 * base * daytime + rand() * 4) }] } });
    }
  }
  const hourlyUsage = { data: hourly, meta: { pagination: { next_record_id: null } } };

  // GET /api/v1/hosts
  const host = (name, cpu, reportedHoursAgo, sources = ['agent', 'azure']) => ({
    name,
    id: Math.floor(1e9 + rand() * 1e9),
    aliases: [name],
    apps: ['agent', 'ntp', 'docker'],
    host_name: name,
    is_muted: false,
    last_reported_time: Math.floor((now.getTime() - reportedHoursAgo * 3600000) / 1000),
    meta: { platform: 'linux', agent_version: '7.58.2' },
    metrics: { cpu, iowait: round2(rand() * 0.6), load: round2(cpu / 25) },
    sources,
    up: reportedHoursAgo < 1,
  });
  const hosts = {
    host_list: [
      host('aks-userpool2-vmss000004', 2.1, 0.1),
      host('aks-userpool2-vmss000005', 3.4, 0.1),
      host('vm-build-agent-07', 1.2, 0.2),
      host('vm-analytics-02', 4.6, 0.1),
      host('vm-legacy-ftp-01', 0.8, 0.1),
      host('vm-sql-migration-tmp', 0, 52),
      host('aks-systempool-vmss000001', 38.2, 0.1),
      host('vm-api-prod-03', 61.7, 0.1),
    ],
    total_matching: 158,
    total_returned: 8,
  };
  return { estimatedCost, projectedCost, historicalCost, hourlyUsage, hosts };
}

// ------------------------------------------------------------------- Atlassian
const FIRST = ['Ava', 'Kasun', 'Nimali', 'Ravi', 'Dilani', 'Chamath', 'Ishara', 'Tharindu', 'Sachini', 'Ashan', 'Hiruni', 'Malith', 'Nadeesha', 'Pasan', 'Sanduni', 'Yohan', 'Gayan', 'Ruwini', 'Lahiru', 'Tharushi'];
const LAST = ['Perera', 'Silva', 'Fernando', 'Jayasinghe', 'Wickramasinghe', 'Bandara', 'Dissanayake', 'Gunawardena', 'Herath', 'Rathnayake', 'Senanayake', 'Kumara', 'Weerasinghe'];

export function sampleAtlassian(now) {
  const rand = sampleRandom(sampleSeed(now, 34));
  const site = 'https://example-allion.atlassian.net';
  const users = [];
  for (let index = 0; index < 236; index += 1) {
    const name = `${FIRST[index % FIRST.length]} ${LAST[Math.floor(index / FIRST.length) % LAST.length]}`;
    const email = `${name.toLowerCase().replace(' ', '.')}${index >= FIRST.length * LAST.length ? index : ''}@example.com`;
    // Most people are active; a long tail hasn't signed in for months.
    const roll = rand();
    const lastActive = roll < 0.74 ? rand() * 6 : roll < 0.86 ? 20 + rand() * 50 : 95 + rand() * 200;
    const access = [{ key: 'jira-software', name: 'Jira', url: site, last_active: isoAt(now, -lastActive) }];
    if (index % 5 !== 4) access.push({ key: 'confluence', name: 'Confluence', url: `${site}/wiki`, last_active: isoAt(now, -(lastActive + rand() * (index % 3 === 0 ? 120 : 8))) });
    if (index < 38) access.push({ key: 'jira-servicedesk', name: 'Jira Service Management', url: site, last_active: isoAt(now, -(index > 31 ? 100 + rand() * 60 : rand() * 4)) });
    users.push({
      account_id: `5f${(100000 + index).toString(16)}a7c1e2d40069b3f${index}`,
      account_type: 'atlassian',
      account_status: 'active',
      name,
      picture: '',
      email,
      access_billable: true,
      last_active: access.map((item) => item.last_active).sort().pop(),
      product_access: access,
      links: { self: `https://api.atlassian.com/users/5f${(100000 + index).toString(16)}/manage/profile` },
    });
  }
  // GET /admin/v1/orgs/{orgId}/users (paged; one page here)
  const orgUsers = { data: users, links: { next: null } };
  // GET /admin/v2/orgs/{orgId}/workspaces
  const workspace = (typeKey, name, planKey, url) => ({ id: uuid(rand), type: 'workspace', attributes: { name, typeKey, type: 'products', owner: 'org', status: 'online', hostUrl: url, planKey, realm: 'au', createdAt: isoAt(now, -1400) }, links: { self: `https://api.atlassian.com/admin/v2/orgs/sample-org/workspaces/${typeKey}` } });
  const workspaces = { data: [
    workspace('jira-software', 'Jira', 'premium', site),
    workspace('confluence', 'Confluence', 'standard', `${site}/wiki`),
    workspace('jira-servicedesk', 'Jira Service Management', 'standard', site),
  ], links: { next: null } };
  return { orgUsers, workspaces };
}
