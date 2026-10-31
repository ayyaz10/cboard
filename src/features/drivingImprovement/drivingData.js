export const HABIT_STATUSES = ['NEEDS_WORK', 'IMPROVING', 'STABLE'];
export const HABIT_STATUS_LABELS = {
  NEEDS_WORK: 'Needs Work', IMPROVING: 'Improving', STABLE: 'Stable',
};

const uuid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function createInitialHabitData() {
  return {
    version: 1,
    habitVersion: 2,
    habits: [],
    categories: [],
    mistakes: [],
    reminders: [],
    guidanceNotes: [],
  };
}

export function slugifyHabitName(name) {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'habit';
}

export function makeHabitArea(input, existingHabits = [], userId, now = new Date().toISOString()) {
  const base = slugifyHabitName(input.name);
  const used = new Set(existingHabits.map(habit => habit.slug));
  let slug = base, suffix = 2;
  while (used.has(slug)) slug = `${base}-${suffix++}`;
  return {
    id: uuid(), userId, name: input.name.trim(), slug,
    description: (input.description || '').trim(), createdAt: now, updatedAt: now, archivedAt: null,
  };
}

function ensureLegacyDrivingArea(data, userId) {
  let area = data.habits.find(habit => habit.slug === 'driving-improvement');
  if (!area) {
    area = {
      id: 'habit-driving-improvement-v1', userId: userId || data.categories.find(category => category.userId)?.userId || null,
      name: 'Driving Improvement', slug: 'driving-improvement', description: '',
      createdAt: data.categories[0]?.createdAt || data.mistakes[0]?.createdAt || new Date(0).toISOString(),
      updatedAt: new Date().toISOString(), archivedAt: null,
    };
    data.habits.push(area);
  }
  const habitIds = new Set(data.habits.map(habit => habit.id));
  for (const category of data.categories) if (!habitIds.has(category.habitId)) category.habitId = area.id;
}

export function migrateHabitData(data, userId) {
  if (!data || data.version !== 1 || !Array.isArray(data.categories) || !Array.isArray(data.mistakes)) {
    throw new Error('Habit Improvement data is invalid.');
  }
  const next = structuredClone(data);
  let changed = next.habitVersion !== 2 || !Array.isArray(next.habits);
  if (!Array.isArray(next.habits)) next.habits = [];
  const knownHabitIds = new Set(next.habits.map(habit => habit.id));
  if (next.categories.length && (next.habits.length === 0 || next.categories.some(category => !knownHabitIds.has(category.habitId)))) {
    ensureLegacyDrivingArea(next, userId);
    changed = true;
  }
  for (const item of next.mistakes) {
    if (item?.status === 'CONFIDENT') {
      item.status = 'STABLE';
      changed = true;
    }
  }
  if (changed) next.habitVersion = 2;
  return { data: validateHabitData(next), changed };
}

export function validateHabitData(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.habits) || !Array.isArray(data.categories) || !Array.isArray(data.mistakes)) throw new Error('Habit Improvement data is invalid.');
  if (data.reminders !== undefined && !Array.isArray(data.reminders)) throw new Error('Archived reference data is invalid.');
  const habitIds = new Set(), habitSlugs = new Set();
  for (const habit of data.habits) {
    if (!habit || typeof habit.id !== 'string' || habitIds.has(habit.id) || typeof habit.name !== 'string' || !habit.name.trim() || habit.name.length > 100 || typeof habit.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(habit.slug) || habitSlugs.has(habit.slug) || (habit.description !== undefined && (typeof habit.description !== 'string' || habit.description.length > 2000)) || (habit.archivedAt !== undefined && habit.archivedAt !== null && typeof habit.archivedAt !== 'string')) throw new Error('Habit area data is invalid.');
    habitIds.add(habit.id); habitSlugs.add(habit.slug);
  }
  const categoryIds = new Set();
  for (const category of data.categories) {
    if (!category || typeof category.id !== 'string' || categoryIds.has(category.id) || typeof category.name !== 'string' || !category.name.trim() || category.name.length > 80 || !habitIds.has(category.habitId)) throw new Error('Habit category data is invalid.');
    categoryIds.add(category.id);
  }
  const itemIds = new Set();
  for (const item of data.mistakes) {
    if (!item || typeof item.id !== 'string' || itemIds.has(item.id) || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 160 || !categoryIds.has(item.categoryId) || !HABIT_STATUSES.includes(item.status) || typeof item.cause !== 'string' || typeof item.correction !== 'string' || (item.description !== undefined && typeof item.description !== 'string')) throw new Error('Improvement item data is invalid.');
    if (item.cause.length > 5000 || item.correction.length > 5000 || (item.description || '').length > 2000) throw new Error('Improvement item notes are too long.');
    itemIds.add(item.id);
  }
  const reminderIds = new Set();
  for (const reminder of data.reminders || []) {
    if (!reminder || typeof reminder.id !== 'string' || reminderIds.has(reminder.id) || typeof reminder.title !== 'string' || !reminder.title.trim() || reminder.title.length > 160 || typeof reminder.text !== 'string' || reminder.text.length > 2000 || !categoryIds.has(reminder.categoryId)) throw new Error('Archived reference data is invalid.');
    reminderIds.add(reminder.id);
  }
  if (data.guidanceNotes !== undefined && (!Array.isArray(data.guidanceNotes) || data.guidanceNotes.some(note => typeof note !== 'string' || note.length > 2000))) throw new Error('Archived guidance data is invalid.');
  if (JSON.stringify(data).length > 500000) throw new Error('Habit Improvement data exceeds the supported size.');
  return data;
}

export function sortImprovementItems(items) {
  const priority = { NEEDS_WORK: 0, IMPROVING: 1, STABLE: 2 };
  return [...items].sort((a, b) => priority[a.status] - priority[b.status] || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export function getHabitSummary(items) {
  return { total: items.length, ...Object.fromEntries(HABIT_STATUSES.map(status => [status, items.filter(item => item.status === status).length])) };
}

export function getItemsForHabit(data, habitId) {
  const categoryIds = new Set(data.categories.filter(category => category.habitId === habitId).map(category => category.id));
  return data.mistakes.filter(item => categoryIds.has(item.categoryId));
}

export function removeHabitArea(data, habitId) {
  const categoryIds = new Set(data.categories.filter(category => category.habitId === habitId).map(category => category.id));
  return {
    ...data,
    habits: data.habits.filter(habit => habit.id !== habitId),
    categories: data.categories.filter(category => category.habitId !== habitId),
    mistakes: data.mistakes.filter(item => !categoryIds.has(item.categoryId)),
    reminders: (data.reminders || []).filter(reminder => !categoryIds.has(reminder.categoryId)),
  };
}

export function makeImprovementItem(input, userId, now = new Date().toISOString()) {
  return { id: uuid(), userId, categoryId: input.categoryId, title: input.title.trim(), description: (input.description || '').trim(), cause: input.cause.trim(), correction: input.correction.trim(), status: input.status || 'NEEDS_WORK', createdAt: now, updatedAt: now };
}
