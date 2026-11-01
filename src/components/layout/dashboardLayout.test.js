import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDashboardViewSize } from './dashboardLayout.js';

test('accepts the three dashboard-wide view sizes', () => {
  for (const size of ['small', 'medium', 'large']) assert.equal(normalizeDashboardViewSize(size), size);
});

test('defaults invalid saved dashboard view values to medium', () => {
  for (const value of [null, undefined, {}, [], 'huge', 2]) assert.equal(normalizeDashboardViewSize(value), 'medium');
});
