// Core App Engagement for one product: active minutes by hour of day over the
// last 24 hours, one line per PC, from the Tracker's samples (or shaped from
// each sample seat's hours when Sample data is on).
import { productSurfaces } from '../data/appCatalog';

const HOURS = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`);
const COLORS = ['#2563eb', '#e74c3c', '#8e44ad', '#16a085', '#f39c12', '#d35400', '#2c3e50', '#c0392b', '#27ae60', '#7f8c8d'];
const DAY_MS = 24 * 60 * 60 * 1000;

const lower = (value) => String(value || '').trim().toLowerCase();

// The names the Tracker reports for a product's desktop app, extension and web use.
function productNames(product) {
  const names = new Set();
  const add = (value) => value && names.add(lower(value));
  add(product.inventoryApp?.processName);
  add(product.inventoryApp?.appName);
  productSurfaces(product.productId).forEach((entry) => add(entry.processName));
  product.seats.forEach((seat) => seat.surfaces?.forEach((surface) => add(surface.appName)));
  return names;
}

function matchesProduct(appName, names) {
  const name = lower(appName);
  if (names.has(name)) return true;
  if (name.startsWith('web:')) return names.has(name.slice(4));
  if (name.startsWith('ext:')) return names.has(name.slice(4).split('@')[0]);
  return false;
}

function usageEntries(sample) {
  const usage = sample?.usage;
  if (Array.isArray(usage)) return usage;
  if (Array.isArray(usage?.usage)) return usage.usage;
  return [];
}

// Active seconds in one sample row: worked time, or automation for agents.
function activeSeconds(entry) {
  const worked = Number(entry.worked_runtime_seconds);
  if (Number.isFinite(worked) && worked > 0) return worked;
  const automation = Number(entry.automation_worked_seconds ?? entry.background_automation_worked_seconds);
  if (Number.isFinite(automation) && automation > 0) return automation;
  const foreground = Number(entry.foreground_runtime_seconds ?? entry.total_runtime_seconds) || 0;
  return Math.max(0, foreground - (Number(entry.idle_runtime_seconds) || 0));
}

function pcKey(pcName) {
  return `pc_${String(pcName).replace(/[^A-Za-z0-9]+/g, '_')}`;
}

function series(pcMinutes) {
  const pcs = [...pcMinutes.keys()].sort();
  const lines = pcs.map((pc, index) => ({ key: pcKey(pc), name: pc, color: COLORS[index % COLORS.length] }));
  const data = HOURS.map((time, hour) => {
    const point = { time };
    pcs.forEach((pc) => {
      point[pcKey(pc)] = Math.round(pcMinutes.get(pc)[hour]);
    });
    return point;
  });
  return { data, lines };
}

// Sample seats: a working-day curve per PC, scaled by how much that PC uses the app.
function sampleSeries(product) {
  const pcMinutes = new Map();
  product.seats.forEach((seat, index) => {
    const workedHours = (Number(seat.workedRuntimeSeconds) || 0) / 3600;
    if (workedHours <= 0) return;
    const peak = Math.min(58, 6 + workedHours * 2.2);
    const start = 8 + (index % 3);
    const end = 16 + (index % 4);
    const minutes = HOURS.map((_, hour) => {
      if (hour < start - 1 || hour > end + 1) return Math.max(0, (index % 2) * 2);
      const middle = (start + end) / 2;
      const spread = (end - start) / 2 + 1;
      const shape = Math.max(0, 1 - ((hour - middle) / spread) ** 2);
      const lunchDip = hour === 12 + (index % 2) ? 0.55 : 1;
      return peak * shape * lunchDip;
    });
    pcMinutes.set(seat.pcName, minutes);
  });
  return pcMinutes;
}

export function appEngagementSeries(product, telemetryHistory = [], now = Date.now()) {
  if (product.sample) return { ...series(sampleSeries(product)), sample: true };
  const names = productNames(product);
  const since = now - DAY_MS;
  const pcMinutes = new Map();
  for (const sample of telemetryHistory) {
    const time = Date.parse(sample?.timestamp);
    if (!Number.isFinite(time) || time < since || time > now) continue;
    const pc = String(sample.device_name || sample.usage?.device_name || sample.device_id || '').toUpperCase();
    if (!pc) continue;
    const seconds = usageEntries(sample)
      .filter((entry) => matchesProduct(entry.app_name, names))
      .reduce((sum, entry) => sum + activeSeconds(entry), 0);
    if (seconds <= 0) continue;
    if (!pcMinutes.has(pc)) pcMinutes.set(pc, new Array(24).fill(0));
    pcMinutes.get(pc)[new Date(time).getHours()] += seconds / 60;
  }
  return { ...series(pcMinutes), sample: false };
}
