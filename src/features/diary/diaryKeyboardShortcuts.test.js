import test from 'node:test';
import assert from 'node:assert/strict';
import { getDiaryShortcutAction } from './diaryKeyboardShortcuts.js';

function key(key, modifiers = {}) { return { key, ...modifiers }; }

test('diary shortcuts map to add meal, add food, manual item, and save actions', () => {
  assert.equal(getDiaryShortcutAction(key('m', { altKey: true, shiftKey: true })), 'add-meal');
  assert.equal(getDiaryShortcutAction(key('c', { altKey: true, shiftKey: true }), { sectionFocused: true }), 'copy-previous-meal');
  assert.equal(getDiaryShortcutAction(key('p', { altKey: true, shiftKey: true }), { sectionFocused: true }), null);
  assert.equal(getDiaryShortcutAction(key('a', { altKey: true, shiftKey: true }), { editorOpen: true }), 'add-food-lookup');
  assert.equal(getDiaryShortcutAction(key('n', { altKey: true, shiftKey: true }), { editorOpen: true }), 'add-manual-food');
  assert.equal(getDiaryShortcutAction(key('Enter', { ctrlKey: true }), { editorOpen: true }), 'save-meal');
  assert.equal(getDiaryShortcutAction(key('Enter', { metaKey: true }), { editorOpen: true }), 'save-meal');
});

test('diary shortcuts ignore unrelated modifiers, editable page fields, dialogs, repeats, and composition', () => {
  assert.equal(getDiaryShortcutAction(key('m', { altKey: true })), null);
  assert.equal(getDiaryShortcutAction(key('m', { altKey: true, shiftKey: true, ctrlKey: true })), null);
  assert.equal(getDiaryShortcutAction(key('m', { altKey: true, shiftKey: true }), { editable: true }), null);
  assert.equal(getDiaryShortcutAction(key('m', { altKey: true, shiftKey: true }), { inDialog: true }), null);
  assert.equal(getDiaryShortcutAction(key('m', { altKey: true, shiftKey: true, repeat: true })), null);
  assert.equal(getDiaryShortcutAction(key('m', { altKey: true, shiftKey: true, isComposing: true })), null);
  assert.equal(getDiaryShortcutAction(key('Enter', { ctrlKey: true }), { editorOpen: false }), null);
});
