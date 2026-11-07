import test from 'node:test';
import assert from 'node:assert/strict';
import { diaryTotals, emptyDay, foodItem, newMeal } from './diaryData.js';
import { appendCopiedMeals, moveDiaryMeal, removeDiaryFood } from './diaryMutations.js';
import { newItem } from '../groceries/groceryData.js';
import { reconcileInventory } from '../groceries/inventory.js';

function chicken(quantity = 250) {
  return {
    ...foodItem({ quantity: 100, unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, source: { provider: 'Food library' } }, 'Chicken breast'),
    quantity,
    foodId: 'food-chicken',
    groceryTrackingEnabled: true,
    inventoryUsage: [{ key: 'food:food-chicken', itemId: 'stock-chicken', foodId: 'food-chicken', name: 'Chicken breast', amount: 1, unit: 'g', groceryTrackingEnabled: true }],
  };
}

test('moving a meal slot preserves IDs and daily totals; its inventory ledger sees no new consumption', () => {
  const date = '2026-11-04';
  const entry = { ...newMeal('Breakfast'), title: 'Chicken breakfast', items: [chicken()] };
  const before = { ...emptyDay(date), meals: [entry] };
  const moved = moveDiaryMeal(before, entry.id, 'Lunch');
  assert.equal(moved.meals[0].id, entry.id);
  assert.equal(moved.meals[0].items[0].id, entry.items[0].id);
  assert.equal(moved.meals[0].meal, 'Lunch');
  assert.deepEqual(diaryTotals(before.meals), diaryTotals(moved.meals));

  const stock = newItem('Chicken breast', 1000, 'g');
  stock.id = 'stock-chicken';
  stock.foodId = 'food-chicken';
  const initial = { items: [stock], settings: { stockTrackingPaused: false } };
  const consumed = reconcileInventory(initial, null, before, [{ id: 'food-chicken', name: 'Chicken breast', groceryTrackingEnabled: true }]);
  assert.equal(consumed.state.items[0].quantity, 750);
  const afterMove = reconcileInventory(consumed.state, before, moved, [{ id: 'food-chicken', name: 'Chicken breast', groceryTrackingEnabled: true }]);
  assert.equal(afterMove.state.items[0].quantity, 750);
  assert.deepEqual(afterMove.adjustments, []);
});

test('editing quantity from 250g to 200g refunds only the 50g delta; deleting restores the recorded use', () => {
  const date = '2026-11-04';
  const entry = { ...newMeal('Lunch'), title: 'Lunch', items: [chicken(250)] };
  const before = { ...emptyDay(date), meals: [entry] };
  const edited = { ...before, meals: [{ ...entry, items: [{ ...entry.items[0], quantity: 200 }] }] };
  const stock = newItem('Chicken breast', 1000, 'g');
  stock.id = 'stock-chicken';
  stock.foodId = 'food-chicken';
  const catalog = [{ id: 'food-chicken', name: 'Chicken breast', groceryTrackingEnabled: true }];
  const consumed = reconcileInventory({ items: [stock] }, null, before, catalog);
  assert.equal(consumed.state.items[0].quantity, 750);
  const adjusted = reconcileInventory(consumed.state, before, edited, catalog);
  assert.equal(adjusted.state.items[0].quantity, 800);
  assert.deepEqual(adjusted.adjustments.map(({ amount }) => amount), [-50]);
  const deleted = removeDiaryFood(edited, entry.id, entry.items[0].id);
  assert.equal(deleted.meals.length, 0);
  assert.equal(diaryTotals(deleted.meals).calories.known, 0);
  const restored = reconcileInventory(adjusted.state, edited, deleted, catalog);
  assert.equal(restored.state.items[0].quantity, 1000);
  assert.deepEqual(restored.adjustments.map(({ amount }) => amount), [-200]);
});

test('copying a meal adds one independent entry and preserves unknown nutrients', () => {
  const source = { ...newMeal('Breakfast'), title: 'Usual breakfast', items: [chicken(80), foodItem({ quantity: 1, unit: 'servings' }, 'Unknown tea')] };
  const day = { ...emptyDay('2026-11-04'), meals: [] };
  const copied = appendCopiedMeals(day, [source]);
  assert.equal(copied.meals.length, 1);
  assert.notEqual(copied.meals[0].id, source.id);
  assert.equal(copied.meals[0].items.length, 2);
  assert.notEqual(copied.meals[0].items[0].id, source.items[0].id);
  assert.deepEqual(diaryTotals(copied.meals).calories, { value: 132, known: 1, missing: 1 });
});
