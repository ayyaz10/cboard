import { cleanLabelBasis } from './nutritionLabelReview.js';
import { cleanNutrients } from './nutrients.js';
import { ingredientLabelNutrition, ingredientRecipeTotals } from '../recipes/ingredientNutrition.js';
import { calculateProducts } from '../recipes/recipeProducts.js';

export { normalizeFoodName, normalizeFoodText, parseFoodQuantityPrefix, recipeFoodName, validFoodBarcode, scoreFoodMatch, findFoodMatches, findPossibleFoodDuplicateGroups, auditFoodDuplicates } from './foodIdentity.js';
import { normalizeFoodName, normalizeFoodText, parseFoodQuantityPrefix, recipeFoodName, scoreFoodMatch, validFoodBarcode } from './foodIdentity.js';

export function catalogFoodCandidatesForIngredient(item, catalog = []) {
  if (item?.foodId) {
    const byId = catalog.find(food => food.id === item.foodId);
    if (byId) return [byId];
  }
  const exactName = normalizeFoodText(item?.name);
  const exactMatches = catalog.filter(food => [food.name, ...(food.aliases || [])].some(name => normalizeFoodText(name) === exactName));
  if (exactMatches.length) return exactMatches;
  const canonicalName = normalizeFoodName(item?.name);
  const matches = catalog.filter(food => [food.name, ...(food.aliases || [])].some(name => normalizeFoodName(name) === canonicalName));
  return matches;
}

export function resolveCatalogFoodForIngredient(item, catalog = []) {
  const matches = catalogFoodCandidatesForIngredient(item, catalog);
  return matches.length === 1 ? matches[0] : null;
}

export function foodNutritionConflicts(foods = []) {
  const keys = ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugars', 'saturatedFat', 'salt', 'sodium', 'potassium', 'calcium', 'iron', 'magnesium', 'zinc', 'vitaminA', 'vitaminC', 'vitaminD', 'vitaminE', 'vitaminB12', 'folate', 'energyKJ'];
  return keys.filter(key => new Set(foods.map(food => food.nutrition?.[key]).filter(value => Number.isFinite(value))).size > 1);
}

export function mergeCanonicalFoods(foods = [], keepId, mergeIds = [], nutritionSourceId = keepId) {
  const selectedIds = new Set([keepId, ...mergeIds]);
  const selected = foods.filter(food => selectedIds.has(food.id));
  const keep = selected.find(food => food.id === keepId);
  const nutritionSource = selected.find(food => food.id === nutritionSourceId) || keep;
  if (!keep || selected.length !== selectedIds.size || !nutritionSource) throw new Error('Choose valid foods to merge.');
  const nutrition = { ...(keep.nutrition || {}) };
  for (const food of selected) for (const [key, value] of Object.entries(food.nutrition || {})) if (nutrition[key] == null && value != null) nutrition[key] = value;
  for (const [key, value] of Object.entries(nutritionSource.nutrition || {})) if (value != null) nutrition[key] = value;
  const quantityPrefix = !keep.barcode && !keep.sku && !keep.brand ? parseFoodQuantityPrefix(keep.name) : null;
  const canonicalName = quantityPrefix?.foodName || keep.name;
  return cleanFoodCatalogItem({ ...keep, name: canonicalName,
    aliases: [...new Set([...selected.flatMap(food => [food.name, ...(food.aliases || [])]), ...(keep.aliases || [])])].filter(name => normalizeFoodText(name) !== normalizeFoodText(canonicalName)),
    nutrition,
    barcode: keep.barcode || nutritionSource.barcode,
    sku: keep.sku || nutritionSource.sku,
    retailer: keep.retailer || nutritionSource.retailer,
    brand: keep.brand || nutritionSource.brand,
    source: { ...(nutritionSource.source || {}), ...(keep.source || {}), name: nutritionSource.source?.name || keep.source?.name || keep.name },
  });
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
    canonicalKey: normalizeFoodName(name),
    aliases: Array.isArray(value?.aliases) ? [...new Set(value.aliases.filter(alias => typeof alias === 'string' && alias.trim() && normalizeFoodText(alias) !== normalizeFoodText(name)).map(alias => alias.trim().slice(0, 300)))].slice(0, 100) : [],
    barcode: validFoodBarcode(value?.barcode || value?.source?.barcode || value?.source?.code) || '',
    sku: String(value?.sku || value?.source?.sku || '').trim().slice(0, 120),
    retailer: String(value?.retailer || value?.source?.retailer || '').trim().slice(0, 120),
    brand: String(value?.brand || value?.source?.brand || '').trim().slice(0, 120),
    quantity,
    unit,
    nutrition: cleanNutrients(value.nutrition),
    source: {
      code: String(value.source?.code || '').slice(0, 100),
      url: String(value.source?.url || '').slice(0, 1000),
      license: String(value.source?.license || '').slice(0, 100),
      provider: String(value.source?.provider || 'Manual').slice(0, 100),
      name: String(value.source?.name || name).slice(0, 500),
      brand: String(value.source?.brand || value.brand || '').slice(0, 120),
      retailer: String(value.source?.retailer || value.retailer || '').slice(0, 120),
      sku: String(value.source?.sku || value.sku || '').slice(0, 120),
      barcode: validFoodBarcode(value.barcode || value.source?.barcode || value.source?.code),
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
      const matching = [...items.values()].filter(item => {
        const result = scoreFoodMatch(clean, item);
        return result.confidence === 'certain' || result.confidence === 'high';
      });
      if (matching.length === 1) {
        clean.id = matching[0].id;
        clean.name = matching[0].name;
      }
    }
    const previous = items.get(clean.id);
    if (previous) {
      if (!explicitId) {
        clean.name = previous.name;
        clean.nutrition = Object.fromEntries(Object.keys(previous.nutrition || {}).map(key => [key, clean.nutrition[key] ?? previous.nutrition[key] ?? null]));
        clean.source = { ...clean.source, ...previous.source };
        clean.barcode = previous.barcode || clean.barcode;
        clean.sku = previous.sku || clean.sku;
        clean.retailer = previous.retailer || clean.retailer;
        clean.brand = previous.brand || clean.brand;
      }
      clean.aliases = [...new Set([...(previous.aliases || []), ...(clean.aliases || []), ...(normalizeFoodText(previous.name) !== normalizeFoodText(clean.name) ? [previous.name] : [])])].filter(alias => normalizeFoodText(alias) !== normalizeFoodText(clean.name));
    }
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
    ...(normalizeFoodText(name) !== normalizeFoodText(item.name) ? { aliases: [item.name] } : {}),
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
