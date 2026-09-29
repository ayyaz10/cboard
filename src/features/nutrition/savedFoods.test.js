import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSavedFoods, findSavedFoods, applySavedGrocery, matchSavedGrocery, groceryCatalogUpdates } from './savedFoods.js';
import { parseEntry, addItems, initialState } from '../groceries/groceryData.js';

const label = { quantity: 100, unit: 'g', calories: 59, protein: 10, calcium: 110, source: { provider: 'Label', code: '12345678' } };
const ingredient = { name: 'Brooklea Fat Free Yogurt', amount: 150, unit: 'g', nutritionLabel: label };
const recipe = { title: 'Breakfast', ingredients: [ingredient], sauces: [] };

test('recipe search transfers full label nutrition without using recipe portion totals', () => {
  const library = buildSavedFoods([recipe]);
  const match = findSavedFoods(library, 'Brooklea Fat')[0];
  const grocery = applySavedGrocery(parseEntry('500 g Brooklea Fat'), match.item);
  assert.equal(grocery.name, ingredient.name);
  assert.equal(grocery.quantity, 500);
  assert.equal(grocery.nutrition.quantity, 100);
  assert.equal(grocery.nutrition.calcium, 110);
  assert.equal(grocery.nutrition.sodium, null);
  assert.equal(grocery.nutrition.source.code, '12345678');
  assert.equal(addItems(initialState(), [grocery]).items.at(-1).nutrition.protein, 10);
});

test('main food record overrides stale recipe and diary labels', () => {
  const catalog = [{ name: ingredient.name, quantity: 100, unit: 'g', nutrition: { ...label, protein: 12 }, source: {} }];
  const days = [{ date: '2026-09-28', meals: [{ items: [{ name: ingredient.name, basis: 100, nutritionUnit: 'g', nutrition: { protein: 5 } }] }] }];
  const library = buildSavedFoods([recipe], days, catalog);
  assert.equal(library.length, 1);
  assert.equal(matchSavedGrocery(parseEntry(ingredient.name), library).nutrition.protein, 12);
});

test('confirmed recipe product labels and alternatives are searchable', () => {
  const library = buildSavedFoods([{ ...recipe, ingredients: [{ ...ingredient, nutritionLabel: undefined }], productNutrition: { items: [{ quantity: 150, unit: 'g', nutrition: label }] }, alternatives: { dairy: { options: [{ name: 'Soy yogurt', amount: 100, unit: 'g', nutritionLabel: label }] } } }]);
  assert.equal(findSavedFoods(library, 'brooklea')[0].item.nutrition.calcium, 110);
  assert.equal(findSavedFoods(library, 'soy')[0].item.nutrition.protein, 10);
});

test('ambiguous historical labels require selection and explicit stock units stay intact', () => {
  const library = buildSavedFoods([recipe, { ...recipe, ingredients: [{ ...ingredient, nutritionLabel: { ...label, calories: 70 } }] }]);
  const current = parseEntry(`2 packs ${ingredient.name}`);
  assert.equal(matchSavedGrocery(current, library).nutrition, null);
  assert.equal(applySavedGrocery(current, library[0].item).unit, 'packs');
  assert.equal(applySavedGrocery(parseEntry(ingredient.name), library[0].item).unit, 'g');
});

test('only changed grocery nutrition is published, preserving unrelated shared records', () => {
  const grocery = applySavedGrocery(parseEntry(ingredient.name), buildSavedFoods([recipe])[0].item);
  const before = { items: [grocery], shopping: [] };
  assert.equal(groceryCatalogUpdates(before, { items: [{ ...grocery, quantity: 500 }], shopping: [] }).length, 0);
  const updates = groceryCatalogUpdates({ items: [] }, before);
  assert.equal(updates[0].nutrition.calcium, 110);
  assert.equal(updates[0].quantity, 100);
});
