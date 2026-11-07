import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { getSchema } from '@tiptap/core';
import { DOMParser as ProseMirrorDOMParser, DOMSerializer } from '@tiptap/pm/model';
import { createNotesDocumentExtensions } from './notesDocumentExtensions.js';
import { getTextFromHtml, prepareNoteHtmlForEditor, sanitizeNoteHtml } from './noteContent.js';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = window;
globalThis.document = window.document;

test('paste sanitization retains useful document structure and removes executable markup', () => {
  const safe = sanitizeNoteHtml('<h2 onclick="run()">Plan</h2><ul><li><strong>Review</strong> draft</li></ul><a href="javascript:alert(1)" onclick="run()">unsafe</a><script>alert(1)</script><img src="data:image/svg+xml;base64,PHN2Zz4=" onerror="run()" alt="chart">');
  assert.match(safe, /<h2>Plan<\/h2>/);
  assert.match(safe, /<strong>Review<\/strong>/);
  assert.match(safe, /<a target="_blank" rel="noopener noreferrer">unsafe<\/a>/);
  assert.doesNotMatch(safe, /script|onclick|onerror|javascript:/i);
  assert.doesNotMatch(safe, /data:image\/svg\+xml/i);
});

test('legacy font markup keeps safe inline formatting when prepared for the editor', () => {
  const prepared = prepareNoteHtmlForEditor('<p><font color="#ef8744" face="Georgia" size="5"><b>Legacy title</b></font></p>');
  assert.match(prepared, /<span style="[^"]*color: (?:#ef8744|rgb\(239, 135, 68\))/i);
  assert.match(prepared, /font-family: Georgia/i);
  assert.match(prepared, /font-size: 24px/i);
  assert.match(prepared, /(?:<strong>|<b>)Legacy title(?:<\/strong>|<\/b>)/);
});

test('search text includes useful image alt descriptions', () => {
  assert.equal(getTextFromHtml('<p>Read this</p><img src="https://example.com/chart.png" alt="Budget trend">'), 'Read this Budget trend');
});


test('legacy HTML opens and serializes through the block schema without losing core structure', () => {
  const schema = getSchema(createNotesDocumentExtensions({ current: {} }));
  const legacyHtml = '<h2>Quarterly plan</h2><p><strong>Bold</strong> and <em>italic</em> with <a href="https://example.com/plan">a source</a>.</p><ul><li>First</li><li>Second</li></ul><ol><li>Next</li></ol>';
  const mount = document.createElement('div');
  mount.innerHTML = prepareNoteHtmlForEditor(legacyHtml);
  const documentNode = ProseMirrorDOMParser.fromSchema(schema).parse(mount);
  assert.deepEqual(documentNode.content.content.map((node) => node.type.name), ['heading', 'paragraph', 'bulletList', 'orderedList']);
  assert.equal(documentNode.firstChild.attrs.level, 2);
  assert.equal(documentNode.child(1).textContent, 'Bold and italic with a source.');
  const inlineMarks = [];
  documentNode.child(1).descendants((node) => { if (node.isText) inlineMarks.push({ text: node.text, marks: node.marks.map((mark) => mark.type.name) }); });
  assert.equal(inlineMarks.some((item) => item.text === 'Bold' && item.marks.includes('bold')), true);
  assert.equal(inlineMarks.some((item) => item.text === 'italic' && item.marks.includes('italic')), true);
  assert.equal(inlineMarks.some((item) => item.text === 'a source' && item.marks.includes('link')), true);
  const roundTrip = document.createElement('div');
  roundTrip.append(DOMSerializer.fromSchema(schema).serializeFragment(documentNode.content));
  const safeHtml = sanitizeNoteHtml(roundTrip.innerHTML);
  const restored = ProseMirrorDOMParser.fromSchema(schema).parse(roundTrip);
  assert.match(safeHtml, /<h2>Quarterly plan<\/h2>/);
  assert.deepEqual(restored.content.content.map((node) => node.type.name), ['heading', 'paragraph', 'bulletList', 'orderedList']);
});


test('task lists and images retain accessible checkbox and alt text semantics', () => {
  const schema = getSchema(createNotesDocumentExtensions({ current: {} }));
  const pasted = sanitizeNoteHtml('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked disabled aria-label="Task: review"><span></span></label><div><p>Review draft</p></div></li></ul><img src="https://example.com/chart.png" alt="Budget trend">');
  const mount = document.createElement('div');
  mount.innerHTML = pasted;
  const documentNode = ProseMirrorDOMParser.fromSchema(schema).parse(mount);
  assert.equal(documentNode.firstChild.type.name, 'taskList');
  assert.equal(documentNode.firstChild.firstChild.attrs.checked, true);
  assert.equal(documentNode.firstChild.firstChild.textContent, 'Review draft');
  assert.equal(documentNode.child(1).type.name, 'image');
  assert.equal(documentNode.child(1).attrs.alt, 'Budget trend');
});

test('divider blocks survive sanitization and editor serialization', () => {
  const schema = getSchema(createNotesDocumentExtensions({ current: {} }));
  const mount = document.createElement('div');
  mount.innerHTML = prepareNoteHtmlForEditor('<p>First section</p><hr><p>Second section</p>');
  const documentNode = ProseMirrorDOMParser.fromSchema(schema).parse(mount);
  assert.deepEqual(documentNode.content.content.map((node) => node.type.name), ['paragraph', 'horizontalRule', 'paragraph']);

  const roundTrip = document.createElement('div');
  roundTrip.append(DOMSerializer.fromSchema(schema).serializeFragment(documentNode.content));
  const restored = ProseMirrorDOMParser.fromSchema(schema).parse(roundTrip);
  assert.deepEqual(restored.content.content.map((node) => node.type.name), ['paragraph', 'horizontalRule', 'paragraph']);
});
