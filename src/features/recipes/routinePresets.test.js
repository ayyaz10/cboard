import test from 'node:test';
import assert from 'node:assert/strict';
import { readRoutinePresets, saveRoutinePreset } from './routinePresets.js';
const routine = {
  version: 1,
  name: 'Training day',
  notes: '',
  entries: [{ id: 'breakfast', meal: 'Breakfast', slug: 'oats', portions: 2 }],
};

test('presets save multiple combinations and update only the selected identity', () => {
  const first = saveRoutinePreset([], routine, 'one');
  const second = saveRoutinePreset(
    first,
    { ...routine, name: 'Rest day' },
    'two',
  );
  const updated = saveRoutinePreset(
    second,
    { ...routine, name: 'Updated training day' },
    'one',
  );
  assert.equal(updated.length, 2);
  assert.equal(updated[0].name, 'Updated training day');
  assert.equal(updated[1].name, 'Rest day');
  assert.equal(first[0].name, 'Training day');
  assert.deepEqual(
    readRoutinePresets(JSON.parse(JSON.stringify(updated))),
    updated,
  );
});
test('preset validation rejects empty combinations, duplicate identities and oversized libraries', () => {
  assert.throws(
    () => saveRoutinePreset([], { ...routine, entries: [] }, 'one'),
    /at least one/,
  );
  assert.throws(
    () =>
      readRoutinePresets([
        { ...routine, id: 'one' },
        { ...routine, id: 'one' },
      ]),
    /read/,
  );
  const full = Array.from({ length: 30 }, (_, index) => ({
    ...routine,
    id: String(index),
  }));
  assert.throws(() => saveRoutinePreset(full, routine, 'new'), /30 presets/);
  assert.equal(saveRoutinePreset(full, routine, '0').length, 30);
});
