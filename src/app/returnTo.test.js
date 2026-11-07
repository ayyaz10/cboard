import test from 'node:test';
import assert from 'node:assert/strict';
import { safeReturnPath } from './returnTo.js';

const location = { basePath: '/cboard/', origin: 'https://cboard.example' };

test('protected deep links keep their destination and query through authentication', () => {
  assert.equal(safeReturnPath('/cboard/finance?section=debts', location), '/finance?section=debts');
  assert.equal(safeReturnPath('/cboard/notes/note-123', location), '/notes/note-123');
});

test('return paths reject external, protocol-relative, base escape and auth-loop targets', () => {
  for (const path of ['//evil.example/path', 'https://evil.example', '/\\\\evil.example', '/outside', '/cboard/login']) {
    assert.equal(safeReturnPath(path, location), '/board', path);
  }
});
