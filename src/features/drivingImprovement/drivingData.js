export const HABIT_STATUSES = ['NEEDS_WORK', 'IMPROVING', 'STABLE'];
export const HABIT_STATUS_LABELS = { NEEDS_WORK: 'Needs Work', IMPROVING: 'Improving', STABLE: 'Stable' };
export const IMPROVEMENT_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'];
export const IMPROVEMENT_PRIORITY_LABELS = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
export const BACKLOG_TYPES = ['HABIT', 'SKILL', 'BEHAVIOR', 'GENERAL'];
export const BACKLOG_TYPE_LABELS = { HABIT: 'Habit', SKILL: 'Skill', BEHAVIOR: 'Behavior', GENERAL: 'General Improvement' };
export const BACKLOG_STATES = ['BACKLOG', 'PROMOTED', 'ARCHIVED'];
export const HABIT_LIFECYCLE_STATES = ['ACTIVE', 'BACKLOG'];

const uuid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const validStatus = status => HABIT_STATUSES.includes(status);
const normalizedNode = (node, habitId) => ({
  id: node.id, userId: node.userId, habitId, parentId: node.parentId ?? null,
  title: node.title, description: node.description || '', whyItHappens: node.whyItHappens ?? node.cause ?? '',
  whatIDoDifferently: node.whatIDoDifferently ?? node.correction ?? '', richNotes: node.richNotes || '',
  status: node.status === 'CONFIDENT' ? 'STABLE' : (validStatus(node.status) ? node.status : 'NEEDS_WORK'),
  priority: IMPROVEMENT_PRIORITIES.includes(node.priority) ? node.priority : 'MEDIUM',
  focusNow: node.focusNow === true, sortOrder: Number.isFinite(node.sortOrder) ? node.sortOrder : 0,
  archivedAt: node.archivedAt || null, createdAt: node.createdAt || new Date(0).toISOString(),
  updatedAt: node.updatedAt || node.createdAt || new Date(0).toISOString(),
});

export function createInitialHabitData() {
  return { version: 1, habitVersion: 6, habits: [], nodes: [], categories: [], mistakes: [], reminders: [], guidanceNotes: [], backlogItems: [] };
}

export function slugifyHabitName(name) {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'habit';
}

export function makeHabitArea(input, existingHabits = [], userId, now = new Date().toISOString()) {
  const base = slugifyHabitName(input.name), used = new Set(existingHabits.map(habit => habit.slug));
  let slug = base, suffix = 2;
  while (used.has(slug)) slug = `${base}-${suffix++}`;
  return { id: uuid(), userId, name: input.name.trim(), slug, description: (input.description || '').trim(), lifecycleState: 'ACTIVE', activatedAt: now, createdAt: now, updatedAt: now, archivedAt: null };
}

export function makeBacklogItem(input, userId, now = new Date().toISOString()) {
  return { id: uuid(), userId, title: input.title.trim(), note: (input.note || '').trim(), type: BACKLOG_TYPES.includes(input.type) ? input.type : null, priority: IMPROVEMENT_PRIORITIES.includes(input.priority) ? input.priority : null, state: 'BACKLOG', createdAt: now, updatedAt: now, archivedAt: null };
}

export function promoteBacklogItem(data, itemId, habitName, userId, now = new Date().toISOString()) {
  const item = (data.backlogItems || []).find(entry => entry.id === itemId);
  if (!item) throw new Error('Backlog idea was not found.');
  if (item.state === 'PROMOTED') {
    const existing = data.habits.find(habit => habit.id === item.promotedHabitId);
    if (existing?.lifecycleState !== 'BACKLOG' && existing && !existing.archivedAt) return { data, habit: existing, changed: false };
    throw new Error('The linked Habit Improvement area could not be found.');
  }
  if (item.state !== 'BACKLOG') throw new Error('Archived ideas cannot be promoted.');
  const name = habitName.trim();
  if (!name || name.length > 100) throw new Error('Enter a Habit Improvement name under 100 characters.');
  if (item.promotedHabitId) {
    const existing = data.habits.find(habit => habit.id === item.promotedHabitId);
    if (!existing || existing.archivedAt || existing.lifecycleState !== 'BACKLOG') throw new Error('The linked Habit Improvement area could not be resumed.');
    const habit = { ...existing, name, description: item.note, lifecycleState: 'ACTIVE', activatedAt: existing.activatedAt || now, backloggedAt: null, updatedAt: now };
    const next = { ...data, habits: data.habits.map(saved => saved.id === habit.id ? habit : saved), backlogItems: data.backlogItems.map(entry => entry.id === item.id ? { ...entry, state: 'PROMOTED', promotedAt: entry.promotedAt || now, backloggedAt: null, archivedAt: null, updatedAt: now } : entry) };
    return { data: validateHabitData(next), habit, changed: true, resumed: true };
  }
  const habit = data.habits.find(entry => !entry.archivedAt && entry.lifecycleState !== 'BACKLOG' && !data.backlogItems.some(link => link.promotedHabitId === entry.id) && entry.name.toLocaleLowerCase() === name.toLocaleLowerCase()) || makeHabitArea({ name, description: item.note }, data.habits, userId, now);
  const activeHabit = { ...habit, lifecycleState: 'ACTIVE', activatedAt: now, backloggedAt: null };
  const next = { ...data, habits: data.habits.some(entry => entry.id === habit.id) ? data.habits.map(entry => entry.id === habit.id ? activeHabit : entry) : [...data.habits, activeHabit], backlogItems: data.backlogItems.map(entry => entry.id === item.id ? { ...entry, state: 'PROMOTED', promotedHabitId: habit.id, promotedAt: now, updatedAt: now } : entry) };
  return { data: validateHabitData(next), habit, changed: true };
}

export function moveHabitToBacklog(data, habitId, now = new Date().toISOString()) {
  const habit = data.habits.find(entry => entry.id === habitId);
  if (!habit || habit.archivedAt) throw new Error('Active Habit was not found.');
  if (habit.lifecycleState === 'BACKLOG') return data;
  const linked = data.backlogItems.find(item => item.promotedHabitId === habitId);
  const backlogItem = linked
    ? { ...linked, title: habit.name, note: habit.description || linked.note || '', state: 'BACKLOG', promotedAt: linked.promotedAt || habit.activatedAt || habit.createdAt, backloggedAt: now, archivedAt: null, updatedAt: now }
    : { ...makeBacklogItem({ title: habit.name, note: habit.description }, habit.userId, now), promotedHabitId: habit.id, promotedAt: habit.activatedAt || habit.createdAt, backloggedAt: now };
  const next = { ...data, habits: data.habits.map(entry => entry.id === habitId ? { ...entry, lifecycleState: 'BACKLOG', backloggedAt: now, updatedAt: now } : entry), backlogItems: linked ? data.backlogItems.map(item => item.id === linked.id ? backlogItem : item) : [...data.backlogItems, backlogItem] };
  return validateHabitData(next);
}

export const getActiveHabits = data => (data.habits || []).filter(habit => !habit.archivedAt && habit.lifecycleState !== 'BACKLOG');
export const getBacklogItems = data => (data.backlogItems || []).filter(item => item.state === 'BACKLOG');

function ensureLegacyDrivingArea(data, userId) {
  let area = data.habits.find(habit => habit.slug === 'driving-improvement');
  if (!area) {
    area = { id: 'habit-driving-improvement-v1', userId: userId || data.categories.find(category => category.userId)?.userId || null, name: 'Driving Improvement', slug: 'driving-improvement', description: '', lifecycleState: 'ACTIVE', createdAt: data.categories[0]?.createdAt || data.mistakes[0]?.createdAt || new Date(0).toISOString(), updatedAt: new Date().toISOString(), archivedAt: null };
    data.habits.push(area);
  }
  const habitIds = new Set(data.habits.map(habit => habit.id));
  for (const category of data.categories) if (!habitIds.has(category.habitId)) category.habitId = area.id;
}

export function migrateHabitData(data, userId) {
  if (!data || data.version !== 1 || !Array.isArray(data.categories || []) || !Array.isArray(data.mistakes || [])) throw new Error('Habit Improvement data is invalid.');
  const next = structuredClone(data);
  next.categories ||= []; next.mistakes ||= []; next.habits ||= []; next.reminders ||= []; next.guidanceNotes ||= [];
  next.backlogItems ||= [];
  let changed = next.habitVersion !== 6 || !Array.isArray(next.nodes) || !Array.isArray(data.backlogItems);
  next.habits = next.habits.map(habit => {
    if (habit.lifecycleState) return habit;
    changed = true;
    return { ...habit, lifecycleState: 'ACTIVE' };
  });
  if (next.categories.length && (next.habits.length === 0 || next.categories.some(category => !next.habits.some(habit => habit.id === category.habitId)))) {
    ensureLegacyDrivingArea(next, userId); changed = true;
  }
  for (const item of next.mistakes) {
    if (item?.status === 'CONFIDENT') { item.status = 'STABLE'; changed = true; }
    if (item && !item.priority) { item.priority = 'MEDIUM'; changed = true; }
  }
  if (!Array.isArray(next.nodes)) {
    const categoriesById = new Map(next.categories.map(category => [category.id, category]));
    next.nodes = [];
    const categoryOrder = new Map();
    for (const category of next.categories) {
      const habitId = category.habitId || next.habits[0]?.id;
      if (!habitId) continue;
      categoryOrder.set(category.id, next.nodes.filter(node => node.habitId === habitId && node.parentId === null).length);
      next.nodes.push(normalizedNode({ ...category, id: category.id, userId: category.userId || userId, title: category.name, status: category.status || 'NEEDS_WORK', priority: category.priority || 'MEDIUM', sortOrder: categoryOrder.get(category.id), createdAt: category.createdAt, updatedAt: category.updatedAt }, habitId));
    }
    const siblingOrders = new Map();
    for (const item of next.mistakes) {
      const category = categoriesById.get(item.categoryId);
      if (!category) continue;
      const parentId = category.id, orderKey = `${category.habitId}:${parentId}`;
      const sortOrder = siblingOrders.get(orderKey) || 0; siblingOrders.set(orderKey, sortOrder + 1);
      next.nodes.push(normalizedNode({ ...item, parentId, title: item.title, description: item.description, whyItHappens: item.cause, whatIDoDifferently: item.correction, sortOrder }, category.habitId));
    }
  } else {
    next.nodes = next.nodes.map(node => normalizedNode(node, node.habitId || next.categories.find(category => category.id === node.id)?.habitId || next.habits[0]?.id));
  }
  if (next.categories.length || next.mistakes.length) { next.categories = []; next.mistakes = []; changed = true; }
  if (changed) next.habitVersion = 6;
  return { data: validateHabitData(next), changed };
}

export function validateHabitData(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.habits) || !Array.isArray(data.categories) || !Array.isArray(data.mistakes) || !Array.isArray(data.nodes) || !Array.isArray(data.backlogItems)) throw new Error('Habit Improvement data is invalid.');
  if (data.reminders !== undefined && !Array.isArray(data.reminders)) throw new Error('Archived reference data is invalid.');
  const habitIds = new Set(), habitSlugs = new Set();
  const habitsById = new Map();
  for (const habit of data.habits) {
    if (!habit || typeof habit.id !== 'string' || habitIds.has(habit.id) || typeof habit.name !== 'string' || !habit.name.trim() || habit.name.length > 100 || typeof habit.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(habit.slug) || habitSlugs.has(habit.slug) || (habit.description !== undefined && (typeof habit.description !== 'string' || habit.description.length > 2000)) || (habit.archivedAt != null && typeof habit.archivedAt !== 'string') || (habit.lifecycleState != null && !HABIT_LIFECYCLE_STATES.includes(habit.lifecycleState)) || (habit.backloggedAt != null && typeof habit.backloggedAt !== 'string')) throw new Error('Habit area data is invalid.');
    habitIds.add(habit.id); habitSlugs.add(habit.slug);
    habitsById.set(habit.id, habit);
  }
  const backlogIds = new Set(), linkedHabitIds = new Set();
  for (const item of data.backlogItems) {
    if (!item || typeof item.id !== 'string' || backlogIds.has(item.id) || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 160 || typeof item.note !== 'string' || item.note.length > 2000 || (item.type !== null && !BACKLOG_TYPES.includes(item.type)) || (item.priority !== null && !IMPROVEMENT_PRIORITIES.includes(item.priority)) || !BACKLOG_STATES.includes(item.state) || (item.archivedAt != null && typeof item.archivedAt !== 'string') || (item.backloggedAt != null && typeof item.backloggedAt !== 'string')) throw new Error('Improvement backlog data is invalid.');
    if (item.state === 'PROMOTED' || (item.state === 'BACKLOG' && item.promotedHabitId)) {
      const linkedHabit = habitsById.get(item.promotedHabitId);
      const expectedState = item.state === 'PROMOTED' ? 'ACTIVE' : 'BACKLOG';
      if (!linkedHabit || linkedHabit.archivedAt || linkedHabit.lifecycleState !== expectedState || (item.userId && linkedHabit.userId && item.userId !== linkedHabit.userId) || typeof item.promotedAt !== 'string' || linkedHabitIds.has(linkedHabit.id)) throw new Error('Improvement backlog promotion link is invalid.');
      linkedHabitIds.add(linkedHabit.id);
    } else if (item.promotedHabitId != null || item.promotedAt != null) throw new Error('Unpromoted ideas cannot link to an active Habit.');
    backlogIds.add(item.id);
  }
  const categoryIds = new Set();
  for (const category of data.categories) {
    if (!category || typeof category.id !== 'string' || categoryIds.has(category.id) || typeof category.name !== 'string' || !category.name.trim() || category.name.length > 80 || !habitIds.has(category.habitId)) throw new Error('Habit category data is invalid.');
    categoryIds.add(category.id);
  }
  const itemIds = new Set();
  for (const item of data.mistakes) {
    if (!item || typeof item.id !== 'string' || itemIds.has(item.id) || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 160 || !categoryIds.has(item.categoryId) || !HABIT_STATUSES.includes(item.status === 'CONFIDENT' ? 'STABLE' : item.status) || typeof item.cause !== 'string' || typeof item.correction !== 'string') throw new Error('Improvement item data is invalid.');
    itemIds.add(item.id);
  }
  const nodes = data.nodes || [], byId = new Map();
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || byId.has(node.id) || !habitIds.has(node.habitId) || (node.parentId !== null && typeof node.parentId !== 'string') || typeof node.title !== 'string' || !node.title.trim() || node.title.length > 160 || !validStatus(node.status) || !IMPROVEMENT_PRIORITIES.includes(node.priority) || typeof node.focusNow !== 'boolean' || !Number.isFinite(node.sortOrder) || (node.archivedAt != null && typeof node.archivedAt !== 'string')) throw new Error('Improvement node data is invalid.');
    for (const key of ['description', 'whyItHappens', 'whatIDoDifferently', 'richNotes']) if (typeof node[key] !== 'string' || node[key].length > (key === 'description' ? 2000 : 20000)) throw new Error('Improvement node content is invalid.');
    byId.set(node.id, node);
  }
  for (const node of nodes) if (node.parentId !== null) {
    const parent = byId.get(node.parentId);
    if (!parent || parent.habitId !== node.habitId || node.id === node.parentId) throw new Error('Improvement node parent is invalid.');
    const seen = new Set([node.id]); let current = parent;
    while (current) { if (seen.has(current.id)) throw new Error('Improvement node hierarchy contains a cycle.'); seen.add(current.id); current = current.parentId ? byId.get(current.parentId) : null; }
  }
  for (const reminder of data.reminders || []) if (!reminder || typeof reminder.id !== 'string' || typeof reminder.title !== 'string') throw new Error('Archived reference data is invalid.');
  if (data.guidanceNotes !== undefined && (!Array.isArray(data.guidanceNotes) || data.guidanceNotes.some(note => typeof note !== 'string' || note.length > 2000))) throw new Error('Archived guidance data is invalid.');
  if (JSON.stringify(data).length > 500000) throw new Error('Habit Improvement data exceeds the supported size.');
  return data;
}

export function makeImprovementNode(input, userId, now = new Date().toISOString()) {
  return normalizedNode({ ...input, id: uuid(), userId, status: input.status || 'NEEDS_WORK', priority: input.priority || 'MEDIUM', focusNow: input.focusNow ?? false, sortOrder: input.sortOrder ?? 0, createdAt: now, updatedAt: now }, input.habitId);
}

export const getItemsForHabit = (data, habitId) => (data.nodes || []).filter(node => node.habitId === habitId);

export function getNodePath(nodes, nodeId) {
  const byId = new Map(nodes.map(node => [node.id, node])), path = [], seen = new Set(); let node = byId.get(nodeId);
  while (node && !seen.has(node.id)) { seen.add(node.id); path.unshift(node); node = node.parentId ? byId.get(node.parentId) : null; }
  return path;
}

export function getDescendantNodes(nodes, nodeId) {
  const descendants = [], seen = new Set([nodeId]), children = new Map();
  for (const node of nodes) { if (!children.has(node.parentId)) children.set(node.parentId, []); children.get(node.parentId).push(node); }
  const stack = [...(children.get(nodeId) || [])].reverse();
  while (stack.length) { const node = stack.pop(); if (seen.has(node.id)) continue; seen.add(node.id); descendants.push(node); stack.push(...[...(children.get(node.id) || [])].reverse()); }
  return descendants;
}

export function getNodeChildren(nodes, parentId, includeArchived = false) { return nodes.filter(node => node.parentId === parentId && (includeArchived || !node.archivedAt)).sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)); }

export function getProgressSummary(nodes) { return { total: nodes.length, ...Object.fromEntries(HABIT_STATUSES.map(status => [status, nodes.filter(node => node.status === status).length])) }; }
export function getNodeProgress(nodes, nodeId) { return getProgressSummary(getDescendantNodes(nodes, nodeId).filter(node => !node.archivedAt)); }
export function getHabitSummary(nodes) { return getProgressSummary(nodes.filter(node => !node.archivedAt && !getNodePath(nodes, node.id).some(part => part.archivedAt))); }

export function sortImprovementItems(items) {
  const priority = { HIGH: 0, MEDIUM: 1, LOW: 2 }, status = { NEEDS_WORK: 0, IMPROVING: 1, STABLE: 2 };
  return [...items].sort((a, b) => status[a.status] - status[b.status] || priority[a.priority] - priority[b.priority] || a.sortOrder - b.sortOrder || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export function getQuickReviewItems(nodes, includeStable = false) {
  const active = nodes.filter(node => !node.archivedAt && !getNodePath(nodes, node.id).some(part => part.archivedAt));
  return active.filter(node => {
    if (!includeStable && node.status === 'STABLE') return false;
    const hasChildren = getNodeChildren(active, node.id).length > 0;
    const hasOwnImprovement = Boolean(node.whyItHappens.trim() || node.whatIDoDifferently.trim() || node.richNotes.trim());
    return !hasChildren || hasOwnImprovement;
  })
    .sort((a, b) => {
      const rank = node => node.status === 'NEEDS_WORK' ? (node.focusNow ? 0 : node.priority === 'HIGH' ? 1 : 2) : node.status === 'IMPROVING' ? (node.focusNow ? 3 : node.priority === 'HIGH' ? 4 : 5) : 6;
      return rank(a) - rank(b) || Number(!getNodeChildren(active, b.id).length) - Number(!getNodeChildren(active, a.id).length) || a.sortOrder - b.sortOrder;
    });
}

export function getQuickReviewItemsForHabit(data, habitId, includeStable = false) {
  const habit = data.habits.find(item => item.id === habitId && !item.archivedAt && item.lifecycleState !== 'BACKLOG');
  return habit ? getQuickReviewItems(getItemsForHabit(data, habitId), includeStable) : [];
}

export function getActiveNodes(nodes, habitId) { return nodes.filter(node => node.habitId === habitId && !getNodePath(nodes, node.id).some(part => part.archivedAt)); }

export function setNodeParent(nodes, nodeId, parentId) {
  const node = nodes.find(item => item.id === nodeId);
  if (!node) throw new Error('Improvement was not found.');
  if (parentId !== null) { const parent = nodes.find(item => item.id === parentId); if (!parent || parent.habitId !== node.habitId) throw new Error('Choose a parent in the same habit.'); if (parentId === nodeId || getDescendantNodes(nodes, nodeId).some(child => child.id === parentId)) throw new Error('An improvement cannot be moved inside itself or one of its sub-improvements.'); }
  const siblings = nodes.filter(item => item.habitId === node.habitId && item.parentId === parentId && item.id !== nodeId);
  return nodes.map(item => item.id === nodeId ? { ...item, parentId, sortOrder: siblings.length, updatedAt: new Date().toISOString() } : item);
}

export function reorderNode(nodes, nodeId, direction) {
  const node = nodes.find(item => item.id === nodeId); if (!node) return nodes;
  const siblings = nodes.filter(item => item.habitId === node.habitId && item.parentId === node.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const index = siblings.findIndex(item => item.id === nodeId), target = index + direction;
  if (target < 0 || target >= siblings.length) return nodes;
  [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
  const orders = new Map(siblings.map((item, order) => [item.id, order]));
  return nodes.map(item => orders.has(item.id) ? { ...item, sortOrder: orders.get(item.id) } : item);
}

export function archiveNodeBranch(nodes, nodeId, archivedAt = new Date().toISOString()) {
  const ids = new Set([nodeId, ...getDescendantNodes(nodes, nodeId).map(node => node.id)]);
  return nodes.map(node => ids.has(node.id) ? { ...node, archivedAt, updatedAt: archivedAt } : node);
}

export function deleteNodeBranch(nodes, nodeId) {
  const ids = new Set([nodeId, ...getDescendantNodes(nodes, nodeId).map(node => node.id)]);
  return nodes.filter(node => !ids.has(node.id));
}

export function removeHabitArea(data, habitId) {
  const removedNodeIds = new Set((data.nodes || []).filter(node => node.habitId === habitId).map(node => node.id));
  const now = new Date().toISOString();
  return { ...data, habits: data.habits.filter(habit => habit.id !== habitId), nodes: (data.nodes || []).filter(node => node.habitId !== habitId), categories: (data.categories || []).filter(category => category.habitId !== habitId), mistakes: (data.mistakes || []).filter(item => !removedNodeIds.has(item.id)), reminders: (data.reminders || []).filter(reminder => !removedNodeIds.has(reminder.categoryId)), backlogItems: (data.backlogItems || []).map(item => item.promotedHabitId === habitId ? { ...item, state: 'ARCHIVED', promotedHabitId: undefined, promotedAt: undefined, archivedAt: now, updatedAt: now } : item) };
}

export function archiveBacklogItem(items, itemId, now = new Date().toISOString()) {
  return items.map(item => item.id === itemId && item.state === 'BACKLOG' ? { ...item, state: 'ARCHIVED', archivedAt: now, updatedAt: now } : item);
}

export function deleteBacklogItem(items, itemId) { return items.filter(item => item.id !== itemId); }

export function archiveBacklogEntry(data, itemId, now = new Date().toISOString()) {
  const item = data.backlogItems.find(entry => entry.id === itemId && entry.state === 'BACKLOG');
  if (!item) return data;
  const linkedHabitId = item.promotedHabitId;
  return validateHabitData({
    ...data,
    habits: linkedHabitId ? data.habits.map(habit => habit.id === linkedHabitId ? { ...habit, archivedAt: now, updatedAt: now } : habit) : data.habits,
    backlogItems: data.backlogItems.map(entry => entry.id === itemId ? { ...entry, state: 'ARCHIVED', promotedHabitId: undefined, promotedAt: undefined, backloggedAt: undefined, archivedAt: now, updatedAt: now } : entry),
  });
}

export function deleteBacklogEntry(data, itemId) {
  const item = data.backlogItems.find(entry => entry.id === itemId);
  if (!item) return data;
  const linkedHabit = item.promotedHabitId && data.habits.find(habit => habit.id === item.promotedHabitId);
  const removed = linkedHabit ? removeHabitArea(data, linkedHabit.id) : data;
  return validateHabitData({ ...removed, backlogItems: removed.backlogItems.filter(entry => entry.id !== itemId) });
}
