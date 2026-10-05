import { catalogFoodCandidatesForIngredient } from './foodCatalog.js';

function recipeFoods(recipe) {
  const alternatives = Object.values(recipe?.alternatives || {}).flatMap(group => group?.options || []);
  return [...(recipe?.ingredients || []), ...(recipe?.sauces || []), ...alternatives].filter(item => item?.name);
}

function foodMatchesForRecipe(recipe, catalog) {
  const ids = new Map();
  for (const item of recipeFoods(recipe)) {
    const matches = catalogFoodCandidatesForIngredient(item, catalog);
    const hasValidId = Boolean(item.foodId && catalog.some(food => food.id === item.foodId));
    const ambiguous = matches.length > 1 && !hasValidId;
    for (const food of matches) {
      const previous = ids.get(food.id);
      ids.set(food.id, { possible: previous ? previous.possible && ambiguous : ambiguous });
    }
  }
  return ids;
}

export function getFoodUsage(food, { catalog = [], recipes = [], mealPlans = [] } = {}) {
  if (!food?.id) return { recipes: [], possibleRecipes: [], mealPlans: [], groceryReferences: [], historicalSnapshots: 0, referenceCount: 0, canHardDelete: true };
  const recipeMatches = recipes.flatMap(recipe => {
    const match = foodMatchesForRecipe(recipe, catalog).get(food.id);
    return match ? [{ slug: recipe.slug, title: recipe.title, possible: match.possible }] : [];
  });
  const usedBy = recipeMatches.filter(recipe => !recipe.possible).map(({ slug, title }) => ({ slug, title }));
  const possibleRecipes = recipeMatches.filter(recipe => recipe.possible).map(({ slug, title }) => ({ slug, title }));
  const usedRecipeSlugs = new Set(recipeMatches.map(recipe => recipe.slug));
  const usedByPlans = mealPlans.filter(plan => (plan.entries || []).some(entry => usedRecipeSlugs.has(entry.slug)))
    .map(plan => ({ id: plan.id, name: plan.name, source: plan.source }));
  // Diary meals and grocery entries persist nutrition snapshots; they do not
  // resolve live nutrition from the catalog and therefore do not block deletion.
  return { recipes: usedBy, possibleRecipes, mealPlans: usedByPlans, groceryReferences: [], historicalSnapshots: 0, referenceCount: usedBy.length + possibleRecipes.length + usedByPlans.length, canHardDelete: usedBy.length === 0 && possibleRecipes.length === 0 && usedByPlans.length === 0 };
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
  const removedIds = new Set(deletedRecipes.flatMap(recipe => [...foodMatchesForRecipe(recipe, catalog).keys()]));
  const deletedSlugs = new Set(deletedRecipes.map(recipe => recipe?.slug));
  const remainingRecipes = recipes.filter(item => !deletedSlugs.has(item.slug));
  const plannedDeletedSlugs = new Set(mealPlans.flatMap(plan => (plan.entries || []).map(entry => entry.slug).filter(slug => deletedSlugs.has(slug))));
  const keptByPlans = new Set(deletedRecipes.filter(recipe => plannedDeletedSlugs.has(recipe.slug)).flatMap(recipe => [...foodMatchesForRecipe(recipe, catalog).keys()]));
  return catalog.filter(food => removedIds.has(food.id) && !keptByPlans.has(food.id) && getFoodUsage(food, { catalog, recipes: remainingRecipes, mealPlans }).canHardDelete);
}
