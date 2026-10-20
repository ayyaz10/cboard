import { cleanLabelBasis } from './nutritionLabelReview.js';
import { cleanNutrients, cleanNutrientSources, nutrientSourcesForValues } from './nutrients.js';
import { ingredientLabelNutrition, ingredientRecipeTotals } from '../recipes/ingredientNutrition.js';
import { calculateProducts } from '../recipes/recipeProducts.js';

export { normalizeFoodName, normalizeFoodText, parseFoodQuantityPrefix, parseIngredientText, normalizeRecipeIngredient, normalizeRecipeUnit, RECIPE_INGREDIENT_UNITS, recipeFoodName, validFoodBarcode, scoreFoodMatch, findFoodMatches, findPossibleFoodDuplicateGroups, auditFoodDuplicates } from './foodIdentity.js';
import { normalizeFoodName, normalizeFoodText, parseFoodQuantityPrefix, recipeFoodName, scoreFoodMatch, validFoodBarcode } from './foodIdentity.js';

export function catalogFoodCandidatesForIngredient(item, catalog = []) {
  const candidateName = recipeFoodName(item?.name);
  const markedSeparate = food => (food.separateAliases || []).some(alias => normalizeFoodName(alias) === normalizeFoodName(candidateName));
  if (item?.foodId) {
    const byId = catalog.find(food => food.id === item.foodId);
    if (byId) return [byId];
  }
  const exactName = normalizeFoodText(item?.name);
  const exactMatches = catalog.filter(food => !markedSeparate(food) && [food.name, ...(food.aliases || [])].some(name => normalizeFoodText(name) === exactName));
  if (exactMatches.length) return exactMatches;
  const canonicalName = normalizeFoodName(item?.name);
  const matches = catalog.filter(food => !markedSeparate(food) && [food.name, ...(food.aliases || [])].some(name => normalizeFoodName(name) === canonicalName));
  return matches;
}

export function resolveCatalogFoodForIngredient(item, catalog = []) {
  const matches = catalogFoodCandidatesForIngredient(item, catalog);
  return matches.length === 1 ? matches[0] : null;
}

const semanticTokens = value => normalizeFoodName(value).replace(/\bspring onions?\b/g, 'springonion').split(' ').map(token => ({
  thighs: 'thigh', fillets: 'fillet', breasts: 'breast', wings: 'wing', legs: 'leg',
  tomatoes: 'tomato', chillies: 'chili', cilantro: 'coriander', scallion: 'springonion', scallions: 'springonion',
  aubergine: 'eggplant', courgette: 'zucchini', capsicum: 'pepper',
}[token] || token)).filter(token => token && !['aldi', 'tesco', 'asda', 'lidl', 'sainsburys', 'cooperative', 'coop', 'boneless', 'bone', 'skinless', 'skin', 'fillet'].includes(token));

const foodDescriptors = value => {
  const text = normalizeFoodName(value);
  const percent = text.match(/\b(\d+(?:\.\d+)?)\s*%/);
  return {
    protein: (text.match(/\b(chicken|turkey|beef|pork|lamb|duck|salmon|tuna|cod|prawn|shrimp|tofu|egg|peanut|almond)\b/) || [])[1] || '',
    cut: ((text.match(/\b(thighs?|breasts?|wings?|legs?|drumsticks?|tenderloins?|fillets?)\b/) || [])[1] || '').replace(/s$/, ''),
    state: /\b(cooked|roasted|boiled|fried|grilled|raw|uncooked)\b/.exec(text)?.[1] || '',
    fat: /\b(skimmed|semi skimmed|whole|full fat|low fat|fat free|0%)\b/.exec(text)?.[1] || '',
    form: /\b(powder|powdered|spread|butter|milk|yogurt|yoghurt|rice|white|brown|salted|unsalted|sweetened|unsweetened)\b/.exec(text)?.[1] || '',
    bone: /\b(boneless|bone in|bone-in)\b/.exec(text)?.[1] || '',
    skin: /\b(skinless|skin on|skin-on)\b/.exec(text)?.[1] || '',
    percent: percent?.[1] || '',
  };
};

function semanticFoodMatch(candidate, food) {
  const leftText = recipeFoodName(candidate?.name), rightText = food?.name || '';
  const left = foodDescriptors(leftText), right = foodDescriptors(rightText);
  const brands = ['aldi', 'tesco', 'asda', 'lidl', 'sainsburys', 'waitrose', 'morrisons', 'costco'];
  const leftBrand = brands.find(brand => normalizeFoodText(candidate?.brand || candidate?.retailer || leftText).split(' ').includes(brand)) || '';
  const rightBrand = brands.find(brand => normalizeFoodText(food?.brand || food?.retailer || rightText).split(' ').includes(brand)) || '';
  if (leftBrand && rightBrand && leftBrand !== rightBrand) return null;
  const incompatible = ['protein', 'cut', 'state', 'fat', 'form', 'bone', 'skin', 'percent'].some(key => left[key] && right[key] && left[key] !== right[key])
    || !left.state && Boolean(right.state) || !left.fat && Boolean(right.fat) || !left.percent && Boolean(right.percent);
  if (incompatible) return null;
  const leftTokens = new Set(semanticTokens(leftText)), rightTokens = new Set(semanticTokens(rightText));
  const core = ['protein', 'cut'].filter(key => left[key]);
  if (core.some(key => !right[key] || left[key] !== right[key])) return null;
  const overlap = [...leftTokens].filter(token => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  if (!core.length && (!leftTokens.size || [...leftTokens].some(token => !rightTokens.has(token)) || rightTokens.size - leftTokens.size > 1)) return null;
  const score = core.length === 2 ? 0.92 + Math.min(0.04, overlap / Math.max(1, union) * 0.04) + (leftBrand && leftBrand === rightBrand ? 0.04 : 0)
    : core.length ? 0.72 : 0.92 + (leftBrand && leftBrand === rightBrand ? 0.04 : 0);
  return { food, score, confidence: score >= 0.9 && !(leftBrand && !rightBrand) ? 'high' : 'review', reasons: [core.length ? `${[left.protein, left.cut].filter(Boolean).join(' ')} attributes match` : 'ingredient synonym match'], semantic: true };
}

export function findRecipeFoodMatches(item, catalog = []) {
  const idMatch = item?.foodId && catalog.find(food => food.id === item.foodId);
  if (idMatch) return [{ food: idMatch, score: 1, confidence: 'certain', reasons: ['food ID matches'], semantic: false }];
  const name = recipeFoodName(item?.name), normalized = normalizeFoodName(name);
  const exact = catalog.filter(food => !(food.separateAliases || []).some(alias => normalizeFoodName(alias) === normalized) && [food.name, ...(food.aliases || [])].some(alias => normalizeFoodName(alias) === normalized));
  if (exact.length) return exact.map(food => {
    const comparison = scoreFoodMatch({ ...item, name }, food);
    const conflict = comparison.conflict && comparison.confidence === 'review';
    return { food, score: 1, confidence: exact.length === 1 && !conflict ? 'high' : 'review', reasons: conflict ? comparison.reasons : ['name or saved alias matches'], semantic: false };
  });
  return catalog.filter(food => !(food.separateAliases || []).some(alias => normalizeFoodName(alias) === normalized))
    .map(food => semanticFoodMatch({ ...item, name }, food)).filter(Boolean)
    .sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name));
}

export function resolveRecipeFoodCandidate(item, catalog = []) {
  const matches = findRecipeFoodMatches(item, catalog);
  if (!matches.length) return { status: 'none', food: null, matches: [] };
  if (matches.length > 1) {
    const top = matches[0], second = matches[1];
    if (top.score - second.score < 0.08 || top.confidence === 'review' || second.score >= 0.9)
      return { status: 'review', food: null, matches };
  }
  const best = matches[0];
  return best.confidence === 'certain' || best.confidence === 'high'
    ? { status: 'matched', food: best.food, match: best, matches }
    : { status: 'review', food: null, matches };
}

export function resolveRecipeIngredients(recipe, catalog = []) {
  let matched = 0, review = 0, noMatch = 0;
  const resolve = item => {
    if (item.foodId && catalog.some(food => food.id === item.foodId) || item.nutritionLabel?.source?.recipeOnly) return item;
    const result = resolveRecipeFoodCandidate(item, catalog);
    if (result.status === 'matched') { matched++; return ingredientFromCatalog(item, result.food); }
    if (result.status === 'review') review++; else noMatch++;
    return item;
  };
  const next = { ...recipe, ingredients: (recipe.ingredients || []).map(resolve), sauces: (recipe.sauces || []).map(resolve), alternatives: Object.fromEntries(Object.entries(recipe.alternatives || {}).map(([key, group]) => [key, { ...group, options: (group.options || []).map(resolve) }])) };
  const hasRecipeNutrition = Object.values(recipe.nutrition || {}).some(value => Number.isFinite(value));
  if (matched && !hasRecipeNutrition) {
    next.nutritionFromIngredients = true;
    next.nutrition = ingredientRecipeTotals(next);
  } else if (next.nutritionFromIngredients) next.nutrition = ingredientRecipeTotals(next);
  return {
    recipe: next,
    summary: { matched, review, noMatch },
  };
}

export function foodNutritionConflicts(foods = []) {
  const keys = ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugars', 'saturatedFat', 'salt', 'sodium', 'potassium', 'calcium', 'iron', 'magnesium', 'zinc', 'vitaminA', 'vitaminC', 'vitaminD', 'vitaminE', 'vitaminB12', 'folate', 'energyKJ'];
  return keys.filter(key => new Set(foods.map(food => food.nutrition?.[key]).filter(value => Number.isFinite(value))).size > 1);
}

export function mergeCanonicalFoods(foods = [], keepId, mergeIds = [], nutritionSourceId = keepId, behaviorSourceId = keepId) {
  const selectedIds = new Set([keepId, ...mergeIds]);
  const selected = foods.filter(food => selectedIds.has(food.id));
  const keep = selected.find(food => food.id === keepId);
  const nutritionSource = selected.find(food => food.id === nutritionSourceId) || keep;
  if (!keep || selected.length !== selectedIds.size || !nutritionSource) throw new Error('Choose valid foods to merge.');
  const nutrition = { ...(keep.nutrition || {}) };
  const nutrientSources = { ...(keep.nutrientSources || {}) };
  for (const food of selected) for (const [key, value] of Object.entries(food.nutrition || {})) if (nutrition[key] == null && value != null) {
    nutrition[key] = value;
    if (food.nutrientSources?.[key]) nutrientSources[key] = food.nutrientSources[key];
  }
  for (const [key, value] of Object.entries(nutritionSource.nutrition || {})) if (value != null) {
    nutrition[key] = value;
    if (nutritionSource.nutrientSources?.[key]) nutrientSources[key] = nutritionSource.nutrientSources[key];
  }
  const quantityPrefix = !keep.barcode && !keep.sku && !keep.brand ? parseFoodQuantityPrefix(keep.name) : null;
  const canonicalName = quantityPrefix?.foodName || keep.name;
  const behaviorSource = selected.find(food => food.id === behaviorSourceId) || keep;
  return cleanFoodCatalogItem({ ...keep, name: canonicalName,
    aliases: [...new Set([...selected.flatMap(food => [food.name, ...(food.aliases || [])]), ...(keep.aliases || [])])].filter(name => normalizeFoodText(name) !== normalizeFoodText(canonicalName)),
    receiptMappings: [...new Map(selected.flatMap(food => food.receiptMappings || []).map(mapping => [`${normalizeFoodText(mapping.retailer)}:${mapping.productCode}`, mapping])).values()],
    nutrition, nutrientSources,
    groceryTrackingEnabled: behaviorSource.groceryTrackingEnabled,
    shoppingListEnabled: behaviorSource.shoppingListEnabled,
    nutritionTrackingEnabled: behaviorSource.nutritionTrackingEnabled,
    barcode: keep.barcode || nutritionSource.barcode,
    sku: keep.sku || nutritionSource.sku,
    retailer: keep.retailer || nutritionSource.retailer,
    brand: keep.brand || nutritionSource.brand,
    source: { ...(nutritionSource.source || {}), ...(keep.source || {}), name: nutritionSource.source?.name || keep.source?.name || keep.name },
  });
}

export function foodBehaviorConflicts(foods = []) {
  return ['groceryTrackingEnabled', 'shoppingListEnabled', 'nutritionTrackingEnabled']
    .filter(key => new Set(foods.map(food => food[key] !== false)).size > 1);
}

function newFoodId() {
  return globalThis.crypto?.randomUUID?.() || `food-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const nutritionSourcePriority = sourceType => {
  const source = String(sourceType || '').toLowerCase();
  if (source.includes('label') || source.includes('manual')) return 100;
  if (source.includes('openfoodfacts')) return 80;
  if (source.includes('cofid') || source.includes('usda')) return 50;
  return 40;
};

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
    separateAliases: Array.isArray(value?.separateAliases) ? [...new Set(value.separateAliases.filter(alias => typeof alias === 'string' && alias.trim()).map(alias => alias.trim().slice(0, 300)))].slice(0, 100) : [],
    receiptMappings: Array.isArray(value?.receiptMappings) ? value.receiptMappings.filter(mapping => mapping && typeof mapping === 'object' && typeof mapping.productCode === 'string' && /^\d{5,8}$/.test(mapping.productCode) && typeof mapping.retailer === 'string' && mapping.retailer.trim()).map(mapping => ({ retailer: mapping.retailer.trim().slice(0,120), productCode: mapping.productCode, alias: String(mapping.alias || '').trim().slice(0,300) })).slice(0,200) : [],
    barcode: validFoodBarcode(value?.barcode || value?.source?.barcode || value?.source?.code) || '',
    sku: String(value?.sku || value?.source?.sku || '').trim().slice(0, 120),
    retailer: String(value?.retailer || value?.source?.retailer || '').trim().slice(0, 120),
    brand: String(value?.brand || value?.source?.brand || '').trim().slice(0, 120),
    quantity,
    unit,
    groceryTrackingEnabled: value?.groceryTrackingEnabled !== false,
    shoppingListEnabled: value?.groceryTrackingEnabled === false ? false : value?.shoppingListEnabled !== false,
    nutritionTrackingEnabled: value?.nutritionTrackingEnabled !== false,
    nutrition: cleanNutrients(value.nutrition),
    nutrientSources: cleanNutrientSources({ ...nutrientSourcesForValues(value.nutrition, value.source), ...(value.nutrientSources || value.nutrition?.nutrientSources || {}) }),
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
      ...(value.source?.sourceType ? {sourceType:String(value.source.sourceType).slice(0,80)} : {}),
      ...(value.source?.ocrProvider ? {ocrProvider:String(value.source.ocrProvider).slice(0,80)} : {}),
      ...(value.source?.ocrModel ? {ocrModel:String(value.source.ocrModel).slice(0,100)} : {}),
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
      for (const key of ['groceryTrackingEnabled', 'shoppingListEnabled', 'nutritionTrackingEnabled'])
        if (update?.[key] === undefined) clean[key] = previous[key] !== false;
      if (!explicitId) {
        clean.name = previous.name;
        const selectedSources = {};
        clean.nutrition = Object.fromEntries(Object.keys(previous.nutrition || {}).map(key => {
          const incoming = clean.nutrition[key], existing = previous.nutrition[key];
          const incomingSource = clean.nutrientSources?.[key] || { sourceType: clean.source?.provider };
          const existingSource = previous.nutrientSources?.[key] || { sourceType: previous.source?.provider };
          const preferIncoming = incoming != null && (existing == null || nutritionSourcePriority(incomingSource.sourceType) >= nutritionSourcePriority(existingSource.sourceType));
          selectedSources[key] = preferIncoming ? incomingSource : existingSource;
          return [key, preferIncoming ? incoming : existing ?? null];
        }));
        clean.nutrientSources = cleanNutrientSources(selectedSources);
        clean.source = { ...clean.source, ...previous.source };
        clean.barcode = previous.barcode || clean.barcode;
        clean.sku = previous.sku || clean.sku;
        clean.retailer = previous.retailer || clean.retailer;
        clean.brand = previous.brand || clean.brand;
      }
      clean.aliases = [...new Set([...(previous.aliases || []), ...(clean.aliases || []), ...(normalizeFoodText(previous.name) !== normalizeFoodText(clean.name) ? [previous.name] : [])])].filter(alias => normalizeFoodText(alias) !== normalizeFoodText(clean.name));
      clean.separateAliases = [...new Set([...(previous.separateAliases || []), ...(clean.separateAliases || [])])];
      clean.receiptMappings = [...new Map([...(previous.receiptMappings || []), ...(clean.receiptMappings || [])].map(mapping => [`${normalizeFoodText(mapping.retailer)}:${mapping.productCode}`, mapping])).values()].slice(0,200);
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
    nutrientSources: item.nutrientSources,
    source: item.source,
  })).filter(Boolean);
}

export function catalogItemFromRecipeIngredient(item) {
  const label = item?.nutritionLabel;
  if (item?.foodId && (!label || label.source?.foodId === item.foodId)) return null;
  const name = recipeFoodName(item.name);
  const unit = ['g', 'ml', 'pieces', 'servings'].includes(label?.unit) ? label.unit : 'g';
  const quantity = Number.isFinite(Number(label?.quantity)) && Number(label.quantity) > 0 ? Number(label.quantity) : 100;
  return { ...(item.foodId || label?.source?.foodId ? { id: item.foodId || label.source.foodId } : {}), name,
    ...(normalizeFoodText(name) !== normalizeFoodText(item.name) ? { aliases: [item.name] } : {}),
    quantity, unit, nutrition: label || {}, nutrientSources: label?.nutrientSources || {},
    source: label?.source || { provider: 'Recipe ingredient', name } };
}

export function catalogItemsFromRecipe(recipe) {
  const ingredients = [...(recipe?.ingredients || []), ...(recipe?.sauces || []), ...Object.values(recipe?.alternatives || {}).flatMap(group => group?.options || [])];
  return ingredients.map((ingredient, index) => {
    const productNutrition = recipe?.productNutrition?.items?.[index]?.nutrition;
    return catalogItemFromRecipeIngredient({ ...ingredient, nutritionLabel: ingredient.nutritionLabel || productNutrition });
  }).filter(Boolean);
}

export function diaryItemFromCatalog(current, catalogItem) {
  return {
    ...current,
    foodId: catalogItem.id,
    nutritionExcluded: catalogItem.nutritionTrackingEnabled === false,
    groceryTrackingEnabled: catalogItem.groceryTrackingEnabled !== false,
    basis: catalogItem.quantity,
    nutritionUnit: catalogItem.unit,
    unit: current.unit === current.nutritionUnit ? catalogItem.unit : current.unit,
    nutrition: { ...catalogItem.nutrition },
    nutrientSources: { ...catalogItem.nutrientSources },
    source: { ...catalogItem.source, modified: false, mainFood: true },
  };
}

export function ingredientFromCatalog(current, catalogItem) {
  const nutritionLabel = { ...catalogItem.nutrition, nutrientSources: catalogItem.nutrientSources, quantity: catalogItem.quantity, unit: catalogItem.unit, source: { ...catalogItem.source, foodId: catalogItem.id, foodName: catalogItem.name } };
  const hasRecipeNutrition = Object.values(current.nutrition || {}).some(value => Number.isFinite(value));
  const nutritionOverride = current.nutritionOverride === true || !current.foodId && !current.nutritionLabel && hasRecipeNutrition;
  const next = { ...current, foodId: catalogItem.id, name: current.name || catalogItem.name, nutritionLabel, nutrientSources: catalogItem.nutrientSources,
    groceryTrackingEnabled: catalogItem.groceryTrackingEnabled !== false,
    shoppingListEnabled: catalogItem.groceryTrackingEnabled !== false && catalogItem.shoppingListEnabled !== false,
    nutritionTrackingEnabled: catalogItem.nutritionTrackingEnabled !== false,
    ...(nutritionOverride ? { nutritionOverride: true } : { nutritionOverride: false }) };
  next.nutrition = nutritionOverride ? { ...current.nutrition } : ingredientLabelNutrition(next);
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
      const parts = [...(recipe.ingredients || []), ...(recipe.sauces || [])];
      const withPreferences = parts.map(item => {
        const food = resolveCatalogFoodForIngredient(item, catalog);
        return food ? { ...item, foodId: food.id, groceryTrackingEnabled: food.groceryTrackingEnabled !== false,
          shoppingListEnabled: food.groceryTrackingEnabled !== false && food.shoppingListEnabled !== false,
          nutritionTrackingEnabled: food.nutritionTrackingEnabled !== false } : item;
      });
      const calculated = calculateProducts(products.filter((_, index) => withPreferences[index]?.nutritionTrackingEnabled !== false), recipe.servings);
      let nutritionIndex = 0;
      return { ...recipe, productNutrition: { ...recipe.productNutrition, items: products }, nutrition: calculated.perServing,
        ingredients: recipe.ingredients.map((_, index) => ({ ...withPreferences[index], nutrition: withPreferences[index].nutritionTrackingEnabled === false ? withPreferences[index].nutrition : calculated.ingredients[nutritionIndex++] })),
        sauces: (recipe.sauces || []).map((_, index) => { const item = withPreferences[recipe.ingredients.length + index]; return { ...item, nutrition: item.nutritionTrackingEnabled === false ? item.nutrition : calculated.ingredients[nutritionIndex++] }; }) };
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
    groceryTrackingEnabled: item.groceryTrackingEnabled !== false,
    shoppingListEnabled: item.groceryTrackingEnabled !== false && item.shoppingListEnabled !== false,
    nutritionTrackingEnabled: item.nutritionTrackingEnabled !== false,
    name: item.name,
    amount: item.quantity,
    unit: item.unit,
    note: 'Uses your main food nutrition record.',
    nutritionLabel: { ...item.nutrition, nutrientSources: item.nutrientSources, quantity: item.quantity, unit: item.unit, source: { ...item.source } },
  };
}
