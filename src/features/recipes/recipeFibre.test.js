import test from 'node:test';
import assert from 'node:assert/strict';
import { fibreBasis, fibreTotal, groceryFibre } from './recipeFibre.js';
import { validateRecipe } from './recipeData.js';
import { calculateMealPlan } from './mealPlanData.js';
const recipe = { title: 'Oats', slug: 'oats', mealType: 'Breakfast', servings: 2, ingredients: [{ name: 'Oats', amount: 0.1, unit: 'kg' }], steps: ['Cook.'], nutrition: { calories: 300 } };
const groceries = { items: [{ name: 'Oats', nutrition: { quantity: 100, unit: 'g', fiber: 10 } }] };

test('grocery fibre converts label quantities and explicitly distinguishes whole recipe and serving', () => {
  const rows = groceryFibre(recipe, groceries);
  assert.equal(rows[0].fiberGrams, 10);
  assert.equal(fibreTotal(rows, 2, 'serving'), 5);
  assert.equal(fibreTotal(rows, 2, 'recipe'), 10);
  assert.equal(fibreTotal(rows, 0, 'serving'), null);
  assert.equal(fibreTotal(rows, 2, ''), null);
});
test('missing, ambiguous and incompatible quantities never become a complete fibre total', () => {
  for (const altered of [
    { ...recipe, ingredients: [{ name: 'Oats', amount: 1, unit: 'cups' }] },
    { ...recipe, ingredients: [{ name: 'Oats', amount: null, unit: 'g' }] },
    { ...recipe, ingredients: [{ name: 'Oats', amount: 100, unit: 'g', note: 'optional' }] },
    { ...recipe, sauces: [{ name: 'Unknown sauce', amount: 10, unit: 'g' }] },
  ]) assert.equal(fibreTotal(groceryFibre(altered, groceries), 1, 'recipe'), null);
  assert.equal(fibreTotal(groceryFibre(recipe, { items: [] }), 1, 'recipe'), null);
  assert.equal(fibreTotal([{ fiberGrams: 0 }], 1, 'recipe'), 0);
});
test('saved estimates feed planner totals, preserve other nutrition, and invalidate after ingredient changes', () => {
  const clean = validateRecipe(recipe);
  const saved = validateRecipe({ ...clean, nutrition: { ...clean.nutrition, fiber: 5 }, fibreSource: { type: 'groceries', value: 5, basis: 'serving', servings: 2, ingredients: fibreBasis(clean) } });
  assert.equal(saved.nutrition.calories, 300);
  assert.equal(saved.fibreSource.type, 'groceries');
  assert.equal(calculateMealPlan([{ slug: 'oats', portions: 2 }], [saved]).totals.fiber.value, 10);
  const edited = validateRecipe({ ...saved, ingredients: [{ name: 'Oats', amount: 200, unit: 'g' }] });
  assert.equal(edited.nutrition.fiber, null);
  assert.equal(edited.fibreSource, undefined);
  const manual = validateRecipe({ ...saved, nutrition: { ...saved.nutrition, fiber: 7 } });
  assert.equal(manual.nutrition.fiber, 7);
  assert.equal(manual.fibreSource, undefined);
});
