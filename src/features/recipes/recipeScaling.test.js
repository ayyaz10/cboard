import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRecipe } from './recipeData.js';
import { recipeScaleMetadata, scaleRecipe } from './recipeScaling.js';

const makeRecipe = () => validateRecipe({
  title: 'Chicken bowl', mealType: 'Lunch', servings: 2, nutritionFromIngredients: true,
  ingredients: [
    { id: 'chicken', name: 'Chicken', amount: 1000, unit: 'g', nutrition: { calories: 2000, protein: 100 } },
    { id: 'yogurt', name: 'Yogurt', amount: 200, unit: 'g', nutrition: { calories: 300, protein: 20 } },
    { id: 'oil', name: 'Oil', amount: 30, unit: 'ml', nutrition: { calories: 270, fat: 30 } },
    { id: 'salt', name: 'Salt', amount: 5, unit: 'g', scaleEnabled: false, nutrition: { sodium: 1900 } },
    { id: 'pepper', name: 'Pepper', amount: 'to taste', unit: '', nutrition: { calories: 0 } },
  ], steps: ['Cook.'],
});

const anchored = () => {
  const recipe = makeRecipe();
  return validateRecipe({ ...recipe, scaling: recipeScaleMetadata(recipe, 'chicken') });
};

test('arbitrary anchor quantities scale from the saved base, preserve fixed and unquantified ingredients, and recalculate nutrition', () => {
  const recipe = anchored();
  const half = scaleRecipe(recipe, 500).recipe;
  assert.deepEqual(half.ingredients.map(item => item.amount), [500, 100, 15, 5, 'to taste']);
  assert.equal(half.ingredients[1].nutrition.calories, 150);
  assert.equal(half.nutrition.calories, (1000 + 150 + 135) / 2);
  const thirtyPercent = scaleRecipe(recipe, 300).recipe;
  assert.deepEqual(thirtyPercent.ingredients.map(item => item.amount), [300, 60, 9, 5, 'to taste']);
});

test('scaling repeatedly always uses base amounts instead of previously rounded values', () => {
  const recipe = anchored();
  const original = structuredClone(recipe);
  scaleRecipe(recipe, 500); // A live preview is a pure calculation until applied by the editor.
  assert.deepEqual(recipe, original);
  const viaHalf = scaleRecipe(scaleRecipe(recipe, 500).recipe, 300).recipe;
  const direct = scaleRecipe(recipe, 300).recipe;
  assert.deepEqual(viaHalf.ingredients.map(item => item.amount), direct.ingredients.map(item => item.amount));
});

test('zero targets recalculate scalable nutrition to zero', () => {
  const zero = scaleRecipe(anchored(), 0).recipe;
  assert.deepEqual(zero.ingredients.map(item => item.amount), [0, 0, 0, 5, 'to taste']);
  assert.equal(zero.ingredients[1].nutrition.calories, 0);
});

test('manual recipe nutrition is preserved and scaled only when all ingredient amounts scale', () => {
  const recipe = validateRecipe({ title: 'Simple', mealType: 'Lunch', servings: 2, nutrition: { calories: 800, protein: 20 }, ingredients: [
    { id: 'main', name: 'Rice', amount: 400, unit: 'g' }, { id: 'water', name: 'Water', amount: 600, unit: 'ml' },
  ], steps: ['Cook.'] });
  const scaled = scaleRecipe(validateRecipe({ ...recipe, scaling: recipeScaleMetadata(recipe, 'main') }), 200);
  assert.equal(scaled.recipe.nutrition.calories, 400);
  assert.equal(scaled.recipe.nutritionFromIngredients, undefined);
  const fixed = validateRecipe({ ...recipe, ingredients: recipe.ingredients.map((item, index) => index ? { ...item, scaleEnabled: false } : item), scaling: recipeScaleMetadata(recipe, 'main') });
  const unchanged = scaleRecipe(fixed, 200);
  assert.equal(unchanged.recipe.nutrition.calories, 800);
  assert.equal(unchanged.warnings.length, 1);
});

test('same canonical food usages scale independently and retain per-row fixed settings and context', () => {
  const recipe = validateRecipe({ title: 'Seasoned chicken', mealType: 'Dinner', servings: 2, ingredients: [
    { id: 'chicken', name: 'Chicken', amount: 500, unit: 'g' },
    { id: 'salt-marinade', name: 'Salt', foodId: 'salt', amount: 1, unit: 'tsp', group: 'Marinade' },
    { id: 'salt-sauce', name: 'Salt', foodId: 'salt', amount: 0.25, unit: 'tsp', group: 'Sauce', scaleEnabled: false },
  ], steps: ['Cook.'] });
  const anchoredRecipe = validateRecipe({ ...recipe, scaling: recipeScaleMetadata(recipe, 'chicken') });
  const scaled = scaleRecipe(anchoredRecipe, 250).recipe;
  assert.deepEqual(scaled.ingredients.map(item => [item.id, item.foodId, item.amount, item.group, item.scaleEnabled]), [
    ['chicken', undefined, 250, undefined, undefined],
    ['salt-marinade', 'salt', 0.5, 'Marinade', undefined],
    ['salt-sauce', 'salt', 0.25, 'Sauce', false],
  ]);
});

test('setting another anchor stores current amounts without changing them', () => {
  const recipe = anchored();
  const changed = validateRecipe({ ...recipe, scaling: recipeScaleMetadata(recipe, 'yogurt') });
  assert.deepEqual(changed.ingredients.map(item => item.amount), recipe.ingredients.map(item => item.amount));
  assert.equal(changed.scaling.anchorIngredientId, 'yogurt');
});

test('scaling metadata survives recipe validation for backup and restore payloads', () => {
  const recipe = anchored();
  assert.deepEqual(validateRecipe(JSON.parse(JSON.stringify(recipe))), recipe);
});

test('rejects negative target amounts and incompatible anchor unit edits', () => {
  const recipe = anchored();
  assert.throws(() => scaleRecipe(recipe, -1), /non-negative/);
  assert.throws(() => scaleRecipe({ ...recipe, ingredients: recipe.ingredients.map(item => item.id === 'chicken' ? { ...item, unit: 'ml' } : item) }, 500), /unit changed/);
  assert.throws(() => recipeScaleMetadata({ ingredients: [{ ...recipe.ingredients[0], amount: 0 }] }, 'chicken'), /positive numeric/);
});
