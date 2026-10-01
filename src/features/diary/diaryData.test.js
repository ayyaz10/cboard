import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyDay,
  foodItem,
  newMeal,
  recipeItems,
  validateDay,
  itemNutrition,
  diaryTotals,
  streaks,
  canComplete,
  validDate,
  shiftDate,
  localDate,
  weekDates,
  dailyCalorieReport,
  weeklyCalorieReport,
  copyMealEntry,
  mealMatchesSearch,
  nutrientContributions,
} from "./diaryData.js";
import { offNutrients } from "../nutrition/nutrients.js";

const egg = () =>
  foodItem(
    {
      quantity: 100,
      unit: "g",
      calories: 155,
      protein: 13,
      fat: 11,
      carbs: 1.1,
      fiber: 0,
      vitaminD: 2.2,
      sodium: 124,
    },
    "Boiled eggs",
  );
const meal = (slot = "Breakfast") => ({ ...newMeal(slot), items: [egg()] });
const completed = (date) => ({
  ...emptyDay(date),
  meals: [meal()],
  skipped: ["Lunch", "Dinner"],
  complete: true,
});
test("copied diary meals keep nutrition but receive independent ids", () => {
  const original = { ...meal("Lunch"), title: "Yesterday's lunch" };
  const copied = copyMealEntry(original);
  assert.equal(copied.title, original.title);
  assert.equal(copied.meal, "Lunch");
  assert.notEqual(copied.id, original.id);
  assert.notEqual(copied.items[0].id, original.items[0].id);
  copied.items[0].nutrition.protein = 999;
  assert.equal(original.items[0].nutrition.protein, 13);
});
test("past meal search includes foods, notes, meal type and source names", () => {
  const snack = {
    ...meal("Snack"),
    title: "Afternoon break",
    notes: "No sugar",
    items: [{ ...egg(), name: "Tea", source: { provider: "Manual", name: "Yorkshire Tea" } }],
  };
  for (const query of ["tea", "snack", "no sugar", "yorkshire", "afternoon tea"]) {
    assert.equal(mealMatchesSearch(snack, query), true);
  }
  assert.equal(mealMatchesSearch(snack, "coffee"), false);
});
test("two eggs use confirmed edible weight, scale micronutrients, and preserve zero", () => {
  const item = { ...egg(), quantity: 2, unit: "pieces", perPiece: 50 };
  assert.equal(itemNutrition(item).calories, 155);
  assert.equal(itemNutrition(item).vitaminD, 2.2);
  assert.equal(itemNutrition(item).fiber, 0);
  assert.equal(itemNutrition({ ...item, perPiece: null }).calories, null);
  assert.equal(itemNutrition({ ...item, unit: "ml" }).calories, null);
});
test("totals expose missing values and never imply complete totals from partial records", () => {
  const totals = diaryTotals([
    {
      ...meal(),
      items: [
        egg(),
        foodItem({ quantity: 1, unit: "servings" }, "Unknown food"),
      ],
    },
  ]);
  assert.deepEqual(totals.protein, { value: 13, known: 1, missing: 1 });
  assert.deepEqual(totals.iron, { value: 0, known: 0, missing: 2 });
});
test("nutrient contributions aggregate foods and calculate their share independently per nutrient", () => {
  const yoghurt = foodItem({ quantity: 100, unit: "g", calories: 80, protein: 10, carbs: 4, fat: 2, fiber: 3 }, "Yoghurt");
  const chicken = foodItem({ quantity: 100, unit: "g", calories: 160, protein: 30, carbs: 0, fat: 5, fiber: 0 }, "Chicken");
  const unknown = foodItem({ quantity: 1, unit: "servings" }, "Unknown topping");
  const result = nutrientContributions([{ ...newMeal("Lunch"), items: [yoghurt, chicken, { ...yoghurt, id: crypto.randomUUID() }, unknown] }]);

  assert.deepEqual(result.protein.foods.map(({ name, value, percentage }) => [name, value, percentage]), [
    ["Chicken", 30, 60],
    ["Yoghurt", 20, 40],
  ]);
  assert.deepEqual(result.fiber.foods.map(({ name, value, percentage }) => [name, value, percentage]), [
    ["Yoghurt", 6, 100],
  ]);
  assert.equal(result.protein.missing, 1);
  assert.equal(result.fiber.missing, 1);
  assert.equal(result.calories.total, 320);
  assert.equal(result.calories.missing, 1);
  assert.equal(result.calories.foods.length, 2);
  assert.ok(result.calories.foods.every(food => food.value === 160 && food.percentage === 50));
  assert.equal(result.protein.calories, 320);
  assert.equal(result.fiber.calories, 160);
  assert.equal(result.fiber.foods[0].calories, 160);
});

test('card calories scale logged portions and flag missing calories without including non-contributors', () => {
  const banana = { ...foodItem({ quantity: 100, unit: 'g', calories: 90, fiber: 3 }, 'Banana'), quantity: 50 };
  const unknown = foodItem({ quantity: 100, unit: 'g', fiber: 2 }, 'Banana');
  const oil = foodItem({ quantity: 100, unit: 'g', calories: 900, fiber: 0 }, 'Oil');
  const result = nutrientContributions([{ items: [banana, unknown, oil] }]);
  assert.equal(result.fiber.total, 3.5);
  assert.equal(result.fiber.calories, 45);
  assert.equal(result.fiber.caloriesKnown, 1);
  assert.equal(result.fiber.caloriesMissing, 1);
  assert.equal(result.fiber.foods.length, 1);
  assert.equal(result.fiber.foods[0].calories, 45);
  assert.equal(result.fiber.foods[0].caloriesMissing, 1);
});
test("recipe snapshots are independent and product ingredients scale per serving", () => {
  const recipe = {
    title: "Egg plate",
    nutrition: { calories: 200 },
    servings: 2,
    ingredients: [{ name: "Eggs" }],
    sauces: [],
    productNutrition: {
      items: [
        {
          quantity: 200,
          nutrition: { quantity: 100, unit: "g", calories: 155, vitaminD: 2.2 },
        },
      ],
    },
  };
  const items = recipeItems(recipe, 2);
  assert.equal(items[0].quantity, 200);
  assert.equal(itemNutrition(items[0]).calories, 310);
  assert.equal(itemNutrition(items[0]).vitaminD, 4.4);
  recipe.productNutrition.items[0].nutrition.calories = 999;
  assert.equal(itemNutrition(items[0]).calories, 310);
  const legacy = recipeItems(
    { title: "Old recipe", nutrition: { calories: 500 } },
    0.5,
  );
  assert.equal(itemNutrition(legacy[0]).calories, 250);
});
test("partial recipe products reach the daily log as a known subtotal with missing ingredients", () => {
  const recipe = {
    title: "Partial plate",
    nutrition: { calories: 155, protein: 13 },
    servings: 1,
    ingredients: [{ name: "Eggs" }, { name: "Unmatched garnish" }],
    sauces: [],
    productNutrition: {
      items: [
        { quantity: 100, unit: "g", nutrition: { quantity: 100, unit: "g", calories: 155, protein: 13 } },
        null,
      ],
    },
  };
  const totals = diaryTotals([{ ...newMeal("Lunch"), items: recipeItems(recipe) }]);
  assert.deepEqual(totals.calories, { value: 155, known: 1, missing: 1 });
  assert.deepEqual(totals.protein, { value: 13, known: 1, missing: 1 });
});
test("calculated editor ingredients automatically reach the daily log", () => {
  const recipe = {
    title: "Calculated bowl", servings: 2, nutritionFromIngredients: true,
    ingredients: [
      { name: "Yoghurt", amount: 300, unit: "g", nutrition: { calories: 180, protein: 30 } },
      { name: "Unknown topping", amount: 10, unit: "g", nutrition: {} },
    ],
    sauces: [],
  };
  const items = recipeItems(recipe, 1);
  assert.equal(items.length, 2);
  const totals = diaryTotals([{ ...newMeal("Breakfast"), items }]);
  assert.deepEqual(totals.calories, { value: 90, known: 1, missing: 1 });
  assert.deepEqual(totals.protein, { value: 15, known: 1, missing: 1 });
});
test("whole recipe imports support missing servings, fractions and inventory without changing the recipe", () => {
  const recipe = { slug: 'imported-meal', title: 'Imported meal', servings: null, nutritionFromIngredients: true,
    ingredients: [{ id: 'chicken', name: 'Chicken', amount: 130, unit: 'g', nutrition: { calories: 156, protein: 29.3, fat: 0 } }],
    sauces: [{ id: 'sauce', name: 'Sauce', amount: 6, unit: 'g', nutrition: { calories: 6, carbs: 1.5 } }],
  };
  const before = structuredClone(recipe);
  const whole = recipeItems(recipe, 1, false, { wholeRecipe: true });
  const half = recipeItems(recipe, 0.5, false, { wholeRecipe: true });
  assert.equal(whole.length, 2);
  assert.equal(whole[0].quantity, 130);
  assert.equal(half[0].quantity, 65);
  assert.equal(itemNutrition(half[0]).calories, 78);
  assert.equal(itemNutrition(half[0]).fat, 0);
  assert.equal(itemNutrition(half[0]).fiber, null);
  assert.equal(itemNutrition(half[1]).calories, 3);
  assert.equal(half[0].inventoryUsage[0].amount * half[0].quantity, 65);
  assert.deepEqual(half[0].inventoryUnresolved, []);
  assert.equal(half[0].recipeOrigin.ingredientId, 'chicken');
  assert.deepEqual(recipe, before);
  assert.throws(() => recipeItems(recipe), /serving count/);
  assert.throws(() => recipeItems(recipe, 0, false, { wholeRecipe: true }), /positive/);
});
test("whole recipe imports scale saved product labels even without servings", () => {
  const recipe = { slug: 'product-meal', title: 'Meal', ingredients: [{ name: 'Food', amount: 200, unit: 'g' }],
    productNutrition: { items: [{ quantity: 200, unit: 'g', nutrition: { quantity: 100, unit: 'g', calories: 80 } }] },
  };
  const [item] = recipeItems(recipe, 0.5, false, { wholeRecipe: true });
  assert.equal(item.quantity, 100);
  assert.equal(itemNutrition(item).calories, 80);
});
test("individual recipe ingredients use full recipe nutrition and serving count", () => {
  const recipe = {
    title: "Eggs",
    servings: 2,
    ingredients: [
      { name: "Eggs", amount: 4, unit: "pieces", nutrition: { calories: 310 } },
    ],
    sauces: [],
  };
  assert.equal(itemNutrition(recipeItems(recipe, 1, true)[0]).calories, 155);
  assert.throws(
    () => recipeItems({ ...recipe, servings: null }, 1, true),
    /serving count/,
  );
});
test("day validation rejects invalid dates, future logs, empty meals, duplicates and invalid quantities", () => {
  assert.equal(validDate("2026-13-01"), false);
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(validDate("2024-02-29"), true);
  assert.throws(() => validateDay(emptyDay("2026-10-01"), "2026-09-19"));
  const day = { ...emptyDay("2026-09-19"), meals: [meal()] };
  assert.deepEqual(validateDay(validateDay(day)), validateDay(day));
  assert.throws(() =>
    validateDay({ ...day, meals: [day.meals[0], day.meals[0]] }),
  );
  assert.throws(() => validateDay({ ...day, meals: [newMeal()] }));
  day.meals[0].items[0].quantity = -2;
  assert.throws(() => validateDay(day));
});
test("completing a day requires all main meals accounted for and at least one logged meal", () => {
  assert.equal(canComplete(completed("2026-09-19")), true);
  assert.equal(
    canComplete({
      ...emptyDay("2026-09-19"),
      skipped: ["Breakfast", "Lunch", "Dinner"],
    }),
    false,
  );
  assert.throws(() => validateDay({ ...completed("2026-09-19"), skipped: [] }));
  assert.equal(validateDay(completed("2026-09-19")).complete, true);
});
test("streaks handle yesterday grace, missed dates, reopening, historical corrections and year boundaries", () => {
  const days = ["2025-12-30", "2025-12-31", "2026-01-01"].map(completed);
  assert.deepEqual(streaks(days, "2026-01-02"), {
    current: 3,
    longest: 3,
    completed: 3,
  });
  assert.deepEqual(streaks(days, "2026-01-03"), {
    current: 0,
    longest: 3,
    completed: 3,
  });
  assert.deepEqual(
    streaks([days[0], { ...days[1], complete: false }, days[2]], "2026-01-01"),
    { current: 1, longest: 1, completed: 2 },
  );
  assert.equal(shiftDate("2026-03-29", 1), "2026-03-30");
  assert.equal(shiftDate("2026-10-25", -1), "2026-10-24");
  assert.match(localDate(), /^\d{4}-\d{2}-\d{2}$/);
});
test("daily and Monday-to-Sunday weekly calorie reports use logged days without inventing zeroes", () => {
  const monday = { ...emptyDay("2026-04-27"), meals: [meal()] };
  const wednesday = {
    ...emptyDay("2026-04-29"),
    meals: [{ ...meal(), items: [{ ...egg(), quantity: 200 }] }],
    complete: true,
  };
  assert.deepEqual(weekDates("2026-05-03"), [
    "2026-04-27", "2026-04-28", "2026-04-29", "2026-04-30",
    "2026-05-01", "2026-05-02", "2026-05-03",
  ]);
  assert.deepEqual(dailyCalorieReport(monday, 1908), {
    calories: 155,
    missing: 0,
    target: 1908,
    balance: 1753,
  });
  const report = weeklyCalorieReport([monday, wednesday], "2026-05-01", 1908);
  assert.equal(report.logged, 2);
  assert.equal(report.average, 232.5);
  assert.equal(report.balance, 3351);
  assert.equal(report.entries[1].calories, null);
  assert.equal(report.entries[2].complete, true);
});
test("OFF mass units convert to mg and micrograms without treating missing micros as zero", () => {
  const n = offNutrients({
    calcium_100g: 0.12,
    sodium_100g: 0.3,
    "vitamin-d_100g": 0.000002,
    iron_100g: 0,
  });
  assert.equal(n.calcium, 120);
  assert.equal(n.sodium, 300);
  assert.equal(n.vitaminD, 2);
  assert.equal(n.iron, 0);
  assert.equal(n.zinc, null);
});
