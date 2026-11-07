import test from 'node:test';
import assert from 'node:assert/strict';
import { getManifestShortcuts } from './pwa-build.js';

test('manifest shortcuts reuse the canonical app module paths under the PWA base', () => {
  const shortcuts = getManifestShortcuts('/cboard/');
  assert.deepEqual(shortcuts.map(({ name, url }) => [name, url]), [
    ['Notes', '/cboard/notes'],
    ['Finance', '/cboard/finance'],
    ['Food Diary', '/cboard/food-diary'],
    ['Recipes', '/cboard/recipes'],
    ['Habit Improvement', '/cboard/habit-improvement'],
  ]);
  assert.ok(shortcuts.every(({ description, short_name }) => description && short_name.length <= 24));
});
