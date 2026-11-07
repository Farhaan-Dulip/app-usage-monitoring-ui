// License Utilizations overview: one row per software product (seats bought,
// seats assigned to PCs, renewal, status), built from the inventory's plans
// and the per-PC license groups. The View modal lists each assigned seat with
// the evidence behind its status (tracker active time and vendor admin data).
import { PRODUCTS, findCatalogSurface } from '../data/appCatalog';
import { plansMonthlyCost } from './appPlans';
import { selectedPolicy } from './appRules';

const DAY_MS = 24 * 60 * 60 * 1000;

export const PRODUCT_DESCRIPTIONS = {
  codex: 'AI development assistant',
  claude: 'AI assistant',
  copilot: 'AI pair programmer',
  postman: 'API development platform',
  figma: 'Design and prototyping',
  zoom: 'Video meetings',
  vscode: 'Code editor',
};

// Status order for a product: the first one any seat has wins.
const PRODUCT_STATUS_ORDER = ['Reclaimable', 'Active', 'Evaluating', 'Not installed'];

const lower = (value) => String(value || '').trim().toLowerCase();

export function productKeyOf(group) {
  return group.productId || lower(group.name);
}

function inventoryProduct(app) {
  return findCatalogSurface(app)?.product || lower(app.appName);
}

// Earliest renewal date still ahead (yyyy-mm-dd), or the latest past one.
function nextRenewal(plans, now) {
  const dates = plans.map((plan) => plan.renewalDate).filter(Boolean).sort();
  const today = new Date(now).toISOString().slice(0, 10);
  return dates.find((date) => date >= today) || dates.at(-1) || null;
}

export function daysUntil(date, now = Date.now()) {
  if (!date) return null;
  return Math.ceil((Date.parse(`${date}T00:00:00`) - now) / DAY_MS);
}

function productStatus(seats) {
  const statuses = new Set(seats.map((seat) => seat.status));
  return PRODUCT_STATUS_ORDER.find((status) => statuses.has(status)) || (seats.length ? seats[0].status : 'No seats');
}

// Rows from real data: every inventory app with a plan or a seat on a PC.
export function buildProductRows({ groups, inventoryApps, now = Date.now() }) {
  const seatsByProduct = new Map();
  for (const group of groups) {
    const key = productKeyOf(group);
    if (!seatsByProduct.has(key)) seatsByProduct.set(key, []);
    seatsByProduct.get(key).push(group);
  }
  const rows = new Map();
  for (const app of inventoryApps.filter((item) => !item.bundledWith && item.appType !== 'Web URL')) {
    const key = inventoryProduct(app);
    const catalog = findCatalogSurface(app);
    const plans = app.noPlanNeeded ? [] : app.plans || [];
    const seats = seatsByProduct.get(key) || [];
    const totalSeats = plans.length ? plans.reduce((sum, plan) => sum + (Number(plan.seats) || 0), 0) : null;
    rows.set(key, {
      id: key,
      productId: catalog?.product || null,
      name: PRODUCTS[catalog?.product] || app.appName,
      description: PRODUCT_DESCRIPTIONS[catalog?.product] || catalog?.category || app.appType,
      category: catalog?.category || 'Other',
      totalSeats,
      assigned: seats.length,
      monthlyCost: plans.length ? plansMonthlyCost(plans) : Number(app.monthlyCost) || 0,
      renewalDate: nextRenewal(plans, now),
      status: productStatus(seats),
      seats,
      inventoryApp: app,
    });
  }
  // Seats on PCs for apps not (or no longer) in the inventory.
  for (const [key, seats] of seatsByProduct) {
    if (rows.has(key) || seats.every((seat) => seat.sample)) continue;
    rows.set(key, {
      id: key,
      productId: seats[0].productId || null,
      name: seats[0].name,
      description: PRODUCT_DESCRIPTIONS[seats[0].productId] || 'Not in the inventory',
      category: 'Other',
      totalSeats: null,
      assigned: seats.length,
      monthlyCost: seats.reduce((sum, seat) => sum + (Number(seat.monthlyCost) || 0), 0),
      renewalDate: null,
      status: productStatus(seats),
      seats,
    });
  }
  return [...rows.values()].map(finishRow);
}

function finishRow(row) {
  const total = row.totalSeats;
  const seatsWith = (status) => row.seats.filter((seat) => seat.status === status).length;
  return {
    ...row,
    // Sample products give company-scale counts; real ones count their seats.
    activeCount: row.activeCount ?? seatsWith('Active'),
    reclaimableCount: row.reclaimableCount ?? seatsWith('Reclaimable'),
    // Sample products: assigned seats not yet decided either way.
    evaluatingCount: row.sample ? Math.max(0, row.assigned - row.activeCount - row.reclaimableCount) : seatsWith('Evaluating'),
    available: total === null ? null : Math.max(0, total - row.assigned),
    utilization: total ? Math.round((row.assigned / total) * 100) : null,
    // Sample products: reclaimable seats at the plan's price per seat.
    savings: row.sample && total
      ? Math.round((row.reclaimableCount * row.monthlyCost) / total)
      : row.seats.reduce((sum, seat) => sum + (Number(seat.savingsOpportunity) || 0), 0),
  };
}

// Sample products for the "Sample data" switch: seat counts at company scale,
// with the sample PCs as the seats the View modal shows in detail.
const SAMPLE_PRODUCTS = [
  { productId: 'codex', name: 'Codex', category: 'AI assistant', totalSeats: 500, assigned: 428, activeCount: 380, reclaimableCount: 39, monthlyCost: 15000, renewalInDays: 38, status: 'Reclaimable' },
  { productId: 'postman', name: 'Postman', category: 'API tools', totalSeats: 200, assigned: 162, activeCount: 135, reclaimableCount: 21, monthlyCost: 3800, renewalInDays: 64, status: 'Reclaimable' },
  { productId: 'claude', name: 'Claude', category: 'AI assistant', totalSeats: 400, assigned: 371, activeCount: 346, reclaimableCount: 13, monthlyCost: 10000, renewalInDays: 121, status: 'Active' },
  { productId: 'copilot', name: 'GitHub Copilot', category: 'AI assistant', totalSeats: 600, assigned: 552, activeCount: 531, reclaimableCount: 12, monthlyCost: 23400, renewalInDays: 210, status: 'Active' },
  { productId: 'figma', name: 'Figma', category: 'Design', totalSeats: 120, assigned: 74, activeCount: 58, reclaimableCount: 0, monthlyCost: 1800, renewalInDays: 17, status: 'Evaluating' },
];

export function sampleProductRows(sampleGroups, now = Date.now()) {
  return SAMPLE_PRODUCTS.map((product) => {
    const seats = sampleGroups.filter((group) => lower(group.name) === lower(product.name));
    return finishRow({
      id: `sample-${product.productId}`,
      sample: true,
      productId: product.productId,
      name: product.name,
      description: PRODUCT_DESCRIPTIONS[product.productId],
      category: product.category,
      totalSeats: product.totalSeats,
      assigned: product.assigned,
      monthlyCost: product.monthlyCost,
      renewalDate: new Date(now + product.renewalInDays * DAY_MS).toISOString().slice(0, 10),
      status: product.status,
      activeCount: product.activeCount,
      reclaimableCount: product.reclaimableCount,
      seats,
    });
  });
}

// ---------------------------------------------------------------- evidence

// Active-time threshold (hours) of the policy a seat's app is onboarded with.
export function thresholdHoursFor(group, inventoryApps) {
  if (Number(group.thresholdHours) > 0) return Number(group.thresholdHours);
  const app = group.inventoryApp || inventoryApps.find((item) => lower(item.appName) === lower(group.name));
  const activeTime = selectedPolicy(app)?.rule?.conditions?.find((condition) => condition.measure === 'activeTime');
  if (!activeTime) return null;
  return activeTime.unit === 'Minutes' ? Number(activeTime.min) / 60 : Number(activeTime.min);
}

const hours = (seconds) => {
  const value = (Number(seconds) || 0) / 3600;
  return `${value >= 10 || value === 0 ? Math.round(value) : value.toFixed(1)}h`;
};

export function trackerEvidence(group, inventoryApps) {
  const threshold = thresholdHoursFor(group, inventoryApps);
  const worked = hours(group.workedRuntimeSeconds);
  if (group.status === 'Not installed') return { text: 'Tracker: app not found on this PC', tone: 'muted' };
  return {
    text: threshold ? `Tracker: ${worked} of ${threshold}h` : `Tracker: ${worked} active`,
    tone: threshold && (Number(group.workedRuntimeSeconds) || 0) / 3600 >= threshold ? 'good' : 'plain',
  };
}

const API_NAMES = {
  claude: 'Claude API',
  codex: 'Codex API',
  copilot: 'GitHub API',
  postman: 'Postman API',
  figma: 'Figma API',
  zoom: 'Zoom API',
};

function checkPhrase(check) {
  if (check.kind === 'within') {
    if (check.value === null) return 'never seen';
    const label = /signed in/i.test(check.label) ? 'signed in' : 'used';
    return `${label} ${check.value === 0 ? 'today' : `${check.value} ${check.value === 1 ? 'day' : 'days'} ago`}`;
  }
  return `${check.value} ${check.label.toLowerCase()}`;
}

export function vendorEvidence(group) {
  const api = API_NAMES[group.productId] || API_NAMES[lower(group.name).replace('github ', '')] || `${group.name} API`;
  const checks = group.vendorRule?.checks || [];
  if (checks.length === 0) return { text: `${api}: no vendor rules in this policy`, tone: 'muted' };
  const met = checks.filter((check) => check.met);
  const count = `(${met.length} of ${checks.length} ${checks.length === 1 ? 'rule' : 'rules'})`;
  if (met.length === 0) {
    const neverSeen = checks.every((check) => check.value === null || check.value === 0);
    return { text: `${api}: ${neverSeen ? 'no use found' : checks.map(checkPhrase).join(', ')} ${count}`, tone: 'bad' };
  }
  return { text: `${api}: ${met.map(checkPhrase).join(', ')} ${count}`, tone: 'good' };
}
