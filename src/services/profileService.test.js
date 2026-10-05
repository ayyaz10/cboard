import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getProfileInitials, isValidUsername, MAX_AVATAR_BYTES, validateAvatarFile } from './profileValidation.js';

test('validates supported avatar formats and the upload size cap', () => {
  assert.equal(validateAvatarFile({ type: 'image/jpeg', size: MAX_AVATAR_BYTES }), '');
  assert.equal(validateAvatarFile({ type: 'image/png', size: 200 }), '');
  assert.equal(validateAvatarFile({ type: 'image/webp', size: 200 }), '');
  assert.match(validateAvatarFile({ type: 'image/gif', size: 200 }), /JPEG, PNG, or WEBP/);
  assert.match(validateAvatarFile({ type: 'image/jpeg', size: MAX_AVATAR_BYTES + 1 }), /5 MB or smaller/);
  assert.match(validateAvatarFile(null), /Choose a profile picture/);
});

test('derives deterministic initials from display name or email', () => {
  assert.equal(getProfileInitials('Douglas Rochman'), 'DR');
  assert.equal(getProfileInitials('', 'douglas.rochman@example.com'), 'DR');
  assert.equal(getProfileInitials('', ''), 'CB');
});

test('keeps usernames within the existing authentication constraints', () => {
  assert.equal(isValidUsername('Ayyaz_10'), true);
  assert.equal(isValidUsername('ab'), false);
  assert.equal(isValidUsername('not allowed'), false);
  assert.equal(isValidUsername('this_username_is_too_long_123'), false);
});
