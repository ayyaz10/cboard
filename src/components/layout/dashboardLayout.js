export const DASHBOARD_VIEW_SIZES = ['small', 'medium', 'large'];
export const DEFAULT_DASHBOARD_VIEW_SIZE = 'medium';

export function normalizeDashboardViewSize(value) {
  return DASHBOARD_VIEW_SIZES.includes(value) ? value : DEFAULT_DASHBOARD_VIEW_SIZE;
}
