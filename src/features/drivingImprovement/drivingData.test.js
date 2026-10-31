import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialDrivingData, getDrivingSummary, makeDrivingMistake, sortDrivingMistakes, STARTER_CATEGORIES, validateDrivingData } from './drivingData.js';

test('first-use state seeds only the ten categories and no mistakes', () => {
  const data = createInitialDrivingData('2026-10-31T00:00:00.000Z');
  assert.deepEqual(data.categories.map(category => category.name), STARTER_CATEGORIES);
  assert.deepEqual(data.mistakes, []);
  assert.equal(getDrivingSummary(data.mistakes).total, 0);
});

test('mistakes retain category identity and summaries reflect their current status', () => {
  const data = createInitialDrivingData();
  const mistake = makeDrivingMistake({ title: 'Late mirror check', categoryId: data.categories[1].id, cause: '', correction: '', status: 'NEEDS_WORK' }, 'user-a');
  data.mistakes.push(mistake);
  validateDrivingData(data);
  assert.equal(data.mistakes[0].categoryId, data.categories[1].id);
  assert.deepEqual(getDrivingSummary(data.mistakes), { total: 1, NEEDS_WORK: 1, IMPROVING: 0, CONFIDENT: 0 });
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
