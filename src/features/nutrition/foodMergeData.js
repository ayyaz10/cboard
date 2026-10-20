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
  const replace = (item, stock = false) => {
    if (!item || typeof item !== 'object') return item;
    const key = normalizeFoodName(item.name);
    const direct = selectedFoods.filter(food => food.id === item.foodId);
    const matches = direct.length ? direct : selectedFoods.filter(food => [food.name, ...(food.aliases || [])].some(name => normalizeFoodName(name) === key));
    if (!matches.length || new Set(matches.map(food => normalizeFoodName(food.name))).size !== 1) return item;
    const trackingDisabled = stock && keptFood.groceryTrackingEnabled === false;
    if (item.name === keptFood.name && item.foodId === keptFood.id && (item.trackingDisabled === true) === trackingDisabled) return item;
    changed = true;
    return { ...item, name: keptFood.name, foodId: keptFood.id, ...(stock ? { trackingDisabled } : {}) };
  };
  const receiptPurchaseLedger = Object.fromEntries(Object.entries(state.receiptPurchaseLedger || {}).map(([key,event]) => {
    if(selectedFoods.some(food=>food.id!==keptFood.id&&food.id===event.foodId)){changed=true;return [key,{...event,foodId:keptFood.id}]}
    return [key,event];
  }));
  const next = { ...state, items: (state.items || []).map(item => replace(item, true)), shopping: (state.shopping || []).map(item => replace(item)), receiptPurchaseLedger };
  return { state: next, changed };
}

export function unlinkDeletedFoodFromGroceryState(value, foodIds) {
  const state=structuredClone(value||{}),ids=new Set(foodIds||[]);let changed=false;
  for(const item of [...(state.items||[]),...(state.shopping||[])]) if(ids.has(item.foodId)) { delete item.foodId;delete item.trackingDisabled;changed=true; }
  for(const event of Object.values(state.receiptPurchaseLedger||{})) if(ids.has(event.foodId)) { event.foodId=null;changed=true; }
  return {state,changed};
}
