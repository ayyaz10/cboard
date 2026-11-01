export const DASHBOARD_CARD_SIZES = ['small', 'medium', 'large'];

export function normalizeDashboardCardSizes(value, modules) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const validIds = new Set(modules.map(module => module.id));
  return Object.fromEntries(Object.entries(value).filter(([id, size]) => validIds.has(id) && DASHBOARD_CARD_SIZES.includes(size)));
}

export function updateDashboardCardSize(sizes, id, size, modules) {
  if (!modules.some(module => module.id === id) || !DASHBOARD_CARD_SIZES.includes(size)) return sizes;
  const next = { ...sizes };
  if (size === 'medium') delete next[id];
  else next[id] = size;
  return next;
}
