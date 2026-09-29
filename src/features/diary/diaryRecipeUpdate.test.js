import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDiaryRecipe, buildDiaryRecipeUpdate, recipeUpdateRows, suggestedDiaryRecipe } from './diaryRecipeUpdate.js';
import { foodItem } from './diaryData.js';
import { applyFoodCatalogToRecipes } from '../nutrition/foodCatalog.js';

const recipe = { ...JSON.parse(readFileSync(new URL('../../../public/recipes/greek-yogurt-oats.json', import.meta.url))), updatedAt: '2026-09-29T00:00:00Z' };
const item = foodItem({ quantity: 100, unit: 'g', calories: 100, protein: 8, source: { provider: 'Recipe ingredient', name: recipe.title } }, 'New yogurt');
const meal = { items: [item] };

test('new diary recipes preserve quantities, divide nutrition by servings and avoid existing slugs', () => {
  const original = structuredClone(meal);
  const saved = buildDiaryRecipe(meal, [{ slug: 'my-meal' }], { title: 'My meal', servings: 2, steps: 'Mix.\nServe.' });
  assert.equal(saved.slug, 'my-meal-2');
  assert.equal(saved.ingredients[0].amount, 100);
  assert.equal(saved.nutrition.protein, 4);
  assert.equal(saved.nutrition.calories, 50);
  assert.deepEqual(saved.steps, ['Mix.', 'Serve.']);
  assert.deepEqual(meal, original);
  assert.throws(() => buildDiaryRecipe(meal, [], { title: 'Meal', servings: 0, steps: 'Mix.' }), /positive/);
  assert.throws(() => buildDiaryRecipe(meal, [], { title: 'Meal', servings: 1, steps: '' }), /non-empty/);
});

test('recipe updates are opt-in, append selected foods and use whole-recipe quantities', () => {
  const rows = recipeUpdateRows(meal, recipe);
  assert.equal(rows[0].selected, false);
  assert.equal(suggestedDiaryRecipe(meal, [recipe]), recipe.slug);
  assert.throws(() => buildDiaryRecipeUpdate(recipe, meal, rows), /Select at least/);
  const saved = buildDiaryRecipeUpdate(recipe, meal, [{ ...rows[0], selected: true, amount: 300 }]);
  assert.equal(saved.ingredients.length, recipe.ingredients.length + 1);
  assert.equal(saved.ingredients.at(-1).nutrition.calories, 300);
  assert.equal(saved.ingredients.at(-1).nutrition.protein, 24);
  assert.equal(saved.ingredients.at(-1).nutritionLabel.quantity, 100);
  assert.equal(recipe.ingredients.some(value => value.name === item.name), false);
});

test('matching ingredients update without duplication and unselected foods stay unchanged', () => {
  const matching = { ...item, name: recipe.ingredients[0].name };
  const entry = { items: [matching] };
  const row = recipeUpdateRows(entry, recipe)[0];
  assert.equal(row.amount, recipe.ingredients[0].amount);
  const saved = buildDiaryRecipeUpdate(recipe, entry, [{ ...row, selected: true, amount: 200, unit: 'g' }]);
  assert.equal(saved.ingredients.length, recipe.ingredients.length);
  assert.equal(saved.ingredients[0].nutrition.protein, 16);
  assert.deepEqual(saved.ingredients[1].name, recipe.ingredients[1].name);
});

test('recipe-only labels survive shared catalog reloads; sharing opts back into shared values', () => {
  const row = { ...recipeUpdateRows(meal, recipe)[0], selected: true };
  const catalog = [{ name: item.name, quantity: 100, unit: 'g', nutrition: { protein: 99 }, source: {} }];
  const saved = buildDiaryRecipeUpdate(recipe, meal, [row]);
  assert.equal(applyFoodCatalogToRecipes([saved], catalog)[0].ingredients.at(-1).nutrition.protein, 8);
  const shared = buildDiaryRecipeUpdate(recipe, meal, [row], true);
  assert.equal(applyFoodCatalogToRecipes([shared], catalog)[0].ingredients.at(-1).nutrition.protein, 99);
});

test('ambiguous duplicate foods and incompatible units cannot silently corrupt a recipe', () => {
  const row = { ...recipeUpdateRows(meal, recipe)[0], selected: true };
  assert.throws(() => buildDiaryRecipeUpdate(recipe, meal, [{ ...row, unit: 'ml' }]), /compatible/);
  assert.throws(() => buildDiaryRecipeUpdate(recipe, meal, [row, row]), /only one/);
  assert.equal(recipeUpdateRows({ items: [{ ...item, source: { provider: 'Recipe' } }] }, recipe).length, 0);
});
