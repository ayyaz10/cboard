import test from 'node:test';
import assert from 'node:assert/strict';
import { hasUnsavedNodeChanges } from './nodeEditor.js';

const baseline = { parentId: null, title: 'Speed bumps', description: '', whyItHappens: '', whatIDoDifferently: '', richNotes: '', status: 'NEEDS_WORK', priority: 'MEDIUM', focusNow: false, updatedAt: 'old timestamp' };

test('node editor considers unchanged fields clean and ignores persisted metadata', () => {
  assert.equal(hasUnsavedNodeChanges({ ...baseline, updatedAt: 'new timestamp' }, baseline), false);
});

test('node editor detects changes to editable text, placement, state, and focus fields', () => {
  for (const [field, value] of Object.entries({ title: 'New name', description: 'Context', whyItHappens: '<p>Why</p>', whatIDoDifferently: '<p>Next</p>', richNotes: '<p>Notes</p>', parentId: 'parent-1', status: 'IMPROVING', priority: 'HIGH', focusNow: true })) {
    assert.equal(hasUnsavedNodeChanges({ ...baseline, [field]: value }, baseline), true, field);
  }
});

test('node editor treats missing optional text as unchanged from an empty value', () => {
  assert.equal(hasUnsavedNodeChanges({ ...baseline, richNotes: undefined }, baseline), false);
});
