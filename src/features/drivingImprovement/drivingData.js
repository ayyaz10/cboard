export const HABIT_STATUSES = ['NEEDS_WORK', 'IMPROVING', 'STABLE'];
export const HABIT_STATUS_LABELS = {
  NEEDS_WORK: 'Needs Work', IMPROVING: 'Improving', STABLE: 'Stable',
};

const uuid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function createInitialHabitData() {
  return {
    version: 1,
    habitVersion: 1,
    categories: [],
    mistakes: [],
    reminders: [],
    guidanceNotes: [],
  };
}

export function migrateHabitData(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.categories) || !Array.isArray(data.mistakes)) {
    throw new Error('Habit Improvement data is invalid.');
  }
  const next = structuredClone(data);
  let changed = next.habitVersion !== 1;
  for (const item of next.mistakes) {
    if (item?.status === 'CONFIDENT') {
      item.status = 'STABLE';
      changed = true;
    }
  }
  if (changed) next.habitVersion = 1;
  return { data: validateHabitData(next), changed };
}

export function validateHabitData(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.categories) || !Array.isArray(data.mistakes)) throw new Error('Habit Improvement data is invalid.');
  if (data.reminders !== undefined && !Array.isArray(data.reminders)) throw new Error('Archived reference data is invalid.');
  const categoryIds = new Set();
  for (const category of data.categories) {
    if (!category || typeof category.id !== 'string' || categoryIds.has(category.id) || typeof category.name !== 'string' || !category.name.trim() || category.name.length > 80) throw new Error('Habit category data is invalid.');
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

export function makeImprovementItem(input, userId, now = new Date().toISOString()) {
  return { id: uuid(), userId, categoryId: input.categoryId, title: input.title.trim(), description: (input.description || '').trim(), cause: input.cause.trim(), correction: input.correction.trim(), status: input.status || 'NEEDS_WORK', createdAt: now, updatedAt: now };
}
