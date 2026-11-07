import test from 'node:test';
import assert from 'node:assert/strict';
import { recipeDeletionEligibility } from './recipeLifecycle.js';

const recipe = { slug: 'oats', title: 'Oats' };

test('hard delete is eligible only when diary, planner and grocery references are absent', () => {
  assert.deepEqual(recipeDeletionEligibility(recipe), { eligible: true, reasons: [] });
  const result = recipeDeletionEligibility(recipe, {
    diaryDays: [{ meals: [{ items: [{ recipeOrigin: { slug: 'oats' } }] }] }],
    mealPlans: [{ entries: [{ slug: 'oats' }] }],
    groceryItems: [{ recipeRefs: [{ slug: 'oats' }] }],
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reasons.length, 3);
});

test('historical recipe snapshots are detected even when the diary item lacks an origin record', () => {
  const result = recipeDeletionEligibility(recipe, { diaryDays: [{ meals: [{ items: [{ source: { provider: 'Recipe', name: 'Oats' } }] }] }] });
  assert.deepEqual(result.reasons, ['Diary history uses this recipe']);
});
