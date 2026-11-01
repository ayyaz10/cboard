import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDashboardCardSizes, updateDashboardCardSize } from './dashboardLayout.js';

const modules = [{ id: 'finance' }, { id: 'notes' }];

test('normalizes saved sizes to known modules and supported values', () => {
  assert.deepEqual(normalizeDashboardCardSizes({ finance: 'large', notes: 'small', unknown: 'large', groceries: 'huge' }, modules), {
    finance: 'large', notes: 'small',
  });
  assert.deepEqual(normalizeDashboardCardSizes(['large'], modules), {});
});

test('updates one known card size and removes medium overrides', () => {
  const initial = { finance: 'large', notes: 'small' };
  assert.deepEqual(updateDashboardCardSize(initial, 'finance', 'small', modules), { finance: 'small', notes: 'small' });
  assert.deepEqual(updateDashboardCardSize(initial, 'finance', 'medium', modules), { notes: 'small' });
  assert.equal(updateDashboardCardSize(initial, 'unknown', 'large', modules), initial);
  assert.equal(updateDashboardCardSize(initial, 'finance', 'huge', modules), initial);
});
