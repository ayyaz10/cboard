import { cleanNutrients, nutrientKeys } from '../nutrition/nutrients.js';
import { ingredientLabelAmount } from '../recipes/ingredientNutrition.js';

const normalise = (value) => String(value || '').trim().toLocaleLowerCase();
const supportedUnits = new Set(['g', 'ml', 'pieces', 'servings']);
const positive = (value) => Number.isFinite(value) && value > 0;

function recipeTemplate(ingredient, recipeTitle) {
  if (!normalise(ingredient?.name)) return null;
  const label = ingredient.nutritionLabel;
  if (label) {
    const amount = ingredientLabelAmount(ingredient);
    return {
      name: ingredient.name,
      quantity: positive(amount) ? amount : label.quantity,
      unit: label.unit,
      basis: label.quantity,
      nutritionUnit: label.unit,
      perPiece: null,
      nutrition: cleanNutrients(label),
      source: { ...label.source },
    };
  }
  const amountSupported = positive(ingredient.amount) && supportedUnits.has(ingredient.unit);
  return {
    name: ingredient.name,
    quantity: amountSupported ? ingredient.amount : 1,
    unit: amountSupported ? ingredient.unit : 'servings',
    basis: amountSupported ? ingredient.amount : 1,
    nutritionUnit: amountSupported ? ingredient.unit : 'servings',
    perPiece: null,
    nutrition: cleanNutrients(ingredient.nutrition),
    source: { provider: 'Recipe ingredient', name: recipeTitle || '' },
  };
}

const signature = (item) => [
  normalise(item.name), item.nutritionUnit, item.basis,
  normalise(item.source?.provider), normalise(item.source?.name),
  ...nutrientKeys.map((key) => item.nutrition?.[key] ?? ''),
].join('|');

export function buildDiaryFoodLibrary(days = [], recipes = []) {
  const entries = new Map();
  const add = (item, origin) => {
    if (!normalise(item?.name)) return;
    const key = signature(item);
    const existing = entries.get(key);
    if (existing) {
      if (origin && !existing.origins.includes(origin)) existing.origins.push(origin);
    } else {
      entries.set(key, { key, item, origins: origin ? [origin] : [] });
    }
  };
  [...days].sort((a, b) => String(b.date).localeCompare(String(a.date))).forEach((day) =>
    (day.meals || []).forEach((meal) => (meal.items || []).forEach((item) => add(item, day.date))),
  );
  recipes.forEach((recipe) => {
    const alternatives = Object.values(recipe.alternatives || {}).flatMap((group) => group.options || []);
    [...(recipe.ingredients || []), ...(recipe.sauces || []), ...alternatives]
      .map((item) => recipeTemplate(item, recipe.title))
      .filter(Boolean)
      .forEach((item) => add(item, recipe.title));
  });
  return [...entries.values()].sort((a, b) => a.item.name.localeCompare(b.item.name));
}

export function findDiaryFoodMatches(library, query, limit = 8) {
  const needle = normalise(query);
  if (needle.length < 2) return [];
  return library
    .filter((entry) => normalise(entry.item.name).includes(needle))
    .sort((a, b) => Number(normalise(b.item.name).startsWith(needle)) - Number(normalise(a.item.name).startsWith(needle)) || a.item.name.localeCompare(b.item.name))
    .slice(0, limit);
}

export function applyStoredDiaryFood(current, stored) {
  return {
    ...stored,
    id: current.id,
    nutrition: { ...(stored.nutrition || {}) },
    source: { ...(stored.source || { provider: 'Manual' }) },
  };
}
