import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDiaryCatalogItems } from './diaryCatalog.js';

test('ambiguous diary food stays in the diary for review instead of blocking the save', () => {
  const meal = { id: 'meal', items: [{ id: 'chicken', name: 'Chicken', quantity: 120 }] };
  const catalog = [{ id: 'chicken-thighs', name: 'Boneless skinless chicken thighs', quantity: 100, unit: 'g' }];
  const result = prepareDiaryCatalogItems([meal], catalog);
  assert.deepEqual(result.reviewFoods, ['Chicken']);
  assert.deepEqual(result.newFoods, []);
  assert.equal(result.meals[0].items[0].foodId, undefined);
  assert.equal(result.meals[0].items[0].name, 'Chicken');
});

test('unambiguous existing and new diary foods link or enter the catalog normally', () => {
  const meals = [{ id: 'meal', items: [{ id: 'oats', name: 'Oats' }, { id: 'pear', name: 'Pear' }] }];
  const result = prepareDiaryCatalogItems(meals, [{ id: 'oats-id', name: 'Oats', groceryTrackingEnabled: false }]);
  assert.equal(result.meals[0].items[0].foodId, 'oats-id');
  assert.equal(result.meals[0].items[0].groceryTrackingEnabled, false);
  assert.deepEqual(result.newFoods.map(item => item.name), ['Pear']);
  assert.deepEqual(result.reviewFoods, []);
});
