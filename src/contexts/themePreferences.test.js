import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_THEMES, resolveStoredTheme } from './themePreferences.js';

test('Midnight joins the existing theme choices without replacing them', () => {
  assert.deepEqual(APP_THEMES, ['original', 'matrix', 'midnight']);
});

test('theme persistence accepts each current theme and safely defaults unknown values', () => {
  for (const theme of APP_THEMES) assert.equal(resolveStoredTheme(theme), theme);
  assert.equal(resolveStoredTheme(null), 'original');
  assert.equal(resolveStoredTheme('future-theme'), 'original');
});
