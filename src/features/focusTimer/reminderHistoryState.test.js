import test from 'node:test';
import assert from 'node:assert/strict';
import { readReminderState, reminderReducer } from './reminderHistoryState.js';

const empty = () => ({ reminders: [], history: [] });
const reminder = (repeatMs = 0) => ({ id: 'r1', title: 'Stretch', dueAt: 60_000, repeatMs, durationMs: 60_000, status: 'waiting' });
const add = (repeatMs = 0) => reminderReducer(empty(), { type: 'add', item: reminder(repeatMs), now: 0 });

test('one-time reminder history survives dismissal and a storage round trip', () => {
  let state = add();
  state = reminderReducer(state, { type: 'tick', now: 60_000 });
  state = reminderReducer(state, { type: 'dismiss', id: 'r1', now: 65_000 });
  assert.equal(state.reminders.length, 0);
  assert.deepEqual(state.history.map((event) => event.type), ['dismissed', 'triggered', 'created']);
  assert.deepEqual(readReminderState(JSON.stringify(state), 70_000), state);
});

test('each repeating occurrence is recorded once and stopping preserves all history', () => {
  let state = add(60_000);
  state = reminderReducer(state, { type: 'tick', now: 60_000 });
  const same = reminderReducer(state, { type: 'tick', now: 60_000 });
  assert.equal(same, state);
  state = reminderReducer(state, { type: 'dismiss', id: 'r1', now: 65_000 });
  state = reminderReducer(state, { type: 'tick', now: 120_000 });
  state = reminderReducer(state, { type: 'cancel', id: 'r1', now: 125_000 });
  assert.equal(state.reminders.length, 0);
  assert.deepEqual(state.history.map((event) => event.type), ['stopped', 'triggered', 'dismissed', 'triggered', 'created']);
  assert.equal(new Set(state.history.map((event) => event.id)).size, state.history.length);
});

test('snoozing and cancelling keep history and ignore duplicate stale actions', () => {
  let state = reminderReducer(add(), { type: 'tick', now: 60_000 });
  state = reminderReducer(state, { type: 'snooze', id: 'r1', now: 61_000 });
  assert.equal(state.reminders[0].dueAt, 361_000);
  assert.equal(state.history[0].type, 'snoozed');
  assert.equal(reminderReducer(state, { type: 'snooze', id: 'r1', now: 61_001 }), state);
  state = reminderReducer(state, { type: 'cancel', id: 'r1', now: 62_000 });
  assert.equal(state.history[0].type, 'cancelled');
  assert.equal(reminderReducer(state, { type: 'cancel', id: 'r1', now: 62_001 }), state);
});

test('existing reminders are retained and imported into history only once', () => {
  const state = readReminderState(JSON.stringify([reminder(60_000)]), 10_000);
  assert.equal(state.reminders.length, 1);
  assert.equal(state.history[0].type, 'restored');
  assert.deepEqual(readReminderState(JSON.stringify(state), 20_000), state);
});

test('invalid stored history is ignored without losing valid active reminders', () => {
  assert.deepEqual(readReminderState('invalid', 0), empty());
  const state = readReminderState(JSON.stringify({ reminders: [reminder()], history: [null, {}, { id: 'bad', title: 'Bad', type: 'created', at: 1e100, dueAt: 0, repeatMs: 0 }] }), 0);
  assert.equal(state.reminders.length, 1);
  assert.deepEqual(state.history, []);
});

test('delayed ticks record one actual alert with its original scheduled time', () => {
  const state = reminderReducer(add(60_000), { type: 'tick', now: 635_000 });
  assert.equal(state.history.filter((event) => event.type === 'triggered').length, 1);
  assert.equal(state.history[0].at, 635_000);
  assert.equal(state.history[0].dueAt, 60_000);
  assert.equal(state.reminders[0].dueAt, 660_000);
});
