import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStoredDiaryFood, buildDiaryFoodLibrary, findDiaryFoodMatches } from './diaryFoodLibrary.js';

const almonds = { id: 'old', name: 'Almonds', quantity: 6, unit: 'g', basis: 100, nutritionUnit: 'g', perPiece: null, nutrition: { calories: 584, protein: 21.2 }, source: { provider: 'USDA', name: 'Almonds, raw' } };

test('diary history and recipe ingredients are available as food suggestions', () => {
  const library = buildDiaryFoodLibrary(
    [{ date: '2026-09-24', meals: [{ items: [almonds] }] }],
    [{ title: 'Fruit bowl', ingredients: [{ name: 'Medium banana', amount: 100, unit: 'g', nutrition: { calories: 89 } }], sauces: [], alternatives: {} }],
  );
  assert.equal(findDiaryFoodMatches(library, 'alm')[0].item.source.name, 'Almonds, raw');
  const banana = findDiaryFoodMatches(library, 'banana')[0].item;
  assert.equal(banana.quantity, 100);
  assert.equal(banana.nutrition.calories, 89);
});

test('selecting a stored diary food keeps the current row id and copies nutrition independently', () => {
  const selected = applyStoredDiaryFood({ id: 'current' }, almonds);
  assert.equal(selected.id, 'current');
  assert.equal(selected.quantity, 6);
  assert.equal(selected.nutrition.calories, 584);
  assert.notEqual(selected.nutrition, almonds.nutrition);
});
