import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAreaInput, normalizeLifeItemInput, normalizeSourceUrl, parseYouTubeTimestamp, youtubeTimestampUrl, validLifeAreaId } from './lifeAreaModel.js';

test('Life Area inputs are trimmed, bounded and restricted to known visual tokens', () => {
  assert.deepEqual(normalizeAreaInput({ name: '  Career  ', description: '  Grow  ', icon: '💼', color: '#22c55e' }), {
    name: 'Career', description: 'Grow', icon: '💼', color: '#22c55e',
  });
  assert.throws(() => normalizeAreaInput({ name: '  ' }), /name/);
  assert.throws(() => normalizeAreaInput({ name: 'a'.repeat(81) }), /80/);
});

test('Projects and Skills validate type, status, description and calendar dates', () => {
  assert.deepEqual(normalizeLifeItemInput({ name: 'Learn React', itemType: 'skill', status: 'active', targetDate: '2026-12-01' }), {
    name: 'Learn React', description: '', itemType: 'skill', status: 'active', targetDate: '2026-12-01',
  });
  for (const item of [
    { name: 'x', itemType: 'goal' }, { name: 'x', itemType: 'project', status: 'deleted' },
    { name: 'x', itemType: 'project', targetDate: '2026-02-30' }, { name: 'x'.repeat(101), itemType: 'skill' },
  ]) assert.throws(() => normalizeLifeItemInput(item));
});

test('learning sources allow HTTP(S) and constrain YouTube hosts', () => {
  assert.equal(normalizeSourceUrl('https://www.youtube.com/watch?v=123', 'youtube'), 'https://www.youtube.com/watch?v=123');
  assert.equal(normalizeSourceUrl('http://example.com/article', 'article'), 'http://example.com/article');
  for (const url of ['javascript:alert(1)', 'file:///tmp/a', 'https://youtube.com.evil.invalid/watch?v=1', 'https://user:pass@example.com']) {
    assert.throws(() => normalizeSourceUrl(url, url.includes('youtube') ? 'youtube' : 'other'));
  }
});

test('YouTube timestamps parse common forms and create time-coded links', () => {
  assert.equal(parseYouTubeTimestamp('4:32'), 272);
  assert.equal(parseYouTubeTimestamp('1:04:32'), 3872);
  assert.equal(parseYouTubeTimestamp('272'), 272);
  assert.equal(parseYouTubeTimestamp(''), null);
  assert.throws(() => parseYouTubeTimestamp('4:90'));
  assert.equal(new URL(youtubeTimestampUrl('https://youtu.be/abc', 272)).searchParams.get('t'), '272s');
  assert.equal(youtubeTimestampUrl('invalid-url', 272), '');
  assert.equal(validLifeAreaId('8f1672b4-9f9f-4aef-8a7e-341f3c4988e2'), true);
  assert.equal(validLifeAreaId('not-an-id'), false);
});
