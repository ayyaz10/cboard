import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserRequest } from './authUserRequest.js';

test('concurrent readers share verification but later calls verify again', async () => {
  let calls = 0;
  const read = createUserRequest(async () => ({ data: { user: { id: String(++calls) } } }));
  assert.deepEqual(await Promise.all([read(), read(), read()]), ['1', '1', '1']);
  assert.equal(await read(), '2');
});

test('stolen-lock errors retry once while other auth failures do not retry', async () => {
  let calls = 0;
  const read = createUserRequest(async () => {
    if (++calls === 1) throw new DOMException("Lock broken by another request with the 'steal' option.", 'AbortError');
    return { data: { user: { id: 'user' } } };
  });
  assert.equal(await read(), 'user');
  assert.equal(calls, 2);
  calls = 0;
  const failed = createUserRequest(async () => { calls++; return { error: new Error('Invalid token') }; });
  await assert.rejects(failed(), /Invalid token/);
  assert.equal(calls, 1);
});
