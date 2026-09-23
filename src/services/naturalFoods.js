import { cleanNutrients, nutrientKeys } from '../features/nutrition/nutrients.js';

function words(value) {
  return value.toLowerCase().replace(/cashews?/g, 'cashew').replace(/bananas?/g, 'banana').replace(/apples?/g, 'apple').replace(/eggs?/g, 'egg').replace(/almonds?/g, 'almond').replace(/boiled/g, 'cooked').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/);
}
export function findNaturalFoods(foods, query) {
  const size = words(query).find((word) => ['medium', 'large', 'small'].includes(word));
  const tokens = words(query).filter((word) => !['medium', 'large', 'small', 'a', 'an', 'the', 'plain', 'natural'].includes(word));
  if (!tokens.length) return [];
  const saltFree = /\b(unsalted|no salt|without salt)\b/i.test(query);
  const required = tokens.filter((word) => !saltFree || !['unsalted', 'no', 'without', 'salt'].includes(word));
  const genericEgg = required.length === 1 && required[0] === 'egg';
  if (!required.length) return [];
  return foods.map((food) => {
    const terms = words(food.name);
    if (!required.every((word) => terms.includes(word))) return null;
    const name = food.name.toLowerCase();
    if (saltFree && /\bsalted\b|with salt|salt added/.test(name) && !/without salt|no salt/.test(name)) return null;
    const everydayEgg = genericEgg
      ? (/\bwhole\b/.test(name) ? 8 : 0)
        + (/grade a.*large/.test(name) ? 8 : 0)
        + (/\bfresh\b/.test(name) ? 4 : 0)
        - (/\bwhite\b|\byolk\b|\bfrozen\b|\bdried\b|\bduck\b|\bgoose\b|\bquail\b|\bturkey\b/.test(name) ? 12 : 0)
      : 0;
    return { food, score: (food.type === 'Foundation' ? 4 : 0) + (/\braw\b/.test(name) ? 5 : 0) + (food.portions?.length ? 2 : 0) + (size && food.portions?.some((portion) => portion.label.toLowerCase().startsWith(size)) ? 10 : 0) + everydayEgg - terms.length };
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name)).slice(0, 30).map(({ food }) => ({
    code: `usda-${food.id}`, name: food.name, brand: '', pack: `${food.type} · ${food.release}`,
    nutrition: { ...cleanNutrients(food.nutrition), quantity: 100, unit: 'g' },
    portions: food.portions || [],
    source: { provider: 'USDA FoodData Central', code: String(food.id), name: food.name, url: `https://fdc.nal.usda.gov/food-details/${food.id}/nutrients`, license: 'CC0', release: food.release },
  }));
}

export function suggestedNaturalPortion(product, recipeName = '', amountUnit = '') {
  const portions = product?.portions || [];
  if (!portions.length) return '';
  const context = `${recipeName} ${amountUnit}`.toLowerCase();
  const size = context.match(/\b(small|medium|large|extra large|jumbo)\b/)?.[1];
  if (size) {
    const match = portions.findIndex((portion) => portion.label.toLowerCase().startsWith(size));
    if (match >= 0) return String(match);
  }
  const unit = amountUnit.toLowerCase().trim().replace(/s$/, '');
  const exact = portions.findIndex((portion) => portion.label.toLowerCase() === unit);
  if (unit && exact >= 0) return String(exact);
  const egg = /\begg(s)?\b/i.test(`${product.name} ${recipeName}`);
  const counted = !amountUnit || /^(egg|eggs|piece|pieces|whole|item|items|each)$/i.test(amountUnit.trim());
  if (egg && counted) {
    const preferred = [/^whole without shell$/i, /^large$/i];
    for (const pattern of preferred) {
      const match = portions.findIndex((portion) => pattern.test(portion.label));
      if (match >= 0) return String(match);
    }
  }
  return '';
}
export function createNaturalFoodSearch(fetchImpl, url) {
  let catalog;
  return async (query) => {
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 120) throw new Error('Enter a food name between 2 and 120 characters.');
    if (!catalog) catalog = (async () => {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('Natural foods could not load. Please try again.');
      const data = await response.json();
      if (data.version !== 1 || !Array.isArray(data.foods)) throw new Error('The natural-food database is unavailable. Please try again.');
      return data.foods;
    })().catch((error) => { catalog = null; throw error; });
    return findNaturalFoods(await catalog, query);
  };
}
// Kept separate from the app bundle; downloaded only when Natural foods is used.
let search;
export function searchNaturalFoods(query) {
  search ||= createNaturalFoodSearch(fetch, `${import.meta.env.BASE_URL}nutrition/usda-foods.json`);
  return search(query);
}
export function naturalPortionNutrition(nutrition, portion) {
  if (!portion) return nutrition;
  return { ...nutrition, source: { ...nutrition.source, estimatedPortion: true, portionDescription: portion.label }, portion: { description: portion.label, grams: portion.grams } };
}
export function nutritionForOnePortion(nutrition) {
  if (!nutrition.portion?.grams) return nutrition;
  return { ...nutrition, source: { ...nutrition.source, name: `${nutrition.source.name} · ${nutrition.portion.description} (estimated portion)` }, quantity: 1, unit: 'pieces', ...Object.fromEntries(nutrientKeys.map((key) => [key, nutrition[key] == null ? null : nutrition[key] * nutrition.portion.grams / nutrition.quantity])) };
}
