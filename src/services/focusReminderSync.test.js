import test from 'node:test';
import assert from 'node:assert/strict';
import { createFocusReminderSync, REMINDER_PAGE_SIZE } from './focusReminderSync.js';

function fakeClient(handler) {
  return {
    rpc(name, args) {
      const query = Promise.resolve().then(async () => ({ data: await handler(name, args), error: null }));
      query.abortSignal = () => query;
      return query;
    },
  };
}

const row = (id, dueAt, extra = {}) => ({
  id, title: 'Walk', due_at: new Date(dueAt).toISOString(), completed_at: null,
  repeat_ms: 60000, duration_ms: 60000, status: 'waiting', alert_at: null,
  revision: 4, metadata: { creditAgreementId: 'a1' }, updated_at: '2026-11-19T10:00:00Z', ...extra,
});

test('focus reminder import keeps its stable ID and maps server revision and metadata', async () => {
  const calls = [];
  const service = createFocusReminderSync({ getContext: async () => ({ client: fakeClient((name, args) => {
    calls.push({ name, args });
    return [row(args.p_id, args.p_due_at, { revision: 5 })];
  }) }), offline: () => false });
  const reminder = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Walk', dueAt: 1_800_000_000_000,
    repeatMs: 60000, durationMs: 60000, status: 'ringing', alertAt: 1_800_000_000_000, creditAgreementId: 'a1' };
  const saved = await service.importReminder(reminder);
  await service.importReminder(reminder);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, 'import_focus_timer_reminder');
  assert.equal(calls[0].args.p_id, reminder.id);
  assert.equal(calls[0].args.p_alert_at, new Date(reminder.alertAt).toISOString());
  assert.equal(saved.revision, 5);
  assert.equal(saved.creditAgreementId, 'a1');
});

test('reminder and history readers follow bounded keyset pages', async () => {
  const due = Date.now();
  let reminderPage = 0;
  let historyPage = 0;
  const service = createFocusReminderSync({ getContext: async () => ({ client: fakeClient((name, args) => {
    if (name === 'list_focus_timer_reminders') {
      reminderPage += 1;
      if (reminderPage === 1) return Array.from({ length: REMINDER_PAGE_SIZE + 1 }, (_, index) =>
        row(`00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, due + index));
      assert.equal(args.p_after_due_at, new Date(due + REMINDER_PAGE_SIZE - 1).toISOString());
      return [row('00000000-0000-4000-8000-999999999999', due + REMINDER_PAGE_SIZE + 1)];
    }
    historyPage += 1;
    if (historyPage === 1) return Array.from({ length: REMINDER_PAGE_SIZE + 1 }, (_, index) => ({
      event_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      event_key: `event-${index}`, reminder_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Walk',
      repeat_ms: 0, duration_ms: 0, due_at: new Date(due).toISOString(), event_type: 'created',
      occurred_at: new Date(due + index).toISOString(),
    }));
    assert.ok(args.p_after_id);
    return [];
  }) }), offline: () => false });
  const reminders = await service.listReminders(due);
  const history = await service.listHistory();
  assert.equal(reminders.length, REMINDER_PAGE_SIZE + 1);
  assert.equal(reminderPage, 2);
  assert.equal(history.length, REMINDER_PAGE_SIZE);
  assert.equal(historyPage, 2);
});

test('offline writes fail visibly before issuing an RPC', async () => {
  let calls = 0;
  const service = createFocusReminderSync({ getContext: async () => ({ client: fakeClient(() => { calls += 1; }) }), offline: () => true });
  await assert.rejects(service.importReminder({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Walk', dueAt: Date.now() }), /offline/i);
  assert.equal(calls, 0);
});