import test from 'node:test';
import assert from 'node:assert/strict';
import { readHealthReview, healthReviewStatus } from './recipeHealthReview.js';
import { validateGeminiRecipe, toStoredRecipe } from '../parse-recipe/recipeParser.js';
import { validateRecipe, recipeEditorData } from '../../../src/features/recipes/recipeData.js';

const review = {
  summary: 'A vegetable and egg dish; the full nutritional balance depends on portions.',
  positives: ['Spinach adds vegetables; eggs provide protein.'],
  watchOuts: ['Added salt contributes sodium; use a small amount.'],
  suggestions: ['Try serving with wholegrain toast.'],
  limitations: ['Exact nutrition is not supplied.'],
};
const model = { is_recipe: true, title: 'Spinach eggs', cooking_time_minutes: 5, ingredients: ['2 eggs', '100g spinach', 'Pinch of salt'], steps: ['Cook spinach, then stir in eggs and cook for 5 minutes.'], health_review: review };
const recipe = () => toStoredRecipe(validateGeminiRecipe(model), 'spinach-eggs');

test('AI review survives server storage and frontend editing without extra model calls', () => {
  const stored = recipe();
  const loaded = validateRecipe(stored);
  assert.deepEqual(loaded.healthReview, stored.healthReview);
  assert.equal(healthReviewStatus(loaded), 'watch');
  assert.equal(healthReviewStatus(validateRecipe(recipeEditorData(loaded))), 'watch');
  assert.equal(healthReviewStatus({ ...loaded, image: 'new photo', tags: ['changed'] }), 'watch');
});

test('ingredient, portion, nutrition and method edits invalidate the report', () => {
  const stored = recipe();
  for (const changed of [
    { ...stored, servings: 2 },
    { ...stored, ingredients: [...stored.ingredients, { name: 'Butter', amount: 30, unit: 'g' }] },
    { ...stored, steps: ['Deep fry everything.'] },
    { ...stored, nutrition: { ...stored.nutrition, calories: 400 } },
    { ...stored, sauces: [{ name: 'Cream sauce' }] },
  ]) assert.equal(healthReviewStatus(changed), 'outdated');
});

test('missing and malformed reports do not break valid recipe imports or pretend to be green', () => {
  for (const health_review of [undefined, null, {}, { ...review, positives: 'text' }, { ...review, summary: 'x'.repeat(301) }, { ...review, watchOuts: Array(4).fill('salt') }]) {
    const stored = toStoredRecipe(validateGeminiRecipe({ ...model, health_review }), 'test');
    assert.equal(healthReviewStatus(stored), 'unavailable');
    assert.equal(stored.title, model.title);
  }
  assert.equal(readHealthReview({ ...review, positives: [], watchOuts: [], limitations: [] }), null);
});

test('uncertainty uses amber, concrete watch-outs use red and green requires positive evidence', () => {
  const make = (health_review) => toStoredRecipe(validateGeminiRecipe({ ...model, health_review }), 'test');
  assert.equal(healthReviewStatus(make({ ...review, watchOuts: [] })), 'limited');
  assert.equal(healthReviewStatus(make({ ...review, watchOuts: [], limitations: [] })), 'positive');
  assert.equal(healthReviewStatus(make(review)), 'watch');
});
