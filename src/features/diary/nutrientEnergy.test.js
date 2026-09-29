import test from 'node:test';
import assert from 'node:assert/strict';
import { nutrientEnergy } from './nutrientEnergy.js';

test('nutrient energy uses 4/4/9/2 factors and compares against logged food calories', () => {
  const nutrient = { total: 29, known: 1, missing: 0 };
  const logged = { total: 580, missing: 0 };
  assert.deepEqual(nutrientEnergy('protein', nutrient, logged), { factor: 4, calories: 116, percentage: 20, partial: false });
  assert.equal(nutrientEnergy('carbs', nutrient, logged).calories, 116);
  assert.equal(nutrientEnergy('fat', nutrient, logged).calories, 261);
  assert.equal(nutrientEnergy('fiber', nutrient, logged).calories, 58);
  assert.equal(nutrientEnergy('calories', nutrient, logged), null);
});

test('missing values stay unknown, known zeros stay zero and partial percentages are marked', () => {
  const logged = { total: 500, missing: 1 };
  assert.equal(nutrientEnergy('protein', { total: 0, known: 0, missing: 1 }, logged).calories, null);
  const zero = nutrientEnergy('protein', { total: 0, known: 1, missing: 1 }, logged);
  assert.equal(zero.calories, 0);
  assert.equal(zero.partial, true);
  assert.equal(nutrientEnergy('fat', { total: 1, known: 1, missing: 0 }, { total: 0, missing: 0 }).percentage, null);
});
