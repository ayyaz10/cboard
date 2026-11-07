import test from 'node:test';
import assert from 'node:assert/strict';
import { isMissingLifecycleSchema, isMissingSearchFunction } from './notesCompatibility.js';

test('legacy Notes schema compatibility only activates for lifecycle columns that are absent', () => {
  assert.equal(isMissingLifecycleSchema({ code: '42703', message: 'column notes.lifecycle_state does not exist' }), true);
  assert.equal(isMissingLifecycleSchema({ code: 'PGRST204', message: "Could not find the 'pinned_at' column" }), true);
  assert.equal(isMissingLifecycleSchema({ code: '42703', message: 'column notes.title does not exist' }), false);
  assert.equal(isMissingLifecycleSchema({ code: '42501', message: 'permission denied for table notes' }), false);
  assert.equal(isMissingLifecycleSchema({ code: 'PGRST202', message: 'search_notes missing' }), false);
});

test('missing search RPC compatibility only activates for the Notes search function', () => {
  assert.equal(isMissingSearchFunction({ code: 'PGRST202', message: 'Could not find the function public.search_notes in the schema cache' }), true);
  assert.equal(isMissingSearchFunction({ code: 'PGRST202', message: 'Could not find the function public.other_rpc' }), false);
  assert.equal(isMissingSearchFunction({ code: '57014', message: 'statement timeout' }), false);
});
