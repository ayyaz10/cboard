function localDateKey(value) {
  const date = value instanceof Date? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function titleKey(value) { return String(value || '').trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+payment$/, ''); }

export function buildAttentionItems({ items = [], finance = null, training = null, now = new Date() } = {}) {
  const today = localDateKey(now), candidates = [];
  for (const item of items) {
    if (item.completedAt || !item.dueAt) continue;
    const dueDate = localDateKey(item.dueAt);
    if (!dueDate || dueDate > today) continue;
    const overdue = Date.parse(item.dueAt) < now.getTime();
    candidates.push({ id: `shared:${item.type}:${item.id}`, source: item.type === 'task'? 'Tasks' : 'Reminders',
      title: item.title, dueDate, dueAt: item.dueAt, rank: overdue? 0 : 1,
      urgency: overdue? 'Overdue' : 'Due today', action: 'Open Today', href: '/board' });
  }
  for (const payment of finance?.overduePayments || []) candidates.push({
    id: `finance:${payment.id}`, source: 'Finance', title: `${payment.title} payment`, dueDate: payment.dueDate,
    rank: 0, urgency: 'Overdue payment', action: 'Open Finance', href: '/finance',
  });
  for (const payment of finance?.upcomingPayments || []) {
    const rank = payment.dueDate === today? 1 : 2;
    candidates.push({ id: `finance:${payment.id}`, source: 'Finance', title: `${payment.title} payment`,
      dueDate: payment.dueDate, rank, urgency: rank === 1? 'Due today' : 'Upcoming payment',
      action: 'Open Finance', href: '/finance' });
  }
  if (training?.todayPlan) candidates.push({ id: `training:${training.todayPlan.date}`, source: 'Training',
    title: `${training.todayPlan.name}, ${training.todayPlan.exercises} planned exercises`, dueDate: today,
    rank: 1, urgency: training.active? 'In progress' : 'Planned today',
    action: training.active? 'Resume Training' : 'Open Training', href: '/training' });

  candidates.sort((left, right) => left.rank - right.rank || String(left.dueDate || '').localeCompare(String(right.dueDate || ''))
    || left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
  const unique = new Map();
  for (const item of candidates) {
    const duplicateKey = `${titleKey(item.title)}:${item.dueDate || ''}`;
    const previous = unique.get(duplicateKey);
    if (!previous || (previous.source === 'Finance' && item.source !== 'Finance')) unique.set(duplicateKey, item);
  }
  return [...unique.values()];
}
