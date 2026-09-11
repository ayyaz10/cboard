import test from 'node:test';
import assert from 'node:assert/strict';
import { observeWorkspaceSetup } from './workspaceSetup.js';

test('effect cleanup and replay finish setup without migrating twice', async () => {
  const ref = { current: null };
  let migrations = 0;
  let oldCompletions = 0;
  let isMigrating = true;
  const migrate = () => { migrations += 1; };
  const cleanup = observeWorkspaceSetup(ref, 'user-1', migrate, () => { oldCompletions += 1; }, assert.fail);
  cleanup();
  observeWorkspaceSetup(ref, 'user-1', migrate, () => { isMigrating = false; }, assert.fail);
  await ref.current.promise;
  assert.equal(migrations, 1);
  assert.equal(oldCompletions, 0);
  assert.equal(isMigrating, false);
});

test('migration errors reach the replayed effect instead of leaving setup loading', async () => {
  const ref = { current: null };
  const failure = new Error('Migration unavailable');
  let received;
  const migrate = () => { throw failure; };
  const cleanup = observeWorkspaceSetup(ref, 'user-1', migrate, assert.fail, assert.fail);
  cleanup();
  observeWorkspaceSetup(ref, 'user-1', migrate, assert.fail, (error) => { received = error; });
  await ref.current.promise.catch(() => {});
  assert.equal(received, failure);
});

test('a previous account cannot finish setup for the next account', async () => {
  const ref = { current: null };
  let finishOld;
  let oldCompletions = 0;
  let newCompletions = 0;
  const oldJob = new Promise((resolve) => { finishOld = resolve; });
  const cleanup = observeWorkspaceSetup(ref, 'old-user', () => oldJob, () => { oldCompletions += 1; }, assert.fail);
  const oldPromise = ref.current.promise;
  cleanup();
  observeWorkspaceSetup(ref, 'new-user', () => {}, () => { newCompletions += 1; }, assert.fail);
  await ref.current.promise;
  finishOld();
  await oldPromise;
  assert.equal(oldCompletions, 0);
  assert.equal(newCompletions, 1);
});
