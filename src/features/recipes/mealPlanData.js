export const MEAL_SLOTS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
export const MACROS = ['calories', 'protein', 'carbs', 'fat'];
export const emptyMealPlan = () =>
  MEAL_SLOTS.map((meal, index) => ({
    id: `meal-${index}`,
    meal,
    slug: '',
    portions: 1,
  }));

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
        }
      }
      return { ...entry, recipe, nutrition };
    });
  return { meals, totals };
}
