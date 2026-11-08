import test from 'node:test';
import assert from 'node:assert/strict';
import { getExecutionStats, getOpportunity, isScheduledDate, localDateKey, recordExecution, startExecution } from './habitExecution.js';

const contract = (schedule = { type: 'DAILY' }) => ({ action: 'Read 10 pages', minimum: 'Read 2 pages', trigger: 'After breakfast', schedule, createdAt: '2026-10-26T00:00:00.000Z' });
const node = (schedule, history = []) => ({ id: 'n1', focusNow: true, actionContract: contract(schedule), executionHistory: history, activeSession: null });
const entry = (date, outcome = 'DONE') => ({ id: date, date, outcome, reason: null, contract: contract() });

test('localDateKey uses local calendar date fields', () => assert.equal(localDateKey(new Date(2026, 10, 8, 23, 59)), '2026-11-08'));
test('weekday schedule ignores unscheduled days for streaks', () => {
  const habit = node({ type: 'WEEKDAYS', days: [1, 3, 5] }, [entry('2026-11-02'), entry('2026-11-04'), entry('2026-11-06')]);
  assert.equal(isScheduledDate(habit.actionContract, '2026-11-03'), false);
  assert.equal(getExecutionStats(habit, '2026-11-08').currentStreak, 3);
  assert.equal(getExecutionStats(habit, '2026-11-08').bestStreak, 3);
});
test('missed daily opportunity breaks streak and minimum completion preserves it', () => {
  const habit = node({ type: 'DAILY' }, [entry('2026-11-05'), entry('2026-11-06', 'MINIMUM_DONE'), entry('2026-11-07', 'MISSED')]);
  assert.equal(getExecutionStats(habit, '2026-11-08').currentStreak, 0);
  const resumed = { ...habit, executionHistory: [...habit.executionHistory, entry('2026-11-08', 'MINIMUM_DONE')] };
  assert.equal(getExecutionStats(resumed, '2026-11-08').currentStreak, 1);
  assert.equal(getExecutionStats(resumed, '2026-11-08').minimum, 2);
});
test('weekly target streaks count consecutive completed calendar weeks', () => {
  const habit = node({ type: 'WEEKLY', target: 2 }, [entry('2026-10-26'), entry('2026-10-28'), entry('2026-11-02'), entry('2026-11-05')]);
  assert.equal(getExecutionStats(habit, '2026-11-08').currentStreak, 2);
  assert.equal(getOpportunity(habit, '2026-11-08').due, false);
});
test('start and outcome operations are idempotent and preserve contract snapshots', () => {
  const habit = node({ type: 'DAILY' });
  const started = startExecution(habit, { date: '2026-11-08', now: '2026-11-08T08:00:00Z' });
  assert.equal(startExecution(started, { date: '2026-11-08', now: '2026-11-08T09:00:00Z' }), started);
  const saved = recordExecution(started, 'MINIMUM_DONE', { date: '2026-11-08', now: '2026-11-08T08:05:00Z' });
  assert.equal(saved.executionHistory.length, 1);
  assert.equal(saved.executionHistory[0].startedAt, '2026-11-08T08:00:00Z');
  assert.equal(recordExecution(saved, 'MINIMUM_DONE', { date: '2026-11-08', now: '2026-11-08T08:06:00Z' }), saved);
  const revised = { ...saved, actionContract: contract() }; revised.actionContract.action = 'New standard';
  assert.equal(revised.executionHistory[0].contract.action, 'Read 10 pages');
});
test('only active Focus Now contracts surface as due and yesterday miss marks recovery', () => {
  const habit = node({ type: 'DAILY' }, [entry('2026-11-07', 'MISSED')]);
  assert.equal(getOpportunity(habit, '2026-11-08').recovery, true);
  assert.equal(getOpportunity({ ...habit, focusNow: false }, '2026-11-08').due, false);
});

test('an unrecorded past scheduled day is a miss, while Backlog pause days freeze the streak', () => {
  const daily = { ...node({ type: 'DAILY' }, [entry('2026-11-05')]), actionContract: { ...contract({type:'DAILY'}), createdAt: '2026-11-05T00:00:00.000Z' } };
  const missed = getExecutionStats(daily, '2026-11-07');
  assert.equal(missed.currentStreak, 0);
  assert.equal(missed.missed, 1);
  const paused = { ...daily, pausedIntervals: [{ start: '2026-11-06', end: '2026-11-07' }] };
  assert.equal(getExecutionStats(paused, '2026-11-07').currentStreak, 1);
  assert.equal(getExecutionStats(paused, '2026-11-07').opportunities, 1);
});

test('focus session references persist on the habit outcome without changing streak semantics', () => {
  const habit = node({ type: 'DAILY' });
  const started = startExecution(habit, { date: '2026-11-08', now: '2026-11-08T08:00:00Z' });
  const outcome = recordExecution(started, 'DONE', { date: '2026-11-08', focusSessionId: 'focus-123' });
  assert.equal(outcome.executionHistory[0].focusSessionId, 'focus-123');
  assert.equal(getExecutionStats(outcome, '2026-11-08').currentStreak, 1);
  const unresolved = { ...started, executionHistory: [] };
  assert.equal(getExecutionStats(unresolved, '2026-11-08').currentStreak, 0);
});
