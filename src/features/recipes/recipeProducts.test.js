import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateProducts, initialProductAmount, productBasis } from './recipeProducts.js';
import { validateRecipe } from './recipeData.js';

const item = { quantity: 150, unit: 'g', nutrition: { quantity: 100, unit: 'g', calories: 200, protein: 12, carbs: 20, fat: 5, fiber: null, source: { name: 'Brand yoghurt', provider: 'Open Food Facts', code: '12345678' } } };
const recipe = { title: 'Lunch', slug: 'lunch', mealType: 'Lunch', servings: 2, ingredients: [{ name: 'Yoghurt', amount: 150, unit: 'g' }], sauces: [], steps: ['Mix.'] };
test('products scale known quantities and expose missing values without discarding useful subtotals', () => {
  const result = calculateProducts([item], 2);
  assert.equal(result.total.calories, 300);
  assert.equal(result.perServing.protein, 9);
  assert.equal(result.perServing.fiber, null);
  const partial = calculateProducts([item, null], 2);
  assert.equal(partial.total.calories, 300);
  assert.equal(partial.perServing.calories, 150);
  assert.equal(partial.missing.calories, 1);
  assert.equal(partial.known.calories, 1);
  assert.equal(calculateProducts([item], 0).perServing.calories, null);
  assert.equal(calculateProducts([{ ...item, unit: 'ml' }], 2).total.calories, null);
});
test('only compatible mass and volume amounts are prefilled', () => {
  assert.equal(initialProductAmount({ amount: 0.5, unit: 'kg' }, 'g'), 500);
  assert.equal(initialProductAmount({ amount: 2, unit: 'cups' }, 'g'), '');
  assert.equal(initialProductAmount({ amount: 150, unit: 'g' }, 'ml'), '');
});
test('recipe quantities accept explicit unit names and numeric fractions without guessing weights', () => {
  assert.equal(initialProductAmount({ amount: '150', unit: 'grams' }, 'g'), 150);
  assert.equal(initialProductAmount({ amount: '1/2', unit: 'kilograms' }, 'g'), 500);
  assert.equal(initialProductAmount({ amount: '1 1/2', unit: 'litres' }, 'ml'), 1500);
  assert.equal(initialProductAmount({ amount: 2, unit: 'whole' }, 'pieces'), 2);
  assert.equal(initialProductAmount({ amount: '2-3', unit: 'g' }, 'g'), '');
  assert.equal(initialProductAmount({ amount: '1/0', unit: 'kg' }, 'g'), '');
  assert.equal(initialProductAmount({ amount: 2, unit: 'whole' }, 'g'), '');
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
test('sauces contribute to totals and missing sauce data leaves a marked known subtotal', () => {
  const clean = validateRecipe({ ...recipe, sauces: [{ name: 'Sauce', amount: 10, unit: 'g' }] });
  const saved = validateRecipe({ ...clean, productNutrition: { basis: productBasis(clean), items: [item, null] } });
  assert.equal(saved.nutrition.calories, 150);
  assert.equal(calculateProducts(saved.productNutrition.items, saved.servings).missing.calories, 1);
});
