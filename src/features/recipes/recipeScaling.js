import { updateIngredientField, ingredientRecipeTotals } from './ingredientNutrition.js';
import { macroKeys } from './recipeProducts.js';

const items = recipe => [...(recipe.ingredients || []), ...(recipe.sauces || [])];
const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const stableQuantity = value => Number(value.toPrecision(10));
const applyAmount = (item, amount) => {
  const next = updateIngredientField(item, 'amount', amount);
  if (amount === 0) next.nutrition = Object.fromEntries(macroKeys.map(key => [key, item.nutrition?.[key] == null ? null : 0]));
  return next;
};

// Recipe quantities are deliberately kept in their entered units. Only units in
// the same physical family can be used for the anchor (g/kg/oz, ml/l, pieces).
export function recipeScaleMetadata(recipe, anchorIngredientId) {
  const selected = items(recipe).find(item => item.id === anchorIngredientId);
  if (!selected || !numeric(selected.amount) || selected.amount <= 0) throw new Error('Choose an ingredient with a positive numeric amount as the main ingredient.');
  return {
    anchorIngredientId,
    baseQuantities: Object.fromEntries(items(recipe).map(item => [item.id, { amount: item.amount, unit: item.unit || '' }])),
  };
}

export function scaleRecipe(recipe, targetQuantity, { scaleOthers = true } = {}) {
  const scaling = recipe.scaling;
  const anchor = items(recipe).find(item => item.id === scaling?.anchorIngredientId);
  const baseAnchor = scaling?.baseQuantities?.[anchor?.id];
  if (!anchor || !baseAnchor || !numeric(baseAnchor.amount) || baseAnchor.amount <= 0) throw new Error('Set a positive numeric main ingredient and base amount before scaling.');
  if (!numeric(targetQuantity)) throw new Error('Enter a valid non-negative quantity.');
  if (String(anchor.unit || '').trim().toLowerCase() !== String(baseAnchor.unit || '').trim().toLowerCase()) throw new Error('The main ingredient unit changed. Set the current amounts as the new base before scaling.');
  const factor = targetQuantity / baseAnchor.amount;
  const ingredientScale = new Map();
  const warnings = [];
  const scaledItems = items(recipe).map(item => {
    const base = scaling.baseQuantities[item.id];
    if (item.id === anchor.id) {
      const next = applyAmount(item, targetQuantity);
      ingredientScale.set(item.id, next);
      return next;
    }
    if (!scaleOthers || item.scaleEnabled === false || !base || !numeric(base.amount)) return item;
    if (String(base.unit || '').trim().toLowerCase() !== String(item.unit || '').trim().toLowerCase()) {
      warnings.push(`${item.name} stayed unchanged because its unit changed from ${base.unit || 'no unit'} to ${item.unit || 'no unit'}.`);
      return item;
    }
    const next = applyAmount(item, stableQuantity(base.amount * factor));
    ingredientScale.set(item.id, next);
    return next;
  });
  const count = (recipe.ingredients || []).length;
  const hasIngredientNutrition = scaledItems.some(item => macroKeys.some(key => typeof item.nutrition?.[key] === 'number'));
  const allAmountsScale = scaleOthers && items(recipe).every(item => item.id === anchor.id || item.scaleEnabled !== false && numeric(scaling.baseQuantities[item.id]?.amount));
  const nextRecipe = {
    ...recipe,
    ingredients: scaledItems.slice(0, count),
    sauces: scaledItems.slice(count),
    ...((recipe.nutritionFromIngredients === true || hasIngredientNutrition) ? { nutritionFromIngredients: true } : {}),
  };
  delete nextRecipe.productNutrition;
  delete nextRecipe.fibreSource;
  if (nextRecipe.nutritionFromIngredients) nextRecipe.nutrition = ingredientRecipeTotals(nextRecipe);
  else if (allAmountsScale) nextRecipe.nutrition = Object.fromEntries(macroKeys.map(key => [key, recipe.nutrition?.[key] == null ? null : stableQuantity(recipe.nutrition[key] * factor)]));
  else warnings.push('Nutrition is manually entered and could not be recalculated from the fixed or unquantified ingredients. Existing nutrition values were kept.');
  return { recipe: nextRecipe, factor, scaledCount: Math.max(0, ingredientScale.size - 1), warnings };
}

export function formatScaledQuantity(amount) {
  if (!Number.isFinite(amount)) return '';
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2, useGrouping: false }).format(amount);
}
