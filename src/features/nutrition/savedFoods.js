import { buildDiaryFoodLibrary, findDiaryFoodMatches } from '../diary/diaryFoodLibrary.js';
import { prepareIngredientEditor } from '../recipes/ingredientNutrition.js';
import { applyFoodCatalogToRecipes, normalizeFoodName } from './foodCatalog.js';
import { cleanNutrients } from './nutrients.js';

export function buildSavedFoods(recipes = [], days = [], catalog = [], groceries = {}) {
  const prepared = applyFoodCatalogToRecipes(recipes.map(prepareIngredientEditor), catalog);
  const library = buildDiaryFoodLibrary(days, prepared, catalog);
  const authoritative = new Set(catalog.map(item => normalizeFoodName(item.name)));
  const entries = library.filter(entry => !authoritative.has(normalizeFoodName(entry.item.name)) || entry.origins.includes('Main food library'));
  for (const item of [...(groceries.items || []), ...(groceries.shopping || [])]) {
    if (entries.some(entry => normalizeFoodName(entry.item.name) === normalizeFoodName(item.name))) continue;
    entries.push({ key: `grocery:${item.id}`, origins: ['Groceries'], item: {
      name: item.name, quantity: item.nutrition?.quantity || 1,
      unit: item.nutrition?.unit || item.unit,
      basis: item.nutrition?.quantity || 1, nutritionUnit: item.nutrition?.unit || item.unit,
      nutrition: cleanNutrients(item.nutrition), source: { ...item.nutrition?.source },
    } });
  }
  return entries;
}

export const findSavedFoods = findDiaryFoodMatches;

export function savedFoodNutrition(item) {
  if (!Object.values(item.nutrition || {}).some(Number.isFinite)) return null;
  return { ...cleanNutrients(item.nutrition), quantity: item.basis, unit: item.nutritionUnit,
    source: { ...item.source, name: item.name, provider: item.source?.provider || 'Saved food' } };
}

export function applySavedGrocery(current, stored) {
  return { ...current, name: stored.name, nutrition: savedFoodNutrition(stored),
    unit: current.quantity == null ? stored.nutritionUnit : current.unit };
}

export function matchSavedGrocery(current, library) {
  const matches = library.filter(entry => normalizeFoodName(entry.item.name) === normalizeFoodName(current.name));
  // Different historical labels need an explicit choice rather than a guess.
  return matches.length === 1 ? applySavedGrocery(current, matches[0].item) : current;
}

export function groceryCatalogUpdates(before, after) {
  const previous = new Map([...(before.items || []), ...(before.shopping || [])].map(item => [item.id, item]));
  return [...(after.items || []), ...(after.shopping || [])].filter(item => {
    const old = previous.get(item.id);
    return item.nutrition && (!old || old.name !== item.name || JSON.stringify(old.nutrition) !== JSON.stringify(item.nutrition));
  }).map(item => ({ name: item.name, quantity: item.nutrition.quantity, unit: item.nutrition.unit,
    nutrition: item.nutrition, source: item.nutrition.source }));
}
