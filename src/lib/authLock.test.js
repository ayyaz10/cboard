import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthLock } from './authLock.js';

test('auth lock never steals and clears its timer once acquired', async () => {
  let options;
  const lock = createAuthLock(() => ({ request: async (name, received, callback) => {
    options = received;
    return callback({ name });
  } }));
  assert.equal(await lock('session', 5, async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(options.signal.aborted, false);
    return 'ok';
  }), 'ok');
  assert.equal(options.steal, undefined);
});

test('busy nonblocking refresh skips without running its callback', async () => {
  const lock = createAuthLock(() => ({ request: async (_, options, callback) => {
    assert.equal(options.ifAvailable, true);
    assert.equal(options.steal, undefined);
    return callback(null);
  } }));
  await assert.rejects(lock('session', 0, () => assert.fail('Must not run')), { isAcquireTimeout: true });
});

test('expired wait aborts only the queued request without stealing', async () => {
  let calls = 0;
  const lock = createAuthLock(() => ({ request: async (_, options) => {
    calls++;
    assert.equal(options.steal, undefined);
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
  } }));
  await assert.rejects(lock('session', 5, () => assert.fail('Must not run')), { isAcquireTimeout: true });
  assert.equal(calls, 1);
});

test('fallback serializes operations without Web Locks', async () => {
  const lock = createAuthLock(() => null);
  const order = [];
  await Promise.all([lock('fallback-test', -1, async () => {
    order.push('start');
    await new Promise(resolve => setTimeout(resolve, 10));
    order.push('end');
  }), lock('fallback-test', -1, async () => order.push('next'))]);
  assert.deepEqual(order, ['start', 'end', 'next']);
});
