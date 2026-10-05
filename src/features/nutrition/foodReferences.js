import { normalizeFoodName } from './foodCatalog.js';

function recipeFoods(recipe) {
  const alternatives = Object.values(recipe?.alternatives || {}).flatMap(group => group?.options || []);
  return [...(recipe?.ingredients || []), ...(recipe?.sauces || []), ...alternatives].filter(item => item?.name);
}

function foodIdsForRecipe(recipe, catalog) {
  const byName = new Map();
  for (const food of catalog) {
    for (const name of [food.name, ...(food.aliases || [])]) {
      const key = normalizeFoodName(name);
      byName.set(key, [...(byName.get(key) || []), food]);
    }
  }
  const ids = new Set();
  for (const item of recipeFoods(recipe)) {
    if (item.foodId) {
      if (catalog.some(food => food.id === item.foodId)) ids.add(item.foodId);
      continue;
    }
    const matches = byName.get(normalizeFoodName(item.name)) || [];
    if (matches.length === 1) ids.add(matches[0].id);
  }
  return ids;
}

export function getFoodUsage(food, { catalog = [], recipes = [], mealPlans = [] } = {}) {
  if (!food?.id) return { recipes: [], mealPlans: [], groceryReferences: [], historicalSnapshots: 0, referenceCount: 0, canHardDelete: true };
  const usedBy = recipes.filter(recipe => foodIdsForRecipe(recipe, catalog).has(food.id))
    .map(recipe => ({ slug: recipe.slug, title: recipe.title }));
  const usedRecipeSlugs = new Set(usedBy.map(recipe => recipe.slug));
  const usedByPlans = mealPlans.filter(plan => (plan.entries || []).some(entry => usedRecipeSlugs.has(entry.slug)))
    .map(plan => ({ id: plan.id, name: plan.name, source: plan.source }));
  // Diary meals and grocery entries persist nutrition snapshots; they do not
  // resolve live nutrition from the catalog and therefore do not block deletion.
  return { recipes: usedBy, mealPlans: usedByPlans, groceryReferences: [], historicalSnapshots: 0, referenceCount: usedBy.length + usedByPlans.length, canHardDelete: usedBy.length === 0 && usedByPlans.length === 0 };
}

export function classifyFoodDeletion(ids, { catalog = [], recipes = [], mealPlans = [] } = {}) {
  const selected = new Set(ids);
  const safe = [], inUse = [];
  for (const food of catalog.filter(item => selected.has(item.id))) {
    const usage = getFoodUsage(food, { catalog, recipes, mealPlans });
    (usage.canHardDelete ? safe : inUse).push({ food, usage });
  }
  return { safe, inUse };
}

export function getOrphanFoodsAfterRecipeDelete(recipe, catalog = [], recipes = [], mealPlans = []) {
  return getOrphanFoodsAfterRecipesDelete([recipe], catalog, recipes, mealPlans);
}

export function getOrphanFoodsAfterRecipesDelete(deletedRecipes, catalog = [], recipes = [], mealPlans = []) {
  const removedIds = new Set(deletedRecipes.flatMap(recipe => [...foodIdsForRecipe(recipe, catalog)]));
  const deletedSlugs = new Set(deletedRecipes.map(recipe => recipe?.slug));
  const remainingRecipes = recipes.filter(item => !deletedSlugs.has(item.slug));
  const plannedDeletedSlugs = new Set(mealPlans.flatMap(plan => (plan.entries || []).map(entry => entry.slug).filter(slug => deletedSlugs.has(slug))));
  const keptByPlans = new Set(deletedRecipes.filter(recipe => plannedDeletedSlugs.has(recipe.slug)).flatMap(recipe => [...foodIdsForRecipe(recipe, catalog)]));
  return catalog.filter(food => removedIds.has(food.id) && !keptByPlans.has(food.id) && getFoodUsage(food, { catalog, recipes: remainingRecipes, mealPlans }).canHardDelete);
}
