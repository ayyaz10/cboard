import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNotesRows } from './noteQueryResult.js';

test('Notes query errors stay errors and cannot become an authoritative empty library', () => {
  const schemaError = { code: '42703', message: 'column notes.lifecycle_state does not exist' };
  assert.throws(() => parseNotesRows({ data: null, error: schemaError }), error => error === schemaError);
  const missingRpc = { code: 'PGRST202', message: 'missing search_notes' };
  assert.throws(() => parseNotesRows({ data: null, error: missingRpc }), error => error === missingRpc);
});

test('only a successful empty Notes response is interpreted as an empty library', () => {
  assert.deepEqual(parseNotesRows({ data: [], error: null }), []);
  assert.throws(() => parseNotesRows({ data: null, error: null }), /invalid response/i);
});
