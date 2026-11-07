import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import { createNotesDocumentExtensions } from './notesDocumentExtensions.js';
import {
  convertTopLevelBlock,
  createEmptyBlock,
  deleteTopLevelBlock,
  duplicateTopLevelBlock,
  getSlashCommands,
  getTopLevelBlock,
  insertEmptyBlock,
  moveTopLevelBlock,
  shouldDeferNoteSerialization,
} from './noteEditorModel.js';

const schema = getSchema(createNotesDocumentExtensions({ current: {} }));

function createState(texts, plugins = []) {
  const paragraphs = texts.map((text) => schema.nodes.paragraph.create(null, text ? schema.text(text) : null));
  return EditorState.create({ schema, doc: schema.nodes.doc.create(null, paragraphs), plugins });
}

function textBlocks(doc) {
  const values = [];
  doc.forEach((node) => values.push(node.textContent));
  return values;
}

test('slash commands accept the documented aliases and filter relevant blocks', () => {
  assert.deepEqual(getSlashCommands('h1').map((item) => item.id), ['heading1']);
  assert.deepEqual(getSlashCommands('hea').map((item) => item.id), ['heading1', 'heading2', 'heading3']);
  assert.deepEqual(getSlashCommands('bullet').map((item) => item.id), ['bullet']);
  assert.deepEqual(getSlashCommands('todo').map((item) => item.id), ['todo']);
  assert.deepEqual(getSlashCommands('image').map((item) => item.id), ['image']);
  assert.deepEqual(getSlashCommands('quote').map((item) => item.id), ['quote']);
  assert.equal(getSlashCommands('').length, 10);
});

test('block movement reorders one top-level block and remains undoable', () => {
  let state = createState(['A', 'B', 'C'], [history()]);
  const transaction = moveTopLevelBlock(state, 6, -1);
  assert.ok(transaction);
  state = state.apply(transaction);
  assert.deepEqual(textBlocks(state.doc), ['A', 'C', 'B']);
  let restored = state;
  assert.equal(undo(restored, (undoTransaction) => { restored = restored.apply(undoTransaction); }), true);
  assert.deepEqual(textBlocks(restored.doc), ['A', 'B', 'C']);
});

test('duplicate and delete affect only the requested block', () => {
  let state = createState(['A', 'B']);
  state = state.apply(duplicateTopLevelBlock(state, 0));
  assert.deepEqual(textBlocks(state.doc), ['A', 'A', 'B']);
  state = state.apply(deleteTopLevelBlock(state, 3));
  assert.deepEqual(textBlocks(state.doc), ['A', 'B']);
  state = state.apply(deleteTopLevelBlock(state, 0));
  assert.deepEqual(textBlocks(state.doc), ['B']);
  const onlyBlock = createState(['only']);
  const cleared = deleteTopLevelBlock(onlyBlock, 0);
  assert.equal(cleared.doc.childCount, 1);
  assert.equal(cleared.doc.firstChild.type.name, 'paragraph');
  assert.equal(cleared.doc.firstChild.textContent, '');
});

test('turning a paragraph into a heading retains inline marks and text', () => {
  const strong = schema.marks.bold.create();
  const paragraph = schema.nodes.paragraph.create(null, schema.text('Preserve this', [strong]));
  const state = EditorState.create({ schema, doc: schema.nodes.doc.create(null, [paragraph]) });
  const transaction = convertTopLevelBlock(state, 0, 'heading2');
  assert.equal(transaction.doc.firstChild.type.name, 'heading');
  assert.equal(transaction.doc.firstChild.attrs.level, 2);
  assert.equal(transaction.doc.firstChild.textContent, 'Preserve this');
  assert.equal(transaction.doc.firstChild.firstChild.marks.some((mark) => mark.type.name === 'bold'), true);
});

test('insert menu creates semantic task, quote, and divider blocks', () => {
  const state = createState(['Anchor']);
  for (const kind of ['todo', 'quote', 'divider']) {
    const block = createEmptyBlock(schema, kind);
    assert.ok(block);
    const transaction = insertEmptyBlock(state, 0, kind);
    assert.ok(transaction);
    const inserted = transaction.doc.firstChild;
    assert.equal(inserted.type.name, kind === 'todo' ? 'taskList' : kind === 'quote' ? 'blockquote' : 'horizontalRule');
  }
});

test('block lookup stays scoped to a top-level list or heading subtree', () => {
  const paragraph = schema.nodes.paragraph.create(null, schema.text('item'));
  const listItem = schema.nodes.listItem.create(null, paragraph);
  const list = schema.nodes.bulletList.create(null, listItem);
  const heading = schema.nodes.heading.create({ level: 2 }, schema.text('section'));
  const state = EditorState.create({ schema, doc: schema.nodes.doc.create(null, [list, heading]) });
  assert.equal(getTopLevelBlock(state.doc, 2).node.type.name, 'bulletList');
  assert.equal(getTopLevelBlock(state.doc, list.nodeSize + 1).node.type.name, 'heading');
});


test('turning a paragraph into a to-do keeps text and inline formatting', () => {
  const italic = schema.marks.italic.create();
  const paragraph = schema.nodes.paragraph.create(null, schema.text('Follow up', [italic]));
  const state = EditorState.create({ schema, doc: schema.nodes.doc.create(null, [paragraph]) });
  const transaction = convertTopLevelBlock(state, 0, 'todo');
  const item = transaction.doc.firstChild.firstChild;
  assert.equal(transaction.doc.firstChild.type.name, 'taskList');
  assert.equal(item.type.name, 'taskItem');
  assert.equal(item.attrs.checked, false);
  assert.equal(item.textContent, 'Follow up');
  assert.equal(item.firstChild.firstChild.marks.some((mark) => mark.type.name === 'italic'), true);
});

test('new text block insertion leaves existing content intact and creates a paragraph', () => {
  const state = createState(['Existing']);
  const transaction = insertEmptyBlock(state, state.doc.content.size, 'text');
  assert.deepEqual(textBlocks(transaction.doc), ['Existing', '']);
  assert.equal(transaction.doc.lastChild.type.name, 'paragraph');
});


test('deleting a block is recoverable through ProseMirror undo history', () => {
  let state = createState(['Keep', 'Remove'], [history()]);
  state = state.apply(deleteTopLevelBlock(state, 6));
  assert.deepEqual(textBlocks(state.doc), ['Keep']);
  assert.equal(undo(state, (transaction) => { state = state.apply(transaction); }), true);
  assert.deepEqual(textBlocks(state.doc), ['Keep', 'Remove']);
});

test('block lookup and movement handle a 1,000 block document and 25,000 words', () => {
  let manyBlocks = createState(Array.from({ length: 1000 }, (_, index) => 'block ' + index));
  const last = getTopLevelBlock(manyBlocks.doc, manyBlocks.doc.content.size - 1);
  assert.equal(last.node.textContent, 'block 999');
  const moved = moveTopLevelBlock(manyBlocks, last.position, -1);
  manyBlocks = manyBlocks.apply(moved);
  assert.equal(manyBlocks.doc.childCount, 1000);
  assert.equal(manyBlocks.doc.lastChild.textContent, 'block 998');
  const longText = schema.text(Array.from({ length: 25000 }, () => 'word').join(' '));
  const longState = EditorState.create({ schema, doc: schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, longText)) });
  assert.equal(longState.doc.firstChild.textContent.split(' ').length, 25000);
});

test('slash command delays serialization only while its accessible menu is open', () => {
  const editor = { view: { dom: { getAttribute: (name) => ({ 'aria-haspopup': 'listbox', 'aria-expanded': 'true' })[name] ?? null } } };
  assert.equal(shouldDeferNoteSerialization(editor), true);
  assert.equal(shouldDeferNoteSerialization(editor, true), false);
  assert.equal(shouldDeferNoteSerialization({ view: { dom: { getAttribute: () => null } } }), false);
});
