import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialHabitData, getHabitSummary, makeImprovementItem, migrateHabitData,
  sortImprovementItems, validateHabitData,
} from './drivingData.js';

test('new workspaces are empty and do not seed driving categories or reminders', () => {
  assert.deepEqual(createInitialHabitData(), {
    version: 1, habitVersion: 1, categories: [], mistakes: [], reminders: [], guidanceNotes: [],
  });
});

test('generic behaviour items work with user-created Focus and Sleep categories', () => {
  const data = createInitialHabitData();
  data.categories.push({ id: 'focus', name: 'Focus', createdAt: '2026-10-31T00:00:00.000Z' });
  data.categories.push({ id: 'sleep', name: 'Sleep', createdAt: '2026-10-31T00:00:00.000Z' });
  const phone = makeImprovementItem({
    title: 'Phone distraction while working', categoryId: 'focus', cause: 'User-entered trigger',
    correction: 'User-entered next action', status: 'NEEDS_WORK',
  }, 'user-a');
  const sleep = makeImprovementItem({
    title: 'Going to bed too late', categoryId: 'sleep', cause: '', correction: 'Set a wind-down alarm', status: 'IMPROVING',
  }, 'user-a');
  data.mistakes.push(phone, sleep);
  validateHabitData(data);
  assert.equal(phone.title, 'Phone distraction while working');
  assert.equal(phone.cause, 'User-entered trigger');
  assert.equal(phone.correction, 'User-entered next action');
  assert.deepEqual(getHabitSummary(data.mistakes), { total: 2, NEEDS_WORK: 1, IMPROVING: 1, STABLE: 0 });
});

test('legacy driving data keeps IDs, dates, category and text while CONFIDENT maps to STABLE', () => {
  const legacy = {
    version: 1,
    categories: [{ id: 'category-mirrors', name: 'Mirrors', createdAt: '2025-01-02T00:00:00.000Z' }],
    mistakes: [
      { id: 'needs', userId: 'user-a', categoryId: 'category-mirrors', title: 'Late mirror check', cause: 'Busy junction', correction: 'Check before changing speed', status: 'NEEDS_WORK', createdAt: '2025-02-01', updatedAt: '2025-02-02' },
      { id: 'improving', userId: 'user-a', categoryId: 'category-mirrors', title: 'Mirror timing', cause: 'User text', correction: 'Check before turning', status: 'IMPROVING', createdAt: '2025-03-01', updatedAt: '2025-03-02' },
      { id: 'confident', userId: 'user-a', categoryId: 'category-mirrors', title: 'Stable observation', cause: 'Original why', correction: 'Original action', status: 'CONFIDENT', createdAt: '2025-04-01', updatedAt: '2025-04-02' },
    ],
    reminders: [{ id: 'legacy-reminder', userId: 'user-a', categoryId: 'category-mirrors', title: 'Archived reminder', text: 'Keep archived', createdAt: '2025-01-01', updatedAt: '2025-01-01' }],
    guidanceNotes: ['Keep archived guidance note'],
  };
  const migrated = migrateHabitData(legacy);
  const repeated = migrateHabitData(migrated.data);
  assert.equal(migrated.changed, true);
  assert.equal(repeated.changed, false);
  assert.deepEqual(repeated.data, migrated.data);
  assert.equal(migrated.data.categories[0].id, 'category-mirrors');
  assert.equal(migrated.data.categories[0].name, 'Mirrors');
  assert.deepEqual(migrated.data.mistakes.map(item => item.status), ['NEEDS_WORK', 'IMPROVING', 'STABLE']);
  assert.deepEqual(migrated.data.mistakes[2], legacy.mistakes[2] && { ...legacy.mistakes[2], status: 'STABLE' });
  assert.deepEqual(migrated.data.reminders, legacy.reminders);
  assert.deepEqual(migrated.data.guidanceNotes, legacy.guidanceNotes);
});

test('Quick Review order is Needs Work then Improving and excludes Stable', () => {
  const items = [
    { id: 'stable', status: 'STABLE', updatedAt: '2026-10-30' },
    { id: 'improving', status: 'IMPROVING', updatedAt: '2026-10-29' },
    { id: 'needs-old', status: 'NEEDS_WORK', updatedAt: '2026-10-29' },
    { id: 'needs-new', status: 'NEEDS_WORK', updatedAt: '2026-10-30' },
  ];
  const ordered = sortImprovementItems(items);
  assert.deepEqual(ordered.map(item => item.id), ['needs-new', 'needs-old', 'improving', 'stable']);
  assert.deepEqual(ordered.filter(item => item.status !== 'STABLE').map(item => item.id), ['needs-new', 'needs-old', 'improving']);
});

test('all status transitions are reversible and unknown states or orphan items are rejected', () => {
  const data = createInitialHabitData();
  data.categories.push({ id: 'focus', name: 'Focus' });
  const item = makeImprovementItem({ title: 'Phone distraction', categoryId: 'focus', cause: '', correction: '', status: 'NEEDS_WORK' }, 'user-a');
  data.mistakes.push(item);
  for (const status of ['IMPROVING', 'STABLE', 'IMPROVING', 'NEEDS_WORK']) {
    item.status = status;
    validateHabitData(data);
  }
  item.status = 'CONFIDENT';
  assert.throws(() => validateHabitData(data), /invalid/i);
  item.status = 'NEEDS_WORK';
  item.categoryId = 'missing';
  assert.throws(() => validateHabitData(data), /invalid/i);
});
