export function filterApps(apps, query) {
  const search = String(query || '').trim().toLowerCase();
  return apps.filter(item => `${item.label} ${item.path} ${item.path === '/training' ? 'exercise workout' : ''}`.toLowerCase().includes(search));
}

export function nextAppIndex(index, count, key) {
  if (!count) return 0;
  return (index + (key === 'ArrowDown' ? 1 : count - 1)) % count;
}

