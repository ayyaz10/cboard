import test from 'node:test';
import assert from 'node:assert/strict';
import { createPendingNutritionImport, formatNutritionFoodName, isPendingNutritionImportExpired, NUTRITION_IMPORT_SESSION_TTL_MS, nutritionJsonMatchesFood } from './nutritionClipboardImport.js';

test('pending lookup captures the exact food text, requested basis, mode, and draft identity', () => {
  const pending = createPendingNutritionImport({ foodName: 'Raw uncooked Chickpeas!', amount: '100', unit: 'g', draftId: 'draft-1', startedAt: 1000, id: 'session-1' });
  assert.deepEqual(pending, { id: 'session-1', foodName: 'Raw uncooked Chickpeas!', amount: 100, unit: 'g', draftId: 'draft-1', mode: 'food_reference', startedAt: 1000, awaitingNutritionJson: true });
  assert.throws(() => createPendingNutritionImport({ foodName: ' ', amount: 100, unit: 'g' }), /food name/i);
  assert.throws(() => createPendingNutritionImport({ foodName: 'Food', amount: 0, unit: 'g' }), /amount/i);
  assert.throws(() => createPendingNutritionImport({ foodName: 'Food', amount: 100, unit: 'cup' }), /unit/i);
});

test('pending lookups expire at their session limit', () => {
  const pending = createPendingNutritionImport({ foodName: 'Chickpeas', amount: 100, unit: 'g', draftId: 'draft-1', startedAt: 500 });
  assert.equal(isPendingNutritionImportExpired(pending, 500 + NUTRITION_IMPORT_SESSION_TTL_MS - 1), false);
  assert.equal(isPendingNutritionImportExpired(pending, 500 + NUTRITION_IMPORT_SESSION_TTL_MS + 1), true);
  assert.equal(isPendingNutritionImportExpired(null), true);
});

test('food comparison tolerates case and punctuation while preserving preparation differences', () => {
  assert.equal(nutritionJsonMatchesFood('RAW, uncooked chickpeas!', { name: 'Raw uncooked chickpeas', state: '' }), true);
  assert.equal(nutritionJsonMatchesFood('chickpeas, cooked', { name: 'Chickpeas', state: 'boiled cooked' }), false);
  assert.equal(nutritionJsonMatchesFood('chickpeas cooked', { name: 'Chickpeas', state: 'cooked' }), true);
  assert.match(formatNutritionFoodName({ name: 'Chickpeas', state: 'boiled' }), /^Chickpeas.*boiled$/);
});
