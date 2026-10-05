import { cleanLabelBasis } from './nutritionLabelReview.js';
import { cleanNutrients } from './nutrients.js';
import { ingredientLabelNutrition, ingredientRecipeTotals } from '../recipes/ingredientNutrition.js';
import { calculateProducts } from '../recipes/recipeProducts.js';

export const normalizeFoodName = value => String(value || '').trim().toLocaleLowerCase();

const LEADING_RECIPE_AMOUNT = /^[\d½¼¾⅓⅔⅛⅜⅝⅞.\/]+\s*(?:tsp|teaspoons?|tbsp|tablespoons?|cups?|g|grams?|kg|kilograms?|ml|millilit(?:er|re)s?|oz|ounces?|lb|pounds?|pieces?|cloves?)\s+(.+)$/i;

export function recipeFoodName(value) {
  const name = String(value || '').trim();
  return name.match(LEADING_RECIPE_AMOUNT)?.[1]?.trim() || name;
}

export function resolveCatalogFoodForIngredient(item, catalog = []) {
  if (item?.foodId) {
    const byId = catalog.find(food => food.id === item.foodId);
    if (byId) return byId;
  }
  const exactName = normalizeFoodName(item?.name);
  const exactMatches = catalog.filter(food => [food.name, ...(food.aliases || [])].some(name => normalizeFoodName(name) === exactName));
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) return null;
  const canonicalName = normalizeFoodName(recipeFoodName(item?.name));
  const matches = catalog.filter(food => [food.name, ...(food.aliases || [])].some(name => normalizeFoodName(name) === canonicalName));
  return matches.length === 1 ? matches[0] : null;
}

function newFoodId() {
  return globalThis.crypto?.randomUUID?.() || `food-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function cleanFoodCatalogItem(value) {
  const name = String(value?.name || '').trim().slice(0, 300);
  const quantity = Number(value?.quantity);
  const unit = String(value?.unit || 'g');
  if (!name || !Number.isFinite(quantity) || quantity <= 0 || !['g', 'ml', 'pieces', 'servings'].includes(unit)) return null;
  return {
    id: typeof value?.id === 'string' && value.id.trim() ? value.id.trim().slice(0, 150) : newFoodId(),
    name,
    aliases: Array.isArray(value?.aliases) ? [...new Set(value.aliases.filter(alias => typeof alias === 'string' && alias.trim() && normalizeFoodName(alias) !== normalizeFoodName(name)).map(alias => alias.trim().slice(0, 300)))].slice(0, 100) : [],
    quantity,
    unit,
    nutrition: cleanNutrients(value.nutrition),
    source: {
      code: String(value.source?.code || '').slice(0, 100),
      url: String(value.source?.url || '').slice(0, 1000),
      license: String(value.source?.license || '').slice(0, 100),
      provider: String(value.source?.provider || 'Manual').slice(0, 100),
      name: String(value.source?.name || name).slice(0, 500),
      modified: true,
      ...(cleanLabelBasis(value.source?.labelBasis) ? {labelBasis:cleanLabelBasis(value.source?.labelBasis)} : {}), 
    },
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
  };
}

export function mergeFoodCatalog(current = [], updates = []) {
  const items = new Map();
  for (const raw of current) {
    const clean = cleanFoodCatalogItem(raw);
    if (clean) items.set(clean.id, clean);
  }
  for (const update of updates) {
    const explicitId = typeof update?.id === 'string' && update.id.trim() ? update.id.trim() : null;
    const clean = cleanFoodCatalogItem(update);
    if (!clean) continue;
    if (!explicitId) {
      const matching = [...items.values()].filter(item => normalizeFoodName(item.name) === normalizeFoodName(clean.name));
      if (matching.length === 1) clean.id = matching[0].id;
    }
    const previous = items.get(clean.id);
    if (previous) clean.aliases = [...new Set([...(previous.aliases || []), ...(clean.aliases || []), ...(normalizeFoodName(previous.name) !== normalizeFoodName(clean.name) ? [previous.name] : [])])].filter(alias => normalizeFoodName(alias) !== normalizeFoodName(clean.name));
    items.set(clean.id, clean);
  }
  return [...items.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function catalogItemsFromDiaryMeal(meal) {
  return (meal?.items || []).filter(item => item.source?.modified).map(item => ({
    ...(item.foodId ? { id: item.foodId } : {}),
    name: item.name,
    quantity: item.basis,
    unit: item.nutritionUnit,
    nutrition: item.nutrition,
    source: item.source,
  })).filter(Boolean);
}

export function catalogItemFromRecipeIngredient(item) {
  const label = item?.nutritionLabel;
  if (!label) return null;
  const name = recipeFoodName(item.name);
  return { ...(item.foodId || label.source?.foodId ? { id: item.foodId || label.source.foodId } : {}), name,
    ...(normalizeFoodName(name) !== normalizeFoodName(item.name) ? { aliases: [item.name] } : {}),
    quantity: label.quantity, unit: label.unit, nutrition: label, source: label.source };
}

export function catalogItemsFromRecipe(recipe) {
  const ingredients = [...(recipe?.ingredients || []), ...(recipe?.sauces || []), ...Object.values(recipe?.alternatives || {}).flatMap(group => group?.options || [])];
  if (recipe?.productNutrition?.items) return recipe.productNutrition.items.map((product, index) => product?.nutrition && ingredients[index]?.name
    ? catalogItemFromRecipeIngredient({ ...ingredients[index], nutritionLabel: product.nutrition }) : null).filter(Boolean);
  return ingredients.map(catalogItemFromRecipeIngredient).filter(Boolean);
}

export function diaryItemFromCatalog(current, catalogItem) {
  return {
    ...current,
    foodId: catalogItem.id,
    basis: catalogItem.quantity,
    nutritionUnit: catalogItem.unit,
    unit: current.unit === current.nutritionUnit ? catalogItem.unit : current.unit,
    nutrition: { ...catalogItem.nutrition },
    source: { ...catalogItem.source, modified: false, mainFood: true },
  };
}

export function ingredientFromCatalog(current, catalogItem) {
  const nutritionLabel = { ...catalogItem.nutrition, quantity: catalogItem.quantity, unit: catalogItem.unit, source: { ...catalogItem.source, foodId: catalogItem.id } };
  const next = { ...current, foodId: catalogItem.id, name: catalogItem.name, nutritionLabel };
  next.nutrition = ingredientLabelNutrition(next);
  return next;
}

export function applyFoodCatalogToRecipes(recipes = [], catalog = []) {
  const replace = item => {
    if (item.nutritionLabel?.source?.recipeOnly) return item;
    const catalogItem = resolveCatalogFoodForIngredient(item, catalog);
    return catalogItem ? ingredientFromCatalog(item, catalogItem) : item;
  };
  return recipes.map(recipe => {
    if (recipe.productNutrition) {
      let matched = false;
      const products = recipe.productNutrition.items.map((product, index) => {
        const ingredient = [...(recipe.ingredients || []), ...(recipe.sauces || [])][index];
        if (!ingredient || ingredient.nutritionLabel?.source?.recipeOnly) return product;
        const food = resolveCatalogFoodForIngredient(ingredient, catalog);
        if (!food || food.unit !== product.unit) return product;
        matched = true;
        return { ...product, nutrition: { ...food.nutrition, quantity: food.quantity, unit: food.unit, source: { ...food.source } } };
      });
      if (!matched) return recipe;
      const calculated = calculateProducts(products, recipe.servings);
      return { ...recipe, productNutrition: { ...recipe.productNutrition, items: products }, nutrition: calculated.perServing,
        ingredients: recipe.ingredients.map((item, index) => ({ ...item, nutrition: calculated.ingredients[index] })),
        sauces: (recipe.sauces || []).map((item, index) => ({ ...item, nutrition: calculated.ingredients[recipe.ingredients.length + index] })) };
    }
    const next = {
      ...recipe,
      ingredients: (recipe.ingredients || []).map(replace),
      sauces: (recipe.sauces || []).map(replace),
      alternatives: Object.fromEntries(Object.entries(recipe.alternatives || {}).map(([key, group]) => [key, { ...group, options: (group.options || []).map(replace) }])),
    };
    if (next.nutritionFromIngredients) next.nutrition = ingredientRecipeTotals(next);
    return next;
  });
}

export function catalogIngredient(item) {
  return {
    foodId: item.id,
    name: item.name,
    amount: item.quantity,
    unit: item.unit,
    note: 'Uses your main food nutrition record.',
    nutritionLabel: { ...item.nutrition, quantity: item.quantity, unit: item.unit, source: { ...item.source } },
  };
}
