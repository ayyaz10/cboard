import test from 'node:test';
import assert from 'node:assert/strict';
import { createFocusReminderSync } from '../../services/focusReminderSync.js';

function fakeClient(handler) {
  return {
    rpc(name, args) {
      const query = Promise.resolve().then(async () => ({ data: await handler(name, args), error: null }));
      query.abortSignal = () => query;
      return query;
    },
  };
}

test('Focus Timer sync preserves one-off reminders and history longer than seven days', async () => {
  const durationMs = 10 * 24 * 60 * 60 * 1000;
  const calls = [];
  const service = createFocusReminderSync({ getContext: async () => ({ client: fakeClient((name, args) => {
    calls.push({ name, args });
    if (name === 'import_focus_timer_reminder') return [{
      id: args.p_id, title: args.p_title, due_at: args.p_due_at, completed_at: null,
      repeat_ms: args.p_repeat_ms, duration_ms: args.p_duration_ms, status: args.p_status,
      alert_at: args.p_alert_at, revision: 1, metadata: args.p_metadata, updated_at: args.p_due_at,
    }];
    return 1;
  }) }), offline: () => false });
  const reminder = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Payment reminder',
    dueAt: 1_800_000_000_000, repeatMs: 0, durationMs, status: 'waiting' };

  const saved = await service.importReminder(reminder);
  await service.importHistory([{ id: reminder.id + ':created:1', reminderId: reminder.id,
    title: reminder.title, repeatMs: 0, durationMs, dueAt: reminder.dueAt,
    type: 'created', at: reminder.dueAt - durationMs }]);

  assert.equal(saved.durationMs, durationMs);
  assert.equal(calls[0].args.p_duration_ms, durationMs);
  assert.equal(calls[1].args.p_events[0].duration_ms, durationMs);
});