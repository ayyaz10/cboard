import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeFoodNamesInGroceryState, mergeFoodReferencesInRecipe } from './foodMergeData.js';
import { applyFoodCatalogToRecipes, mergeCanonicalFoods } from './foodCatalog.js';

const originalFoods = [
  { id: 'canonical', name: 'Coriander Powder', quantity: 100, unit: 'g', nutrition: { calories: 300, protein: 10 } },
  { id: 'duplicate', name: '1 tbsp coriander powder', quantity: 100, unit: 'g', nutrition: { calories: 300, protein: 10 } },
];

test('merging food references rewrites recipes but preserves their amount and unit', () => {
  const keep = mergeCanonicalFoods(originalFoods, 'canonical', ['duplicate']);
  const recipe = { slug: 'curry', title: 'Curry', servings: 1, nutritionFromIngredients: true, nutrition: {}, sauces: [], alternatives: {}, ingredients: [
    { name: '1 tbsp coriander powder', foodId: 'duplicate', amount: 1, unit: 'tbsp', nutritionLabel: { quantity: 100, unit: 'g', calories: 300, protein: 10 } },
  ] };
  const rewritten = mergeFoodReferencesInRecipe(recipe, ['duplicate'], originalFoods, keep, originalFoods);
  const updated = applyFoodCatalogToRecipes([rewritten], [keep])[0];
  assert.equal(updated.ingredients[0].foodId, 'canonical');
  assert.equal(updated.ingredients[0].name, 'Coriander Powder');
  assert.equal(updated.ingredients[0].amount, 1);
  assert.equal(updated.ingredients[0].unit, 'tbsp');
});

test('merge keeps diary snapshots independent from changed master food data', () => {
  const diary = structuredClone({ date: '2025-01-01', items: [{ foodId: 'duplicate', name: '1 tbsp coriander powder', quantity: 1, unit: 'tbsp', nutrition: { calories: 42 } }] });
  const keep = mergeCanonicalFoods(originalFoods, 'canonical', ['duplicate']);
  mergeFoodReferencesInRecipe({ slug: 'empty', ingredients: [], sauces: [], alternatives: {} }, ['duplicate'], originalFoods, keep, originalFoods);
  assert.equal(diary.items[0].foodId, 'duplicate');
  assert.equal(diary.items[0].nutrition.calories, 42);
});

test('merge updates active grocery names but preserves grocery quantities and nutrition snapshots', () => {
  const grocery = { items: [{ id: 'stock-1', name: '1 tbsp coriander powder', quantity: 20, nutrition: { calories: 60 } }], shopping: [{ id: 'shop-1', name: '1 tbsp coriander powder', quantity: 2 }] };
  const result = mergeFoodNamesInGroceryState(grocery, originalFoods, { ...originalFoods[0], name: 'Coriander Powder' });
  assert.equal(result.changed, true);
  assert.deepEqual(result.state.items[0], { id: 'stock-1', name: 'Coriander Powder', quantity: 20, nutrition: { calories: 60 } });
  assert.equal(result.state.shopping[0].quantity, 2);
  assert.equal(grocery.items[0].name, '1 tbsp coriander powder');
});
