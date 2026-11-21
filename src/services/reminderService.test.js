import test from 'node:test';
import assert from 'node:assert/strict';
import { createReminderService, ReminderServiceError } from './reminderService.js';

const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const id = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const dueAt = '2026-11-19T09:30:00.000Z';

function asRow(record) {
  return { id: record.id, title: record.title, due_at: record.dueAt, completed_at: record.completedAt,
    created_at: record.createdAt, updated_at: record.updatedAt };
}

function fakeDatabase() {
  const records = new Map();
  const calls = [];
  function rpcFor(userId, name, args) {
    calls.push({ userId, name, args });
    if (name === 'create_user_reminder') {
      const prior = records.get(args.p_id);
      if (prior) {
        if (prior.deletedAt) return { data: null, error: { code: 'P0001', message: 'Reminder is unavailable.' } };

        if (prior.userId !== userId || prior.title !== args.p_title || prior.dueAt !== args.p_due_at) {
          return { data: null, error: { code: 'P0001', message: 'Conflicting reminder ID.' } };
        }
        return { data: [asRow(prior)], error: null };
      }
      const record = { id: args.p_id, userId, title: args.p_title, dueAt: args.p_due_at, completedAt: null,
        createdAt: '2026-11-19T08:00:00.000Z', updatedAt: '2026-11-19T08:00:00.000Z' };
      records.set(record.id, record);
      return { data: [asRow(record)], error: null };
    }
    if (name === 'list_user_reminders') {
      const rows = [...records.values()].filter(row => row.userId === userId
        && !row.deletedAt && row.dueAt >= args.p_start_at && row.dueAt < args.p_end_at
        && (!args.p_after_due_at || row.dueAt > args.p_after_due_at
          || (row.dueAt === args.p_after_due_at && row.id > args.p_after_id)))
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id))
        .slice(0, args.p_limit + 1).map(asRow);
      return { data: rows, error: null };
    }
    if (name === 'complete_user_reminder') {
      const record = records.get(args.p_id);
      if (!record || record.userId !== userId) return { data: [], error: null };
      if (!record.completedAt) {
        record.completedAt = '2026-11-19T10:00:00.000Z';
        record.updatedAt = record.completedAt;
      }
      return { data: [asRow(record)], error: null };
    }
    if (name === 'update_user_reminder') {
      const record = records.get(args.p_id);
      if (!record || record.userId !== userId || record.deletedAt) return { data: null, error: { code: 'P0001', message: 'unavailable' } };
      if (record.updatedAt !== args.p_expected_updated_at) return { data: [{ ...asRow(record), applied: record.title === args.p_title && record.dueAt === args.p_due_at }], error: null };
      record.title = args.p_title; record.dueAt = args.p_due_at; record.updatedAt = '2026-11-19T10:00:00.123456Z';
      return { data: [{ ...asRow(record), applied: true }], error: null };
    }
    if (name === 'delete_user_reminder') {
      const record = records.get(args.p_id);
      if (!record || record.userId !== userId) return { data: null, error: { code: 'P0001', message: 'unavailable' } };
      if (record.deletedAt) return { data: true, error: null };
      if (record.updatedAt !== args.p_expected_updated_at) return { data: null, error: { code: 'P0001', message: 'stale' } };
      record.deletedAt = '2026-11-19T11:00:00Z'; return { data: true, error: null };
    }    throw new Error('Unexpected RPC ' + name);
  }
  const clientFor = userId => ({ rpc(name, args) {
    return { abortSignal: signal => signal.aborted
      ? Promise.reject(new DOMException('Aborted', 'AbortError'))
      : Promise.resolve(rpcFor(userId, name, args)) };
  } });
  return { records, calls, clientFor };
}

function serviceFor(db, userId, options = {}) {
  return createReminderService({ getContext: async () => ({ client: db.clientFor(userId), userId }),
    offline: () => false, timeoutMs: 20, ...options });
}

test('create validates ID, trimmed title, length, and timezone-aware due instant', async () => {
  const db = fakeDatabase();
  const service = serviceFor(db, userA);
  const invalid = [
    { id: 'bad', title: 'Call', dueAt },
    { id, title: '  Call  ', dueAt },
    { id, title: 'Call', dueAt: '2026-11-19T09:30:00' },
    { id, title: 'Call', dueAt: '2026-02-30T09:30:00Z' },
    { id, title: 'Call', dueAt: 'not-a-date' },
    { id, title: 'x'.repeat(121), dueAt },
  ];
  for (const input of invalid) await assert.rejects(service.createReminder(input), TypeError);
  assert.equal(db.calls.length, 0);
});

test('concurrent duplicate creates with the same ID return one matching record', async () => {
  const db = fakeDatabase();
  const service = serviceFor(db, userA);
  const input = { id, title: 'Call the dentist', dueAt };
  const [first, second] = await Promise.all([service.createReminder(input), service.createReminder(input)]);
  assert.deepEqual(first, second);
  assert.equal(db.records.size, 1);
  await assert.rejects(service.createReminder({ ...input, title: 'Different reminder' }), error => error.outcome === 'rejected');
});

test('unknown create outcome can be retried with the same ID after the server accepted it', async () => {
  const db = fakeDatabase();
  let first = true;
  const client = { rpc(name, args) { return { abortSignal: async () => {
    const result = await db.clientFor(userA).rpc(name, args).abortSignal(new AbortController().signal);
    if (first) { first = false; throw new TypeError('Connection lost after write.'); }
    return result;
  } }; } };
  const service = createReminderService({ getContext: async () => ({ client, userId: userA }), offline: () => false, timeoutMs: 20 });
  const input = { id, title: 'Check the parcel', dueAt };
  await assert.rejects(service.createReminder(input), error => error instanceof ReminderServiceError
    && error.outcome === 'unknown' && error.retryable);
  assert.equal((await service.createReminder(input)).id, id);
  assert.equal(db.records.size, 1);
});

test('offline writes are reported before sending and can retry after reconnect', async () => {
  const db = fakeDatabase();
  let offline = true;
  const service = serviceFor(db, userA, { offline: () => offline });
  const input = { id, title: 'Take a break', dueAt };
  await assert.rejects(service.createReminder(input), error => error.outcome === 'offline' && error.retryable);
  assert.equal(db.calls.length, 0);
  offline = false;
  assert.equal((await service.createReminder(input)).id, id);
});

test('list uses a half-open bounded range and pages by due time plus ID', async () => {
  const db = fakeDatabase();
  const service = serviceFor(db, userA);
  await service.createReminder({ id, title: 'First', dueAt: '2026-11-19T09:30:00Z' });
  await service.createReminder({ id: secondId, title: 'Second', dueAt: '2026-11-19T09:30:00Z' });
  const endId = '33333333-3333-4333-8333-333333333333';
  await service.createReminder({ id: endId, title: 'At end', dueAt: '2026-11-20T00:00:00Z' });
  const first = await service.listReminders({ startAt: '2026-11-19T00:00:00Z', endAt: '2026-11-20T00:00:00Z', limit: 1 });
  assert.equal(first.items.length, 1);
  assert.ok(first.nextCursor);
  const second = await service.listReminders({ startAt: '2026-11-19T00:00:00Z', endAt: '2026-11-20T00:00:00Z', after: first.nextCursor, limit: 1 });
  assert.equal(second.items.length, 1);
  assert.notEqual(second.items[0].id, first.items[0].id);
  assert.equal(second.nextCursor, null);
  for (const args of [
    { startAt: '2026-11-20T00:00:00Z', endAt: '2026-11-19T00:00:00Z' },
    { startAt: '2026-11-19T00:00:00', endAt: '2026-11-20T00:00:00Z' },
    { startAt: '2026-11-19T00:00:00Z', endAt: '2026-11-20T00:00:00Z', limit: 101 },
  ]) await assert.rejects(service.listReminders(args));
});

test('completion is idempotent and concurrent calls converge; user scope is enforced by service contract', async () => {
  const db = fakeDatabase();
  const clientA = serviceFor(db, userA);
  const clientB = serviceFor(db, userA);
  const otherUser = serviceFor(db, userB);
  await clientA.createReminder({ id, title: 'Finish report', dueAt });
  assert.equal((await clientB.listReminders({ startAt: '2026-11-19T00:00:00Z', endAt: '2026-11-20T00:00:00Z' })).items.length, 1);
  const [completeA, completeB] = await Promise.all([clientB.completeReminder(id), clientB.completeReminder(id)]);
  assert.equal(completeA.completedAt, completeB.completedAt);
  const readBack = await clientA.listReminders({ startAt: '2026-11-19T00:00:00Z', endAt: '2026-11-20T00:00:00Z' });
  assert.equal(readBack.items[0].completedAt, completeA.completedAt);
  assert.equal((await clientA.completeReminder(id)).completedAt, completeA.completedAt);
  await assert.rejects(otherUser.completeReminder(id));
  assert.deepEqual((await otherUser.listReminders({ startAt: '2026-11-19T00:00:00Z', endAt: '2026-11-20T00:00:00Z' })).items, []);
});

test('request timeout is unknown and retrying after a late commit returns the same record', async () => {
  const db = fakeDatabase();
  const client = { rpc(name, args) { return { abortSignal: async () => {
    const result = await db.clientFor(userA).rpc(name, args).abortSignal(new AbortController().signal);
    await new Promise(resolve => setTimeout(resolve, 20));
    return result;
  } }; } };
  const service = createReminderService({ getContext: async () => ({ client, userId: userA }), offline: () => false, timeoutMs: 1 });
  const input = { id, title: 'Wait for delivery', dueAt };
  await assert.rejects(service.createReminder(input), error => error.outcome === 'unknown' && error.retryable);
  await new Promise(resolve => setTimeout(resolve, 25));
  const retry = serviceFor(db, userA);
  assert.equal((await retry.createReminder(input)).id, id);
  assert.equal(db.records.size, 1);
});
test('reminder updates retain the precise server version and stale edits are rejected', async () => {
  const db=fakeDatabase(),service=serviceFor(db,userA);
  const created=await service.createReminder({id,title:'Pay bill',dueAt});
  const updated=await service.updateReminder({id,expectedUpdatedAt:created.updatedAt,title:'Pay bill today',dueAt:'2026-11-20T09:30:00.000Z'});
  assert.equal(updated.title,'Pay bill today');
  assert.equal(db.calls.at(-1).args.p_expected_updated_at,created.updatedAt);
  assert.equal(db.records.get(id).updatedAt,'2026-11-19T10:00:00.123456Z');
  await assert.rejects(service.updateReminder({id,expectedUpdatedAt:created.updatedAt,title:'Stale title',dueAt:'2026-11-20T09:30:00.000Z'}),e=>e.outcome==='rejected');
});

test('reminder delete is idempotent, hidden from reads, and does not permit stale re-create', async () => {
  const db=fakeDatabase(),service=serviceFor(db,userA);
  const created=await service.createReminder({id,title:'Pay bill',dueAt});
  await service.deleteReminder(id,created.updatedAt);
  await service.deleteReminder(id,created.updatedAt);
  const page=await service.listReminders({startAt:'2026-11-19T00:00:00Z',endAt:'2026-11-20T00:00:00Z'});
  assert.equal(page.items.length,0);
  await assert.rejects(service.createReminder({id,title:'Pay bill',dueAt}),e=>e.outcome==='rejected');
});