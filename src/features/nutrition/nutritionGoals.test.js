import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGoals, emptyGoals, compareGoal, comparisonText } from './nutritionGoals.js';
import { calculateMealPlan } from '../recipes/mealPlanData.js';

test('daily targets preserve zero and optional values through a save round trip', () => {
  const goals = validateGoals({ calories: '2000', protein: '150.5', carbs: '', fat: 0 });
  assert.deepEqual(goals, { calories: 2000, protein: 150.5, carbs: null, fat: 0, fiber: null });
  assert.deepEqual(validateGoals(JSON.parse(JSON.stringify(goals))), goals);
  assert.deepEqual(validateGoals({}), emptyGoals());
  for (const value of [-1, Infinity, NaN, true, [], {}, 'oops', 100001])
    assert.throws(() => validateGoals({ protein: value }), /Protein/);
});

test('meal selections and fractional portions compare independently against each goal', () => {
  const entries = [{ id: 'meal', slug: 'oats', portions: 2 }];
  const recipes = [{ slug: 'oats', nutrition: { calories: 600, protein: 30, carbs: 70, fat: 20 } }];
  const { totals } = calculateMealPlan(entries, recipes);
  assert.deepEqual(compareGoal(totals.calories, 1000), { status: 'over', amount: 200, incomplete: false });
  assert.deepEqual(compareGoal(totals.protein, 100), { status: 'remaining', amount: 40 });
  assert.equal(compareGoal(totals.carbs, 140).status, 'met');
  assert.equal(compareGoal(totals.fat, null).status, 'unset');
  entries[0].portions = 0.5;
  assert.equal(compareGoal(calculateMealPlan(entries, recipes).totals.calories, 1000).amount, 700);
});

test('unknown nutrition cannot claim a goal is met or within target', () => {
  assert.equal(compareGoal({ value: 0, known: 0, missing: 1 }, 100).status, 'incomplete');
  assert.equal(compareGoal({ value: 100, known: 1, missing: 1 }, 100).status, 'incomplete');
  const over = compareGoal({ value: 120, known: 1, missing: 1 }, 100);
  assert.equal(comparisonText(over, 'g'), 'At least 20 g over target');
  assert.equal(compareGoal({ value: 0, known: 0, missing: 0 }, 0).status, 'empty');
});

test('zero targets and decimal arithmetic give meaningful comparisons', () => {
  assert.equal(compareGoal({ value: 0, known: 1, missing: 0 }, 0).status, 'met');
  assert.equal(compareGoal({ value: 1, known: 1, missing: 0 }, 0).status, 'over');
  assert.equal(compareGoal({ value: 0.1 + 0.2, known: 2, missing: 0 }, 0.3).status, 'met');
  assert.equal(comparisonText(compareGoal({ value: 100.01, known: 1, missing: 0 }, 100), 'g'), '<0.1 g over target');
});

test('fibre reaches its target without an over-limit warning and unknown fibre stays unknown', () => {
  assert.equal(compareGoal({ value: 35, known: 2, missing: 0 }, 30, 'fiber').status, 'reached');
  assert.equal(compareGoal({ value: 20, known: 2, missing: 0 }, 30, 'fiber').amount, 10);
  assert.equal(compareGoal({ value: 0, known: 0, missing: 2 }, 0, 'fiber').status, 'incomplete');
  const totals = calculateMealPlan([{ slug: 'oats', portions: 0.5 }, { slug: 'missing', portions: 1 }], [{ slug: 'oats', nutrition: { fiber: 8 } }]).totals;
  assert.deepEqual(totals.fiber, { value: 4, known: 1, missing: 1 });
  assert.equal(compareGoal(totals.fiber, 30, 'fiber').status, 'incomplete');
  assert.equal(validateGoals({ fiber: '30' }).fiber, 30);
});
