export const OVERDUE_LOOKBACK_DAYS = 365;
export const DASHBOARD_PAGE_SIZE = 50;
export const INITIAL_OVERDUE_ITEMS = 3;

function localMidnight(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function getTodayWindow(now = new Date()) {
  const start = localMidnight(now);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

export function getTimelineWindow(view, now = new Date()) {
  if (view === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - OVERDUE_LOOKBACK_DAYS);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return { startAt: start.toISOString(), endAt: end.toISOString(), includeUndated: false };
  }
  if (view === 'tomorrow') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
    return { startAt: start.toISOString(), endAt: end.toISOString(), includeUndated: false };
  }
  if (view === 'week') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
    return { startAt: start.toISOString(), endAt: end.toISOString(), includeUndated: false };
  }
  return { startAt: '1000-01-01T00:00:00.000Z', endAt: '9999-01-01T00:00:00.000Z', includeUndated: true };
}

export function getOverdueWindow(now = new Date()) {
  const end = localMidnight(now);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - OVERDUE_LOOKBACK_DAYS);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

export function getGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function sortByDueAt(items) {
  return [...items].sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt) || left.id.localeCompare(right.id));
}

export function getIncomplete(items) { return items.filter(item => !item.completedAt); }

export function getNextReminder(overdue, today, now = new Date()) {
  const eligible = new Map();
  for (const item of overdue) if (!item.completedAt) eligible.set(item.id, item);
  for (const item of today) if (!item.completedAt && Date.parse(item.dueAt) <= now.getTime()) eligible.set(item.id, item);
  if (eligible.size) return sortByDueAt([...eligible.values()])[0];
  return sortByDueAt(getIncomplete(today).filter(item => Date.parse(item.dueAt) > now.getTime()))[0] || null;
}

export function formatReminderTime(value, options = {}) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', ...options }).format(date);
}

export function formatTodayDate(date = new Date()) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}
