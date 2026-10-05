import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFoodDeletion, getFoodUsage, getOrphanFoodsAfterRecipeDelete } from './foodReferences.js';
import { applyFoodCatalogToRecipes } from './foodCatalog.js';

const foods = [
  { id: 'chicken', name: 'Chicken', quantity: 100, unit: 'g', nutrition: { calories: 165, protein: 31 } },
  { id: 'rice', name: 'Rice', quantity: 100, unit: 'g', nutrition: { calories: 130, protein: 3 } },
];
const a = { slug: 'recipe-a', title: 'Recipe A', ingredients: [{ name: 'Chicken', foodId: 'chicken', amount: 150, unit: 'g' }, { name: 'Rice', foodId: 'rice', amount: 80, unit: 'g' }] };
const b = { slug: 'recipe-b', title: 'Recipe B', ingredients: [{ name: 'Chicken', foodId: 'chicken', amount: 90, unit: 'g' }] };

test('deleting a recipe offers only foods no longer used by another recipe', () => {
  assert.deepEqual(getOrphanFoodsAfterRecipeDelete(a, foods, [a, b]).map(food => food.id), ['rice']);
});

test('recipe-only food becomes an orphan candidate and remains in catalog by default', () => {
  assert.deepEqual(getOrphanFoodsAfterRecipeDelete(a, foods, [a]).map(food => food.id), ['chicken', 'rice']);
  assert.equal(foods.length, 2);
});

test('shared master food is protected from single and bulk deletion', () => {
  assert.equal(getFoodUsage(foods[0], { catalog: foods, recipes: [a, b] }).canHardDelete, false);
  const result = classifyFoodDeletion(['chicken', 'rice'], { catalog: foods, recipes: [a, b] });
  assert.deepEqual(result.safe.map(item => item.food.id), []);
  assert.deepEqual(result.inUse.map(item => item.food.id), ['chicken', 'rice']);
});

test('bulk cleanup deletes only unused foods while retaining foods referenced by recipes', () => {
  const other = { id: 'oil', name: 'Oil', quantity: 100, unit: 'g', nutrition: {} };
  const unused = { id: 'sauce', name: 'Sauce', quantity: 100, unit: 'g', nutrition: {} };
  const result = classifyFoodDeletion(['chicken', 'oil', 'sauce'], { catalog: [...foods, other, unused], recipes: [a, b] });
  assert.deepEqual(result.safe.map(item => item.food.id), ['oil', 'sauce']);
  assert.deepEqual(result.inUse.map(item => item.food.id), ['chicken']);
});

test('current and saved meal routines protect foods used by their referenced recipe', () => {
  const routines = [{ id: 'routine', name: 'Weekdays', entries: [{ slug: 'recipe-a' }] }];
  assert.equal(getFoodUsage(foods[0], { catalog: foods, recipes: [a], mealPlans: routines }).canHardDelete, false);
  assert.equal(getOrphanFoodsAfterRecipeDelete(a, foods, [a], routines).length, 0);
});

test('a historical diary snapshot does not keep the reusable master food active', () => {
  const historical = { date: '2025-01-01', meals: [{ items: [{ foodId: 'rice', name: 'Rice', nutrition: { calories: 100 } }] }] };
  assert.equal(getFoodUsage(foods[1], { catalog: foods, recipes: [], mealPlans: [] }).canHardDelete, true);
  assert.equal(historical.meals[0].items[0].nutrition.calories, 100);
});

test('legacy name links resolve uniquely and ambiguous duplicate names are protected from deletion', () => {
  const legacy = { slug: 'legacy', title: 'Legacy', ingredients: [{ name: 'Chicken' }] };
  assert.equal(getFoodUsage(foods[0], { catalog: foods, recipes: [legacy] }).canHardDelete, false);
  const duplicateNames = [...foods, { ...foods[0], id: 'chicken-2' }];
  const ambiguousUsage = getFoodUsage(duplicateNames[0], { catalog: duplicateNames, recipes: [legacy] });
  assert.equal(ambiguousUsage.canHardDelete, false);
  assert.deepEqual(ambiguousUsage.possibleRecipes.map(recipe => recipe.slug), ['legacy']);
});

test('stale recipe food IDs resolve through a unique legacy quantity-name alias', () => {
  const spice = { id: 'spice', name: 'Coriander Powder', aliases: ['1 tbsp coriander powder'], quantity: 100, unit: 'g', nutrition: {} };
  const recipe = { slug: 'curry', title: 'Curry', ingredients: [{ name: '1 tbsp coriander powder', foodId: 'deleted-food-id' }] };
  assert.equal(getFoodUsage(spice, { catalog: [spice], recipes: [recipe] }).canHardDelete, false);
  assert.deepEqual(getOrphanFoodsAfterRecipeDelete(recipe, [spice], [recipe]).map(food => food.id), ['spice']);
});

test('master nutrition edits recalculate linked recipe totals and preserve recipe quantities', () => {
  const recipe = { ...a, servings: 1, nutritionFromIngredients: true, nutrition: {}, sauces: [], alternatives: {} };
  const updated = applyFoodCatalogToRecipes([recipe], [{ ...foods[0], nutrition: { calories: 200, protein: 35 } }, foods[1]])[0];
  assert.equal(updated.ingredients[0].amount, 150);
  assert.equal(updated.ingredients[0].nutrition.calories, 300);
  assert.equal(updated.nutrition.protein, 54.9);
});
