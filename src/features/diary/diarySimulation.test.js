import test from 'node:test';
import assert from 'node:assert/strict';
import { foodItem, newMeal, diaryTotals } from './diaryData.js';
import { simulateDiaryChanges, simulationKey } from './diarySimulation.js';

function fixture() {
  const meal = newMeal('Lunch');
  const a = foodItem({ quantity: 100, unit: 'g', calories: 100, protein: 10, carbs: 10, fat: 2, fiber: 1 }, 'Food A');
  const b = foodItem({ quantity: 100, unit: 'g', calories: 200, protein: 20, carbs: 20, fat: 10, fiber: 2 }, 'Food B');
  meal.items = [a, b];
  return { meal, a, b, meals: [meal] };
}

test('halving a source previews exact diary totals without mutating logged data', () => {
  const { meal, b, meals } = fixture();
  const original = structuredClone(meals);
  const preview = simulateDiaryChanges(meals, { [simulationKey(meal.id, b.id)]: { quantity: 50 } });
  assert.deepEqual([preview.currentTotals.calories.value, preview.currentTotals.protein.value, preview.currentTotals.carbs.value, preview.currentTotals.fat.value], [300, 30, 30, 12]);
  assert.deepEqual([preview.simulatedTotals.calories.value, preview.simulatedTotals.protein.value, preview.simulatedTotals.carbs.value, preview.simulatedTotals.fat.value], [200, 20, 20, 7]);
  assert.deepEqual(meals, original);
  assert.deepEqual(diaryTotals(meals), preview.currentTotals);
});

test('multiple overrides combine, one can reset alone, and reset all returns exact originals', () => {
  const { meal, a, b, meals } = fixture();
  const keyA = simulationKey(meal.id, a.id), keyB = simulationKey(meal.id, b.id);
  const combined = simulateDiaryChanges(meals, { [keyA]: { quantity: 50 }, [keyB]: { quantity: 150 } });
  assert.deepEqual([combined.simulatedTotals.calories.value, combined.simulatedTotals.protein.value, combined.simulatedTotals.fat.value], [350, 35, 16]);
  const resetA = simulateDiaryChanges(meals, { [keyB]: { quantity: 150 } });
  assert.deepEqual([resetA.simulatedTotals.calories.value, resetA.simulatedTotals.protein.value, resetA.simulatedTotals.fat.value], [400, 40, 17]);
  const resetAll = simulateDiaryChanges(meals, {});
  assert.deepEqual(resetAll.simulatedTotals, resetAll.currentTotals);
});

test('zero quantity previews removing a source and preserves the source meal when foods remain', () => {
  const { meal, b, meals } = fixture();
  const preview = simulateDiaryChanges(meals, { [simulationKey(meal.id, b.id)]: { quantity: 0 } });
  assert.deepEqual(preview.meals[0].items.map(item => item.name), ['Food A']);
  assert.equal(preview.simulatedTotals.calories.value, 100);
  assert.equal(meals[0].items.length, 2);
});

test('product-only override recalculates the same 30g portion across canonical nutrients', () => {
  const meal = newMeal('Lunch');
  const current = foodItem({ quantity: 100, unit: 'g', calories: 600, fat: 50, protein: 25, vitaminD: 2 }, 'Regular Peanut Butter');
  current.quantity = 30;
  meal.items = [current];
  const preview = simulateDiaryChanges([meal], { [simulationKey(meal.id, current.id)]: {
    name: 'Peanut Butter Powder', basis: 100, nutritionUnit: 'g',
    nutrition: { calories: 400, fat: 10, protein: 45, vitaminD: null },
    source: { provider: 'Manual simulation' }, productChanged: true,
  } });
  assert.deepEqual([preview.currentTotals.calories.value, preview.currentTotals.fat.value], [180, 15]);
  assert.deepEqual([preview.simulatedTotals.calories.value, preview.simulatedTotals.fat.value], [120, 3]);
  assert.equal(preview.meals[0].items[0].quantity, 30);
  assert.equal(preview.meals[0].items[0].name, 'Peanut Butter Powder');
  assert.equal(preview.simulatedTotals.vitaminD.missing, 1);
});

test('product and quantity overrides combine and do not mutate recipe snapshots', () => {
  const meal = newMeal('Lunch');
  const original = foodItem({ quantity: 100, unit: 'g', calories: 600, fat: 50 }, 'Regular Peanut Butter');
  original.quantity = 30;
  original.recipeOrigin = { slug: 'source-recipe', baseline: structuredClone(original) };
  meal.items = [original];
  const snapshot = structuredClone([meal]);
  const preview = simulateDiaryChanges([meal], { [simulationKey(meal.id, original.id)]: {
    quantity: 15, name: 'Peanut Butter Powder', basis: 100, nutritionUnit: 'g',
    nutrition: { calories: 400, fat: 10 }, productChanged: true,
  } });
  assert.deepEqual([preview.currentTotals.calories.value, preview.currentTotals.fat.value], [180, 15]);
  assert.deepEqual([preview.simulatedTotals.calories.value, preview.simulatedTotals.fat.value], [60, 1.5]);
  assert.deepEqual([meal], snapshot);
  assert.equal(preview.meals[0].items[0].recipeOrigin.slug, 'source-recipe');
  assert.equal(simulateDiaryChanges([meal], {}).simulatedTotals.calories.value, 180);
});

