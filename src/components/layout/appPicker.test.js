import test from 'node:test';
import assert from 'node:assert/strict';
import { filterApps, nextAppIndex } from './appPicker.js';

const apps = [
  { path: '/training', label: 'Training' },
  { path: '/food-diary', label: 'Food Diary' },
  { path: '/finance', label: 'Finance' },
];

test('app picker searches names and useful aliases without case sensitivity', () => {
  assert.deepEqual(filterApps(apps, 'FOOD'), [apps[1]]);
  assert.deepEqual(filterApps(apps, 'workout'), [apps[0]]);
  assert.deepEqual(filterApps(apps, ''), apps);
});

test('app picker arrow navigation wraps in both directions and handles no results', () => {
  assert.equal(nextAppIndex(0, 3, 'ArrowUp'), 2);
  assert.equal(nextAppIndex(2, 3, 'ArrowDown'), 0);
  assert.equal(nextAppIndex(0, 0, 'ArrowDown'), 0);
});
