import test from 'node:test';
import assert from 'node:assert/strict';
import { getRouteBoundaryKey } from './useRoute.js';

test('selected improvement routes keep the same habit error boundary mounted', () => {
  assert.equal(getRouteBoundaryKey('/habit-improvement/reading'), '/habit-improvement/reading');
  assert.equal(getRouteBoundaryKey('/habit-improvement/reading/node-1'), '/habit-improvement/reading');
  assert.equal(getRouteBoundaryKey('/habit-improvement/reading/node-2'), '/habit-improvement/reading');
  assert.notEqual(getRouteBoundaryKey('/habit-improvement/writing/node-1'), getRouteBoundaryKey('/habit-improvement/reading/node-1'));
});
