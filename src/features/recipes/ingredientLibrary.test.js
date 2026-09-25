import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStoredIngredient, buildIngredientLibrary, findIngredientMatches, hasStoredNutrition } from './ingredientLibrary.js';

const banana = { name: 'Medium Banana', amount: 1, unit: 'piece', note: 'Peeled', nutrition: { calories: 105 }, nutritionLabel: { quantity: 100, unit: 'g', calories: 89, source: { name: 'Bananas, raw', provider: 'USDA' } } };

test('saved recipe ingredients become searchable suggestions without exact duplicates', () => {
  const library = buildIngredientLibrary([
    { title: 'Breakfast', ingredients: [banana], sauces: [], alternatives: {} },
    { title: 'Snack', ingredients: [{ ...banana }], sauces: [{ name: 'Honey', amount: 1, unit: 'tsp' }], alternatives: {} },
  ]);
  assert.equal(library.length, 2);
  assert.deepEqual(library[1].recipeTitles, ['Breakfast', 'Snack']);
  assert.equal(findIngredientMatches(library, 'banana')[0].item.name, 'Medium Banana');
  assert.equal(findIngredientMatches(library, 'med')[0].item.name, 'Medium Banana');
});

test('selecting a stored ingredient copies all useful fields and preserves the current alternative group', () => {
  const selected = applyStoredIngredient({ alternativeGroup: 'fruit' }, banana);
  assert.equal(selected.name, 'Medium Banana');
  assert.equal(selected.amount, 1);
  assert.equal(selected.note, 'Peeled');
  assert.equal(selected.alternativeGroup, 'fruit');
  assert.equal(selected.nutrition.calories, 105);
  assert.equal(selected.nutritionLabel.source.name, 'Bananas, raw');
  assert.notEqual(selected.nutrition, banana.nutrition);
  assert.equal(hasStoredNutrition(selected), true);
});
