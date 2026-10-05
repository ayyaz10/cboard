import { cleanLabelBasis } from './nutritionLabelReview.js';
import { cleanNutrients } from './nutrients.js';
import { ingredientLabelNutrition, ingredientRecipeTotals } from '../recipes/ingredientNutrition.js';
import { calculateProducts } from '../recipes/recipeProducts.js';

export const normalizeFoodName = value => String(value || '').trim().toLocaleLowerCase();

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
  return label ? { ...(item.foodId || label.source?.foodId ? { id: item.foodId || label.source.foodId } : {}), name: item.name, quantity: label.quantity, unit: label.unit, nutrition: label, source: label.source } : null;
}

export function catalogItemsFromRecipe(recipe) {
  const ingredients = [...(recipe?.ingredients || []), ...(recipe?.sauces || [])];
  if (recipe?.productNutrition?.items) return recipe.productNutrition.items.map((product, index) => product?.nutrition ? { ...(ingredients[index]?.foodId ? { id: ingredients[index].foodId } : {}), name: ingredients[index]?.name, quantity: product.nutrition.quantity, unit: product.nutrition.unit, nutrition: product.nutrition, source: product.nutrition.source } : null).filter(Boolean);
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
  const byId = new Map(catalog.map(item => [item.id, item]));
  const byName = new Map();
  catalog.forEach(item => {
    for (const name of [item.name, ...(item.aliases || [])]) {
      const key = normalizeFoodName(name);
      byName.set(key, [...(byName.get(key) || []), item]);
    }
  });
  const replace = item => {
    if (item.nutritionLabel?.source?.recipeOnly) return item;
    const matches = byName.get(normalizeFoodName(item?.name)) || [];
    const catalogItem = item?.foodId ? byId.get(item.foodId) : (matches.length === 1 ? matches[0] : null);
    return catalogItem ? ingredientFromCatalog(item, catalogItem) : item;
  };
  return recipes.map(recipe => {
    if (recipe.productNutrition) {
      let matched = false;
      const products = recipe.productNutrition.items.map((product, index) => {
        const ingredient = [...(recipe.ingredients || []), ...(recipe.sauces || [])][index];
        if (!ingredient || ingredient.nutritionLabel?.source?.recipeOnly) return product;
        const nameMatches = byName.get(normalizeFoodName(ingredient.name)) || [];
        const food = ingredient.foodId ? byId.get(ingredient.foodId) : nameMatches.length === 1 ? nameMatches[0] : null;
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
