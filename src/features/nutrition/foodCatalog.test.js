import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFoodCatalogToRecipes, catalogItemsFromDiaryMeal, diaryItemFromCatalog, mergeFoodCatalog } from './foodCatalog.js';

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
