import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHabitFocusLaunch,
  createHabitFocusReturn,
  findLinkedHabitFocusSession,
  getHabitFocusMarker,
  hasHabitFocusSessionConflict,
} from './habitFocusBridge.js';

const node = {
  id: 'node-1',
  habitId: 'habit-1',
  actionContract: {
    action: 'Read 10 pages', minimum: 'Read 2 pages',
    focusMinutes: 25, minimumFocusMinutes: 5,
  },
};
const launch = (minimumMode = false) => createHabitFocusLaunch({
  requestId: 'request-1', userId: 'user-1', node, habitTitle: 'Reading',
  date: '2026-11-09', minimumMode,
});

test('standard launch carries exact habit context and standard duration', () => {
  assert.deepEqual(launch(), {
    requestId: 'request-1', userId: 'user-1', nodeId: 'node-1', habitId: 'habit-1',
    habitTitle: 'Reading', action: 'Read 10 pages', minimum: 'Read 2 pages',
    date: '2026-11-09', minimumMode: false, focusMinutes: 25,
    returnTo: '/habit-improvement',
  });
});

test('minimum launch carries minimum mode and minimum duration', () => {
  assert.equal(launch(true).minimumMode, true);
  assert.equal(launch(true).focusMinutes, 5);
});

test('launch requires an id, user, node, and action contract', () => {
  assert.throws(() => createHabitFocusLaunch({ requestId: 'r', userId: 'u', node: { id: 'node-2', habitId: 'habit-1' } }), /incomplete/);
});

test('request marker finds the existing linked timer after refresh', () => {
  const session = { id: 'focus-1', intention: ' [habit-run:request-1] Standard action: Read 10 pages' };
  assert.equal(getHabitFocusMarker(launch()), '[habit-run:request-1]');
  assert.equal(findLinkedHabitFocusSession([session], launch()), session);
  assert.equal(findLinkedHabitFocusSession([session], { ...launch(), requestId: 'other' }), null);
});

test('existing unrelated session conflicts, while the linked session does not', () => {
  assert.equal(hasHabitFocusSessionConflict({ id: 'other' }, null), true);
  assert.equal(hasHabitFocusSessionConflict({ id: 'focus-1' }, { id: 'focus-1' }), false);
  assert.equal(hasHabitFocusSessionConflict(null, null), false);
});

test('completion and cancellation return linkage without deciding habit success', () => {
  const completed = createHabitFocusReturn({ ...launch(), focusSessionId: 'focus-1' }, 'COMPLETED', null, '2026-11-09T12:00:00.000Z');
  const cancelled = createHabitFocusReturn(launch(), 'CANCELLED', 'focus-2', '2026-11-09T12:01:00.000Z');
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.focusSessionId, 'focus-1');
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.focusSessionId, 'focus-2');
  assert.equal(completed.outcome, undefined);
  assert.throws(() => createHabitFocusReturn(launch(), 'DONE', null), /invalid/);
});
