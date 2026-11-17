import { NUTRIENTS } from '../nutrition/nutrients.js';
export const categories = {
  "Grains & Bakery": [
    "Oats",
    "Brown bread",
    "Protein tortilla wraps",
    "White rice",
  ],
  "Dairy & Eggs": ["Plain fat-free Greek yogurt", "Eggs", "Cheddar cheese"],
  "Meat & Poultry": ["Chicken breast"],
  Fruit: ["Bananas", "Apples"],
  Vegetables: [
    "Green peas",
    "Bell peppers",
    "Onions",
    "Carrots",
    "Lettuce",
    "Mushrooms",
    "Garlic",
    "Ginger",
  ],
  "Beans & Legumes": ["Pinto beans"],
  "Spreads & Sweeteners": [
    "Peanut butter",
    "Sugar-free syrup",
    "Sugar-free sweetener",
  ],
  "Sauces & Condiments": ["Soy sauce", "Sweet chilli sauce", "Sriracha sauce"],
  "Spices & Seasonings": [
    "Cinnamon powder",
    "Chilli flakes",
    "Fajita seasoning",
    "Taco seasoning",
  ],
  Supplements: ["Protein powder"],
};
export const icons = [
  "🌾",
  "🥚",
  "🍗",
  "🍎",
  "🥕",
  "🫘",
  "🥜",
  "🍶",
  "🧂",
  "🥤",
];
export const categoryIcon = (name) =>
  icons[Object.keys(categories).indexOf(name)] || "🛒";
export const units = [
  "pieces",
  "servings",
  "g",
  "kg",
  "ml",
  "L",
  "packs",
  "cans",
  "bottles",
];
export const round = (n) => Math.round(n * 10000) / 10000;
export function removeGroceryItems(state, ids, shopping = false) {
  const selected = new Set(ids);
  if (shopping) state.shopping = state.shopping.filter(item => !selected.has(item.id));
  else for (const item of state.items) {
    // Retain IDs referenced by diary snapshots and the inventory ledger.
    if (selected.has(item.id)) item.removed = true;
  }
  return state;
}
export const normalizeName = (name) =>
  name
    .toLowerCase()
    .replace(/[-]/g, " ")
    .replace(/\bplain\b/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/ies\b/g, "y")
    .replace(/s\b/g, "");

export function normalizeGroceryState(value) {
  const fallback = initialState();
  const state = value && typeof value === "object" ? structuredClone(value) : fallback;
  state.items = Array.isArray(state.items) ? state.items : fallback.items;
  state.wishlist = Array.isArray(state.wishlist) ? state.wishlist : [];
  state.shopping = Array.isArray(state.shopping) ? state.shopping : [];
  state.ingredientLinks = state.ingredientLinks && typeof state.ingredientLinks === 'object' ? state.ingredientLinks : {};
  state.unlinkedIngredients = Array.isArray(state.unlinkedIngredients) ? state.unlinkedIngredients.filter(key => typeof key === 'string') : [];
  state.receiptPurchaseLedger = state.receiptPurchaseLedger && typeof state.receiptPurchaseLedger === 'object' ? state.receiptPurchaseLedger : {};
  state.settings = { ...fallback.settings, ...(state.settings || {}) };
  if (!Number.isFinite(state.settings.lowStockThresholdPercent) || state.settings.lowStockThresholdPercent < 0 || state.settings.lowStockThresholdPercent > 100) state.settings.lowStockThresholdPercent = 45;
  if (typeof state.settings.showStockPercentage !== 'boolean') state.settings.showStockPercentage = false;
  state.migrations = state.migrations && typeof state.migrations === 'object' ? state.migrations : {};
  state.stockAlerts = Array.isArray(state.stockAlerts) ? state.stockAlerts : [];
  state.stockAlertSequence = Number.isSafeInteger(state.stockAlertSequence) && state.stockAlertSequence >= 0 ? state.stockAlertSequence : 0;
  let migratedNegativeItems = 0;
  for (const item of state.items) {
    if (Number.isFinite(item.quantity) && item.quantity < 0) {
      migratedNegativeItems++;
      item.shortage = round((Number.isFinite(item.shortage) ? Math.max(0, item.shortage) : 0) + Math.abs(item.quantity));
      item.quantity = 0;
    }
    item.shortage = Number.isFinite(item.shortage) && item.shortage >= 0 ? item.shortage : 0;
  }
  state.migrations.negativeStockV1 = true;
  state.migrations.negativeStockV1Count = Math.max(0, Number(state.migrations.negativeStockV1Count) || 0) + migratedNegativeItems;
  state.imageLibrary =
    state.imageLibrary && typeof state.imageLibrary === "object"
      ? state.imageLibrary
      : {};
  // Migrate earlier item-level images into one shared record, avoiding duplicate
  // base64 data in inventory and shopping entries.
  for (const item of [...state.items, ...state.shopping]) {
    if (typeof item.image === "string" && item.image.startsWith("data:image/"))
      state.imageLibrary[normalizeName(item.name)] = item.image;
    item.nutrition ??= null;
    if (item.thresholdEnabled == null) item.thresholdEnabled = Number.isFinite(item.threshold) && item.threshold > 0;
    item.estimatedPrice ??= null;
    item.priceQuantity ??= 1;
    delete item.image;
  }
  return state;
}

export const groceryImageFor = (state, name) =>
  state.imageLibrary?.[normalizeName(name)] || null;

export function setGroceryImage(state, name, image) {
  state.imageLibrary ||= {};
  const key = normalizeName(name);
  if (image) state.imageLibrary[key] = image;
  else delete state.imageLibrary[key];
  for (const item of [...state.items, ...state.shopping]) delete item.image;
  return state;
}
export function newItem(name, quantity = null, unit = "pieces", category) {
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    quantity,
    unit,
    category:
      category ||
      Object.keys(categories).find((c) =>
        categories[c].some((n) => normalizeName(n) === normalizeName(name)),
      ) ||
      "Other",
    nutrition: null,
    estimatedPrice: null,
    priceQuantity: 1,
    threshold: 0,
    thresholdEnabled: false,
    shortage: 0,
    expiry: "",
    location: "",
  };
}
export const initialState = () => ({
  ingredientLinks: {},
  unlinkedIngredients: [],
  items: Object.entries(categories).flatMap(([category, names]) =>
    names.map((name) =>
      newItem(
        name,
        null,
        /oats|yogurt|rice|cheese|chicken|powder|butter|beans|peas|seasoning|flakes/i.test(
          name,
        )
          ? "g"
          : /sauce|syrup/i.test(name)
            ? "ml"
            : "pieces",
        category,
      ),
    ),
  ),
  shopping: [],
  wishlist: [],
  imageLibrary: {},
  migrations: { negativeStockV1: true },
  settings: { currency: "GBP", autoImages: false, expiryReminders: true, imageLimit: 0, lowStockThresholdPercent: 45, showStockPercentage: false },
});
export function stockPercentage(item) {
  if (!Number.isFinite(item?.quantity) || item.quantity <= 0) return null;
  const baseline = item.stockBaseline;
  if (!Number.isFinite(baseline?.quantity) || baseline.quantity <= 0 || !baseline.unit) return null;
  const converted = convert(item.quantity, item.unit, baseline.unit);
  return converted == null ? null : converted / baseline.quantity * 100;
}
export function formatStockPercentage(value, thresholdPercent = 45) {
  if (!Number.isFinite(value)) return '';
  for (let digits = 1; digits <= 6; digits++) {
    const displayed = Number(value.toFixed(digits));
    if ((displayed < thresholdPercent) === (value < thresholdPercent)) return displayed.toFixed(digits);
  }
  return value.toFixed(6);
}
export const stockStatus = (item, thresholdPercent = 45) =>
  item.quantity == null || !Number.isFinite(item.quantity)
    ? "Unknown"
    : item.quantity <= 0
      ? "Out of stock"
      : stockPercentage(item) != null && stockPercentage(item) < thresholdPercent
        ? "Low stock"
        : stockPercentage(item) == null ? "Unknown" : "In stock";
export function checkGroceryIntegrity(state) {
  const issues = [];
  const canonical = new Set();
  for (const item of state.items || []) {
    if (item.quantity != null && (!Number.isFinite(item.quantity) || item.quantity < 0)) issues.push(`${item.name}: available stock is invalid.`);
    if (!Number.isFinite(item.shortage ?? 0) || (item.shortage ?? 0) < 0) issues.push(`${item.name}: shortage is invalid.`);
    if ((item.shortageHistory || []).some(event => !Number.isFinite(event.quantity) || event.quantity < 0 || typeof event.unit !== 'string')) issues.push(`${item.name}: historical shortage is invalid.`);
    if (item.thresholdEnabled && (!Number.isFinite(item.threshold) || item.threshold < 0)) issues.push(`${item.name}: low-stock threshold is invalid.`);
    if (!item.removed && item.foodId) {
      if (canonical.has(item.foodId)) issues.push(`${item.name}: duplicate Grocery rows use the same canonical food.`);
      canonical.add(item.foodId);
    }
  }
  const alertIds = new Set();
  for (const alert of state.stockAlerts || []) {
    if (!alert.id || alertIds.has(alert.id)) issues.push('Stock alerts contain a duplicate event identity.');
    alertIds.add(alert.id);
  }
  return issues;
}

export function recordStockTransitions(before, after, { at = Date.now() } = {}) {
  const prior = new Map((before.items || []).filter(item => !item.removed).map(item => [item.id, stockStatus(item, before.settings?.lowStockThresholdPercent ?? 45)]));
  const transitions = (after.items || []).filter(item => !item.removed && prior.has(item.id)).flatMap(item => {
    const from = prior.get(item.id), to = stockStatus(item, after.settings?.lowStockThresholdPercent ?? 45);
    return from !== to && ['Low stock', 'Out of stock'].includes(to) ? [{ itemId: item.id, name: item.name, from, to, quantity: item.quantity, unit: item.unit }] : [];
  });
  if (!transitions.length) return after;
  const out = transitions.filter(item => item.to === 'Out of stock'), low = transitions.filter(item => item.to === 'Low stock');
  const describe = (items, label) => items.length === 1
    ? `${items[0].name} is ${label.toLowerCase()}${label === 'Out of stock' ? '.' : ` — ${items[0].quantity} ${items[0].unit} remaining.`}`
    : `${items.length} Grocery items are now ${label.toLowerCase()}.`;
  const alerts = [];
  if (out.length) alerts.push({ id: crypto.randomUUID(), type: 'out', title: describe(out, 'Out of stock'), itemIds: out.map(item => item.itemId), items: out.map(({ name, quantity, unit }) => ({ name, quantity, unit })), at, read: false });
  if (low.length) alerts.push({ id: crypto.randomUUID(), type: 'low', title: describe(low, 'Low stock'), itemIds: low.map(item => item.itemId), items: low.map(({ name, quantity, unit }) => ({ name, quantity, unit })), at, read: false });
  after.stockAlerts = [...alerts, ...(after.stockAlerts || [])].slice(0, 50);
  return after;
}
export const increment = (unit) =>
  unit === "g" || unit === "ml" ? 50 : unit === "kg" || unit === "L" ? 0.25 : 1;
const aliases = {
  piece: "pieces",
  pcs: "pieces",
  whole: "pieces",
  medium: "pieces",
  large: "pieces",
  small: "pieces",
  gram: "g",
  grams: "g",
  kilogram: "kg",
  kilograms: "kg",
  litre: "L",
  litres: "L",
  l: "L",
  pack: "packs",
  can: "cans",
  bottle: "bottles",
  each: "pieces",
  unit: "pieces",
};
export const canonicalUnit = (unit) => aliases[unit?.toLowerCase()] || unit;
export function convert(amount, from, to) {
  from = canonicalUnit(from);
  to = canonicalUnit(to);
  if (!Number.isFinite(amount)) return null;
  if (from === to) return amount;
  const scale = {
    g: ["mass", 1],
    kg: ["mass", 1000],
    ml: ["volume", 1],
    L: ["volume", 1000],
  };
  return scale[from] && scale[to] && scale[from][0] === scale[to][0]
    ? round((amount * scale[from][1]) / scale[to][1])
    : null;
}
export function parseEntry(text) {
  const match = text
    .trim()
    .replace(/^[-•]\s*/, "")
    .match(
      /^(?:(\d+(?:\.\d+)?)\s+)?(?:(pieces|pcs|kg|grams?|g|ml|litres?|L|packs?|cans?|bottles?)\s+)?(.+)$/i,
    );
  if (!match || !match[3].trim()) throw new Error("Enter an item name.");
  return newItem(
    match[3],
    match[1] == null ? null : Number(match[1]),
    canonicalUnit(match[2]?.toLowerCase() || "pieces"),
  );
}
export const nutrients = NUTRIENTS.map(([key, label, unit]) => [key, label, unit]);
export function validateNutrition(nutrition) {
  if (nutrition == null) return;
  if (!Number.isFinite(nutrition.quantity) || nutrition.quantity <= 0 || !units.includes(nutrition.unit))
    throw new Error("Enter a nutrition basis greater than zero and a supported unit.");
  for (const [key, label] of nutrients)
    if (nutrition[key] != null && (!Number.isFinite(nutrition[key]) || nutrition[key] < 0))
      throw new Error(`${label} must be blank or a non-negative number.`);
}
// Calculate directly from ingredients: nutrition units are independent of stock units.
export const ingredientKey = (recipe, item, index) => `${recipe.slug}/${item.id || `ingredient:${index}`}`;
function recipeStock(recipe, ingredient, index, state) {
  const linkedId = state.ingredientLinks?.[ingredientKey(recipe, ingredient, index)];
  const linked = linkedId && state.items.find(item => item.id === linkedId);
  return (linked && !linked.removed ? linked : null) || state.items.find(item => !item.removed && ingredient.foodId && item.foodId === ingredient.foodId) || state.items.find(item => !item.removed && normalizeName(item.name) === normalizeName(ingredient.name));
}
export function recipeNutrition(recipe, state, multiplier = 1, foodCatalog = []) {
  const totals = Object.fromEntries(nutrients.map(([key]) => [key, { value: null, missing: [] }]));
  for (const [index, ingredient] of [...recipe.ingredients, ...(recipe.sauces || [])].entries()) {
    const food = ingredient.foodId && foodCatalog.find(item => item.id === ingredient.foodId);
    if (ingredient.nutritionTrackingEnabled === false || food?.nutritionTrackingEnabled === false) continue;
    const item = recipeStock(recipe, ingredient, index, state);
    const nutrition = item?.nutrition;
    const amount = nutrition && Number.isFinite(ingredient.amount) && ingredient.amount > 0
      ? convert(ingredient.amount * multiplier, ingredient.unit, nutrition.unit) : null;
    for (const [key] of nutrients) {
      const value = nutrition?.[key];
      if (amount == null || !Number.isFinite(nutrition?.quantity) || nutrition.quantity <= 0 ||
          !Number.isFinite(value) || value < 0) {
        totals[key].missing.push(ingredient.name);
      } else {
        totals[key].value = (totals[key].value ?? 0) + value * amount / nutrition.quantity;
      }
    }
  }
  return totals;
}
export function validatePrice(item) {
  if (item.estimatedPrice != null &&
      (!Number.isFinite(item.estimatedPrice) || item.estimatedPrice < 0 ||
       !Number.isFinite(item.priceQuantity) || item.priceQuantity <= 0))
    throw new Error("Enter a non-negative estimated price and a price quantity greater than zero.");
}
export function estimatedCost(item) {
  if (item.estimatedPrice == null || item.quantity == null) return null;
  validatePrice(item);
  return Math.round(item.estimatedPrice * item.quantity / item.priceQuantity * 100) / 100;
}
export function shoppingEstimate(items) {
  const costs = items.map(estimatedCost);
  return {
    total: Math.round(costs.reduce((sum, cost) => sum + (cost ?? 0), 0) * 100) / 100,
    missing: costs.filter((cost) => cost == null).length,
  };
}
function copyPrice(target, source) {
  if (source.estimatedPrice == null) return;
  const basis = convert(source.priceQuantity, source.unit, target.unit);
  if (basis == null) return;
  target.estimatedPrice = source.estimatedPrice;
  target.priceQuantity = basis;
}
export function addItems(state, entries, shopping = false) {
  const next = structuredClone(state);
  for (const entry of entries) {
    validatePrice(entry);
    validateNutrition(entry.nutrition);
    if (
      !entry.name.trim() ||
      !units.includes(entry.unit) ||
      (entry.quantity != null &&
        (!Number.isFinite(entry.quantity) || entry.quantity < 0))
    )
      throw new Error("Check item names, quantities and units.");
    if (shopping) {
      next.shopping = addShopping(next.shopping, entry, entry.quantity ?? 1);
      continue;
    }
    const existing = next.items.find(i => entry.foodId && i.foodId === entry.foodId) || next.items.find(
      (i) => normalizeName(i.name) === normalizeName(entry.name),
    );
    if (existing) {
      if (existing.removed) { existing.quantity = null; existing.removed = false; }
      existing.recipeOnly = false;
      copyPrice(existing, entry);
      if (entry.nutrition != null) existing.nutrition = structuredClone(entry.nutrition);
      if (entry.quantity == null) continue;
      const amount = convert(entry.quantity, entry.unit, existing.unit);
      if (amount == null)
        throw new Error(
          `${entry.name}: use ${existing.unit} or edit its unit first.`,
        );
      if (existing.quantity == null && !existing.stockBaseline && entry.quantity > 0) existing.stockBaseline = { quantity: entry.quantity, unit: entry.unit };
      existing.quantity = round((existing.quantity ?? 0) + amount);
    } else next.items.push({ ...entry, ...(entry.quantity != null && entry.quantity > 0 && !entry.stockBaseline ? { stockBaseline: { quantity: entry.quantity, unit: entry.unit } } : {}) });
  }
  return next;
}
export function addShopping(list, item, amount = 1, ensure = false) {
  validatePrice(item);
  validateNutrition(item.nutrition);
  const next = structuredClone(list);
  const existing = next.find(
    (i) =>
      ((item.foodId && i.foodId === item.foodId) || normalizeName(i.name) === normalizeName(item.name)) &&
      convert(amount, item.unit, i.unit) != null,
  );
  if (existing) {
    if (existing.nutrition == null && item.nutrition != null) existing.nutrition = structuredClone(item.nutrition);
    if (existing.estimatedPrice == null) copyPrice(existing, item);
    const converted = convert(amount, item.unit, existing.unit);
    existing.quantity = round(
      ensure
        ? Math.max(existing.quantity, converted)
        : existing.quantity + converted,
    );
  } else
    next.push({
      ...item,
      id: crypto.randomUUID(),
      quantity: amount,
    });
  return next;
}
export function restockStock(state, itemId, quantity, unit, currentQuantity, operationId = crypto.randomUUID(), shoppingEntryId = null) {
  const next = structuredClone(state);
  const item = next.items.find(row => row.id === itemId && !row.removed);
  if (!item || !Number.isFinite(quantity) || quantity <= 0) throw new Error('Enter the actual purchased quantity.');
  if (item.quantity == null && Number.isFinite(currentQuantity) && currentQuantity >= 0) item.quantity = currentQuantity;
  const amount = convert(quantity, unit, item.unit);
  if (amount == null || item.quantity == null) throw new Error(`Set ${item.name} stock and use a compatible unit before restocking.`);
  item.quantity = round(item.quantity + amount);
  next.restockOperations ||= [];
  const shoppingEntry = shoppingEntryId ? next.shopping.find(entry => entry.id === shoppingEntryId) : null;
  next.restockOperations.push({ id: operationId, itemId, amount, unit: item.unit, undone: false, at: Date.now(), ...(shoppingEntry ? { shoppingEntry: structuredClone(shoppingEntry) } : {}) });
  if (shoppingEntry) next.shopping = next.shopping.filter(entry => entry.id !== shoppingEntryId);
  next.restockOperations = next.restockOperations.slice(-50);
  return next;
}
export function undoRestockStock(state, operationId) {
  const next = structuredClone(state);
  const operation = (next.restockOperations || []).find(row => row.id === operationId);
  if (!operation || operation.undone) throw new Error('This restock was already undone or is no longer available.');
  const item = next.items.find(row => row.id === operation.itemId);
  if (!item || item.quantity == null) throw new Error('This Grocery item is no longer available to undo.');
  const amount = convert(operation.amount, operation.unit, item.unit);
  if (amount == null) throw new Error('The Grocery unit changed, so this restock cannot be undone safely.');
  const removed = Math.min(item.quantity, amount);
  item.quantity = round(item.quantity - removed);
  if (removed < amount) item.shortage = round((item.shortage || 0) + amount - removed);
  operation.undone = true;
  if (operation.shoppingEntry && !next.shopping.some(entry => entry.id === operation.shoppingEntry.id || ((operation.shoppingEntry.foodId && entry.foodId === operation.shoppingEntry.foodId) || normalizeName(entry.name) === normalizeName(operation.shoppingEntry.name)) && convert(1, operation.shoppingEntry.unit, entry.unit) != null)) next.shopping.push(structuredClone(operation.shoppingEntry));
  return next;
}
export function setShoppingCompleted(state, itemId, completed) {
  if (typeof completed !== 'boolean') throw new Error('Choose whether this shopping item is complete.');
  const next = structuredClone(state);
  const item = next.shopping.find(entry => entry.id === itemId);
  if (!item) throw new Error('This Shopping List item is no longer available.');
  item.checked = completed;
  return next;
}
export function purchase(state, purchases) {
  const next = structuredClone(state);
  for (const { id, quantity, currentQuantity, purchaseUnit: purchaseUnitOverride } of purchases) {
    const entry = next.shopping.find((i) => i.id === id);
    if (!entry) continue;
    if (!Number.isFinite(quantity) || quantity <= 0)
      throw new Error("Purchased amounts must be greater than zero.");
    const purchaseUnit = canonicalUnit(purchaseUnitOverride || entry.unit);
    const existing = next.items.find(
      (i) => (entry.foodId && i.foodId === entry.foodId) || normalizeName(i.name) === normalizeName(entry.name),
    );
    if (existing) {
      if (existing.removed) { existing.quantity = 0; existing.removed = false; }
      existing.recipeOnly = false;
      const amount = convert(quantity, purchaseUnit, existing.unit);
      if (
        existing.quantity == null &&
        Number.isFinite(currentQuantity) &&
        currentQuantity >= 0
      )
        existing.quantity = currentQuantity;
      if (amount == null || existing.quantity == null)
        throw new Error(
          `Set ${entry.name}'s stock quantity and compatible unit before purchasing.`,
        );
      existing.quantity = round(existing.quantity + amount);
      copyPrice(existing, entry);
      if (entry.nutrition != null) existing.nutrition = structuredClone(entry.nutrition);
    } else
      next.items.push(
        { ...newItem(entry.name, quantity, purchaseUnit, entry.category), stockBaseline: { quantity, unit: purchaseUnit },
          nutrition: structuredClone(entry.nutrition ?? null),
          estimatedPrice: entry.estimatedPrice ?? null, priceQuantity: entry.priceQuantity ?? 1 },
      );
    next.shopping = next.shopping.filter((i) => i.id !== id);
  }
  return next;
}
export function recipeNeeds(recipe, state, multiplier = 1, foodCatalog = []) {
  const grouped = [];
  for (const [index, ingredient] of [...recipe.ingredients, ...(recipe.sauces || [])].entries()) {
    const food = ingredient.foodId && foodCatalog.find(item => item.id === ingredient.foodId);
    if (ingredient.groceryTrackingEnabled === false || food?.groceryTrackingEnabled === false) continue;
    const unit = canonicalUnit(ingredient.unit);
    const amount =
      typeof ingredient.amount === "number" && ingredient.amount > 0
        ? round(ingredient.amount * multiplier)
        : null;
    const item = recipeStock(recipe, ingredient, index, state);
    const targetUnit = item?.unit || unit;
    const required = amount == null ? null : convert(amount, unit, targetUnit);
    const existing = grouped.find(
      (i) =>
        normalizeName(i.name) === normalizeName(ingredient.name) &&
        i.unit === targetUnit &&
        i.required != null &&
        required != null,
    );
    if (existing) existing.required = round(existing.required + required);
    else
      grouped.push({
        name: ingredient.name,
        itemId: item?.id,
        nutrition: structuredClone(item?.nutrition ?? null),
        estimatedPrice: item?.estimatedPrice ?? null,
        priceQuantity: item?.priceQuantity ?? 1,
        unit: targetUnit,
        required,
        quantityKnown: amount != null,
        available: item ? item.quantity : 0,
        category: item?.category || "Other",
        autoShoppingEnabled: ingredient.groceryTrackingEnabled !== false && ingredient.shoppingListEnabled !== false && food?.shoppingListEnabled !== false,
        image: groceryImageFor(state, ingredient.name),
      });
  }
  return grouped.map((i) => ({
    ...i,
    missing:
      i.required == null || i.available == null || !units.includes(i.unit)
        ? null
        : Math.max(0, round(i.required - i.available)),
  }));
}
export function plannedIngredientShortages(entries, recipes, state, foodCatalog = []) {
  const recipeBySlug = new Map(recipes.map(recipe => [recipe.slug, recipe]));
  const groups = [];
  for (const entry of entries.filter(item => item.slug)) {
    const recipe = recipeBySlug.get(entry.slug);
    if (!recipe) continue;
    const needs = recipeNeeds(recipe, state, entry.portions, foodCatalog);
    for (const need of needs) {
      const direct = (recipe.ingredients || []).find(item => normalizeName(item.name) === normalizeName(need.name));
      const identityBase = need.itemId || direct?.foodId || `name:${normalizeName(need.name)}`;
      const identity = `${identityBase}|prep:${normalizeName(direct?.preparation || direct?.note || "")}`;
      const sameIdentity = groups.filter(group => group.identity === identity);
      let group = sameIdentity.find(candidate => convert(1, need.unit, candidate.unit) != null);
      if (!group) {
        const pantryCandidates = state.items.filter(item => !item.removed && ((direct?.foodId && item.foodId === direct.foodId) || normalizeName(item.name) === normalizeName(need.name)));
        group = { key: `${identity}:${need.unit}`, identity, itemId: need.itemId, foodId: direct?.foodId || null, name: need.name, unit: need.unit, required: null, available: need.available, category: need.category, meals: [], issue: null, pantryCandidates: pantryCandidates.map(item => item.id) };
        if (pantryCandidates.length > 1) group.issue = 'Ambiguous pantry match';
        if (sameIdentity.length && !group.issue) group.issue = 'Incompatible units';
        groups.push(group);
      }
      if (need.required == null) group.issue ||= need.quantityKnown ? 'Incompatible units' : 'Quantity needs review';
      else {
        const converted = convert(need.required, need.unit, group.unit);
        if (converted == null) group.issue ||= 'Incompatible units';
        else group.required = round((group.required || 0) + converted);
      }
      group.meals.push(`${entry.meal}: ${recipe.title || recipe.name || entry.slug}`);
    }
  }
  return groups.map(group => {
    const available = Number.isFinite(group.available) ? group.available : group.itemId ? null : 0;
    const listedCandidates = state.shopping.filter(item => (group.foodId && item.foodId === group.foodId) || normalizeName(item.name) === normalizeName(group.name));
    const compatibleListed = listedCandidates.find(item => convert(1, group.unit, item.unit) != null);
    const listed = compatibleListed || listedCandidates[0];
    const issue = group.issue || (group.itemId && available == null ? 'Available pantry quantity needs review' : listedCandidates.length && !compatibleListed ? 'Incompatible shopping-list unit' : null);
    const shortage = issue || group.required == null ? null : Math.max(0, round(group.required - available));
    const listedQuantity = listed ? (compatibleListed ? convert(listed.quantity, listed.unit, group.unit) : listed.quantity) : null;
    const listedUnit = listed ? (compatibleListed ? group.unit : listed.unit) : null;
    return { ...group, issue, available, shortage, listedId: listed?.id || null, listedQuantity, listedUnit, listGap: shortage == null || listedQuantity == null || !compatibleListed ? shortage : Math.max(0, round(shortage - listedQuantity)) };
  });
}
export function cookRecipe(state, needs) {
  const next = structuredClone(state);
  for (const need of needs) {
    const item = next.items.find((i) => i.id === need.itemId);
    if (!item || item.quantity == null || !Number.isFinite(need.required) || need.required < 0)
      throw new Error("Set a known stock quantity and check recipe amounts before cooking.");
    const consumed = Math.min(item.quantity, need.required);
    item.quantity = round(item.quantity - consumed);
    item.shortage = round((item.shortage || 0) + need.required - consumed);
  }
  return next;
}
