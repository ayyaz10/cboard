import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyNotesError, getNotesLoadMessage, readNotesCache, shouldShowNotesEmpty, writeNotesCache,
} from './notesLoadState.js';

function withSessionStorage(run) {
  const values = new Map();
  globalThis.sessionStorage = {
    get length() { return values.size; },
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    key: index => [...values.keys()][index] ?? null,
  };
  try { run(); } finally { delete globalThis.sessionStorage; }
}

test('Notes errors distinguish schema/query, authorization, network, and server failures safely', () => {
  assert.equal(classifyNotesError({ code: 'PGRST202', message: 'missing RPC' }), 'QUERY_ERROR');
  assert.equal(classifyNotesError({ code: '42703', message: 'column does not exist' }), 'QUERY_ERROR');
  assert.equal(classifyNotesError({ code: '42501' }), 'AUTH_ERROR');
  assert.equal(classifyNotesError({ status: 401 }), 'AUTH_ERROR');
  assert.equal(classifyNotesError(new TypeError('Failed to fetch')), 'NETWORK_ERROR');
  assert.equal(classifyNotesError({ status: 503 }), 'SERVER_ERROR');
  assert.match(getNotesLoadMessage('QUERY_ERROR'), /storage needs an update/);
  assert.doesNotMatch(getNotesLoadMessage('QUERY_ERROR'), /schema cache|PGRST202|notes\./i);
});

test('a failed Notes fetch cannot render an authoritative empty state', () => {
  assert.equal(shouldShowNotesEmpty({ isLoading: false, error: 'Notes unavailable', notes: [] }), false);
  assert.equal(shouldShowNotesEmpty({ isLoading: true, error: '', notes: [] }), false);
  assert.equal(shouldShowNotesEmpty({ isLoading: false, error: '', notes: [] }), true);
});

test('Notes list cache is user and filter scoped and remains available after refresh failure', () => {
  withSessionStorage(() => {
    const criteria = { view: 'active', query: '', sortBy: 'updated' };
    const result = { notes: [{ id: 'note-a', title: 'Cached title', contentSnippet: 'Cached preview' }], hasMore: false };
    assert.equal(writeNotesCache('user-a', criteria, result), true);
    assert.deepEqual(readNotesCache('user-a', criteria), result);
    assert.equal(readNotesCache('user-b', criteria), null);
    assert.equal(readNotesCache('user-a', { ...criteria, query: 'different search' }), null);
    // Failed refreshes do not write a replacement [] to storage.
    assert.deepEqual(readNotesCache('user-a', criteria), result);
    writeNotesCache('user-a', criteria, { notes: [], hasMore: false });
    assert.deepEqual(readNotesCache('user-a', criteria), { notes: [], hasMore: false });
  });
});
