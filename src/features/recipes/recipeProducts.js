import { cleanNutrients } from '../nutrition/nutrients.js';
export const macroKeys = ['calories', 'protein', 'carbs', 'fat', 'fiber'];
export const productIngredients = (recipe) => [...recipe.ingredients, ...(recipe.sauces || [])];
export const productBasis = (recipe) => JSON.stringify(productIngredients(recipe).map(({ name, amount, unit, note }) => [name, amount, unit, note || '']));
const positive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const text = (s) => typeof s === 'string' ? s.slice(0, 500) : '';

export function normalizeProducts(value, recipe) {
  if (!value || value.basis !== productBasis(recipe) || !Array.isArray(value.items) || value.items.length !== productIngredients(recipe).length) return null;
  const items = value.items.map((item) => {
    if (!item || !['g', 'ml', 'pieces'].includes(item.unit) || !positive(item.quantity)) return null;
    const nutrition = item.nutrition;
    if (!nutrition || nutrition.unit !== item.unit || !positive(nutrition.quantity)) return null;
    const source = nutrition.source || {};
    return { quantity: item.quantity, unit: item.unit, nutrition: {
      quantity: nutrition.quantity, unit: item.unit,
      ...cleanNutrients(nutrition),
      source: { name: text(source.name), provider: text(source.provider), code: text(source.code), fetchedAt: text(source.fetchedAt), modified: source.modified === true },
    } };
  });
  return { basis: value.basis, items };
}

export function calculateProducts(items, servings) {
  const ingredients = items.map((item) => Object.fromEntries(macroKeys.map((key) => {
    const value = item?.nutrition?.[key];
    const amount = item && positive(item.quantity) && positive(item.nutrition?.quantity) && item.unit === item.nutrition.unit && typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? value * item.quantity / item.nutrition.quantity : null;
    return [key, amount != null && Number.isFinite(amount) ? amount : null];
  })));
  const total = Object.fromEntries(macroKeys.map((key) => [key, ingredients.length && ingredients.every((item) => item[key] != null) ? ingredients.reduce((sum, item) => sum + item[key], 0) : null]));
  const perServing = Object.fromEntries(macroKeys.map((key) => [key, total[key] != null && positive(servings) ? Math.round(total[key] / servings * 100) / 100 : null]));
  return { ingredients, total, perServing };
}

export function initialProductAmount(ingredient, unit) {
  const conversions = { g: ['g', 1], kg: ['g', 1000], ml: ['ml', 1], l: ['ml', 1000], pieces: ['pieces', 1] };
  const conversion = conversions[String(ingredient.unit).toLowerCase().trim()];
  return positive(ingredient.amount) && conversion?.[0] === unit ? ingredient.amount * conversion[1] : '';
}
