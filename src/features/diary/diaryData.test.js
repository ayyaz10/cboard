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
