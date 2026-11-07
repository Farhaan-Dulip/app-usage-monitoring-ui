export const RECLAIMABLE_THRESHOLD_SECONDS = 60 * 60;
export const TOTAL_MONTHLY_SOFTWARE_SPEND = 4250;
export const DEFAULT_USAGE_WINDOW_SECONDS = 60 * 60;

export const DEFAULT_RECLAIM_POLICY = {
  evaluation_window_seconds: 30 * 24 * 60 * 60,
  worked_threshold_seconds: RECLAIMABLE_THRESHOLD_SECONDS,
  token_threshold: 0,
  idle_threshold_seconds: 4,
};

export const DEFAULT_LICENSE_APP_FORM = {
  appName: '',
  processName: '',
  url: '',
  owner: '',
  ownerEmail: '',
  appType: 'Application',
  parentApp: '',
  subscriptionType: '',
};
