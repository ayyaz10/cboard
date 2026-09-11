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
  "g",
  "kg",
  "ml",
  "L",
  "packs",
  "cans",
  "bottles",
];
export const round = (n) => Math.round(n * 10000) / 10000;
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
  state.shopping = Array.isArray(state.shopping) ? state.shopping : [];
  state.settings = { ...fallback.settings, ...(state.settings || {}) };
  state.imageLibrary =
    state.imageLibrary && typeof state.imageLibrary === "object"
      ? state.imageLibrary
      : {};
  // Migrate earlier item-level images into one shared record, avoiding duplicate
  // base64 data in inventory and shopping entries.
  for (const item of [...state.items, ...state.shopping]) {
    if (typeof item.image === "string" && item.image.startsWith("data:image/"))
      state.imageLibrary[normalizeName(item.name)] = item.image;
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
    threshold: 0,
    expiry: "",
    location: "",
  };
}
export const initialState = () => ({
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
  imageLibrary: {},
  settings: { autoImages: false, expiryReminders: true, imageLimit: 0 },
});
export const stockStatus = (item) =>
  item.quantity == null
    ? "Set quantity"
    : item.quantity === 0
      ? "Out of stock"
      : item.quantity <= item.threshold
        ? "Low stock"
        : "In stock";
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
export function addItems(state, entries, shopping = false) {
  const next = structuredClone(state);
  for (const entry of entries) {
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
    const existing = next.items.find(
      (i) => normalizeName(i.name) === normalizeName(entry.name),
    );
    if (existing) {
      if (entry.quantity == null) continue;
      const amount = convert(entry.quantity, entry.unit, existing.unit);
      if (amount == null)
        throw new Error(
          `${entry.name}: use ${existing.unit} or edit its unit first.`,
        );
      existing.quantity = round((existing.quantity ?? 0) + amount);
    } else next.items.push(entry);
  }
  return next;
}
export function addShopping(list, item, amount = 1, ensure = false) {
  const next = structuredClone(list);
  const existing = next.find(
    (i) =>
      normalizeName(i.name) === normalizeName(item.name) &&
      convert(amount, item.unit, i.unit) != null,
  );
  if (existing) {
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
export function purchase(state, purchases) {
  const next = structuredClone(state);
  for (const { id, quantity, currentQuantity } of purchases) {
    const entry = next.shopping.find((i) => i.id === id);
    if (!entry) continue;
    if (!Number.isFinite(quantity) || quantity <= 0)
      throw new Error("Purchased amounts must be greater than zero.");
    const existing = next.items.find(
      (i) => normalizeName(i.name) === normalizeName(entry.name),
    );
    if (existing) {
      const amount = convert(quantity, entry.unit, existing.unit);
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
    } else
      next.items.push(
        newItem(entry.name, quantity, entry.unit, entry.category),
      );
    next.shopping = next.shopping.filter((i) => i.id !== id);
  }
  return next;
}
export function recipeNeeds(recipe, state, multiplier = 1) {
  const grouped = [];
  for (const ingredient of recipe.ingredients) {
    const unit = canonicalUnit(ingredient.unit);
    const amount =
      typeof ingredient.amount === "number" && ingredient.amount > 0
        ? round(ingredient.amount * multiplier)
        : null;
    const item = state.items.find(
      (i) => normalizeName(i.name) === normalizeName(ingredient.name),
    );
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
        unit: targetUnit,
        required,
        available: item ? item.quantity : 0,
        category: item?.category || "Other",
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
export function cookRecipe(state, needs) {
  if (needs.some((i) => i.missing !== 0))
    throw new Error(
      "Resolve missing stock and unknown quantities before cooking.",
    );
  const next = structuredClone(state);
  for (const need of needs) {
    const item = next.items.find((i) => i.id === need.itemId);
    if (!item || item.quantity == null || item.quantity < need.required)
      throw new Error("Stock changed. Review ingredients again.");
    item.quantity = round(item.quantity - need.required);
  }
  return next;
}
