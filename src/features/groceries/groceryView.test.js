import test from 'node:test';
import assert from 'node:assert/strict';
import { filterGroceryItems, isGroceryCategoryExpanded, summarizeCategoryStock } from './groceryView.js';

const items = [
  { id: 'milk', name: 'Milk', category: 'Dairy', quantity: 0, threshold: 1, recipeRefs: [{ title: 'Oats' }] },
  { id: 'apple', name: 'Apple', category: 'Fruit', quantity: 2, stockBaseline: { quantity: 5, unit: 'g' }, threshold: 3, unit: 'g', tags: ['snack'] },
  { id: 'rice', name: 'Rice', category: 'Grains', quantity: null },
  { id: 'tea', name: 'Tea', category: 'Pantry', brand: 'North Star', quantity: 4, stockBaseline: { quantity: 4, unit: 'g' }, unit: 'g' },
];

test('grocery search includes category, brand, tags, and recipe usage', () => {
  assert.deepEqual(filterGroceryItems(items, { query: 'north star' }).map(item => item.id), ['tea']);
  assert.deepEqual(filterGroceryItems(items, { query: 'snack' }).map(item => item.id), ['apple']);
  assert.deepEqual(filterGroceryItems(items, { query: 'oats' }).map(item => item.id), ['milk']);
  assert.deepEqual(filterGroceryItems(items, { query: 'dairy' }).map(item => item.id), ['milk']);
});

test('stock and recipe filters select only matching inventory rows', () => {
  assert.deepEqual(filterGroceryItems(items, { status: 'Needs attention' }).map(item => item.id), ['apple', 'milk']);
  assert.deepEqual(filterGroceryItems(items, { status: 'Unknown' }).map(item => item.id), ['rice']);
  assert.deepEqual(filterGroceryItems(items, { recipeUsage: 'used' }).map(item => item.id), ['milk']);
  assert.deepEqual(filterGroceryItems(items, { recipeUsage: 'unused' }).map(item => item.id), ['apple', 'rice', 'tea']);
});

test('sorting supports name, stock priority, lowest stock, and category order', () => {
  assert.deepEqual(filterGroceryItems(items, { sort: 'name' }).map(item => item.name), ['Apple', 'Milk', 'Rice', 'Tea']);
  assert.deepEqual(filterGroceryItems(items, { sort: 'stock' }).map(item => item.id), ['milk', 'apple', 'tea', 'rice']);
  assert.deepEqual(filterGroceryItems(items, { sort: 'lowest' }).map(item => item.id), ['milk', 'apple', 'tea', 'rice']);
  assert.deepEqual(filterGroceryItems(items, { categoryNames: ['Pantry', 'Dairy', 'Fruit', 'Grains'] }).map(item => item.id), ['tea', 'milk', 'apple', 'rice']);
});

test('category summaries report out, low, in-stock, and unknown counts', () => {
  assert.deepEqual(summarizeCategoryStock(items), { count: 4, out: 1, low: 1, inStock: 1, unknown: 1 });
});

test('categories start collapsed, filters open matching groups, and user overrides stay independent', () => {
  assert.equal(isGroceryCategoryExpanded({}, 'Fruit', false), false);
  assert.equal(isGroceryCategoryExpanded({}, 'Fruit', true), true);
  assert.equal(isGroceryCategoryExpanded({ Fruit: false }, 'Fruit', true), false);
  assert.equal(isGroceryCategoryExpanded({ Fruit: true }, 'Fruit', false), true);
});

test('shopping filter matches compatible canonical inventory entries', () => {
  const list = [{ id: 'milk-list', name: 'Milk', quantity: 2, unit: 'L' }];
  assert.deepEqual(filterGroceryItems(items, { shoppingFilter: 'on', shopping: list }).map(item => item.id), []);
  const compatible = [{ id: 'milk-list', name: 'Milk', quantity: 2, unit: 'L' }];
  const inventory = [{ id: 'inventory-milk', name: 'Milk', category: 'Dairy', quantity: 1, unit: 'L' }, ...items.filter(item => item.id !== 'milk')];
  assert.deepEqual(filterGroceryItems(inventory, { shoppingFilter: 'on', shopping: compatible }).map(item => item.id), ['inventory-milk']);
  assert.ok(filterGroceryItems(inventory, { shoppingFilter: 'off', shopping: compatible }).every(item => item.id !== 'inventory-milk'));
});

test('percentage stock filters combine with search and category and sort low items first', () => {
  const rows = [
    { id: 'low-1', name: 'Rice', category: 'Grains', quantity: 20, unit: 'g', stockBaseline: { quantity: 100, unit: 'g' } },
    { id: 'low-2', name: 'Rice flour', category: 'Baking', quantity: 10, unit: 'g', stockBaseline: { quantity: 100, unit: 'g' } },
    { id: 'out', name: 'Rice milk', category: 'Dairy', quantity: 0, unit: 'ml' },
    { id: 'healthy', name: 'Oats', category: 'Grains', quantity: 45, unit: 'g', stockBaseline: { quantity: 100, unit: 'g' } },
  ];
  assert.deepEqual(filterGroceryItems(rows, { status: 'Low stock', sort: 'lowest' }).map(item => item.id), ['low-2', 'low-1']);
  assert.deepEqual(filterGroceryItems(rows, { status: 'Low stock', category: 'Baking', query: 'rice' }).map(item => item.id), ['low-2']);
  assert.deepEqual(filterGroceryItems(rows, { status: 'Out of stock' }).map(item => item.id), ['out']);
});