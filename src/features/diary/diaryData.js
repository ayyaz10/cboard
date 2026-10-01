import { ingredientLabelAmount } from '../recipes/ingredientNutrition.js';
import { convert, canonicalUnit } from '../groceries/groceryData.js';
import {
  cleanNutrients,
  nutrientKeys,
  validNutrient,
} from "../nutrition/nutrients.js";
import { productIngredients, initialProductAmount } from "../recipes/recipeProducts.js";

export const MEALS = ["Breakfast", "Lunch", "Dinner", "Snack"];
export const REQUIRED_MEALS = MEALS.slice(0, 3);
export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function validDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < "2000-01-01" ||
    value > "2100-12-31"
  )
    return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function shiftDate(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function weekDates(date) {
  if (!validDate(date)) throw new Error("Choose a valid report date.");
  const value = new Date(`${date}T12:00:00Z`);
  const weekday = value.getUTCDay();
  const monday = shiftDate(date, weekday === 0 ? -6 : 1 - weekday);
  return Array.from({ length: 7 }, (_, index) => shiftDate(monday, index));
}
export const emptyDay = (date) => ({
  version: 1,
  date,
  meals: [],
  skipped: [],
  complete: false,
});
export const newMeal = (meal = "Breakfast") => ({
  id: crypto.randomUUID(),
  meal,
  title: meal,
  notes: "",
  items: [],
});
export function copyMealEntry(meal) {
  return {
    ...structuredClone(meal),
    id: crypto.randomUUID(),
    items: meal.items.map((item) => ({
      ...structuredClone(item),
      id: crypto.randomUUID(),
    })),
  };
}
export function mealMatchesSearch(meal, query) {
  const words = String(query || '').trim().toLowerCase();
  if (!words) return true;
  const content = [
    meal?.title,
    meal?.meal,
    meal?.notes,
    ...(Array.isArray(meal?.items) ? meal.items.flatMap((item) => [
      item?.name,
      item?.source?.name,
      item?.source?.provider,
    ]) : []),
  ].filter(Boolean).join(' ').toLowerCase();
  return words.split(/\s+/).every((word) => content.includes(word));
}
const positive = (value) =>
  Number.isFinite(value) &&
  typeof value === "number" &&
  value > 0 &&
  value <= 1000000;
const units = ["g", "ml", "pieces", "servings"];
function text(value, max, required = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new Error("Enter a valid name or note.");
  return value.trim();
}
export function validateItem(item) {
  if (
    !item ||
    !positive(item.quantity) ||
    !positive(item.basis) ||
    !units.includes(item.unit) ||
    !units.includes(item.nutritionUnit)
  )
    throw new Error("Enter a positive amount and label basis for every food.");
  if (
    item.unit !== item.nutritionUnit &&
    !(
      item.unit === "pieces" &&
      ["g", "ml"].includes(item.nutritionUnit) &&
      positive(item.perPiece)
    )
  )
    throw new Error(
      "Enter the edible weight or volume of one piece; grams and millilitres cannot be interchanged.",
    );
  const nutrition = cleanNutrients(item.nutrition);
  for (const key of nutrientKeys)
    if (item.nutrition?.[key] != null && !validNutrient(item.nutrition[key]))
      throw new Error(
        "Nutrition must be zero or greater, or blank for unknown.",
      );
  return {
    id: text(item.id, 100, true),
    name: text(item.name, 300, true),
    ...(Array.isArray(item.inventoryUnresolved) ? { inventoryUnresolved: item.inventoryUnresolved.filter(name => typeof name === 'string').slice(0, 200) } : {}),
    ...(item.recipeOrigin ? { recipeOrigin: structuredClone(item.recipeOrigin) } : {}),
    ...(Array.isArray(item.inventoryUsage) ? { inventoryUsage: item.inventoryUsage.filter(use => typeof use.key === 'string' && typeof use.name === 'string' && Number.isFinite(use.amount) && use.amount >= 0 && ['g', 'ml', 'pieces'].includes(use.unit)).map(use => ({ ...(typeof use.code === 'string' ? { code: use.code.slice(0, 30) } : {}), ...(typeof use.itemId === 'string' ? { itemId: use.itemId.slice(0, 150) } : {}), key: use.key.slice(0, 300), name: use.name.slice(0, 300), amount: use.amount, unit: use.unit })) } : {}),
    quantity: item.quantity,
    unit: item.unit,
    basis: item.basis,
    nutritionUnit: item.nutritionUnit,
    perPiece: item.unit !== item.nutritionUnit ? item.perPiece : null,
    nutrition,
    source: {
      provider: text(item.source?.provider || "Manual", 100),
      name: text(item.source?.name || "", 500),
      code: /^\d{1,30}$/.test(item.source?.code || "") ? item.source.code : "",
      modified: item.source?.modified === true,
      estimatedPortion: item.source?.estimatedPortion === true,
      portionDescription: text(item.source?.portionDescription || '', 200),
    },
  };
}
export function canComplete(day) {
  return (
    day.meals.length > 0 &&
    REQUIRED_MEALS.every(
      (meal) =>
        day.skipped.includes(meal) ||
        day.meals.some((entry) => entry.meal === meal && entry.items.length),
    )
  );
}
export function validateDay(value, today = localDate()) {
  if (
    !value ||
    !validDate(value.date) ||
    value.date > today ||
    !Array.isArray(value.meals) ||
    value.meals.length > 40 ||
    !Array.isArray(value.skipped)
  )
    throw new Error(
      "Choose today or a past date and no more than 40 meal entries.",
    );
  const ids = new Set();
  const meals = value.meals.map((meal) => {
    if (
      !MEALS.includes(meal.meal) ||
      !Array.isArray(meal.items) ||
      !meal.items.length ||
      meal.items.length > 100 ||
      ids.has(meal.id)
    )
      throw new Error(
        "Every meal needs at least one food, a meal type and a unique entry.",
      );
    ids.add(meal.id);
    const items = meal.items.map(validateItem);
    if (new Set(items.map((item) => item.id)).size !== items.length)
      throw new Error("Food entries must be unique.");
    return {
      id: text(meal.id, 100, true),
      meal: meal.meal,
      title: text(meal.title, 160, true),
      notes: text(meal.notes || "", 2000),
      items,
    };
  });
  const skipped = REQUIRED_MEALS.filter(
    (meal) =>
      value.skipped.includes(meal) &&
      !meals.some((entry) => entry.meal === meal),
  );
  const result = {
    version: 1,
    date: value.date,
    meals,
    skipped,
    complete: value.complete === true,
  };
  if (result.complete && !canComplete(result))
    throw new Error(
      "Log or skip breakfast, lunch and dinner before finishing the day.",
    );
  return result;
}
export function itemNutrition(item) {
  const quantity =
    item.unit === item.nutritionUnit
      ? item.quantity
      : item.unit === "pieces" &&
          ["g", "ml"].includes(item.nutritionUnit) &&
          positive(item.perPiece)
        ? item.quantity * item.perPiece
        : null;
  return Object.fromEntries(
    nutrientKeys.map((key) => {
      const value = item.nutrition?.[key];
      const scaled =
        positive(quantity) && positive(item.basis) && validNutrient(value)
          ? (value * quantity) / item.basis
          : null;
      return [key, validNutrient(scaled) ? scaled : null];
    }),
  );
}
export function diaryTotals(meals) {
  const items = meals.flatMap((meal) => meal.items).map(itemNutrition);
  return Object.fromEntries(
    nutrientKeys.map((key) => [
      key,
      {
        value: items.reduce((sum, item) => sum + (item[key] ?? 0), 0),
        known: items.filter((item) => item[key] != null).length,
        missing: items.filter((item) => item[key] == null).length,
      },
    ]),
  );
}

export function nutrientContributions(meals, keys = ["calories", "protein", "carbs", "fat", "fiber"]) {
  const items = meals.flatMap((meal) => meal.items || []);
  return Object.fromEntries(keys.map((key) => {
    const foods = new Map();
    let missing = 0;
    let known = 0;
    for (const item of items) {
      const nutrition = itemNutrition(item);
      const value = nutrition[key];
      if (value == null) {
        missing += 1;
        continue;
      }
      known += 1;
      if (value <= 0) continue;
      const name = String(item.name || "Food").trim() || "Food";
      const identity = name.toLocaleLowerCase();
      const current = foods.get(identity) || { name, value: 0, calories: 0, caloriesKnown: 0, caloriesMissing: 0 };
      current.value += value;
      if (nutrition.calories == null) current.caloriesMissing += 1;
      else {
        current.calories += nutrition.calories;
        current.caloriesKnown += 1;
      }
      foods.set(identity, current);
    }
    const total = [...foods.values()].reduce((sum, food) => sum + food.value, 0);
    return [key, {
      total,
      missing,
      known,
      calories: [...foods.values()].reduce((sum, food) => sum + food.calories, 0),
      caloriesKnown: [...foods.values()].reduce((sum, food) => sum + food.caloriesKnown, 0),
      caloriesMissing: [...foods.values()].reduce((sum, food) => sum + food.caloriesMissing, 0),
      foods: [...foods.values()]
        .map((food) => ({
          ...food,
          percentage: total > 0 ? (food.value / total) * 100 : 0,
        }))
        .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name)),
    }];
  }));
}
export function dailyCalorieReport(day, target) {
  const calories = diaryTotals(day?.meals || []).calories;
  const hasTarget = Number.isFinite(target) && target > 0;
  return {
    calories: calories.known ? calories.value : null,
    missing: calories.missing,
    target: hasTarget ? target : null,
    balance: calories.known && hasTarget ? target - calories.value : null,
  };
}
export function weeklyCalorieReport(days, date, target) {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const entries = weekDates(date).map((entryDate) => ({
    date: entryDate,
    complete: byDate.get(entryDate)?.complete === true,
    ...dailyCalorieReport(byDate.get(entryDate), target),
  }));
  const logged = entries.filter((entry) => entry.calories != null);
  const consumed = logged.reduce((sum, entry) => sum + entry.calories, 0);
  const hasTarget = Number.isFinite(target) && target > 0;
  return {
    start: entries[0].date,
    end: entries[6].date,
    entries,
    logged: logged.length,
    average: logged.length ? consumed / logged.length : null,
    balance: logged.length && hasTarget ? target * logged.length - consumed : null,
  };
}
export function foodItem(nutrition, name = "") {
  return {
    id: crypto.randomUUID(),
    name: name || nutrition.source?.name || "Food",
    quantity: nutrition.quantity,
    unit: nutrition.unit,
    basis: nutrition.quantity,
    nutritionUnit: nutrition.unit,
    perPiece: null,
    nutrition: cleanNutrients(nutrition),
    source: nutrition.source || { provider: "Manual" },
  };
}
function rawRecipeItems(recipe, portions = 1, ingredients = false) {
  if (!positive(portions)) throw new Error("Enter a positive portion count.");
  if (recipe.productNutrition && recipe.servings > 0) {
    return productIngredients(recipe).map((ingredient, index) => {
      const product = recipe.productNutrition.items[index];
      return product
        ? {
            ...foodItem(product.nutrition, ingredient.name),
            quantity: (product.quantity / recipe.servings) * portions,
          }
        : {
            ...foodItem({ quantity: 1, unit: "servings" }, ingredient.name),
            quantity: portions,
          };
    });
  }
  if (ingredients || recipe.nutritionFromIngredients) {
    if (!(recipe.servings > 0))
      throw new Error(
        "This recipe needs a serving count before importing individual ingredients.",
      );
    return productIngredients(recipe).map((ingredient) => {
      const canonical = canonicalUnit(ingredient.unit);
      const targetUnit = canonical === 'kg' ? 'g' : canonical === 'L' ? 'ml' : canonical;
      const amount = convert(Number(ingredient.amount), ingredient.unit, targetUnit);
      const supported = positive(amount) && units.includes(targetUnit);
      return {
        ...foodItem(
          {
            ...ingredient.nutrition,
            quantity: supported ? amount : 1,
            unit: supported ? targetUnit : "servings",
            source: { provider: "Recipe ingredient", name: recipe.title },
          },
          ingredient.name,
        ),
        quantity:
          ((supported ? amount : 1) / recipe.servings) * portions,
      };
    });
  }
  return [
    {
      ...foodItem(
        {
          ...recipe.nutrition,
          quantity: 1,
          unit: "servings",
          source: { provider: "Recipe", name: recipe.title },
        },
        recipe.title,
      ),
      quantity: portions,
    },
  ];
}
// Snapshot ingredient usage per diary unit. Later recipe edits never rewrite history.
export function recipeItems(recipe, portions = 1, ingredients = false, { wholeRecipe = false } = {}) {
  // A whole-recipe import is explicitly labelled by the caller. Do not change
  // the saved recipe's serving count or silently reinterpret serving imports.
  if (wholeRecipe) recipe = { ...recipe, servings: 1 };
  const items = rawRecipeItems(recipe, portions, ingredients);
  const parts = productIngredients({ ...recipe, ingredients: recipe.ingredients || [] });
  const individual = Boolean(recipe.productNutrition || recipe.nutritionFromIngredients || ingredients);
  const usage = (part, index, divisor) => {
    const product = recipe.productNutrition?.items[index];
    const rawUnit = product?.unit || part.nutritionLabel?.unit || part.unit;
    const unit = ['kg', 'g'].includes(canonicalUnit(rawUnit)) ? 'g' : ['L', 'ml'].includes(canonicalUnit(rawUnit)) ? 'ml' : 'pieces';
    const amount = convert(Number(product?.quantity ?? (part.nutritionLabel ? ingredientLabelAmount(part) : part.amount)), rawUnit, unit);
    return amount != null && amount > 0 && divisor > 0 ? [{ key: `${recipe.slug}/${part.id || `ingredient:${index}`}`, name: part.name, amount: amount / divisor, unit }] : [];
  };
  return items.map((item, index) => ({ ...item,
    recipeOrigin: { slug: recipe.slug, ingredientId: individual ? parts[index]?.id : null, ingredientAmount: individual ? initialProductAmount({ amount: parts[index]?.amount, unit: 'pieces' }, 'pieces') : null, baseline: structuredClone(item) },
    inventoryUnresolved: (individual ? [index] : parts.map((_, index) => index)).filter(i => !usage(parts[i], i, 1).length || !(recipe.servings > 0)).map(i => parts[i].name),
    inventoryUsage: individual ? usage(parts[index], index, item.quantity * recipe.servings / portions) : parts.flatMap((part, index) => usage(part, index, recipe.servings)),
  }));
}
export function streaks(days, today = localDate()) {
  const dates = [
    ...new Set(
      days
        .filter((day) => day.complete && day.date <= today && canComplete(day))
        .map((day) => day.date),
    ),
  ].sort();
  const completed = new Set(dates);
  let current = 0,
    longest = 0,
    run = 0,
    previous;
  for (const date of dates) {
    run = previous && shiftDate(previous, 1) === date ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = date;
  }
  let cursor = completed.has(today) ? today : shiftDate(today, -1);
  while (completed.has(cursor)) {
    current++;
    cursor = shiftDate(cursor, -1);
  }
  return { current, longest, completed: dates.length };
}
