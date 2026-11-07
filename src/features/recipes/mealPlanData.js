import { ingredientRecipeCalculation, recipeProductCalculation } from './ingredientNutrition.js';

export const MEAL_SLOTS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
export const MACROS = ['calories', 'protein', 'carbs', 'fat', 'fiber'];
export const DATED_PLAN_KEY = 'recipes:dated-plans:v1';
const validPlanDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00`)) && new Date(`${date}T00:00:00`).toISOString().slice(0, 10) === date;
export const emptyMealPlan = () =>
  MEAL_SLOTS.map((meal, index) => ({
    id: `meal-${index}`,
    meal,
    slug: '',
    portions: 1,
  }));

export function addRecipeToMealRoutine(current, slug, meal, portions) {
  const routine = current == null ? { version: 1, name: 'My current meal routine', notes: '', entries: emptyMealPlan() } : readMealRoutine(current);
  if (!MEAL_SLOTS.includes(meal) || typeof slug !== 'string' || !slug || !Number.isFinite(portions) || portions <= 0 || portions > 100)
    throw new Error('Choose a meal and serving amount to add this recipe to your planner.');
  if (routine.entries.length >= 24) throw new Error('Your planner already has the maximum of 24 meals.');
  const matching = routine.entries.find(entry => entry.slug === slug && entry.meal === meal);
  const empty = routine.entries.find(entry => !entry.slug && entry.meal === meal);
  const entries = matching
    ? routine.entries.map(entry => entry.id === matching.id ? { ...entry, portions } : entry)
    : empty
      ? routine.entries.map(entry => entry.id === empty.id ? { ...entry, slug, portions } : entry)
      : [...routine.entries, { id: `quick-${slug}-${Date.now().toString(36)}`, meal, slug, portions }];
  return readMealRoutine({ ...routine, entries });
}

export function readDatedMealPlans(value) {
  if (value == null) return { version: 1, dates: {} };
  if (!value || value.version !== 1 || !value.dates || typeof value.dates !== 'object' || Array.isArray(value.dates))
    throw new Error('Saved date plans are invalid.');
  const dates = Object.entries(value.dates);
  if (dates.length > 366) throw new Error('Keep no more than 366 dated meal plans at a time.');
  const clean = {};
  for (const [date, entries] of dates) {
    if (!validPlanDate(date)) throw new Error('A saved meal plan has an invalid date.');
    clean[date] = validateMealPlan(entries);
  }
  return { version: 1, dates: clean };
}

export function addRecipeToDatedMealPlan(current, date, slug, meal, portions) {
  if (!validPlanDate(date))
    throw new Error('Choose a valid date for the Planner.');
  if (!MEAL_SLOTS.includes(meal) || typeof slug !== 'string' || !slug || !Number.isFinite(portions) || portions <= 0 || portions > 100)
    throw new Error('Choose a meal and serving amount to add this recipe to your planner.');
  const plan = readDatedMealPlans(current);
  const entries = [...(plan.dates[date] || emptyMealPlan())];
  const existing = entries.find(entry => entry.slug === slug && entry.meal === meal);
  if (existing) existing.portions = portions;
  else {
    if (entries.length >= 24) throw new Error('This date already has the maximum of 24 meals.');
    const empty = entries.find(entry => !entry.slug && entry.meal === meal);
    if (empty) { empty.slug = slug; empty.portions = portions; }
    else entries.push({ id: `scheduled-${slug}-${meal.toLowerCase()}-${date}`, meal, slug, portions });
  }
  return readDatedMealPlans({ ...plan, dates: { ...plan.dates, [date]: validateMealPlan(entries) } });
}

export function setDatedMealPlan(current, date, entries) {
  if (!validPlanDate(date)) throw new Error('Choose a valid date for the Planner.');
  const plan = readDatedMealPlans(current);
  const validated = validateMealPlan(entries);
  return readDatedMealPlans({ ...plan, dates: { ...plan.dates, [date]: validated } });
}

export function readMealRoutine(value) {
  if (Array.isArray(value))
    return {
      version: 1,
      name: 'My current meal routine',
      notes: '',
      entries: validateMealPlan(value),
    };
  if (
    !value ||
    value.version !== 1 ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 120 ||
    typeof value.notes !== 'string' ||
    value.notes.length > 2000
  )
    throw new Error(
      'Enter a routine name up to 120 characters and notes up to 2000 characters.',
    );
  return {
    version: 1,
    name: value.name.trim(),
    notes: value.notes.trim(),
    entries: validateMealPlan(value.entries),
  };
}

export function validateMealPlan(value) {
  if (!Array.isArray(value) || value.length > 24)
    throw new Error('A daily plan can contain up to 24 meals.');
  const ids = new Set();
  return value.map((entry, index) => {
    if (
      !entry ||
      typeof entry.id !== 'string' ||
      ids.has(entry.id) ||
      !MEAL_SLOTS.includes(entry.meal) ||
      typeof entry.slug !== 'string' ||
      entry.slug.length > 100 ||
      typeof entry.portions !== 'number' ||
      !Number.isFinite(entry.portions) ||
      entry.portions <= 0 ||
      entry.portions > 100
    )
      throw new Error(
        `Meal #${index + 1}: choose a meal type and a portion multiplier greater than 0 and no more than 100.`,
      );
    ids.add(entry.id);
    return {
      id: entry.id,
      meal: entry.meal,
      slug: entry.slug,
      portions: entry.portions,
    };
  });
}

export function calculateMealPlan(entries, recipes) {
  const bySlug = new Map(recipes.map((recipe) => [recipe.slug, recipe]));
  const totals = Object.fromEntries(
    MACROS.map((key) => [key, { value: 0, known: 0, missing: 0 }]),
  );
  const meals = entries
    .filter((entry) => entry.slug)
    .map((entry) => {
      const recipe = bySlug.get(entry.slug);
      const productCalculation = recipe?.productNutrition
        ? recipeProductCalculation(recipe)
        : recipe?.nutritionFromIngredients
          ? ingredientRecipeCalculation(recipe)
          : null;
      const validPortions =
        typeof entry.portions === 'number' &&
        Number.isFinite(entry.portions) &&
        entry.portions > 0 &&
        entry.portions <= 100;
      const nutrition = {};
      for (const key of MACROS) {
        const value = recipe?.nutrition?.[key];
        nutrition[key] =
          validPortions &&
          typeof value === 'number' &&
          Number.isFinite(value) &&
          value >= 0
            ? value * entry.portions
            : null;
        if (nutrition[key] === null) totals[key].missing += 1;
        else {
          totals[key].known += 1;
          totals[key].value += nutrition[key];
          if (productCalculation?.missing[key] > 0) totals[key].missing += 1;
        }
      }
      return { ...entry, recipe, nutrition };
    });
  return { meals, totals };
}
