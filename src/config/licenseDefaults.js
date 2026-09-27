export const RECLAIMABLE_THRESHOLD_SECONDS = 60 * 60;
export const TOTAL_MONTHLY_SOFTWARE_SPEND = 4250;
export const DEFAULT_USAGE_WINDOW_SECONDS = 60 * 60;

export const DEFAULT_RECLAIM_POLICY = {
  evaluation_window_seconds: 30 * 24 * 60 * 60,
  worked_threshold_seconds: RECLAIMABLE_THRESHOLD_SECONDS,
  token_threshold: 0,
  idle_threshold_seconds: 4,
};

export const LICENSE_POLICY_OPTIONS = [
  { name: 'Finance baseline', evaluationWindowDays: 30, evaluationWindowValue: 30, evaluationWindowUnit: 'Days', workedThresholdHours: 1 },
  { name: 'Design suite', evaluationWindowDays: 45, evaluationWindowValue: 45, evaluationWindowUnit: 'Days', workedThresholdHours: 4 },
  { name: 'Engineering tools', evaluationWindowDays: 30, evaluationWindowValue: 30, evaluationWindowUnit: 'Days', workedThresholdHours: 8 },
  { name: 'Request based reclaim', evaluationWindowDays: 14, evaluationWindowValue: 14, evaluationWindowUnit: 'Days', workedThresholdHours: 1 },
];

export const DEFAULT_LICENSE_APP_FORM = {
  appName: '',
  processName: '',
  url: '',
  monthlyCost: '',
  owner: '',
  ownerEmail: '',
  appType: 'Application',
  parentApp: '',
  subscriptionType: '',
};

export const DEFAULT_ONBOARD_APP_LICENSE_FORM = {
  appId: '',
  policyName: LICENSE_POLICY_OPTIONS[0].name,
};

export const DEFAULT_POLICY_REGISTRATION_FORM = {
  name: '',
  evaluationWindowValue: '30',
  evaluationWindowUnit: 'Days',
  workedThresholdHours: '1',
};
