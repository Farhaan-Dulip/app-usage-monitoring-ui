// Reports & Insights > Tracker Usage: what the Trackers measured on PCs over
// the last 30 days (real telemetry), across all monitored apps.
import { daysSince, isoDay, lastDays } from '../aiTools/http.js';

const round = (value) => Math.round(value * 100) / 100;

export function buildTrackerReport(events, devices, now = new Date()) {
  const days = lastDays(now, 30);
  const perDay = Object.fromEntries(days.map((day) => [day, { date: day, worked: 0, idle: 0 }]));
  const perApp = new Map();
  const perDevice = new Map();
  for (const event of events) {
    const day = event.recorded_date || isoDay(event.received_at || event.timestamp);
    const key = event.device_key || event.device_id;
    const device = perDevice.get(key) || { device: event.device_name || key, user: event.user_upn || event.usage?.user_upn || '', worked: 0, samples: 0, lastSeen: null };
    device.samples += 1;
    if (!device.lastSeen || String(event.timestamp) > device.lastSeen) device.lastSeen = event.timestamp;
    for (const row of event.usage?.usage || []) {
      const worked = Number(row.worked_runtime_seconds) || 0;
      const idle = Number(row.idle_runtime_seconds) || 0;
      const app = String(row.app_name || 'unknown').toLowerCase();
      if (perDay[day]) {
        perDay[day].worked += worked;
        perDay[day].idle += idle;
      }
      const entry = perApp.get(app) || { app, worked: 0, idle: 0, devices: new Set() };
      entry.worked += worked;
      entry.idle += idle;
      if (worked > 0) entry.devices.add(key);
      perApp.set(app, entry);
      device.worked += worked;
    }
    perDevice.set(key, device);
  }
  const apps = [...perApp.values()].sort((a, b) => b.worked - a.worked);
  const deviceRows = [...perDevice.values()].sort((a, b) => b.worked - a.worked);
  const totalWorked = apps.reduce((total, app) => total + app.worked, 0);
  const totalIdle = apps.reduce((total, app) => total + app.idle, 0);
  const registered = devices.length;
  const liveNow = devices.filter((device) => device.lastSeenAt && Date.now() - new Date(device.lastSeenAt).getTime() < 15 * 60 * 1000).length;

  return {
    kpis: [
      { label: 'PCs reporting (30 days)', value: perDevice.size, format: 'number' },
      { label: 'Live now', value: liveNow, format: 'number', hint: `${registered} registered` },
      { label: 'Active time, 30 days', value: totalWorked / 3600, format: 'hours' },
      { label: 'Idle share', value: totalWorked + totalIdle ? totalIdle / (totalWorked + totalIdle) : null, format: 'percent' },
      { label: 'Apps with activity', value: apps.filter((app) => app.worked > 0).length, format: 'number' },
      { label: 'Telemetry samples', value: events.length, format: 'number' },
    ],
    charts: [
      {
        id: 'daily',
        title: 'Active vs idle hours per day',
        type: 'area',
        stacked: true,
        xKey: 'date',
        series: [{ key: 'worked', label: 'Active hours', format: 'hours' }, { key: 'idle', label: 'Idle hours', format: 'hours' }],
        data: Object.values(perDay).map((day) => ({ date: day.date, worked: round(day.worked / 3600), idle: round(day.idle / 3600) })),
      },
      {
        id: 'apps',
        title: 'Active hours by app',
        type: 'bar',
        xKey: 'name',
        series: [{ key: 'hours', label: 'Active hours', format: 'hours' }],
        data: apps.slice(0, 12).map((app) => ({ name: app.app, hours: round(app.worked / 3600) })),
      },
    ],
    table: {
      title: 'PCs',
      columns: [
        { key: 'device', label: 'PC', format: 'text' },
        { key: 'user', label: 'User', format: 'text' },
        { key: 'hours', label: 'Active hours (30d)', format: 'hours' },
        { key: 'lastSeen', label: 'Last report', format: 'date' },
        { key: 'status', label: 'Status', format: 'status' },
      ],
      rows: deviceRows.map((device) => ({
        id: device.device,
        device: device.device,
        user: device.user || '—',
        hours: round(device.worked / 3600),
        lastSeen: device.lastSeen,
        status: daysSince(device.lastSeen, now) === null ? 'never' : daysSince(device.lastSeen, now) <= 1 ? 'active' : 'idle',
      })),
    },
    appsTable: apps.map((app) => ({ app: app.app, hours: round(app.worked / 3600), idleHours: round(app.idle / 3600), devices: app.devices.size })),
  };
}
