import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMacroTargets } from './macroTargets.js';

const balanced = { protein: 20, carbs: 50, fat: 30 };
const unlocked = { protein: false, carbs: false, fat: false };
const calculate = (overrides = {}) => calculateMacroTargets({
  calories: 2000,
  preferredPercentages: balanced,
  locked: unlocked,
  grams: {},
  ...overrides,
});
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('no macros locked uses the full preferred distribution', () => {
  const result = calculate();
  close(result.protein.grams, 100);
  close(result.carbs.grams, 250);
  close(result.fat.grams, 600 / 9);
  close(result.totalCalories, 2000);
});

test('protein locked distributes remaining calories between carbs and fat', () => {
  const result = calculate({ locked: { ...unlocked, protein: true }, grams: { protein: 130 } });
  close(result.protein.calories, 520);
  close(result.carbs.grams, 231.25);
  close(result.fat.grams, 555 / 9);
  close(result.carbs.percentage, 46.25);
});

test('carbs locked distributes remaining calories between protein and fat', () => {
  const result = calculate({ locked: { ...unlocked, carbs: true }, grams: { carbs: 200 } });
  close(result.protein.calories, 480);
  close(result.fat.calories, 720);
});

test('fat locked distributes remaining calories between protein and carbs', () => {
  const result = calculate({ locked: { ...unlocked, fat: true }, grams: { fat: 50 } });
  close(result.protein.calories, 1550 * 20 / 70);
  close(result.carbs.calories, 1550 * 50 / 70);
});

test('protein and fat locked give all remaining calories to carbs', () => {
  const result = calculate({ locked: { protein: true, carbs: false, fat: true }, grams: { protein: 130, fat: 60 } });
  close(result.carbs.grams, 235);
});

test('protein and carbs locked give all remaining calories to fat', () => {
  const result = calculate({ locked: { protein: true, carbs: true, fat: false }, grams: { protein: 100, carbs: 250 } });
  close(result.fat.grams, 600 / 9);
});

test('carbs and fat locked give all remaining calories to protein', () => {
  const result = calculate({ locked: { protein: false, carbs: true, fat: true }, grams: { carbs: 250, fat: 60 } });
  close(result.protein.grams, 115);
});

test('all three locked can exactly equal the calorie target', () => {
  const result = calculate({ locked: { protein: true, carbs: true, fat: true }, grams: { protein: 100, carbs: 250, fat: 600 / 9 } });
  assert.equal(result.valid, true);
  close(result.targetDifference, 0);
});

test('all three locked remain unchanged when they exceed the calorie target', () => {
  const result = calculate({ locked: { protein: true, carbs: true, fat: true }, grams: { protein: 130, carbs: 250, fat: 75 } });
  assert.equal(result.valid, true);
  assert.equal(result.totalCalories, 2195);
  assert.equal(result.targetDifference, 195);
});

test('locked macros exceeding available calories invalidate automatic macros without making them negative', () => {
  const result = calculate({ locked: { protein: true, carbs: false, fat: true }, grams: { protein: 400, fat: 50 } });
  assert.equal(result.valid, false);
  assert.equal(result.carbs.grams, 0);
  assert.match(result.error, /exceed.*50 kcal/i);
});

test('custom percentages calculate dynamically', () => {
  const result = calculate({ preferredPercentages: { protein: 30, carbs: 40, fat: 30 } });
  close(result.protein.grams, 150);
  close(result.carbs.grams, 200);
  close(result.fat.grams, 600 / 9);
});

test('full precision is stable while rounded display values can differ by a few calories', () => {
  const result = calculate({ calories: 1999, locked: { ...unlocked, protein: true }, grams: { protein: 127.25 } });
  close(result.totalCalories, 1999);
  assert.equal(Math.round(result.carbs.grams), 233);
  assert.equal(Math.round(result.fat.grams), 62);
  assert.ok(Math.abs(
    Math.round(result.protein.grams) * 4 + Math.round(result.carbs.grams) * 4 + Math.round(result.fat.grams) * 9 - 1999,
  ) <= 5);
});

test('invalid calories, grams and percentage totals fail clearly', () => {
  assert.match(calculate({ calories: 0 }).error, /greater than 0/);
  assert.match(calculate({ locked: { ...unlocked, protein: true }, grams: { protein: -1 } }).error, /valid protein/);
  assert.match(calculate({ preferredPercentages: { protein: 20, carbs: 40, fat: 30 } }).error, /total 100/);
});
