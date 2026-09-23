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
      source: { name: text(source.name), provider: text(source.provider), code: text(source.code), fetchedAt: text(source.fetchedAt), modified: source.modified === true, estimatedPortion: source.estimatedPortion === true, portionDescription: text(source.portionDescription) },
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
  const known = Object.fromEntries(macroKeys.map((key) => [key, ingredients.filter((item) => item[key] != null).length]));
  const missing = Object.fromEntries(macroKeys.map((key) => [key, ingredients.length - known[key]]));
  // Preserve useful values from matched products. `missing` lets callers label
  // them as subtotals instead of silently treating absent values as zero.
  const total = Object.fromEntries(macroKeys.map((key) => [key, known[key] ? ingredients.reduce((sum, item) => sum + (item[key] ?? 0), 0) : null]));
  const perServing = Object.fromEntries(macroKeys.map((key) => [key, total[key] != null && positive(servings) ? Math.round(total[key] / servings * 100) / 100 : null]));
  return { ingredients, total, perServing, known, missing };
}

export function initialProductAmount(ingredient, unit) {
  const aliases = { gram: 'g', grams: 'g', kilogram: 'kg', kilograms: 'kg', milligram: 'mg', milligrams: 'mg', millilitre: 'ml', millilitres: 'ml', milliliter: 'ml', milliliters: 'ml', litre: 'l', litres: 'l', liter: 'l', liters: 'l', piece: 'pieces', whole: 'pieces', item: 'pieces', items: 'pieces', each: 'pieces', ounce: 'oz', ounces: 'oz', pound: 'lb', pounds: 'lb', lbs: 'lb' };
  const conversions = { g: ['g', 1], kg: ['g', 1000], mg: ['g', .001], oz: ['g', 28.349523125], lb: ['g', 453.59237], ml: ['ml', 1], cl: ['ml', 10], dl: ['ml', 100], l: ['ml', 1000], pieces: ['pieces', 1] };
  const rawUnit = String(ingredient.unit).toLowerCase().trim();
  const conversion = conversions[aliases[rawUnit] || rawUnit];
  let amount = ingredient.amount;
  if (typeof amount === 'string') {
    const raw = amount.trim();
    if (/^\d+(?:\.\d+)?$/.test(raw)) amount = Number(raw);
    else {
      const fraction = raw.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/);
      amount = fraction && Number(fraction[3]) > 0 ? Number(fraction[1] || 0) + Number(fraction[2]) / Number(fraction[3]) : null;
    }
  }
  return positive(amount) && conversion?.[0] === unit ? Number((amount * conversion[1]).toPrecision(12)) : '';
}
