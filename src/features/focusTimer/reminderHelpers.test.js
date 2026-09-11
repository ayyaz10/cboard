import test from 'node:test';
import assert from 'node:assert/strict';
import { activateDueReminders, dismissReminder, durationMilliseconds, formatReminderInterval, readReminders, reminderCountdown } from './reminderHelpers.js';

test('custom durations accept 1 hour 30 minutes and reject invalid values', () => {
  assert.equal(durationMilliseconds('1', '30'), 5_400_000);
  for (const [hours, minutes] of [[0, 0], [-1, 30], [1, 60], [0, 1.5], ['oops', 10], [169, 0]]) {
    assert.equal(durationMilliseconds(hours, minutes), 0);
  }
});

test('elapsed reminders ring after a delayed tick or reload without changing future ones', () => {
  const items = [
    { id: 'past', title: 'Call Alex', dueAt: 100, status: 'waiting' },
    { id: 'future', title: 'Tea', dueAt: 500, status: 'waiting' },
  ];
  const restored = readReminders(JSON.stringify(items));
  const activated = activateDueReminders(restored, 200);
  assert.equal(activated[0].status, 'ringing');
  assert.equal(activated[1].status, 'waiting');
  assert.deepEqual(activateDueReminders(activated, 200), activated);
  assert.equal(items[0].status, 'waiting');
  assert.equal(activateDueReminders(restored, 500)[1].status, 'ringing');
});

test('bad stored data does not break reminders', () => {
  for (const value of ['broken', '{}', 'null', '[null, 1, {}]']) assert.deepEqual(readReminders(value), []);
  assert.deepEqual(readReminders('[{"id":"x","title":"Tea","dueAt":"bad","status":"waiting"}]'), []);
});

test('countdowns handle long durations, rounding, and overdue reminders', () => {
  assert.equal(reminderCountdown(5_400_000, 0), '1:30:00');
  assert.equal(reminderCountdown(60_000, 1), '01:00');
  assert.equal(reminderCountdown(0, 1000), '00:00');
});

test('45-minute and hourly reminders repeat even without dismissing the last alert', () => {
  for (const minutes of [45, 60]) {
    const repeatMs = minutes * 60_000;
    const initial = [{ id: 'repeat', title: 'Stretch', dueAt: repeatMs, repeatMs, status: 'waiting' }];
    const first = activateDueReminders(initial, repeatMs);
    assert.equal(first[0].status, 'ringing');
    assert.equal(first[0].dueAt, repeatMs * 2);
    assert.equal(first[0].alertAt, repeatMs);
    assert.deepEqual(activateDueReminders(first, repeatMs + 1000), first);
    const second = activateDueReminders(first, repeatMs * 2);
    assert.equal(second[0].dueAt, repeatMs * 3);
    assert.equal(second[0].alertAt, repeatMs * 2);
  }
});

test('dismiss keeps recurring reminders on schedule and removes one-time reminders', () => {
  const items = [
    { id: 'repeat', title: 'Stretch', dueAt: 120_000, repeatMs: 60_000, status: 'ringing' },
    { id: 'once', title: 'Call', dueAt: 60_000, status: 'ringing' },
  ];
  const dismissed = dismissReminder(items, 'repeat');
  assert.equal(dismissed[0].status, 'waiting');
  assert.equal(dismissed[0].dueAt, 120_000);
  assert.equal(dismissReminder(dismissed, 'once').length, 1);
});

test('restored repeating reminders skip missed intervals without flooding alerts', () => {
  const items = readReminders(JSON.stringify([
    { id: 'repeat', title: 'Water', dueAt: 60_000, repeatMs: 60_000, status: 'ringing' },
  ]));
  const activated = activateDueReminders(items, 635_000);
  assert.equal(activated.length, 1);
  assert.equal(activated[0].dueAt, 660_000);
  assert.equal(activated[0].status, 'ringing');
});

test('invalid saved repeat intervals fall back to a one-time reminder', () => {
  for (const repeatMs of [-1, 0, 1, '60000', 1e20]) {
    const items = readReminders(JSON.stringify([{ id: 'x', title: 'Tea', dueAt: 0, repeatMs, status: 'waiting' }]));
    assert.equal(items[0].repeatMs, 0);
    assert.equal(activateDueReminders(items, 100)[0].status, 'ringing');
  }
  assert.equal(formatReminderInterval(2_700_000), '45 min');
  assert.equal(formatReminderInterval(3_600_000), '1 hour');
});
