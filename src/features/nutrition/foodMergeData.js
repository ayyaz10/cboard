import { ingredientFromCatalog, normalizeFoodName } from './foodCatalog.js';
import { ingredientLabelNutrition } from '../recipes/ingredientNutrition.js';

export function mergeFoodReferencesInRecipe(recipe, mergeIds, selectedFoods, keptFood, catalog) {
  const removedIds = new Set(mergeIds);
  const replace = item => {
    if (!item || typeof item !== 'object') return item;
    if (item.foodId && catalog.some(food => food.id === item.foodId) && !removedIds.has(item.foodId)) return item;
    let match = item.foodId ? selectedFoods.find(food => food.id === item.foodId) : null;
    if (!match) {
      const nameKey = normalizeFoodName(item.name);
      const named = selectedFoods.filter(food => [food.name, ...(food.aliases || [])].some(name => normalizeFoodName(name) === nameKey));
      if (named.length && new Set(named.map(food => normalizeFoodName(food.name))).size === 1) match = named[0];
    }
    if (!match) return item;
    const linked = ingredientFromCatalog(item, keptFood);
    if (item.nutritionLabel?.amountPerUnit > 0) {
      linked.nutritionLabel.amountPerUnit = item.nutritionLabel.amountPerUnit;
      linked.nutritionLabel.recipeUnit = item.nutritionLabel.recipeUnit;
      linked.nutrition = ingredientLabelNutrition(linked);
    }
    return { ...linked, name: keptFood.name, foodId: keptFood.id };
  };
  return {
    ...recipe,
    ingredients: (recipe.ingredients || []).map(replace),
    sauces: (recipe.sauces || []).map(item => typeof item === 'string' ? item : replace(item)),
    alternatives: Object.fromEntries(Object.entries(recipe.alternatives || {}).map(([key, group]) => [key, { ...group, options: (group.options || []).map(replace) }])),
  };
}

export function mergeFoodNamesInGroceryState(state, selectedFoods, keptFood) {
  let changed = false;
  const replace = item => {
    if (!item || typeof item !== 'object') return item;
    const key = normalizeFoodName(item.name);
    const matches = selectedFoods.filter(food => [food.name, ...(food.aliases || [])].some(name => normalizeFoodName(name) === key));
    if (!matches.length || new Set(matches.map(food => normalizeFoodName(food.name))).size !== 1 || item.name === keptFood.name) return item;
    changed = true;
    return { ...item, name: keptFood.name };
  };
  const next = { ...state, items: (state.items || []).map(replace), shopping: (state.shopping || []).map(replace) };
  return { state: next, changed };
}
