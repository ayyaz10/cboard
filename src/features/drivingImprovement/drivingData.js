export const DRIVING_STATUSES = ['NEEDS_WORK', 'IMPROVING', 'CONFIDENT'];
export const DRIVING_STATUS_LABELS = {
  NEEDS_WORK: 'Needs Work', IMPROVING: 'Improving', CONFIDENT: 'Confident',
};
export const STARTER_CATEGORIES = [
  'Roundabouts', 'Mirrors', 'Stopping & Braking', 'Speed Control', 'Speed Bumps',
  'Lane Discipline', 'Changing Lanes', 'Junctions & Traffic Signals',
  'Pedestrian Awareness', 'Road Signs',
];
const uuid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function createInitialDrivingData(now = new Date().toISOString()) {
  return {
    version: 1,
    categories: STARTER_CATEGORIES.map(name => ({ id: uuid(), name, createdAt: now, updatedAt: now })),
    mistakes: [],
  };
}

export function validateDrivingData(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.categories) || !Array.isArray(data.mistakes)) throw new Error('Driving Improvement data is invalid.');
  const categoryIds = new Set();
  for (const category of data.categories) {
    if (!category || typeof category.id !== 'string' || categoryIds.has(category.id) || typeof category.name !== 'string' || !category.name.trim() || category.name.length > 80) throw new Error('Driving category data is invalid.');
    categoryIds.add(category.id);
  }
  const mistakeIds = new Set();
  for (const mistake of data.mistakes) {
    if (!mistake || typeof mistake.id !== 'string' || mistakeIds.has(mistake.id) || typeof mistake.title !== 'string' || !mistake.title.trim() || mistake.title.length > 160 || !categoryIds.has(mistake.categoryId) || !DRIVING_STATUSES.includes(mistake.status) || typeof mistake.cause !== 'string' || typeof mistake.correction !== 'string') throw new Error('Driving mistake data is invalid.');
    if (mistake.cause.length > 5000 || mistake.correction.length > 5000) throw new Error('Driving mistake notes are too long.');
    mistakeIds.add(mistake.id);
  }
  if (JSON.stringify(data).length > 500000) throw new Error('Driving Improvement data exceeds the supported size.');
  return data;
}

export function sortDrivingMistakes(mistakes) {
  const priority = { NEEDS_WORK: 0, IMPROVING: 1, CONFIDENT: 2 };
  return [...mistakes].sort((a, b) => priority[a.status] - priority[b.status] || b.updatedAt.localeCompare(a.updatedAt));
}

export function getDrivingSummary(mistakes) {
  return { total: mistakes.length, ...Object.fromEntries(DRIVING_STATUSES.map(status => [status, mistakes.filter(item => item.status === status).length])) };
}

export function makeDrivingMistake(input, userId, now = new Date().toISOString()) {
  return { id: uuid(), userId, categoryId: input.categoryId, title: input.title.trim(), cause: input.cause.trim(), correction: input.correction.trim(), status: input.status || 'NEEDS_WORK', createdAt: now, updatedAt: now };
}
