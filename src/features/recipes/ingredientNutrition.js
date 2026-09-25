import { cleanNutrients } from '../nutrition/nutrients.js';
import { initialProductAmount, macroKeys } from './recipeProducts.js';

export function cleanIngredientLabel(label) {
  if (!label || !['g', 'ml', 'pieces'].includes(label.unit) || !Number.isFinite(label.quantity) || label.quantity <= 0) return null;
  return { ...cleanNutrients(label), quantity: label.quantity, unit: label.unit,
    amountPerUnit: Number.isFinite(label.amountPerUnit) && label.amountPerUnit > 0 ? label.amountPerUnit : null,
    recipeUnit: typeof label.recipeUnit === 'string' ? label.recipeUnit.slice(0, 80) : '',
    source: { name: String(label.source?.name || '').slice(0, 500), provider: String(label.source?.provider || 'Label').slice(0, 100), code: /^\d+$/.test(label.source?.code || '') ? String(label.source.code).slice(0, 30) : '', estimatedPortion: label.source?.estimatedPortion === true, portionDescription: String(label.source?.portionDescription || '').slice(0, 200) },
  };
}
export function ingredientLabelAmount(item) {
  const label = item.nutritionLabel;
  if (!label) return null;
  const direct = initialProductAmount(item, label.unit);
  if (direct !== '') return direct;
  const count = initialProductAmount({ amount: item.amount, unit: 'pieces' }, 'pieces');
  return count !== '' && label.amountPerUnit > 0 && String(item.unit || '').trim().toLowerCase() === label.recipeUnit ? count * label.amountPerUnit : null;
}
export function ingredientLabelNutrition(item) {
  const amount = ingredientLabelAmount(item);
  return Object.fromEntries(macroKeys.map((key) => {
    const value = item.nutritionLabel?.[key];
    const result = amount != null && value != null ? value * amount / item.nutritionLabel.quantity : null;
    return [key, Number.isFinite(result) && result >= 0 ? Math.round(result * 10000) / 10000 : null];
  }));
}
export function updateIngredientField(item, key, value) {
  const next = { ...item, [key]: value };
  if (key === 'nutrition') delete next.nutritionLabel;
  else if (next.nutritionLabel) next.nutrition = ingredientLabelNutrition(next);
  return next;
}
export function ingredientRecipeCalculation(recipe) {
  const items = [...(recipe.ingredients || []), ...(recipe.sauces || [])];
  const ingredients = items.map((item) => Object.fromEntries(macroKeys.map((key) => {
    const value = item.nutrition?.[key];
    return [key, typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null];
  })));
  const known = Object.fromEntries(macroKeys.map((key) => [key, ingredients.filter((item) => item[key] != null).length]));
  const missing = Object.fromEntries(macroKeys.map((key) => [key, ingredients.length - known[key]]));
  const total = Object.fromEntries(macroKeys.map((key) => [key, known[key]
    ? ingredients.reduce((sum, item) => sum + (item[key] ?? 0), 0)
    : null]));
  const perServing = Object.fromEntries(macroKeys.map((key) => [key, total[key] != null && recipe.servings > 0
    ? Math.round(total[key] / recipe.servings * 100) / 100
    : null]));
  return { ingredients, total, perServing, known, missing };
}
export function ingredientRecipeTotals(recipe) {
  return ingredientRecipeCalculation(recipe).perServing;
}
export function prepareIngredientEditor(recipe) {
  if (!recipe.productNutrition) return recipe;
  let index = 0;
  const convert = (item) => {
    const product = recipe.productNutrition.items[index++];
    if (!product) return item;
    // Preserve the actual saved amount, even when the original recipe used pieces.
    const count = initialProductAmount({ amount: item.amount, unit: 'pieces' }, 'pieces');
    const direct = initialProductAmount(item, product.unit);
    const nutritionLabel = cleanIngredientLabel({ ...product.nutrition, recipeUnit: String(item.unit || '').trim().toLowerCase(), amountPerUnit: count > 0 ? product.quantity / count : null });
    return { ...item, ...((direct !== '' ? direct !== product.quantity : !(count > 0)) ? { amount: product.quantity, unit: product.unit } : {}), nutritionLabel };
  };
  const { productNutrition, fibreSource, ...rest } = recipe;
  return { ...rest, ingredients: recipe.ingredients.map(convert), sauces: (recipe.sauces || []).map(convert), nutritionFromIngredients: true };
}
