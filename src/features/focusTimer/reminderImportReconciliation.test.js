import test from 'node:test';
import assert from 'node:assert/strict';
import { importLocalRemindersIndependently } from './reminderImportReconciliation.js';

test('a failed local reminder import does not block later reminders from syncing', async () => {
  const synced = [];
  const reminders = [
    { id: 'legacy-finance', title: 'Payment', dueAt: 1, durationMs: 10 * 86_400_000 },
    { id: 'phone-timer', title: 'Break', dueAt: 2, durationMs: 30 * 60_000 },
  ];
  const result = await importLocalRemindersIndependently(reminders, async item => {
    if (item.id === 'legacy-finance') throw new Error('Duration is outside the current database range.');
    synced.push(item.id);
    return { ...item, revision: 1 };
  });

  assert.deepEqual(synced, ['phone-timer']);
  assert.deepEqual(result.imported.map(item => item.id), ['phone-timer']);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].item.id, 'legacy-finance');
});

test('already-synced reminders pass through without another write', async () => {
  let calls = 0;
  const result = await importLocalRemindersIndependently([{ id: 'cloud', revision: 4 }], async () => { calls += 1; });
  assert.equal(calls, 0);
  assert.equal(result.imported[0].revision, 4);
  assert.deepEqual(result.errors, []);
});