import test from 'node:test';
import assert from 'node:assert/strict';
import { createSingleFlightByKey } from './singleFlight.js';

test('shares concurrent work for the same key and separates users', async () => {
  const singleFlight = createSingleFlightByKey();
  let calls = 0;
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const first = singleFlight('user-a', async () => { calls += 1; await wait; return 'a'; });
  const duplicate = singleFlight('user-a', async () => { calls += 1; return 'wrong'; });
  const otherUser = singleFlight('user-b', async () => { calls += 1; return 'b'; });

  assert.equal(await otherUser, 'b');
  release();
  const [firstValue, duplicateValue] = await Promise.all([first, duplicate]);
  assert.deepEqual([firstValue, duplicateValue], ['a', 'a']);
  assert.equal(calls, 2);
});

test('clones shared object results for each caller', async () => {
  const singleFlight = createSingleFlightByKey();
  const source = { rows: [{ value: 1 }] };
  const [first, duplicate] = await Promise.all([
    singleFlight('user-a', async () => source),
    singleFlight('user-a', async () => ({ rows: [] })),
  ]);
  first.rows[0].value = 2;
  assert.equal(duplicate.rows[0].value, 1);
  assert.equal(source.rows[0].value, 1);
});

test('clears successful and failed work so later calls reload', async () => {
  const singleFlight = createSingleFlightByKey();
  let calls = 0;
  assert.equal(await singleFlight('user-a', async () => ++calls), 1);
  assert.equal(await singleFlight('user-a', async () => ++calls), 2);
  await assert.rejects(singleFlight('user-a', async () => { throw new Error('offline'); }), /offline/);
  assert.equal(await singleFlight('user-a', async () => ++calls), 3);
});
