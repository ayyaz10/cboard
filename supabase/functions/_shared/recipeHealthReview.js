// Shared validation keeps model output bounded and browser/server storage consistent.
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
export function readHealthReview(value) {
  if (!object(value)) return null;
  const text = (input) => {
    if (typeof input !== 'string' || !input.trim() || input.length > 300) throw new Error('Invalid review text');
    return input.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  };
  const list = (input) => {
    if (!Array.isArray(input) || input.length > 3) throw new Error('Invalid review list');
    return input.map(text);
  };
  try {
    const result = {
      summary: text(value.summary),
      positives: list(value.positives),
      watchOuts: list(value.watchOuts),
      suggestions: list(value.suggestions),
      limitations: list(value.limitations),
    };
    if (!result.positives.length && !result.watchOuts.length && !result.limitations.length) return null;
    return result;
  } catch { return null; }
}

export function healthReviewBasis(recipe) {
  const nutrients = (value) => ['calories', 'protein', 'carbs', 'fat', 'fiber'].map((key) => value?.[key] ?? null);
  const ingredient = (value) => [value.name, value.amount ?? null, value.unit ?? '', value.note ?? '', nutrients(value.nutrition), value.alternativeGroup ?? null];
  return JSON.stringify([
    recipe.title, recipe.ingredients.map(ingredient), recipe.steps,
    recipe.servings ?? null, recipe.cookTime ?? null, nutrients(recipe.nutrition),
    (recipe.sauces ?? []).map(ingredient),
    Object.entries(recipe.alternatives ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => [key, group.options.map(ingredient)]),
  ]);
}

export function storedHealthReview(value) {
  const review = readHealthReview(value);
  if (!review || value.version !== 1 || typeof value.basis !== 'string' || value.basis.length > 100000) return null;
  return { version: 1, ...review, basis: value.basis };
}

export function healthReviewStatus(recipe) {
  const review = storedHealthReview(recipe.healthReview);
  if (!review) return 'unavailable';
  if (review.basis !== healthReviewBasis(recipe)) return 'outdated';
  if (review.watchOuts.length) return 'watch';
  if (review.limitations.length) return 'limited';
  return 'positive';
}
