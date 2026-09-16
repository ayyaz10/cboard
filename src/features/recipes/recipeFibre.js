import { recipeNutrition } from '../groceries/groceryData.js';

export function fibreIngredients(recipe) {
  return [...recipe.ingredients, ...(recipe.sauces || [])];
}
export function fibreBasis(recipe) {
  return JSON.stringify([fibreIngredients(recipe).map((item) => [item.name, item.amount ?? null, item.unit || '', item.note || '', item.alternativeGroup || '']), recipe.steps, recipe.servings ?? null]);
}
export function groceryFibre(recipe, groceries) {
  return fibreIngredients(recipe).map((ingredient, index) => {
    const total = recipeNutrition({ ingredients: [ingredient] }, groceries).fiber;
    const ambiguous = ingredient.alternativeGroup || /\b(optional|or|to taste|as needed)\b/i.test(`${ingredient.name} ${ingredient.note || ''}`);
    return {
      index, ingredient: ingredient.name,
      quantityUsed: [ingredient.amount, ingredient.unit].filter((v) => v != null && v !== '').join(' '),
      fiberGrams: ambiguous || total.missing.length ? null : total.value,
      note: ambiguous ? 'Confirm the selected alternative or optional amount in Edit Recipe.' : total.missing.length ? 'Needs a matching grocery fibre value and a compatible ingredient quantity.' : 'Calculated from your grocery label.',
      source: 'groceries',
    };
  });
}
export function fibreTotal(rows, servings, basis) {
  if (!rows.length || rows.some((row) => !Number.isFinite(row.fiberGrams) || row.fiberGrams < 0)) return null;
  if (!Number.isFinite(servings) || servings <= 0 || servings > 100 || !['serving', 'recipe'].includes(basis)) return null;
  const total = rows.reduce((sum, row) => sum + row.fiberGrams, 0);
  return Math.round(total / (basis === 'serving' ? servings : 1) * 10) / 10;
}
export function normaliseFibreSource(source, recipe) {
  if (!source || !['groceries', 'ai'].includes(source.type) || !['serving', 'recipe'].includes(source.basis)
      || !Number.isFinite(source.servings) || source.servings <= 0 || source.servings > 100
      || !Number.isFinite(source.value) || source.value < 0 || typeof source.ingredients !== 'string') return null;
  // Editing a manually entered fibre value replaces its old estimate provenance.
  if (recipe.nutrition.fiber !== source.value) return null;
  return { type: source.type, basis: source.basis, servings: source.servings, value: source.value, ingredients: source.ingredients };
}
