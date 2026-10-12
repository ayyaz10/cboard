import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRecipeIngredient, normalizeRecipeUnit, parseIngredientText, RECIPE_INGREDIENT_UNITS } from './recipeIngredient.js';

test('parses common metric and cooking units including no space before unit', () => {
  const cases = [
    ['500g boneless skinless chicken thighs', 500, 'g', 'Boneless skinless chicken thighs'],
    ['500 g boneless skinless chicken thighs', 500, 'g', 'Boneless skinless chicken thighs'],
    ['2 tablespoons yogurt', 2, 'tbsp', 'Yogurt'],
    ['1 teaspoon salt', 1, 'tsp', 'Salt'],
    ['500 grams chicken', 500, 'g', 'Chicken'],
    ['150ml skimmed milk', 150, 'ml', 'Skimmed milk'],
    ['30g cheese', 30, 'g', 'Cheese'],
  ];
  for (const [text, amount, unit, name] of cases) assert.deepEqual(
    (({ amount, unit, name }) => [amount, unit, name])(parseIngredientText(text)), [amount, unit, name], text,
  );
});

test('parses fractions, mixed values and context without changing ingredient identity', () => {
  assert.deepEqual(((item) => [item.amount, item.unit, item.name])(parseIngredientText('1/2 tbsp paprika')), [0.5, 'tbsp', 'Paprika']);
  assert.deepEqual(((item) => [item.amount, item.unit, item.name])(parseIngredientText('1/3 tsp cumin')), [1 / 3, 'tsp', 'Cumin']);
  assert.equal(parseIngredientText('1 1/2 cup flour').amount, 1.5);
  assert.deepEqual(((item) => [item.amount, item.unit, item.name, item.group])(parseIngredientText('1 tsp salt (for chicken)')), [1, 'tsp', 'Salt', 'Chicken']);
  assert.deepEqual(((item) => [item.amount, item.unit, item.name, item.group])(parseIngredientText('1/4 tsp salt (for sauce)')), [0.25, 'tsp', 'Salt', 'Sauce']);
  assert.deepEqual(((item) => [item.amount, item.unit, item.name, item.note])(parseIngredientText('coriander for garnish')), [null, '', 'Coriander', 'garnish']);
  assert.equal(parseIngredientText('1/2 tbsp paprika, finely chopped').preparation, 'finely chopped');
});

test('keeps percentages and numeric brand names intact while parsing measured numeric food names', () => {
  for (const name of ['0% Greek Yogurt', '2% Milk', '5 Spice', '7UP']) {
    const parsed = parseIngredientText(name);
    assert.equal(parsed.name, name);
    assert.equal(parsed.amount, null);
  }
  assert.deepEqual(((item) => [item.amount, item.unit, item.name])(parseIngredientText('30g 100% Peanut Butter')), [30, 'g', '100% Peanut Butter']);
});

test('normalization repairs legacy names while explicit structured values take precedence', () => {
  assert.deepEqual(((item) => [item.name, item.amount, item.unit])(normalizeRecipeIngredient({ name: '2 tbsp yogurt', amount: null, unit: '' })), ['Yogurt', 2, 'tbsp']);
  assert.deepEqual(((item) => [item.name, item.amount, item.unit])(normalizeRecipeIngredient({ name: '2 tbsp yogurt', amount: 3, unit: 'tablespoons' })), ['Yogurt', 3, 'tbsp']);
  assert.deepEqual(((item) => [item.name, item.amount, item.unit])(normalizeRecipeIngredient({ name: 'Yogurt', amount: 2, unit: 'tbsp' })), ['Yogurt', 2, 'tbsp']);
  assert.equal(normalizeRecipeUnit('milliliters'), 'ml');
  assert.ok(RECIPE_INGREDIENT_UNITS.some(unit => unit.id === 'tbsp' && unit.dimension === 'volume'));
});
