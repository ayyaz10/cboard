import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findNaturalFoods, createNaturalFoodSearch, naturalPortionNutrition, nutritionForOnePortion, suggestedNaturalPortion } from './naturalFoods.js';
import { cleanIngredientLabel, ingredientLabelNutrition } from '../features/recipes/ingredientNutrition.js';
import { foodItem, itemNutrition, validateDay, emptyDay, newMeal } from '../features/diary/diaryData.js';
const catalog = JSON.parse(readFileSync(new URL('../../public/nutrition/usda-foods.json', import.meta.url)));
test('USDA search finds plain cashews and preserves preparation differences', () => {
  const rows = findNaturalFoods(catalog.foods, 'raw unsalted cashews');
  assert.ok(rows.some((food) => food.name === 'Nuts, cashew nuts, raw'));
  assert.ok(rows.every((food) => !/salt added|\bsalted\b/.test(food.name)));
  assert.equal(findNaturalFoods(catalog.foods, 'medium banana')[0].name, 'Bananas, raw');
  assert.ok(findNaturalFoods(catalog.foods, 'large apple').some((food) => food.portions.some((portion) => portion.label.startsWith('large'))));
});
test('USDA medium banana gives estimated edible weight and scales half portions, including micros', () => {
  const banana = findNaturalFoods(catalog.foods, 'medium banana')[0];
  const medium = banana.portions.find((portion) => portion.label.startsWith('medium'));
  assert.equal(medium.grams, 118);
  const nutrition = naturalPortionNutrition({ ...banana.nutrition, source: banana.source }, medium);
  const item = { name: 'Banana', amount: '1/2', unit: 'piece', nutritionLabel: cleanIngredientLabel({ ...nutrition, amountPerUnit: medium.grams, recipeUnit: 'piece' }) };
  assert.equal(ingredientLabelNutrition(item).calories, 52.51);
  assert.equal(item.nutritionLabel.source.estimatedPortion, true);
  const diaryItem = { ...foodItem(nutritionForOnePortion(nutrition)), quantity: .5 };
  assert.equal(itemNutrition(diaryItem).calories, 52.51);
  assert.equal(diaryItem.nutritionUnit, 'pieces');
  assert.ok(itemNutrition(diaryItem).potassium > 0);
  assert.equal(itemNutrition(diaryItem).salt, null);
  const day = validateDay({ ...emptyDay('2026-09-19'), meals: [{ ...newMeal(), items: [diaryItem] }] });
  assert.equal(day.meals[0].items[0].source.estimatedPortion, true);
});
test('plain eggs prefer a whole large egg and default to its edible per-egg portion', () => {
  const egg = findNaturalFoods(catalog.foods, 'egg')[0];
  assert.match(egg.name, /grade a.*large.*whole/i);
  const index = suggestedNaturalPortion(egg, 'Egg', 'eggs');
  assert.equal(egg.portions[index].label, 'whole without shell');
  assert.equal(egg.portions[index].grams, 50.3);
  const selected = naturalPortionNutrition({ ...egg.nutrition, source: egg.source }, egg.portions[index]);
  assert.equal(Number((selected.calories * selected.portion.grams / selected.quantity).toFixed(2)), 74.44);
  assert.equal(suggestedNaturalPortion(egg, 'Egg', 'g'), '');
});
test('USDA data uses canonical units and missing nutrients are not fabricated', () => {
  const banana = findNaturalFoods(catalog.foods, 'medium banana')[0];
  assert.equal(banana.nutrition.calories, 89);
  assert.equal(banana.nutrition.vitaminA, 3);
  assert.equal(banana.nutrition.vitaminC, 8.7);
  assert.equal(banana.nutrition.salt, null);
  assert.ok(catalog.foods.length > 8000);
  assert.ok(catalog.sources.every((source) => source.sha256.length === 64));
});
test('natural catalog is lazy, shared by concurrent searches and retries a failed fetch', async () => {
  let calls = 0;
  const search = createNaturalFoodSearch(async () => {
    calls++;
    if (calls === 1) return { ok: false };
    return { ok: true, json: async () => catalog };
  }, '/nutrition/usda-foods.json');
  await assert.rejects(search('banana'), /could not load/);
  const results = await Promise.all([search('banana'), search('cashew')]);
  assert.equal(calls, 2); assert.ok(results.every((rows) => rows.length));
  await assert.rejects(search('x'), /food name/);
});
