import test from 'node:test';
import assert from 'node:assert/strict';
import { getReviewAdjustments } from './habitReview.js';

test('Review does not recommend changes before a repeated-miss pattern', () => {
  assert.deepEqual(getReviewAdjustments({ recentMisses: 2, commonReason: 'Wrong timing' }), []);
});

test('repeated misses always offer a smaller minimum and target the common observed reason', () => {
  assert.deepEqual(getReviewAdjustments({ recentMisses: 3, commonReason: 'Wrong timing' }), [
    { label: 'Make smaller', target: 'minimum' },
    { label: 'Change timing', target: 'timing' },
  ]);
  assert.deepEqual(getReviewAdjustments({ recentMisses: 4, commonReason: 'Forgot' }), [
    { label: 'Make smaller', target: 'minimum' },
    { label: 'Change trigger', target: 'cue' },
  ]);
  assert.deepEqual(getReviewAdjustments({ recentMisses: 3, commonReason: 'Environment' }), [
    { label: 'Make smaller', target: 'minimum' },
    { label: 'Change environment', target: 'environment' },
  ]);
});

test('unmapped reasons do not invent a targeted recommendation', () => {
  assert.deepEqual(getReviewAdjustments({ recentMisses: 3, commonReason: 'Other' }), [
    { label: 'Make smaller', target: 'minimum' },
  ]);
});
