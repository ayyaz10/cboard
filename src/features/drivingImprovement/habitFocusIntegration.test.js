import test from 'node:test';
import assert from 'node:assert/strict';
import { getExecutionStats, recordExecution, startExecution } from './habitExecution.js';
import { createHabitFocusLaunch, createHabitFocusReturn, findLinkedHabitFocusSession, getHabitFocusMarker, hasHabitFocusSessionConflict } from './habitFocusBridge.js';

const contract = { action: 'Read 10 pages', minimum: 'Read 2 pages', schedule: { type: 'DAILY' }, useFocusTimer: true, focusMinutes: 25, minimumFocusMinutes: 5, createdAt: '2026-11-09T00:00:00.000Z' };
const habit = { id: 'node-1', habitId: 'habit-1', focusNow: true, actionContract: contract, executionHistory: [], activeSession: null };
function startHabit(minimumMode = false) {
  const focusRequestId = 'run-1';
  const started = startExecution(habit, { date: '2026-11-09', now: '2026-11-09T08:00:00.000Z', focusRequestId });
  const launch = createHabitFocusLaunch({ requestId: started.activeSession.focusRequestId, userId: 'user-1', node: habit, habitTitle: 'Reading', date: '2026-11-09', minimumMode });
  return { started, launch };
}
function createTimerSession(launch) {
  return { id: 'focus-1', title: launch.habitTitle, focusMinutes: launch.focusMinutes, taskDetails: launch.action, intention: `${getHabitFocusMarker(launch)} ${launch.minimumMode ? 'Minimum' : 'Standard'} action: ${launch.action}`, status: 'active' };
}

test('Today standard Start launches one linked timer, returns completion, and records explicit Done once', () => {
  const { started, launch } = startHabit();
  assert.deepEqual({ nodeId: launch.nodeId, habitId: launch.habitId, userId: launch.userId, action: launch.action, focusMinutes: launch.focusMinutes, minimumMode: launch.minimumMode }, { nodeId: 'node-1', habitId: 'habit-1', userId: 'user-1', action: 'Read 10 pages', focusMinutes: 25, minimumMode: false });
  const focus = createTimerSession(launch);
  const recovered = findLinkedHabitFocusSession([focus], JSON.parse(JSON.stringify(launch)));
  assert.equal(recovered.id, 'focus-1');
  assert.equal(hasHabitFocusSessionConflict(focus, recovered), false);
  const returned = createHabitFocusReturn({ ...launch, focusSessionId: focus.id }, 'COMPLETED', focus.id, '2026-11-09T08:25:00.000Z');
  assert.equal(returned.nodeId, 'node-1');
  assert.equal(returned.outcome, undefined, 'timer completion must leave the habit outcome undecided');
  const done = recordExecution(started, 'DONE', { date: returned.date, focusSessionId: returned.focusSessionId, now: returned.endedAt });
  assert.equal(done.executionHistory.length, 1);
  assert.equal(done.executionHistory[0].focusSessionId, 'focus-1');
  assert.equal(getExecutionStats(done, '2026-11-09').currentStreak, 1);
  assert.equal(recordExecution(done, 'DONE', { date: returned.date, focusSessionId: 'focus-1' }), done, 'repeat outcome submission is idempotent');
});

test('minimum Start uses the minimum duration and explicit Minimum Done keeps streak continuity', () => {
  const { started, launch } = startHabit(true);
  assert.equal(launch.focusMinutes, 5);
  assert.equal(launch.minimumMode, true);
  const focus = createTimerSession(launch);
  const returned = createHabitFocusReturn(launch, 'COMPLETED', focus.id, '2026-11-09T08:05:00.000Z');
  const saved = recordExecution(started, 'MINIMUM_DONE', { date: returned.date, focusSessionId: returned.focusSessionId, now: returned.endedAt });
  assert.equal(saved.executionHistory[0].outcome, 'MINIMUM_DONE');
  assert.equal(getExecutionStats(saved, '2026-11-09').currentStreak, 1);
});

test('cancellation returns linkage without inventing a miss or changing the streak', () => {
  const { started, launch } = startHabit();
  const focus = createTimerSession(launch);
  const returned = createHabitFocusReturn(launch, 'CANCELLED', focus.id, '2026-11-09T08:03:00.000Z');
  assert.equal(returned.status, 'CANCELLED');
  assert.equal(started.executionHistory.length, 0);
  assert.equal(getExecutionStats(started, '2026-11-09').currentStreak, 0);
});

test('active unrelated timer presents a conflict, and retrying a linked launch reuses its request marker', () => {
  const { started, launch } = startHabit();
  const focus = createTimerSession(launch);
  assert.equal(hasHabitFocusSessionConflict({ id: 'other-running' }, null), true);
  assert.equal(hasHabitFocusSessionConflict(focus, findLinkedHabitFocusSession([focus], launch)), false);
  assert.equal(startExecution(started, { date: '2026-11-09', focusRequestId: 'run-2' }), started);
  assert.equal(started.activeSession.focusRequestId, launch.requestId);
  const sessions = [focus];
  assert.equal(findLinkedHabitFocusSession(sessions, launch), focus);
  assert.equal(sessions.length, 1);
});
