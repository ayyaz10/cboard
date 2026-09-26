const STORAGE_KEY = "cboard:navigation-usage:v1";

function readAll() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function readNavigationUsage(userId, scope) {
  const owner = userId || "device";
  const usage = readAll()[owner]?.[scope];
  return usage && typeof usage === "object" ? usage : {};
}

export function orderByUsage(items, usage = {}, getKey = (item) => item) {
  return items
    .map((item, index) => ({ item, index, stats: usage[getKey(item)] || {} }))
    .sort(
      (a, b) =>
        (b.stats.count || 0) - (a.stats.count || 0) ||
        (b.stats.lastUsed || 0) - (a.stats.lastUsed || 0) ||
        a.index - b.index,
    )
    .map(({ item }) => item);
}

export function recordNavigationUse(userId, scope, key, now = Date.now()) {
  if (!scope || !key) return;
  try {
    const all = readAll();
    const owner = userId || "device";
    const current = all[owner]?.[scope]?.[key] || {};
    all[owner] = {
      ...(all[owner] || {}),
      [scope]: {
        ...(all[owner]?.[scope] || {}),
        [key]: { count: Math.min(1000000, (current.count || 0) + 1), lastUsed: now },
      },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Navigation remains usable when browser storage is unavailable.
  }
}
