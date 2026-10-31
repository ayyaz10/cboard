import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialDrivingData, getDrivingSummary, makeDrivingMistake, seedDrivingPresets, sortDrivingMistakes, STARTER_CATEGORIES, validateDrivingData } from './drivingData.js';

test('first-use state seeds the requested categories, mistakes and separate reminders', () => {
  const data = createInitialDrivingData('user-a', '2026-10-31T00:00:00.000Z');
  assert.deepEqual(data.categories.map(category => category.name), STARTER_CATEGORIES);
  assert.equal(data.mistakes.length, 26);
  assert.equal(data.reminders.length, 4);
  assert.equal(data.mistakes.every(item => item.status === 'NEEDS_WORK' && item.userId === 'user-a' && !item.cause && !item.correction), true);
  assert.equal(data.reminders.every(item => item.categoryId === data.categories[9].id), true);
  assert.equal(getDrivingSummary(data.mistakes).total, 26);
});

test('mistakes retain category identity and summaries reflect their current status', () => {
  const data = createInitialDrivingData();
  const mistake = makeDrivingMistake({ title: 'Late mirror check', categoryId: data.categories[1].id, cause: '', correction: '', status: 'NEEDS_WORK' }, 'user-a');
  data.mistakes.push(mistake);
  validateDrivingData(data);
  assert.equal(data.mistakes.find(item => item.id === mistake.id).categoryId, data.categories[1].id);
  assert.deepEqual(getDrivingSummary([mistake]), { total: 1, NEEDS_WORK: 1, IMPROVING: 0, CONFIDENT: 0 });
});

test('preset upgrade adds the provided records once while retaining existing user records', () => {
  const base = createInitialDrivingData('user-a');
  const legacy = {
    version: 1,
    categories: base.categories.map((category, index) => ({ ...category, id: `old-${index}`, name: ['Roundabouts','Mirrors','Stopping & Braking','Speed Control','Speed Bumps','Lane Discipline','Changing Lanes','Junctions & Traffic Signals','Pedestrian Awareness','Road Signs'][index] })),
    mistakes: [{ id: 'personal', userId: 'user-a', categoryId: 'old-0', title: 'My own note', cause: '', correction: '', status: 'IMPROVING', createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
  };
  const seeded = seedDrivingPresets(legacy, 'user-a', '2026-10-31T00:00:00.000Z');
  const again = seedDrivingPresets(seeded, 'user-a', '2026-10-31T00:00:00.000Z');
  assert.equal(seeded.mistakes.length, 27);
  assert.equal(seeded.reminders.length, 4);
  assert.equal(seeded.mistakes.find(item => item.id === 'personal').status, 'IMPROVING');
  assert.equal(seeded.categories.find(item => item.id === 'old-3').name, 'Speed Management');
  assert.equal(again.mistakes.length, seeded.mistakes.length);
  assert.equal(again.reminders.length, seeded.reminders.length);
});

test('list ordering prioritizes Needs Work, then Improving, then Confident', () => {
  const rows = [
    { id: 'c', status: 'CONFIDENT', updatedAt: '2026-10-30' },
    { id: 'i', status: 'IMPROVING', updatedAt: '2026-10-29' },
    { id: 'n-old', status: 'NEEDS_WORK', updatedAt: '2026-10-29' },
    { id: 'n-new', status: 'NEEDS_WORK', updatedAt: '2026-10-30' },
  ];
  assert.deepEqual(sortDrivingMistakes(rows).map(row => row.id), ['n-new', 'n-old', 'i', 'c']);
});

test('validation rejects orphan mistakes and unknown statuses', () => {
  const data = createInitialDrivingData();
  data.mistakes.push({ id: 'x', categoryId: 'missing', title: 'Mistake', cause: '', correction: '', status: 'NEEDS_WORK' });
  assert.throws(() => validateDrivingData(data), /invalid/);
});
