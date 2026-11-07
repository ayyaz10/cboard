import test from 'node:test';
import assert from 'node:assert/strict';
import { getNoteLifecycleChanges, getNoteSizeIssue, isSafeNoteLink, isSafeNoteMedia, isSafeNoteUrl, matchesNoteSearch } from './noteContent.js';

test('note search matches title, body text, and tags without case sensitivity', () => {
  const note = {
    title: 'Campaign planning',
    contentText: 'Review quarterly pricing before launch',
    tags: ['Marketing', 'Ideas'],
  };

  assert.equal(matchesNoteSearch(note, 'CAMPAIGN'), true);
  assert.equal(matchesNoteSearch(note, 'quarterly pricing'), true);
  assert.equal(matchesNoteSearch(note, 'marketing'), true);
  assert.equal(matchesNoteSearch(note, 'finance'), false);
  assert.equal(matchesNoteSearch(note, '   '), true);
});

test('note lifecycle transitions preserve the pre-trash state and reject invalid transitions', () => {
  const active = { lifecycle_state: 'active', state_before_trash: 'active', pinned_at: null };
  const archived = { lifecycle_state: 'archived', state_before_trash: 'active', pinned_at: null };

  assert.deepEqual(getNoteLifecycleChanges(active, 'archive'), { lifecycle_state: 'archived' });
  assert.deepEqual(getNoteLifecycleChanges(archived, 'trash'), { lifecycle_state: 'trashed', state_before_trash: 'archived' });
  assert.deepEqual(getNoteLifecycleChanges({ ...archived, lifecycle_state: 'trashed', state_before_trash: 'archived' }, 'restore'), { lifecycle_state: 'archived' });
  assert.equal(getNoteLifecycleChanges(archived, 'restore'), null);
  assert.deepEqual(getNoteLifecycleChanges(active, 'pin', '2026-11-06T00:00:00.000Z'), { pinned_at: '2026-11-06T00:00:00.000Z' });
  assert.equal(getNoteLifecycleChanges({ ...active, lifecycle_state: 'trashed' }, 'pin'), null);
});

test('note URLs reject script and SVG data protocols while retaining approved media and links', () => {
  assert.equal(isSafeNoteUrl('javascript:alert(1)'), false);
  assert.equal(isSafeNoteUrl('data:image/svg+xml;base64,PHN2Zz4='), false);
  assert.equal(isSafeNoteUrl('data:image/png;base64,AAAA'), true);
  assert.equal(isSafeNoteUrl('https://example.com'), true);
  assert.equal(isSafeNoteUrl('/notes'), true);
  assert.equal(isSafeNoteUrl('//example.com'), false);
  assert.equal(isSafeNoteUrl('https://example.com\njavascript:alert(1)'), false);
});

test('note size validation rejects oversized text, titles, tags, and attachments without truncating', () => {
  assert.equal(getNoteSizeIssue({ title: 'Untitled', contentHtml: '<p>ok</p>' }), null);
  assert.match(getNoteSizeIssue({ title: 'x'.repeat(241) }), /240 characters/);
  assert.match(getNoteSizeIssue({ tags: ['x'.repeat(129)] }), /128 characters/);
  assert.match(getNoteSizeIssue({ contentText: 'x'.repeat(5 * 1024 * 1024 + 1) }), /searchable text/);
  assert.match(getNoteSizeIssue({ media: [{ size: 13 * 1024 * 1024 }] }), /12 MB/);
  assert.match(getNoteSizeIssue({ media: Array.from({ length: 25 }, () => ({ size: 1 })) }), /24 attachments/);
});

test('note attachments accept passive allowlisted file data and reject active HTML/SVG', () => {
  assert.equal(isSafeNoteMedia({ type: 'image/png', dataUrl: 'data:image/png;base64,YWJj' }), true);
  assert.equal(isSafeNoteMedia({ type: 'application/pdf', dataUrl: 'data:application/pdf;base64,YWJj' }), true);
  assert.equal(isSafeNoteMedia({ type: 'image/svg+xml', dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }), false);
  assert.equal(isSafeNoteMedia({ type: 'text/html', dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' }), false);
});


test('note links reject data URLs and unsafe protocols while accepting safe destinations', () => {
  assert.equal(isSafeNoteLink('javascript:alert(1)'), false);
  assert.equal(isSafeNoteLink('data:image/png;base64,AAAA'), false);
  assert.equal(isSafeNoteLink('//example.com'), false);
  assert.equal(isSafeNoteLink('https://example.com'), true);
  assert.equal(isSafeNoteLink('mailto:notes@example.com'), true);
  assert.equal(isSafeNoteLink('/notes'), true);
  assert.equal(isSafeNoteLink('#section'), true);
});
