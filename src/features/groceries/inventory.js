import { newItem, convert, canonicalUnit, round, ingredientKey } from './groceryData.js';
const nameKey = name => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
const baseUnit = unit => ['g', 'kg'].includes(canonicalUnit(unit)) ? 'g' : ['ml', 'L'].includes(canonicalUnit(unit)) ? 'ml' : canonicalUnit(unit);

function resolve(state, usage, active = false) {
  state.ingredientLinks ||= {};
  const linkedId = usage.itemId || state.ingredientLinks[usage.key];
  let item = linkedId && state.items.find(item => item.id === linkedId);
  if (usage.itemId && !item) throw new Error(`${usage.name}: its tracked stock record is missing. Restore that stock record before changing the diary entry.`);
  if (!item) {
    const compatible = state.items.filter(item => convert(1, usage.unit, item.unit) != null);
    const codeMatches = usage.code ? compatible.filter(item => (item.nutrition?.source?.code || item.ingredientCode) === usage.code) : [];
    const matches = codeMatches.length ? codeMatches : compatible.filter(item => nameKey(item.name) === nameKey(usage.name) &&
      !(usage.code && (item.nutrition?.source?.code || item.ingredientCode) && (item.nutrition?.source?.code || item.ingredientCode) !== usage.code));
    if (matches.length) item = matches[0];
    else {
      item = { ...newItem(usage.name, 0, usage.unit), recipeOnly: !active, ...(usage.code ? { ingredientCode: usage.code } : {}) };
      state.items.push(item);
    }
    state.ingredientLinks[usage.key] = item.id;
  }
  if (active) item.recipeOnly = false;
  return item;
}
export function linkRecipeInventory(state, recipes, days = []) {
  const next = structuredClone(state);
  for (const item of next.items) item.recipeRefs = [];
  const active = new Set(days.flatMap(day => day.meals.flatMap(meal => meal.items.map(item => item.recipeOrigin?.slug).filter(Boolean))));
  // Legacy recipe titles are used only to establish visibility, never to deduct stock.
  for (const recipe of recipes) {
    if (days.some(day => day.meals.some(meal => meal.items.some(item => item.source?.provider === 'Recipe' && item.name === recipe.title || item.source?.provider === 'Recipe ingredient' && item.source?.name === recipe.title)))) active.add(recipe.slug);
    [...recipe.ingredients, ...(recipe.sauces || [])].forEach((part, index) => {
      const unit = baseUnit(recipe.productNutrition?.items[index]?.unit || part.nutritionLabel?.unit || part.unit);

      const item = resolve(next, { key: ingredientKey(recipe, part, index), name: part.name, unit, code: recipe.productNutrition?.items[index]?.nutrition?.source?.code || part.nutritionLabel?.source?.code }, active.has(recipe.slug));
      item.recipeRefs ||= [];
      if (!item.recipeRefs.some(ref => ref.slug === recipe.slug)) item.recipeRefs.push({ slug: recipe.slug, title: recipe.title });
    });
  }
  return next;
}
function dayUsage(state, day, activate) {
  const entries = new Map();
  for (const meal of day?.meals || []) for (const food of meal.items) {
    const amounts = new Map();
    const usages = food.inventoryUsage || (food.unit !== 'servings' ? [{ key: `food:${food.source?.code || nameKey(food.name)}:${food.nutritionUnit}`, name: food.name, code: food.source?.code, unit: food.nutritionUnit, amount: 1 }] : []);
    for (const usage of usages) {
      if (!(usage.amount >= 0) || !Number.isFinite(usage.amount)) continue;
      const item = resolve(state, usage, activate);
      if (activate && food.inventoryUsage) usage.itemId = item.id;
      // For a single physical ingredient, the edited weight/volume is authoritative.
      const physical = convert(food.quantity, food.unit, usage.unit);
      const pieces = food.unit === 'pieces' && food.perPiece > 0 ? convert(food.quantity * food.perPiece, food.nutritionUnit, usage.unit) : null;
      const originalUnit = food.recipeOrigin?.baseline?.unit;
      const consumed = usages.length === 1 && food.unit !== 'servings' ? pieces ?? physical ?? (originalUnit === food.unit ? food.quantity * usage.amount : null) : food.quantity * usage.amount;
      if (consumed == null) throw new Error(`${food.name}: confirm a compatible stock unit or edible weight.`);
      const amount = convert(consumed, usage.unit, item.unit);
      if (amount == null) throw new Error(`${item.name}: stock unit no longer matches the logged food. Restore its unit before saving.`);
      amounts.set(item.id, round((amounts.get(item.id) || 0) + amount));
    }
    entries.set(`${day.date}/${meal.id}/${food.id}`, amounts);
  }
  return entries;
}
// A per-entry applied ledger distinguishes actual deductions from old or paused logs.
// Repeated saves reconcile to zero; deletion restores only stock actually deducted.
export function reconcileInventory(state, before, after) {
  const next = structuredClone(state);
  next.inventoryLedger ||= {};
  const previous = dayUsage(next, before, false);
  const current = dayUsage(next, after, true);
  const adjustments = [];
  for (const key of new Set([...previous.keys(), ...current.keys()])) {
    const old = previous.get(key) || new Map();
    const now = current.get(key) || new Map();
    const applied = next.inventoryLedger[key] || {};
    const updated = {};
    for (const itemId of new Set([...old.keys(), ...now.keys(), ...Object.keys(applied)])) {
      const item = next.items.find(item => item.id === itemId);
      if (!item) throw new Error('A tracked stock item was removed. Reload groceries before reconciling this entry.');
      const prior = applied[itemId] ? convert(applied[itemId].amount, applied[itemId].unit, item.unit) : 0;
      if (prior == null) throw new Error(`${item.name}: use the original stock unit before changing its diary entry.`);
      const delta = (now.get(itemId) || 0) - (old.get(itemId) || 0);
      const target = next.settings.stockTrackingPaused || item.stockTrackingPaused || item.removed ? prior : current.has(key) ? Math.max(0, round(prior + delta)) : 0;
      const change = round(target - prior);
      if (change && item.quantity != null) {
        item.quantity = round(item.quantity - change);
        adjustments.push({ entry: key, itemId, amount: change, unit: item.unit });
      }
      if (current.has(key) && item.quantity != null && target) updated[itemId] = { amount: target, unit: item.unit };
    }
    if (Object.keys(updated).length) next.inventoryLedger[key] = updated;
    else delete next.inventoryLedger[key];
  }
  return { state: next, adjustments };
}
