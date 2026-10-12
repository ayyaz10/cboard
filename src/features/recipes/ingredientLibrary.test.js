import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStoredIngredient, buildIngredientLibrary, findIngredientMatches, hasStoredNutrition, removeRecipeOnlyIngredients } from './ingredientLibrary.js';

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

test('selecting a stored ingredient applies its name and nutrition while preserving recipe amount and context', () => {
  const selected = applyStoredIngredient({ alternativeGroup: 'fruit', name: 'Banana', amount: 2, unit: 'pieces', group: 'Topping' }, { ...banana, foodId: 'banana-food' });
  assert.equal(selected.name, 'Medium Banana');
  assert.equal(selected.amount, 2);
  assert.equal(selected.unit, 'pieces');
  assert.equal(selected.note, 'Peeled');
  assert.equal(selected.alternativeGroup, 'fruit');
  assert.equal(selected.group, 'Topping');
  assert.equal(selected.foodId, 'banana-food');
  assert.equal(selected.foodAliasConfirmed, undefined);
  assert.equal(selected.nutrition.calories, 105);
  assert.equal(selected.nutritionLabel.source.name, 'Bananas, raw');
  assert.notEqual(selected.nutrition, banana.nutrition);
  assert.equal(hasStoredNutrition(selected), true);
});

test('selecting a reusable food recalculates label nutrition using the amount already in the recipe row', () => {
  const current = { name: 'Cheese', amount: 30, unit: 'g', note: 'Grated', group: 'Sauce', scaleEnabled: false };
  const food = {
    foodId: 'cheddar-food', name: 'British Extra Mature Cheddar Cheese', amount: 100, unit: 'g',
    nutrition: { calories: 400, protein: 25, carbs: 1, fat: 33, fiber: 0 },
    nutritionLabel: { quantity: 100, unit: 'g', calories: 400, protein: 25, carbs: 1, fat: 33, fiber: 0, source: { name: 'British Extra Mature Cheddar Cheese', provider: 'Open Food Facts' } },
  };

  const selected = applyStoredIngredient(current, food);
  assert.equal(selected.name, food.name);
  assert.equal(selected.amount, 30);
  assert.equal(selected.unit, 'g');
  assert.equal(selected.note, 'Grated');
  assert.equal(selected.group, 'Sauce');
  assert.equal(selected.scaleEnabled, false);
  assert.deepEqual(['calories', 'protein', 'carbs', 'fat', 'fiber'].map(key => selected.nutrition[key]), [120, 7.5, 0.3, 9.9, 0]);
});

test('recipe rows with stale food IDs still attach to the reusable item by its legacy alias', () => {
  const food = { id: 'coriander', name: 'Coriander Powder', aliases: ['1 tbsp coriander powder'], quantity: 100, unit: 'g', nutrition: { calories: 300 } };
  const recipe = { slug: 'curry', title: 'Curry', ingredients: [{ name: '1 tbsp coriander powder', foodId: 'deleted-id', amount: 1, unit: 'tbsp' }], sauces: [], alternatives: {} };
  const [entry] = buildIngredientLibrary([recipe], [food]);
  assert.equal(entry.item.foodId, 'coriander');
  assert.equal(entry.recipeTitles.includes('Curry'), true);
  assert.equal(entry.key, 'food:coriander');
});

test('recipe-only cleanup removes matching rows across recipe sections but leaves other ingredients untouched', () => {
  const orphan = { name: '1 tbsp coriander powder', amount: 1, unit: 'tbsp', nutrition: {} };
  const recipe = { slug: 'curry', title: 'Curry', ingredients: [orphan, { name: 'Salt', amount: 1, unit: 'pinch', nutrition: {}, alternativeGroup: 'spice' }], sauces: [], alternatives: { spice: { options: [{ ...orphan }] } } };
  const key = buildIngredientLibrary([recipe]).find(entry => entry.item.name === orphan.name).key;
  const result = removeRecipeOnlyIngredients([recipe], [key]);
  assert.equal(result.removed, 2);
  assert.deepEqual(result.recipes[0].ingredients.map(item => item.name), ['Salt']);
  assert.deepEqual(result.recipes[0].alternatives, {});
  assert.equal(result.recipes[0].ingredients[0].alternativeGroup, undefined);
});
