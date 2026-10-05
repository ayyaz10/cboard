import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFoodCatalogToRecipes, catalogItemFromRecipeIngredient, catalogItemsFromDiaryMeal, diaryItemFromCatalog, mergeFoodCatalog, recipeFoodName, resolveCatalogFoodForIngredient } from './foodCatalog.js';
import { productBasis } from '../recipes/recipeProducts.js';

const oats = { name: 'Oats', quantity: 100, unit: 'g', nutrition: { calories: 380, protein: 13, carbs: 68, fat: 7, fiber: 10 }, source: { provider: 'Manual' } };

test('latest edit replaces the main food record by normalized name', () => {
  const result = mergeFoodCatalog([oats], [{ ...oats, name: ' oats ', nutrition: { ...oats.nutrition, protein: 15 } }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].nutrition.protein, 15);
});

test('edited diary label becomes a reusable main food item without changing eaten quantity', () => {
  const diary = { items: [{ name: 'Oats', quantity: 60, unit: 'g', basis: 100, nutritionUnit: 'g', nutrition: oats.nutrition, source: { provider: 'Manual', modified: true } }] };
  const [main] = catalogItemsFromDiaryMeal(diary);
  const applied = diaryItemFromCatalog({ ...diary.items[0], quantity: 40 }, main);
  assert.equal(main.quantity, 100);
  assert.equal(applied.quantity, 40);
  assert.equal(applied.nutrition.protein, 13);
});

test('main food values flow into calculated recipes and planner totals', () => {
  const recipes = [{ title: 'Porridge', servings: 2, nutritionFromIngredients: true, nutrition: {}, ingredients: [{ name: 'Oats', amount: 100, unit: 'g', nutrition: {} }], sauces: [], alternatives: {} }];
  const [recipe] = applyFoodCatalogToRecipes(recipes, [oats]);
  assert.equal(recipe.ingredients[0].nutrition.protein, 13);
  assert.equal(recipe.nutrition.protein, 6.5);
});

test('catalog IDs survive renames and same-name records stay distinct', () => {
  const first = { ...oats, id: 'food-a' };
  const second = { ...oats, id: 'food-b', name: 'Oats' };
  const merged = mergeFoodCatalog([first, second], [{ ...first, name: 'Rolled oats', nutrition: { ...first.nutrition, protein: 15 } }]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find(item => item.id === 'food-a').name, 'Rolled oats');
  assert.equal(merged.find(item => item.id === 'food-b').name, 'Oats');
});

test('legacy recipe names continue linking to the same food after a rename', () => {
  const catalog = mergeFoodCatalog([{ ...oats, id: 'oats-id' }], [{ ...oats, id: 'oats-id', name: 'Rolled oats' }]);
  const [recipe] = applyFoodCatalogToRecipes([{ title: 'Porridge', ingredients: [{ name: 'Oats', amount: 40, unit: 'g', nutrition: {} }], sauces: [], alternatives: {} }], catalog);
  assert.equal(catalog[0].id, 'oats-id');
  assert.deepEqual(catalog[0].aliases, ['Oats']);
  assert.equal(recipe.ingredients[0].foodId, 'oats-id');
  assert.equal(recipe.ingredients[0].name, 'Rolled oats');
});

test('linked source nutrition scales the recipe amount, not the master basis or diary snapshot', () => {
  const recipe = { slug: 'oat-bowl', title: 'Oat bowl', servings: 1, nutritionFromIngredients: true, nutrition: {}, ingredients: [{ name: 'Oats', foodId: 'oats-id', amount: 40, unit: 'g', nutrition: {} }], sauces: [], alternatives: {} };
  const history = { date: '2026-01-01', meals: [{ items: [{ name: 'Oats', foodId: 'oats-id', quantity: 40, basis: 100, nutritionUnit: 'g', unit: 'g', nutrition: { protein: 5 }, source: { provider: 'Manual' } }] }] };
  const [recalculated] = applyFoodCatalogToRecipes([recipe], [{ ...oats, id: 'oats-id', nutrition: { ...oats.nutrition, protein: 20 } }]);
  assert.equal(recalculated.ingredients[0].amount, 40);
  assert.equal(recalculated.nutrition.protein, 8);
  assert.equal(history.meals[0].items[0].nutrition.protein, 5);
});

test('master nutrition edits also refresh linked product nutrition without changing product quantity', () => {
  const recipe = { slug: 'oat-product', title: 'Oat product', servings: 2, ingredients: [{ name: 'Oats', foodId: 'oats-id', amount: 40, unit: 'g', nutrition: {} }], sauces: [], alternatives: {} };
  recipe.productNutrition = { basis: productBasis(recipe), items: [{ quantity: 40, unit: 'g', nutrition: { ...oats.nutrition, quantity: 100, unit: 'g' } }] };
  const [updated] = applyFoodCatalogToRecipes([recipe], [{ ...oats, id: 'oats-id', nutrition: { ...oats.nutrition, protein: 20 } }]);
  assert.equal(updated.productNutrition.items[0].quantity, 40);
  assert.equal(updated.nutrition.protein, 4);
});

test('recipe quantity labels resolve to the reusable food while retaining the legacy label as an alias', () => {
  const ingredient = { name: '1 tbsp coriander powder', foodId: 'deleted-food-id', amount: 1, unit: 'tbsp', nutritionLabel: { quantity: 100, unit: 'g', calories: 300, source: { provider: 'Manual' } } };
  assert.equal(recipeFoodName(ingredient.name), 'coriander powder');
  const item = catalogItemFromRecipeIngredient(ingredient);
  assert.equal(item.name, 'coriander powder');
  assert.deepEqual(item.aliases, ['1 tbsp coriander powder']);
  const catalog = [{ id: 'coriander', name: 'Coriander Powder', aliases: ['1 tbsp coriander powder'] }];
  assert.equal(resolveCatalogFoodForIngredient(ingredient, catalog).id, 'coriander');
});

test('unknown stale recipe food IDs fall back only to a unique canonical or alias name', () => {
  const ingredient = { name: '1 tbsp coriander powder', foodId: 'removed-id' };
  const catalog = [{ id: 'coriander', name: 'Coriander Powder', aliases: ['1 tbsp coriander powder'] }];
  assert.equal(resolveCatalogFoodForIngredient(ingredient, catalog).id, 'coriander');
  assert.equal(resolveCatalogFoodForIngredient(ingredient, [...catalog, { id: 'other', name: '1 tbsp coriander powder' }]), null);
});

test('master edits relink stale recipe IDs, refresh nutrition and preserve recipe amounts', () => {
  const spice = { id: 'spice', name: 'Coriander Powder', aliases: ['1 tbsp coriander powder'], quantity: 100, unit: 'g', nutrition: { calories: 300, protein: 10 } };
  const recipe = { slug: 'curry', title: 'Curry', servings: 1, nutritionFromIngredients: true, nutrition: {}, sauces: [], alternatives: {}, ingredients: [{ name: '1 tbsp coriander powder', foodId: 'deleted-id', amount: 50, unit: 'g', nutritionLabel: { quantity: 100, unit: 'g', calories: 100, protein: 3, source: { provider: 'Manual' } } }] };
  const updated = applyFoodCatalogToRecipes([recipe], [spice])[0];
  assert.equal(updated.ingredients[0].foodId, 'spice');
  assert.equal(updated.ingredients[0].amount, 50);
  assert.equal(updated.ingredients[0].unit, 'g');
  assert.equal(updated.ingredients[0].nutritionLabel.calories, 300);
  assert.equal(updated.ingredients[0].nutrition.calories, 150);
  assert.equal(updated.nutrition.calories, 150);
});
