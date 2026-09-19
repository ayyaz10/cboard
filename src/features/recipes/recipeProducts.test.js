import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateProducts, initialProductAmount, productBasis } from './recipeProducts.js';
import { validateRecipe } from './recipeData.js';

const item = { quantity: 150, unit: 'g', nutrition: { quantity: 100, unit: 'g', calories: 200, protein: 12, carbs: 20, fat: 5, fiber: null, source: { name: 'Brand yoghurt', provider: 'Open Food Facts', code: '12345678' } } };
const recipe = { title: 'Lunch', slug: 'lunch', mealType: 'Lunch', servings: 2, ingredients: [{ name: 'Yoghurt', amount: 150, unit: 'g' }], sauces: [], steps: ['Mix.'] };
test('products scale full quantities and divide totals by servings, preserving unknown nutrients', () => {
  const result = calculateProducts([item], 2);
  assert.equal(result.total.calories, 300);
  assert.equal(result.perServing.protein, 9);
  assert.equal(result.perServing.fiber, null);
  assert.equal(calculateProducts([item, null], 2).total.calories, null);
  assert.equal(calculateProducts([item], 0).perServing.calories, null);
  assert.equal(calculateProducts([{ ...item, unit: 'ml' }], 2).total.calories, null);
});
test('only compatible mass and volume amounts are prefilled', () => {
  assert.equal(initialProductAmount({ amount: 0.5, unit: 'kg' }, 'g'), 500);
  assert.equal(initialProductAmount({ amount: 2, unit: 'cups' }, 'g'), '');
  assert.equal(initialProductAmount({ amount: 150, unit: 'g' }, 'ml'), '');
});
test('saved product choices survive validation and serving edits recalculate nutrition', () => {
  const clean = validateRecipe(recipe);
  const saved = validateRecipe({ ...clean, productNutrition: { basis: productBasis(clean), items: [item] } });
  assert.equal(saved.nutrition.calories, 150);
  assert.equal(saved.ingredients[0].nutrition.calories, 300);
  assert.deepEqual(validateRecipe(saved), saved);
  assert.equal(validateRecipe({ ...saved, servings: 3 }).nutrition.calories, 100);
  const changed = validateRecipe({ ...saved, ingredients: [{ ...saved.ingredients[0], amount: 200 }] });
  assert.equal(changed.productNutrition, undefined);
  assert.equal(changed.nutrition.calories, null);
  assert.equal(changed.ingredients[0].nutrition.calories, null);
});
test('sauces contribute to totals and missing sauce data makes totals unknown', () => {
  const clean = validateRecipe({ ...recipe, sauces: [{ name: 'Sauce', amount: 10, unit: 'g' }] });
  const saved = validateRecipe({ ...clean, productNutrition: { basis: productBasis(clean), items: [item, null] } });
  assert.equal(saved.nutrition.calories, null);
});
