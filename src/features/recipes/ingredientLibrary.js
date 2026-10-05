import { catalogIngredient, resolveCatalogFoodForIngredient } from '../nutrition/foodCatalog.js';

const normalise = (value) => String(value || '').trim().toLocaleLowerCase();

const nutritionSignature = (item) => {
  const label = item.nutritionLabel;
  if (label) return ['label', label.source?.provider, label.source?.name, label.quantity, label.unit].map(normalise).join('|');
  return ['nutrition', ...['calories', 'protein', 'carbs', 'fat', 'fiber'].map((key) => item.nutrition?.[key] ?? '')].join('|');
};

export function buildIngredientLibrary(recipes = [], foodCatalog = []) {
  const entries = new Map();
  const catalogById = new Map();
  const catalogByName = new Map();
  foodCatalog.forEach((catalogItem) => {
    const item = catalogIngredient(catalogItem);
    const key = [normalise(item.name), normalise(item.unit), String(item.amount ?? ''), nutritionSignature(item)].join('|');
    const entryKey = `food:${catalogItem.id}`;
    entries.set(entryKey, { key: entryKey, item, recipeTitles: ['Main food library'], recipeSlugs: [] });
    catalogById.set(catalogItem.id, entryKey);
    catalogByName.set(normalise(catalogItem.name), [...(catalogByName.get(normalise(catalogItem.name)) || []), entryKey]);
    for (const alias of catalogItem.aliases || []) catalogByName.set(normalise(alias), [...(catalogByName.get(normalise(alias)) || []), entryKey]);
  });
  recipes.forEach((recipe) => {
    const alternatives = Object.values(recipe.alternatives || {}).flatMap((group) => group.options || []);
    [...(recipe.ingredients || []), ...(recipe.sauces || []), ...alternatives].forEach((item) => {
      if (!normalise(item?.name)) return;
      const resolvedFood = resolveCatalogFoodForIngredient(item, foodCatalog);
      const legacyMatches = catalogByName.get(normalise(item.name)) || [];
      const masterKey = resolvedFood ? catalogById.get(resolvedFood.id) : legacyMatches.length === 1 ? legacyMatches[0] : null;
      const key = masterKey || [normalise(item.name), normalise(item.unit), String(item.amount ?? ''), nutritionSignature(item)].join('|');
      const existing = entries.get(key);
      if (existing) {
        if (recipe.title && !existing.recipeTitles.includes(recipe.title)) existing.recipeTitles.push(recipe.title);
        if (recipe.slug && !existing.recipeSlugs.includes(recipe.slug)) existing.recipeSlugs.push(recipe.slug);
      } else {
        entries.set(key, { key, item, recipeTitles: recipe.title ? [recipe.title] : [], recipeSlugs: recipe.slug ? [recipe.slug] : [] });
      }
    });
  });
  return [...entries.values()].sort((a, b) => a.item.name.localeCompare(b.item.name));
}

export function findIngredientMatches(library, query, limit = 8) {
  const needle = normalise(query);
  if (needle.length < 2) return [];
  return library
    .filter((entry) => normalise(entry.item.name).includes(needle))
    .sort((a, b) => {
      const aName = normalise(a.item.name);
      const bName = normalise(b.item.name);
      return Number(bName.startsWith(needle)) - Number(aName.startsWith(needle)) || aName.localeCompare(bName);
    })
    .slice(0, limit);
}

export function applyStoredIngredient(current, stored) {
  const next = {
    ...(current.id ? { id: current.id } : {}),
    ...(stored.foodId ? { foodId: stored.foodId } : {}),
    name: stored.name,
    amount: stored.amount ?? null,
    unit: stored.unit || '',
    note: stored.note || '',
    nutrition: { ...(stored.nutrition || {}) },
    ...(stored.nutritionLabel ? { nutritionLabel: { ...stored.nutritionLabel, source: { ...stored.nutritionLabel.source } } } : {}),
  };
  if (current.alternativeGroup) next.alternativeGroup = current.alternativeGroup;
  return next;
}

export function hasStoredNutrition(item) {
  return Boolean(item.nutritionLabel) || Object.values(item.nutrition || {}).some((value) => Number.isFinite(value));
}
