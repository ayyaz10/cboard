import test from 'node:test';
import assert from 'node:assert/strict';
import { addRecipeToDatedMealPlan, addRecipeToMealRoutine, readDatedMealPlans, readMealRoutine, setDatedMealPlan } from './mealPlanData.js';

test('meal routines preserve names, notes and legacy saved daily plans', () => {
  const entries = emptyMealPlan();
  entries[0].slug = 'oats';
  const legacy = readMealRoutine(entries);
  assert.equal(legacy.name, 'My current meal routine');
  assert.deepEqual(legacy.entries, entries);
  const routine = readMealRoutine({
    version: 1,
    name: ' Weekday meals ',
    notes: ' Repeat these days ',
    entries,
  });
  assert.equal(routine.name, 'Weekday meals');
  assert.equal(routine.notes, 'Repeat these days');
  assert.deepEqual(
    readMealRoutine(JSON.parse(JSON.stringify(routine))),
    routine,
  );
  assert.throws(
    () => readMealRoutine({ ...routine, name: ' ' }),
    /routine name/,
  );
  assert.throws(
    () => readMealRoutine({ ...routine, version: 2 }),
    /routine name/,
  );
});
import {
  calculateMealPlan,
  emptyMealPlan,
  validateMealPlan,
} from './mealPlanData.js';

const recipes = [
  {
    slug: 'oats',
    servings: 2,
    nutrition: { calories: 560, protein: 40, carbs: 77, fat: 12 },
  },
  {
    slug: 'burrito',
    nutrition: { calories: 605, protein: 58, carbs: 47, fat: 19 },
  },
  {
    slug: 'snack',
    nutrition: { calories: 0, protein: null, carbs: null, fat: 0 },
  },
];
test('daily planner sums listed macros with fractional portions without dividing by servings', () => {
  const plan = emptyMealPlan();
  plan[0].slug = 'oats';
  plan[0].portions = 0.5;
  plan[1].slug = 'burrito';
  plan[1].portions = 2;
  const { totals, meals } = calculateMealPlan(plan, recipes);
  assert.equal(meals.length, 2);
  assert.equal(totals.calories.value, 1490);
  assert.equal(totals.protein.value, 136);
  assert.equal(totals.carbs.value, 132.5);
  assert.equal(totals.fat.value, 44);
  assert.equal(totals.calories.missing, 0);
});
test('unknown macros, deleted recipes and invalid portions cannot silently count as zero', () => {
  const plan = emptyMealPlan();
  plan[0].slug = 'oats';
  plan[1].slug = 'snack';
  plan[2].slug = 'deleted';
  const { totals } = calculateMealPlan(plan, recipes);
  assert.deepEqual(totals.calories, { value: 560, known: 2, missing: 1 });
  assert.deepEqual(totals.protein, { value: 40, known: 1, missing: 2 });
  plan[0].portions = '';
  assert.equal(calculateMealPlan(plan, recipes).totals.calories.missing, 2);
  assert.equal(calculateMealPlan([], recipes).totals.calories.known, 0);
});
test('partial product nutrition contributes a labelled known subtotal', () => {
  const plan = emptyMealPlan();
  plan[0].slug = 'partial';
  const partial = {
    slug: 'partial', servings: 1,
    nutrition: { calories: 200, protein: 10, carbs: null, fat: 5, fiber: 0 },
    productNutrition: { items: [
      { quantity: 100, unit: 'g', nutrition: { quantity: 100, unit: 'g', calories: 200, protein: 10, carbs: null, fat: 5, fiber: 0 } },
      null,
    ] },
  };
  const { totals, meals } = calculateMealPlan(plan, [...recipes, partial]);
  assert.equal(meals[0].nutrition.calories, 200);
  assert.deepEqual(totals.calories, { value: 200, known: 1, missing: 1 });
  assert.deepEqual(totals.carbs, { value: 0, known: 0, missing: 1 });
});
test('partial editor ingredient nutrition contributes a labelled known subtotal', () => {
  const plan = emptyMealPlan();
  plan[0].slug = 'editor-partial';
  const partial = {
    slug: 'editor-partial', servings: 1, nutritionFromIngredients: true,
    nutrition: { calories: 200, protein: 10, carbs: null, fat: 5, fiber: 0 },
    ingredients: [
      { nutrition: { calories: 200, protein: 10, carbs: null, fat: 5, fiber: 0 } },
      { nutrition: { calories: null, protein: null, carbs: null, fat: null, fiber: null } },
    ],
  };
  const { totals } = calculateMealPlan(plan, [...recipes, partial]);
  assert.deepEqual(totals.calories, { value: 200, known: 1, missing: 1 });
  assert.deepEqual(totals.carbs, { value: 0, known: 0, missing: 1 });
});
test('saved plans validate portions, identities and limits', () => {
  const plan = emptyMealPlan();
  assert.deepEqual(validateMealPlan(JSON.parse(JSON.stringify(plan))), plan);
  for (const portions of [0, -1, Infinity, 101, '', null])
    assert.throws(
      () => validateMealPlan([{ ...plan[0], portions }]),
      /Meal #1/,
    );
  assert.throws(() => validateMealPlan([plan[0], plan[0]]), /Meal #2/);
  assert.throws(() => validateMealPlan(Array(25).fill(plan[0])), /24 meals/);
});

test('quick planner add fills the selected empty slot and preserves existing routine metadata', () => {
  const routine = { version: 1, name: 'Weekday', notes: 'Keep this note', entries: [
    { id: 'breakfast', meal: 'Breakfast', slug: '', portions: 1 },
    { id: 'lunch', meal: 'Lunch', slug: 'soup', portions: 1.5 },
  ] };
  const next = addRecipeToMealRoutine(routine, 'oats', 'Breakfast', 1);
  assert.equal(next.name, 'Weekday');
  assert.equal(next.notes, 'Keep this note');
  assert.deepEqual(next.entries[0], { id: 'breakfast', meal: 'Breakfast', slug: 'oats', portions: 1 });
  assert.deepEqual(next.entries[1], routine.entries[1]);
});

test('quick planner add appends when the chosen slot already has a recipe and validates bounds', () => {
  const routine = { version: 1, name: 'Weekday', notes: '', entries: [{ id: 'b', meal: 'Breakfast', slug: 'toast', portions: 1 }] };
  const next = addRecipeToMealRoutine(routine, 'oats', 'Breakfast', 2);
  assert.equal(next.entries.length, 2);
  assert.equal(next.entries[1].slug, 'oats');
  assert.throws(() => addRecipeToMealRoutine(routine, 'oats', 'Dessert', 1), /Choose a meal/);
  assert.throws(() => addRecipeToMealRoutine(routine, 'oats', 'Breakfast', 101), /Choose a meal/);
});

test('dated planner add is idempotent for the same recipe and preserves other dates', () => {
  const first = addRecipeToDatedMealPlan(null, '2026-11-06', 'oats', 'Breakfast', 1);
  const again = addRecipeToDatedMealPlan(first, '2026-11-06', 'oats', 'Breakfast', 1.5);
  const tomorrow = addRecipeToDatedMealPlan(again, '2026-11-07', 'soup', 'Lunch', 2);
  assert.equal(tomorrow.dates['2026-11-06'].filter(entry => entry.slug === 'oats').length, 1);
  assert.equal(tomorrow.dates['2026-11-06'].find(entry => entry.slug === 'oats').portions, 1.5);
  assert.equal(tomorrow.dates['2026-11-07'].find(entry => entry.slug === 'soup').portions, 2);
  assert.throws(() => addRecipeToDatedMealPlan(tomorrow, '2026-02-31', 'oats', 'Breakfast', 1), /valid date/);
});

test('dated planner edit validates meal identity and count limits', () => {
  const plan = setDatedMealPlan(null, '2026-11-06', [{ id: 'breakfast', meal: 'Breakfast', slug: 'oats', portions: 1 }]);
  assert.deepEqual(readDatedMealPlans(plan), plan);
  assert.throws(() => setDatedMealPlan(plan, '2026-11-06', Array.from({ length: 25 }, (_, index) => ({ id: `x${index}`, meal: 'Lunch', slug: '', portions: 1 }))), /24 meals/);
});
