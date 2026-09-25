const normalise = (value) => String(value || '').trim().toLocaleLowerCase();

const nutritionSignature = (item) => {
  const label = item.nutritionLabel;
  if (label) return ['label', label.source?.provider, label.source?.name, label.quantity, label.unit].map(normalise).join('|');
  return ['nutrition', ...['calories', 'protein', 'carbs', 'fat', 'fiber'].map((key) => item.nutrition?.[key] ?? '')].join('|');
};

export function buildIngredientLibrary(recipes = []) {
  const entries = new Map();
  recipes.forEach((recipe) => {
    const alternatives = Object.values(recipe.alternatives || {}).flatMap((group) => group.options || []);
    [...(recipe.ingredients || []), ...(recipe.sauces || []), ...alternatives].forEach((item) => {
      if (!normalise(item?.name)) return;
      const key = [normalise(item.name), normalise(item.unit), String(item.amount ?? ''), nutritionSignature(item)].join('|');
      const existing = entries.get(key);
      if (existing) {
        if (recipe.title && !existing.recipeTitles.includes(recipe.title)) existing.recipeTitles.push(recipe.title);
      } else {
        entries.set(key, { key, item, recipeTitles: recipe.title ? [recipe.title] : [] });
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
