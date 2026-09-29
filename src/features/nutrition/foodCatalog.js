import { cleanNutrients } from './nutrients.js';
import { ingredientLabelNutrition, ingredientRecipeTotals } from '../recipes/ingredientNutrition.js';

export const normalizeFoodName = value => String(value || '').trim().toLocaleLowerCase();

export function cleanFoodCatalogItem(value) {
  const name = String(value?.name || '').trim().slice(0, 300);
  const quantity = Number(value?.quantity);
  const unit = String(value?.unit || 'g');
  if (!name || !Number.isFinite(quantity) || quantity <= 0 || !['g', 'ml', 'pieces', 'servings'].includes(unit)) return null;
  return {
    name,
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
    },
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
  };
}

export function mergeFoodCatalog(current = [], updates = []) {
  const items = new Map(current.map(item => [normalizeFoodName(item.name), cleanFoodCatalogItem(item)]).filter(([, item]) => item));
  for (const update of updates) {
    const clean = cleanFoodCatalogItem(update);
    if (clean) items.set(normalizeFoodName(clean.name), clean);
  }
  return [...items.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function catalogItemsFromDiaryMeal(meal) {
  return (meal?.items || []).filter(item => item.source?.modified).map(item => cleanFoodCatalogItem({
    name: item.name,
    quantity: item.basis,
    unit: item.nutritionUnit,
    nutrition: item.nutrition,
    source: item.source,
  })).filter(Boolean);
}

export function catalogItemFromRecipeIngredient(item) {
  const label = item?.nutritionLabel;
  return label ? cleanFoodCatalogItem({ name: item.name, quantity: label.quantity, unit: label.unit, nutrition: label, source: label.source }) : null;
}

export function catalogItemsFromRecipe(recipe) {
  const ingredients = [...(recipe?.ingredients || []), ...(recipe?.sauces || [])];
  if (recipe?.productNutrition?.items) return recipe.productNutrition.items.map((product, index) => product?.nutrition ? cleanFoodCatalogItem({ name: ingredients[index]?.name, quantity: product.nutrition.quantity, unit: product.nutrition.unit, nutrition: product.nutrition, source: product.nutrition.source }) : null).filter(Boolean);
  return ingredients.map(catalogItemFromRecipeIngredient).filter(Boolean);
}

export function diaryItemFromCatalog(current, catalogItem) {
  return {
    ...current,
    basis: catalogItem.quantity,
    nutritionUnit: catalogItem.unit,
    unit: current.unit === current.nutritionUnit ? catalogItem.unit : current.unit,
    nutrition: { ...catalogItem.nutrition },
    source: { ...catalogItem.source, modified: false, mainFood: true },
  };
}

export function ingredientFromCatalog(current, catalogItem) {
  const nutritionLabel = { ...catalogItem.nutrition, quantity: catalogItem.quantity, unit: catalogItem.unit, source: { ...catalogItem.source } };
  const next = { ...current, nutritionLabel };
  next.nutrition = ingredientLabelNutrition(next);
  return next;
}

export function applyFoodCatalogToRecipes(recipes = [], catalog = []) {
  const byName = new Map(catalog.map(item => [normalizeFoodName(item.name), item]));
  const replace = item => {
    const catalogItem = byName.get(normalizeFoodName(item?.name));
    return catalogItem ? ingredientFromCatalog(item, catalogItem) : item;
  };
  return recipes.map(recipe => {
    if (recipe.productNutrition) return recipe;
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
    name: item.name,
    amount: item.quantity,
    unit: item.unit,
    note: 'Uses your main food nutrition record.',
    nutritionLabel: { ...item.nutrition, quantity: item.quantity, unit: item.unit, source: { ...item.source } },
  };
}
