import test from 'node:test';
import assert from 'node:assert/strict';
import { linkRecipeInventory, reconcileInventory } from './inventory.js';
import { foodItem, recipeItems, validateDay } from '../diary/diaryData.js';
import { validateRecipe } from '../recipes/recipeData.js';
const stock = () => ({ items: [{ id: 'chicken', name: 'Chicken', quantity: 1000, unit: 'g' }], settings: {}, shopping: [] });
const recipe = (slug = 'chicken-rice') => validateRecipe({ slug, title: slug, mealType: 'Lunch', servings: 2, ingredients: [{ name: 'Chicken', amount: 300, unit: 'g', nutrition: { calories: 330, protein: 60, salt: 1, sugars: 2 } }], steps: ['Cook'], nutritionFromIngredients: true });
const day = items => ({ date: '2026-09-29', meals: [{ id: 'meal', meal: 'Lunch', title: 'Lunch', items }], skipped: [], complete: false });
const quantity = state => state.items.find(item => item.id === 'chicken').quantity;

test('recipe log, repeated save, quantity edit, reload and delete reconcile exact stock deltas', () => {
  const r = recipe(); const items = recipeItems(r); const first = validateDay(day(items), '2026-09-30');
  let state = linkRecipeInventory(stock(), [r]);
  state = reconcileInventory(state, null, first).state;
  assert.equal(quantity(state), 850);
  state = reconcileInventory(JSON.parse(JSON.stringify(state)), first, first).state;
  assert.equal(quantity(state), 850);
  const edited = structuredClone(first); edited.meals[0].items[0].quantity = 200;
  const result = reconcileInventory(state, first, edited); state = result.state;
  assert.equal(quantity(state), 800); assert.equal(result.adjustments[0].amount, 50);
  assert.equal(quantity(reconcileInventory(state, edited, null).state), 1000);
});

test('shared ingredients use one stock ID; renames and recipe edits preserve existing snapshots', () => {
  const a = recipe(), b = recipe('another');
  let state = linkRecipeInventory(stock(), [a, b]);
  assert.equal(state.items.length, 1);
  const first = day(recipeItems(a)); state = reconcileInventory(state, null, first).state;
  const renamed = structuredClone(a); renamed.title = 'Renamed'; renamed.ingredients[0].name = 'Chicken breast'; renamed.ingredients[0].amount = 900;
  state = linkRecipeInventory(state, [renamed, b], [first]);
  assert.equal(state.items.length, 1); assert.equal(quantity(state), 850);
  assert.equal(quantity(reconcileInventory(state, first, null).state), 1000);
});

test('unused ingredients activate on consumption without duplicates', () => {
  const r = recipe(); r.ingredients.push({ id: 'pasta', name: 'Pasta', amount: 200, unit: 'g', nutrition: {} });
  let state = linkRecipeInventory(stock(), [r]);
  assert.equal(state.items.find(item=>item.name==='Pasta').recipeOnly, true);
  state = reconcileInventory(state, null, day(recipeItems(r))).state;
  assert.equal(state.items.find(item=>item.name==='Pasta').recipeOnly, false);
  assert.equal(state.items.length, 2);
});

test('paused logging is not caught up or falsely restored; later changes deduct only their delta', () => {
  const first = day(recipeItems(recipe())); let state = stock(); state.settings.stockTrackingPaused = true;
  state = reconcileInventory(state, null, first).state; assert.equal(quantity(state), 1000);
  state.settings.stockTrackingPaused = false;
  assert.equal(quantity(reconcileInventory(state, first, null).state), 1000);
  const edited = structuredClone(first); edited.meals[0].items[0].quantity = 200;
  state = reconcileInventory(state, first, edited).state; assert.equal(quantity(state), 950);
  assert.equal(quantity(reconcileInventory(state, edited, null).state), 1000);
});

test('historical entries never backfill deductions or refund stock that was not tracked', () => {
  const first = day([foodItem({quantity:100, unit:'g'}, 'Chicken')]);
  assert.equal(quantity(reconcileInventory(stock(), first, first).state), 1000);
  assert.equal(quantity(reconcileInventory(stock(), first, null).state), 1000);
});

test('per-item pause skips only that food, survives reload, and never catches up paused logs', () => {
  const initial = stock();
  initial.items[0].stockTrackingPaused = true;
  initial.items.push({ id: 'rice', name: 'Rice', quantity: 500, unit: 'g' });
  const first = day([foodItem({ quantity: 100, unit: 'g' }, 'Chicken'), foodItem({ quantity: 50, unit: 'g' }, 'Rice')]);
  let state = reconcileInventory(initial, null, first).state;
  assert.equal(quantity(state), 1000);
  assert.equal(state.items.find(item => item.id === 'rice').quantity, 450);
  state = JSON.parse(JSON.stringify(state));
  assert.equal(state.items[0].stockTrackingPaused, true);
  state.items[0].stockTrackingPaused = false;
  state = reconcileInventory(state, first, first).state;
  assert.equal(quantity(state), 1000);
  const edited = structuredClone(first);
  edited.meals[0].items[0].quantity = 150;
  state = reconcileInventory(state, first, edited).state;
  assert.equal(quantity(state), 950);
  state = reconcileInventory(state, edited, null).state;
  assert.equal(quantity(state), 1000);
  assert.equal(state.items.find(item => item.id === 'rice').quantity, 500);
});

test('item pause freezes edits and deletions; global pause overrides item tracking', () => {
  const first = day([foodItem({ quantity: 100, unit: 'g' }, 'Chicken')]);
  let state = reconcileInventory(stock(), null, first).state;
  state.items[0].stockTrackingPaused = true;
  const edited = structuredClone(first);
  edited.meals[0].items[0].quantity = 200;
  state = reconcileInventory(state, first, edited).state;
  assert.equal(quantity(state), 900);
  assert.equal(quantity(reconcileInventory(state, edited, null).state), 900);
  state.items[0].stockTrackingPaused = false;
  state.settings.stockTrackingPaused = true;
  const another = day([foodItem({ quantity: 50, unit: 'g' }, 'Chicken')]);
  assert.equal(quantity(reconcileInventory(state, null, another).state), 900);
  state.settings.stockTrackingPaused = false;
  assert.equal(quantity(reconcileInventory(state, null, another).state), 850);
});

test('shortages remain reversible, unset stock stays unset, copies are separate consumption', () => {
  const first = day(recipeItems(recipe())); const initial = stock(); initial.items[0].quantity = 20;
  const result = reconcileInventory(initial, null, first);
  assert.equal(quantity(result.state), -130);
  assert.equal(quantity(reconcileInventory(result.state, first, null).state), 20);
  initial.items[0].quantity = null;
  assert.equal(quantity(reconcileInventory(initial, null, first).state), null);
  const second = structuredClone(first); second.meals[0].items.push({...second.meals[0].items[0], id:'copy'});
  assert.equal(quantity(reconcileInventory(stock(), null, second).state), 700);
});

test('whole recipes, kg ingredients and changed piece weights use physical amounts', () => {
  const r = recipe(); r.ingredients[0].amount = 0.3; r.ingredients[0].unit = 'kg';
  const first = day(recipeItems(r)); assert.equal(first.meals[0].items[0].quantity, 150);
  assert.equal(quantity(reconcileInventory(stock(), null, first).state), 850);
  r.nutritionFromIngredients = false;
  const whole = day(recipeItems(r, 2)); assert.equal(quantity(reconcileInventory(stock(), null, whole).state), 700);
  const pieces = day([foodItem({quantity:100, unit:'g'}, 'Chicken')]);
  pieces.meals[0].items[0] = {...pieces.meals[0].items[0], quantity:2, unit:'pieces', perPiece:75};
  assert.equal(quantity(reconcileInventory(stock(), null, pieces).state), 850);
});

test('changing an ingredient link affects future logs, never previously resolved stock', () => {
  const r = recipe(); let state = stock(); state.items.push({ id: 'other', name: 'Other chicken', quantity: 500, unit: 'g' });
  state = linkRecipeInventory(state, [r]); const first = day(recipeItems(r));
  state = reconcileInventory(state, null, first).state;
  assert.equal(first.meals[0].items[0].inventoryUsage[0].itemId, 'chicken');
  state.ingredientLinks[first.meals[0].items[0].inventoryUsage[0].key] = 'other';
  state = reconcileInventory(state, first, null).state;
  assert.equal(quantity(state), 1000); assert.equal(state.items.find(item=>item.id==='other').quantity,500);
  state = reconcileInventory(state, null, day(recipeItems(r))).state;
  assert.equal(quantity(state),1000); assert.equal(state.items.find(item=>item.id==='other').quantity,350);
});

test('recipe pieces with a confirmed edible weight deduct matching grams', () => {
  const r = validateRecipe({ title: 'Egg meal', mealType: 'Lunch', servings: 1, steps: ['Serve'], nutritionFromIngredients: true,
    ingredients: [{name:'Chicken',amount:2,unit:'pieces',nutritionLabel:{quantity:100,unit:'g',calories:100,amountPerUnit:75,recipeUnit:'pieces'}}] });
  const first=day(recipeItems(r));
  assert.equal(quantity(reconcileInventory(stock(),null,first).state),850);
});

test('shared product barcodes link differently named ingredients to the same stock record', () => {
  const a=recipe(), b=recipe('second');
  a.ingredients[0].nutritionLabel={quantity:100,unit:'g',source:{code:'12345678'}};
  b.ingredients[0].nutritionLabel={quantity:100,unit:'g',source:{code:'12345678'}};
  b.ingredients[0].name='Packaged chicken';
  const empty={items:[],settings:{},shopping:[]};
  const state=linkRecipeInventory(empty,[a,b]);
  assert.equal(state.items.length,1);
  assert.equal(new Set(Object.values(state.ingredientLinks)).size,1);
});
