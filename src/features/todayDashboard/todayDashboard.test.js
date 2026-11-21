import test from 'node:test';
import assert from 'node:assert/strict';
import { getGreeting, getIncomplete, getNextReminder, getOverdueWindow, getTodayWindow, getTimelineWindow, sortByDueAt } from './todayDashboard.js';

const item = (id, dueAt, completedAt = null) => ({ id, dueAt, completedAt });

test('local today boundaries use separate midnights across daylight saving changes', () => {
  const spring = getTodayWindow(new Date('2026-03-29T12:00:00+01:00'));
  assert.equal(Date.parse(spring.endAt) - Date.parse(spring.startAt), 23 * 60 * 60 * 1000);
  const autumn = getTodayWindow(new Date('2026-10-25T12:00:00Z'));
  assert.equal(Date.parse(autumn.endAt) - Date.parse(autumn.startAt), 25 * 60 * 60 * 1000);
});

test('overdue window is a bounded local calendar year ending at today midnight', () => {
  const window = getOverdueWindow(new Date('2026-11-21T12:00:00Z'));
  assert.equal(Date.parse(window.endAt), new Date(2026, 10, 21).getTime());
  assert.equal(new Date(window.startAt).getFullYear(), 2025);
});

test('next action prioritizes overdue and sorts ties deterministically', () => {
  const overdue = [item('b', '2026-11-20T08:00:00Z'), item('a', '2026-11-20T08:00:00Z')];
  const today = [item('c', '2026-11-21T10:00:00Z'), item('d', '2026-11-21T13:00:00Z')];
  assert.equal(getNextReminder(overdue, today, new Date('2026-11-21T09:00:00Z')).id, 'a');
  assert.equal(getNextReminder([], today, new Date('2026-11-21T09:00:00Z')).id, 'c');
  assert.equal(getNextReminder([], [item('done', '2026-11-21T08:00:00Z', '2026-11-21T08:05:00Z')], new Date('2026-11-21T09:00:00Z')), null);
});

test('completed items are filtered and overdue candidates sort earliest first', () => {
  assert.deepEqual(getIncomplete([item('done', '2026-01-01', '2026-01-02'), item('open', '2026-01-01')]).map(row => row.id), ['open']);
  assert.deepEqual(sortByDueAt([item('later', '2026-01-02'), item('first', '2026-01-01')]).map(row => row.id), ['first', 'later']);
});

test('greeting follows local morning, afternoon, and evening hours', () => {
  assert.equal(getGreeting(new Date(2026, 0, 1, 11)), 'Good morning');
  assert.equal(getGreeting(new Date(2026, 0, 1, 12)), 'Good afternoon');
  assert.equal(getGreeting(new Date(2026, 0, 1, 17)), 'Good evening');
});

test('timeline views use local calendar boundaries including DST changes', () => {
  const spring = new Date('2026-03-29T12:00:00+01:00');
  const autumn = new Date('2026-10-25T12:00:00Z');
  const tomorrowSpring = getTimelineWindow('tomorrow', spring);
  const tomorrowAutumn = getTimelineWindow('tomorrow', autumn);
  const weekSpring = getTimelineWindow('week', spring);
  const weekAutumn = getTimelineWindow('week', autumn);
  assert.equal(Date.parse(tomorrowSpring.endAt) - Date.parse(tomorrowSpring.startAt), 24 * 60 * 60 * 1000);
  assert.equal(Date.parse(tomorrowAutumn.endAt) - Date.parse(tomorrowAutumn.startAt), 24 * 60 * 60 * 1000);
  assert.equal(Date.parse(weekSpring.endAt) - Date.parse(weekSpring.startAt), 167 * 60 * 60 * 1000);
  assert.equal(Date.parse(weekAutumn.endAt) - Date.parse(weekAutumn.startAt), 169 * 60 * 60 * 1000);
  assert.equal(getTimelineWindow('all', spring).includeUndated, true);
});
