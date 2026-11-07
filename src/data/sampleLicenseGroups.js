// Sample rows for License Utilizations: fictional PCs and people (no real
// data), shown only while "Sample data" is switched on, to demo every status
// and how vendor admin data keeps a seat or confirms a reclaim.
//
// Each group has the shape buildLicenseGroups() produces, plus `sample: true`
// and `vendorRule` in the shape the backend's /api/vendor-rule-results returns.

const HOUR = 3600;
const minutesAgo = (now, minutes) => new Date(now - minutes * 60 * 1000).toISOString();

const surface = (now, kind, detail, { total = 0, worked = 0, automation = 0, idle = 0, lastSeenMinutes = null, status = 'Active', ...rest } = {}) => ({
  surface: kind,
  detail,
  totalRuntimeSeconds: total,
  workedRuntimeSeconds: worked,
  automationWorkedSeconds: automation,
  idleRuntimeSeconds: idle,
  lastSeenAt: lastSeenMinutes === null ? null : minutesAgo(now, lastSeenMinutes),
  notTracked: lastSeenMinutes === null && status !== 'Not installed',
  status,
  ...rest,
});

const check = (label, kind, threshold, value) => ({
  label,
  kind,
  threshold,
  value,
  met: kind === 'within' ? value !== null && value <= threshold : value >= threshold,
});

// Same wording as applyVendorRuleResults() gives real results.
const described = (item) =>
  item.kind === 'within'
    ? `${item.label} ${item.threshold} days (${item.value === 0 ? 'today' : `${item.value} days ago`})`
    : `${item.label} ${item.value} (needs ${item.threshold})`;

const vendorRule = (source, policyName, checks) => ({
  source,
  policyName,
  checks,
  inUse: checks.some((item) => item.met),
  metText: checks.filter((item) => item.met).map(described).join('; '),
  mode: 'sample',
});

// Product IDs and the active-time threshold (hours) of each sample policy.
const PRODUCT_OF = { Claude: 'claude', Postman: 'postman', Codex: 'codex', 'GitHub Copilot': 'copilot', Figma: 'figma' };
const THRESHOLD_HOURS = { claude: 8, postman: 2, codex: 8, copilot: 8, figma: 4 };

function group(now, { pc, name, appName, status, reason, cost, surfaces, vendor = null, hasAgentExtension = false }) {
  const sum = (field) => surfaces.reduce((total, item) => total + (Number(item[field]) || 0), 0);
  return {
    id: `sample|${pc}|${name}`,
    sample: true,
    pcName: pc,
    name,
    appName,
    productId: PRODUCT_OF[name],
    thresholdHours: THRESHOLD_HOURS[PRODUCT_OF[name]],
    icon: null,
    surfaces,
    hostsExtensions: [],
    status,
    reclaimReason: reason,
    monthlyCost: cost,
    savingsOpportunity: status === 'Reclaimable' ? cost : 0,
    totalRuntimeSeconds: sum('totalRuntimeSeconds'),
    workedRuntimeSeconds: sum('workedRuntimeSeconds'),
    automationWorkedSeconds: sum('automationWorkedSeconds'),
    idleRuntimeSeconds: sum('idleRuntimeSeconds'),
    hasAgentExtension,
    vendorRule: vendor,
  };
}

export function sampleLicenseGroups(now = Date.now()) {
  return [
    // Heavy desktop use: tracker active time alone keeps it.
    group(now, {
      pc: 'SAMPLE-ENG-01',
      name: 'Claude',
      appName: 'Claude',
      status: 'Active',
      reason: 'Policy thresholds met',
      cost: 25,
      hasAgentExtension: true,
      surfaces: [
        surface(now, 'Desktop app', 'claude.exe', { total: 31 * HOUR, worked: 22 * HOUR, automation: 6 * HOUR, idle: 9 * HOUR, lastSeenMinutes: 12 }),
        surface(now, 'Extension', 'Claude Code in Visual Studio Code', { total: 9 * HOUR, worked: 9 * HOUR, automation: 9 * HOUR, lastSeenMinutes: 40, type: 'agent' }),
        surface(now, 'Web app', 'claude.ai', { total: 2 * HOUR, worked: 1.5 * HOUR, idle: 0.5 * HOUR, lastSeenMinutes: 300 }),
      ],
      vendor: vendorRule('Claude Code usage report', 'Engineering', [
        check('Used Claude Code within', 'within', 7, 0),
        check('Active days', 'atLeast', 4, 18),
        check('Accepted edits', 'atLeast', 20, 412),
      ]),
    }),
    // Low desktop time, but the vendor shows real Claude Code use: kept.
    group(now, {
      pc: 'SAMPLE-ENG-02',
      name: 'Claude',
      appName: 'Claude',
      status: 'Active',
      reason: 'Kept by vendor activity: Used Claude Code within 7 days (2 days ago); Accepted edits 64 (needs 20) (sample data)',
      cost: 25,
      surfaces: [
        surface(now, 'Desktop app', 'claude.exe', { total: 1.2 * HOUR, worked: 0.4 * HOUR, idle: 0.8 * HOUR, lastSeenMinutes: 2880 }),
        surface(now, 'Web app', 'claude.ai', { lastSeenMinutes: null }),
      ],
      vendor: vendorRule('Claude Code usage report', 'Engineering', [
        check('Used Claude Code within', 'within', 7, 2),
        check('Active days', 'atLeast', 4, 3),
        check('Accepted edits', 'atLeast', 20, 64),
      ]),
    }),
    // Neither the tracker nor Postman's audit log shows use: reclaim.
    group(now, {
      pc: 'SAMPLE-QA-01',
      name: 'Postman',
      appName: 'Postman',
      status: 'Reclaimable',
      reason: 'Below policy thresholds; no sign-in within 30 days',
      cost: 19,
      surfaces: [
        surface(now, 'Desktop app', 'Postman.exe', { total: 0.3 * HOUR, worked: 0.1 * HOUR, idle: 0.2 * HOUR, lastSeenMinutes: 26 * 24 * 60, status: 'Reclaimable' }),
        surface(now, 'Web app', 'web.postman.co', { lastSeenMinutes: null }),
      ],
      vendor: vendorRule('Postman audit log', 'QA team', [check('Signed in within', 'within', 30, 47)]),
    }),
    // Low desktop time but signed in recently (uses the web app elsewhere): kept.
    group(now, {
      pc: 'SAMPLE-QA-02',
      name: 'Postman',
      appName: 'Postman',
      status: 'Active',
      reason: 'Kept by vendor activity: Signed in within 30 days (5 days ago) (sample data)',
      cost: 19,
      surfaces: [
        surface(now, 'Desktop app', 'Postman.exe', { total: 0.6 * HOUR, worked: 0.2 * HOUR, idle: 0.4 * HOUR, lastSeenMinutes: 9 * 24 * 60 }),
        surface(now, 'Web app', 'web.postman.co', { total: 3 * HOUR, worked: 2.4 * HOUR, idle: 0.6 * HOUR, lastSeenMinutes: 5 * 24 * 60 }),
      ],
      vendor: vendorRule('Postman audit log', 'QA team', [check('Signed in within', 'within', 30, 5)]),
    }),
    // Codex used through the CLI and IDE: the vendor confirms heavy use.
    group(now, {
      pc: 'SAMPLE-ENG-03',
      name: 'Codex',
      appName: 'Codex',
      status: 'Active',
      reason: 'Policy thresholds met',
      cost: 30,
      hasAgentExtension: true,
      surfaces: [
        surface(now, 'Desktop app', 'codex.exe', { total: 6 * HOUR, worked: 5 * HOUR, automation: 5 * HOUR, idle: HOUR, lastSeenMinutes: 55, type: 'agent' }),
        surface(now, 'Extension', 'Codex in Visual Studio Code', { total: 11 * HOUR, worked: 11 * HOUR, automation: 11 * HOUR, lastSeenMinutes: 20, type: 'agent' }),
      ],
      vendor: vendorRule('Codex usage', 'Engineering', [
        check('Used Codex within', 'within', 10, 0),
        check('Active days', 'atLeast', 5, 14),
        check('Turns', 'atLeast', 30, 286),
      ]),
    }),
    // Codex seat nobody uses: the vendor has no record of them.
    group(now, {
      pc: 'SAMPLE-SALES-01',
      name: 'Codex',
      appName: 'Codex',
      status: 'Reclaimable',
      reason: 'Below policy thresholds; no Codex use reported by OpenAI',
      cost: 30,
      surfaces: [surface(now, 'Desktop app', 'codex.exe', { status: 'Reclaimable', lastSeenMinutes: null })],
      vendor: vendorRule('Codex usage', 'Sales', [
        check('Used Codex within', 'within', 10, null),
        check('Active days', 'atLeast', 5, 0),
        check('Turns', 'atLeast', 30, 0),
      ]),
    }),
    // Copilot in two IDEs.
    group(now, {
      pc: 'SAMPLE-ENG-01',
      name: 'GitHub Copilot',
      appName: 'GitHub Copilot',
      status: 'Active',
      reason: 'Policy thresholds met',
      cost: 39,
      hasAgentExtension: true,
      surfaces: [
        surface(now, 'Extension', 'In Visual Studio Code, IntelliJ IDEA', { total: 24 * HOUR, worked: 24 * HOUR, automation: 24 * HOUR, lastSeenMinutes: 8, type: 'agent' }),
      ],
      vendor: vendorRule('GitHub Copilot metrics', 'Engineering', [
        check('Accepted suggestions', 'atLeast', 50, 731),
        check('Active within', 'within', 7, 0),
      ]),
    }),
    // App deployed to the PC but the tracker never found it installed.
    group(now, {
      pc: 'SAMPLE-DESIGN-01',
      name: 'Figma',
      appName: 'Figma',
      status: 'Not installed',
      reason: 'The Tracker did not find this app on the PC',
      cost: 15,
      surfaces: [
        surface(now, 'Desktop app', 'Figma.exe', { status: 'Not installed', lastSeenMinutes: null }),
        surface(now, 'Web app', 'figma.com', { lastSeenMinutes: null }),
      ],
      vendor: vendorRule('Figma activity log', 'Design team', [
        check('Files edited', 'atLeast', 5, 0),
        check('Files viewed', 'atLeast', 10, 2),
      ]),
    }),
    // New window still collecting data.
    group(now, {
      pc: 'SAMPLE-DESIGN-02',
      name: 'Figma',
      appName: 'Figma',
      status: 'Evaluating',
      reason: 'First evaluation in progress',
      cost: 15,
      surfaces: [
        surface(now, 'Desktop app', 'Figma.exe', { total: 4 * HOUR, worked: 3.1 * HOUR, idle: 0.9 * HOUR, lastSeenMinutes: 90, status: 'Evaluating' }),
        surface(now, 'Web app', 'figma.com', { total: 1 * HOUR, worked: 0.7 * HOUR, idle: 0.3 * HOUR, lastSeenMinutes: 600 }),
      ],
      vendor: vendorRule('Figma activity log', 'Design team', [
        check('Files edited', 'atLeast', 5, 12),
        check('Files viewed', 'atLeast', 10, 41),
      ]),
    }),
    ...extraSeats(now),
  ];
}

// More sample PCs per product, so each app's engagement chart has a spread of
// heavy, light and idle seats. [pc, manual hours, automation hours, idle hours,
// vendor values, status?]; the status follows the policy unless given.
const VENDOR_CHECKS = {
  claude: ([used, days, edits]) => [
    check('Used Claude Code within', 'within', 7, used),
    check('Active days', 'atLeast', 4, days),
    check('Accepted edits', 'atLeast', 20, edits),
  ],
  codex: ([used, days, turns]) => [
    check('Used Codex within', 'within', 10, used),
    check('Active days', 'atLeast', 5, days),
    check('Turns', 'atLeast', 30, turns),
  ],
  postman: ([signedIn]) => [check('Signed in within', 'within', 30, signedIn)],
  copilot: ([accepted, active]) => [
    check('Accepted suggestions', 'atLeast', 50, accepted),
    check('Active within', 'within', 7, active),
  ],
  figma: ([edited, viewed]) => [
    check('Files edited', 'atLeast', 5, edited),
    check('Files viewed', 'atLeast', 10, viewed),
  ],
};

const EXTRA_SEATS = {
  Claude: {
    cost: 25, policy: 'Engineering', source: 'Claude Code usage report', process: 'claude.exe',
    seats: [
      ['SAMPLE-ENG-04', 11, 4, 3, [1, 12, 188]],
      ['SAMPLE-ENG-05', 7.5, 3, 2.5, [0, 15, 240]],
      ['SAMPLE-PM-01', 5, 0, 1.5, [4, 6, 22]],
      ['SAMPLE-SALES-02', 0.5, 0, 1.2, [null, 0, 0]],
      ['SAMPLE-OPS-01', 2, 0, 0.8, [9, 2, 6]],
    ],
  },
  Codex: {
    cost: 30, policy: 'Engineering', source: 'Codex usage', process: 'codex.exe', agent: true,
    seats: [
      ['SAMPLE-ENG-04', 2, 9, 1, [0, 11, 190]],
      ['SAMPLE-ENG-06', 1, 6.5, 0.5, [2, 7, 96]],
      ['SAMPLE-QA-03', 0.5, 2, 0.4, [6, 3, 18]],
      ['SAMPLE-PM-02', 0, 0, 0.3, [null, 0, 0]],
    ],
  },
  Postman: {
    cost: 19, policy: 'QA team', source: 'Postman audit log', process: 'Postman.exe',
    seats: [
      ['SAMPLE-QA-03', 4.5, 0, 1, [2]],
      ['SAMPLE-QA-04', 3, 0, 0.6, [8]],
      ['SAMPLE-ENG-05', 1.2, 0, 0.5, [12]],
      ['SAMPLE-DEV-01', 0.2, 0, 0.3, [61]],
    ],
  },
  'GitHub Copilot': {
    cost: 39, policy: 'Engineering', source: 'GitHub Copilot metrics', process: 'github-copilot', agent: true,
    seats: [
      ['SAMPLE-ENG-02', 0, 13, 0, [402, 0]],
      ['SAMPLE-ENG-04', 0, 18, 0, [655, 0]],
      ['SAMPLE-ENG-05', 0, 9, 0, [210, 1]],
      ['SAMPLE-QA-01', 0, 1.5, 0, [12, 19]],
      ['SAMPLE-SALES-01', 0, 0, 0, [0, null]],
    ],
  },
  Figma: {
    cost: 15, policy: 'Design team', source: 'Figma activity log', process: 'Figma.exe',
    seats: [
      ['SAMPLE-DESIGN-03', 9, 0, 2, [24, 80]],
      ['SAMPLE-DESIGN-04', 5.5, 0, 1.5, [9, 33], 'Evaluating'],
      ['SAMPLE-PM-01', 1.5, 0, 0.8, [1, 14], 'Evaluating'],
    ],
  },
};

function extraSeats(now) {
  return Object.entries(EXTRA_SEATS).flatMap(([name, spec]) =>
    spec.seats.map(([pc, manual, automation, idle, values, given]) => {
      const product = PRODUCT_OF[name];
      const checks = VENDOR_CHECKS[product](values);
      const vendor = vendorRule(spec.source, spec.policy, checks);
      const worked = (manual + automation) * HOUR;
      const meetsTime = worked >= THRESHOLD_HOURS[product] * HOUR;
      const status = given || (meetsTime || vendor.inUse ? 'Active' : 'Reclaimable');
      const reason = given
        ? 'Evaluation window still running'
        : meetsTime
          ? 'Policy thresholds met'
          : vendor.inUse
            ? `Kept by vendor activity: ${vendor.metText} (sample data)`
            : 'Below policy thresholds; no vendor activity';
      const total = worked + idle * HOUR;
      return group(now, {
        pc,
        name,
        appName: name,
        status,
        reason,
        cost: spec.cost,
        hasAgentExtension: Boolean(spec.agent),
        surfaces: [
          surface(now, spec.agent ? 'Extension' : 'Desktop app', spec.process, {
            total,
            worked,
            automation: automation * HOUR,
            idle: idle * HOUR,
            lastSeenMinutes: total > 0 ? 60 + manual * 37 : null,
            status,
            ...(spec.agent ? { type: 'agent' } : {}),
          }),
        ],
        vendor,
      });
    })
  );
}
