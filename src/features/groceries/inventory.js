import { newItem, convert, canonicalUnit, round, ingredientKey, recordStockTransitions, normalizeGroceryState } from './groceryData.js';
const nameKey = name => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
const baseUnit = unit => ['g', 'kg'].includes(canonicalUnit(unit)) ? 'g' : ['ml', 'L'].includes(canonicalUnit(unit)) ? 'ml' : canonicalUnit(unit);

function resolve(state, usage, active = false, foodCatalog = []) {
  state.ingredientLinks ||= {};
  const linkedId = usage.itemId || state.ingredientLinks[usage.key];
  let item = linkedId && state.items.find(item => item.id === linkedId);
  const food = usage.foodId && foodCatalog.find(food => food.id === usage.foodId);
  const track = usage.groceryTrackingEnabled !== false && food?.groceryTrackingEnabled !== false;
  if (!track) {
    item ||= state.items.find(item => !item.removed && usage.foodId && item.foodId === usage.foodId);
    if (item && food) { item.foodId = food.id; item.trackingDisabled = true; }
    if (linkedId && item) state.ingredientLinks[usage.key] = item.id;
    return item || null;
  }
  if (usage.itemId && !item) throw new Error(`${usage.name}: its tracked stock record is missing. Restore that stock record before changing the diary entry.`);
  if (!item) {
    const compatible = state.items.filter(item => !item.removed && convert(1, usage.unit, item.unit) != null);
    const foodMatches = usage.foodId ? compatible.filter(item => item.foodId === usage.foodId) : [];
    const codeMatches = usage.code ? compatible.filter(item => (item.nutrition?.source?.code || item.ingredientCode) === usage.code) : [];
    const matches = foodMatches.length ? foodMatches : codeMatches.length ? codeMatches : compatible.filter(item => nameKey(item.name) === nameKey(usage.name) &&
      !(usage.code && (item.nutrition?.source?.code || item.ingredientCode) && (item.nutrition?.source?.code || item.ingredientCode) !== usage.code));
    if (matches.length) item = matches[0];
    else {
      item = { ...newItem(usage.name, 0, usage.unit), recipeOnly: !active, ...(usage.code ? { ingredientCode: usage.code } : {}) };
      state.items.push(item);
    }
    state.ingredientLinks[usage.key] = item.id;
  }
  if (food) { item.foodId = food.id; item.trackingDisabled = false; }
  if (active) item.recipeOnly = false;
  return item;
}
export function linkRecipeInventory(state, recipes, days = [], foodCatalog = []) {
  const next = structuredClone(state);
  for (const item of next.items) {
    const matches = foodCatalog.filter(food => item.foodId === food.id || [food.name, ...(food.aliases || [])].some(name => nameKey(name) === nameKey(item.name)));
    if (matches.length === 1) {
      item.foodId = matches[0].id;
      item.trackingDisabled = matches[0].groceryTrackingEnabled === false;
    }
  }
  for (const item of next.items) item.recipeRefs = [];
  const active = new Set(days.flatMap(day => day.meals.flatMap(meal => meal.items.map(item => item.recipeOrigin?.slug).filter(Boolean))));
  // Legacy recipe titles are used only to establish visibility, never to deduct stock.
  for (const recipe of recipes) {
    if (days.some(day => day.meals.some(meal => meal.items.some(item => item.source?.provider === 'Recipe' && item.name === recipe.title || item.source?.provider === 'Recipe ingredient' && item.source?.name === recipe.title)))) active.add(recipe.slug);
    [...recipe.ingredients, ...(recipe.sauces || [])].forEach((part, index) => {
      const unit = baseUnit(recipe.productNutrition?.items[index]?.unit || part.nutritionLabel?.unit || part.unit);

      const food = part.foodId && foodCatalog.find(food => food.id === part.foodId);
      const matchingFood = food || foodCatalog.find(candidate => [candidate.name, ...(candidate.aliases || [])].some(name => nameKey(name) === nameKey(part.name)));
      const item = resolve(next, { ...(matchingFood ? { foodId: matchingFood.id, groceryTrackingEnabled: matchingFood.groceryTrackingEnabled } : {}), key: ingredientKey(recipe, part, index), name: part.name, unit, code: recipe.productNutrition?.items[index]?.nutrition?.source?.code || part.nutritionLabel?.source?.code }, active.has(recipe.slug), foodCatalog);
      if (!item) return;
      item.recipeRefs ||= [];
      if (!item.recipeRefs.some(ref => ref.slug === recipe.slug)) item.recipeRefs.push({ slug: recipe.slug, title: recipe.title });
    });
  }
  return next;
}
function dayUsage(state, day, activate, foodCatalog = []) {
  const entries = new Map();
  entries.warnings = new Set();
  for (const meal of day?.meals || []) for (const food of meal.items) {
    const amounts = new Map();
    const usages = food.inventoryUsage || (food.unit !== 'servings' ? [{ key: `food:${food.source?.code || nameKey(food.name)}:${food.nutritionUnit}`, name: food.name, code: food.source?.code, unit: food.nutritionUnit, amount: 1 }] : []);
    for (const usage of usages) {
      if (!(usage.amount >= 0) || !Number.isFinite(usage.amount)) continue;
      const linkedStockId = usage.itemId || state.ingredientLinks?.[usage.key];
      const linkedStock = linkedStockId && state.items.find(item => item.id === linkedStockId);
      const usageFood = foodCatalog.find(food => food.id === usage.foodId || food.id === linkedStock?.foodId ||
        [food.name, ...(food.aliases || [])].some(name => nameKey(name) === nameKey(usage.name)));
      const foodDisabled = usage.groceryTrackingEnabled === false || usageFood?.groceryTrackingEnabled === false;
      if (foodDisabled) continue;
      const item = resolve(state, usage, activate, foodCatalog);
      if (!item) continue;
      if (activate && food.inventoryUsage) usage.itemId = item.id;
      // For a single physical ingredient, the edited weight/volume is authoritative.
      const physical = convert(food.quantity, food.unit, usage.unit);
      const pieces = food.unit === 'pieces' && food.perPiece > 0 ? convert(food.quantity * food.perPiece, food.nutritionUnit, usage.unit) : null;
      const originalUnit = food.recipeOrigin?.baseline?.unit;
      const consumed = usages.length === 1 && food.unit !== 'servings' ? pieces ?? physical ?? (originalUnit === food.unit ? food.quantity * usage.amount : null) : food.quantity * usage.amount;
      if (consumed == null) throw new Error(`${food.name}: confirm a compatible stock unit or edible weight.`);
      const amount = convert(consumed, usage.unit, item.unit);
      if (amount == null) {
        entries.warnings.add(`${item.name}: diary saved, but grocery stock was not adjusted because its unit does not match the logged food. Restore the original stock unit to reconcile it.`);
        continue;
      }
      amounts.set(item.id, round((amounts.get(item.id) || 0) + amount));
    }
    entries.set(`${day.date}/${meal.id}/${food.id}`, amounts);
  }
  return entries;
}
// A per-entry applied ledger distinguishes actual deductions from old or paused logs.
// Repeated saves reconcile to zero; deletion restores only stock actually deducted.
export function reconcileInventory(state, before, after, foodCatalog = []) {
  const next = normalizeGroceryState(state);
  const original = structuredClone(next);
  next.inventoryLedger ||= {};
  const previous = dayUsage(next, before, false, foodCatalog);
  const current = dayUsage(next, after, true, foodCatalog);
  const warnings = new Set([...previous.warnings, ...current.warnings]);
  const adjustments = [];
  for (const key of new Set([...previous.keys(), ...current.keys()])) {
    const old = previous.get(key) || new Map();
    const now = current.get(key) || new Map();
    const applied = next.inventoryLedger[key] || {};
    const updated = {};
    for (const itemId of new Set([...old.keys(), ...now.keys(), ...Object.keys(applied)])) {
      const item = next.items.find(item => item.id === itemId);
      if (!item) throw new Error('A tracked stock item was removed. Reload groceries before reconciling this entry.');
      const record = applied[itemId];
      const legacy = record && !Number.isFinite(record.requested);
      const prior = record ? convert(legacy ? record.amount : record.requested, record.unit, item.unit) : 0;
      const priorConsumedInUnit = record && !legacy ? convert(record.consumed || 0, record.unit, item.unit) : 0;
      const priorShortageInUnit = record && !legacy ? convert(record.shortage || 0, record.unit, item.unit) : 0;
      if (prior == null || priorConsumedInUnit == null || priorShortageInUnit == null) {
        if (!after) throw new Error(`${item.name}: use the original stock unit before deleting this diary entry.`);
        warnings.add(`${item.name}: diary saved, but grocery stock was not adjusted because its unit changed. Restore the original stock unit to reconcile it.`);
        updated[itemId] = applied[itemId];
        continue;
      }
      const delta = (now.get(itemId) || 0) - (old.get(itemId) || 0);
      const foodTrackingDisabled = foodCatalog.find(food => food.id === item.foodId)?.groceryTrackingEnabled === false || item.trackingDisabled === true;
      const paused = next.settings.stockTrackingPaused || item.stockTrackingPaused || item.removed || foodTrackingDisabled;
      const priorConsumed = legacy ? 0 : Math.max(0, priorConsumedInUnit);
      const priorShortage = legacy ? 0 : Math.max(0, priorShortageInUnit);
      if (paused) {
        if (applied[itemId]) updated[itemId] = structuredClone(applied[itemId]);
        continue;
      }
      let requested = round(Math.max(0, prior + delta)), consumed = priorConsumed, shortage = priorShortage;
      if (legacy) {
        // Old ledgers stored requested use but cannot identify which part became negative.
        // Keep that historical shortage intact and reconcile only future changes.
        requested = round(Math.max(0, prior + delta));
      } else if (item.quantity != null) {
        if (delta > 0) {
          const used = Math.min(item.quantity, delta);
          item.quantity = round(item.quantity - used);
          consumed = round(consumed + used);
          const short = round(delta - used);
          shortage = round(shortage + short);
          item.shortage = round((item.shortage || 0) + short);
          if (used) adjustments.push({ entry: key, itemId, amount: used, unit: item.unit, requested: delta, shortage: short });
        } else if (delta < 0) {
          let released = Math.min(shortage, -delta);
          shortage = round(shortage - released);
          item.shortage = round(Math.max(0, (item.shortage || 0) - released));
          let refund = Math.min(consumed, -delta - released);
          consumed = round(consumed - refund);
          item.quantity = round(item.quantity + refund);
          if (refund || released) adjustments.push({ entry: key, itemId, amount: -refund, unit: item.unit, requested: delta, shortage: -released });
        }
      }
      // Unknown quantities stay unknown and do not invent consumption or shortage.
      if (item.quantity != null && requested > 0) updated[itemId] = { requested, consumed, shortage, unit: item.unit, ...(legacy ? { legacy: true } : {}) };
    }
    if (Object.keys(updated).length) next.inventoryLedger[key] = updated;
    else delete next.inventoryLedger[key];
  }
  recordStockTransitions(original, next);
  return { state: next, adjustments, warnings: [...warnings] };
}
