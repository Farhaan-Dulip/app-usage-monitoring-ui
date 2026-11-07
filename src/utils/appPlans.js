// Subscription plans bought for an inventory app. Dates are yyyy-mm-dd strings
// from date inputs, so they compare correctly as text.
export const BILLING_CYCLES = ['Monthly', 'Annual'];

let nextPlanNumber = 0;

export function emptyPlan() {
  nextPlanNumber += 1;
  return {
    id: `plan-${Date.now()}-${nextPlanNumber}`,
    planName: '',
    seats: '',
    pricePerSeat: '',
    billingCycle: 'Annual',
    startDate: '',
    renewalDate: '',
    noticeDays: '',
    autoRenew: false,
  };
}

// First problem in a plan, or '' when it can be saved.
export function planError(plan) {
  if (!String(plan.planName || '').trim()) return 'Enter a plan name.';
  const seats = Number(plan.seats);
  if (!Number.isInteger(seats) || seats < 1) return 'Enter a whole number of seats.';
  if (plan.pricePerSeat !== '' && !(Number(plan.pricePerSeat) >= 0)) return 'Enter a valid price per seat.';
  if (plan.startDate && plan.renewalDate && plan.renewalDate <= plan.startDate) {
    return 'Renewal date must be after the start date.';
  }
  if (plan.noticeDays !== '' && !(Number.isInteger(Number(plan.noticeDays)) && Number(plan.noticeDays) >= 0)) {
    return 'Enter notice as a whole number of days.';
  }
  return '';
}

export function normalizePlan(plan) {
  return {
    ...plan,
    planName: String(plan.planName).trim(),
    seats: Number(plan.seats),
    pricePerSeat: plan.pricePerSeat === '' ? '' : Number(plan.pricePerSeat),
    noticeDays: plan.noticeDays === '' ? '' : Number(plan.noticeDays),
  };
}

// The inventory list's Plans column.
export function planSummary(app) {
  if (app.noPlanNeeded) return { label: 'Free', missing: false };
  const plans = app.plans || [];
  if (plans.length === 0) return { label: 'Plans missing', missing: true };
  const seats = plans.reduce((total, plan) => total + (Number(plan.seats) || 0), 0);
  const names = plans.length === 1 ? plans[0].planName : `${plans.length} plans`;
  return { label: `${names} · ${seats} ${seats === 1 ? 'seat' : 'seats'}`, missing: false };
}
