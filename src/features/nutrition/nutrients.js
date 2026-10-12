// Canonical nutrition registry. Numeric values remain on each food's existing
// `nutrition` object for backwards compatibility; source attribution lives in
// the sibling `nutrientSources` map and is keyed by these stable IDs.
const definitions = [
  ['calories', 'Calories', 'kcal', 'energy', ['energy', 'energy kcal', 'calories']],
  ['protein', 'Protein', 'g', 'macros', ['protein']],
  ['carbs', 'Carbohydrates', 'g', 'macros', ['carbohydrate', 'carbohydrates', 'carbs']],
  ['fat', 'Fat', 'g', 'macros', ['fat', 'total fat', 'lipids']],
  ['fiber', 'Fibre', 'g', 'macros', ['fibre', 'fiber', 'dietary fibre', 'dietary fiber']],
  ['energyKJ', 'Energy', 'kJ', 'energy', ['kilojoules', 'energy kj']],
  ['sugars', 'Sugars', 'g', 'macros', ['sugars', 'total sugars']],
  ['saturatedFat', 'Saturated fat', 'g', 'fat', ['saturated fat', 'saturates']],
  ['monounsaturatedFat', 'Monounsaturated fat', 'g', 'fat', ['monounsaturated fat', 'monounsaturates']],
  ['polyunsaturatedFat', 'Polyunsaturated fat', 'g', 'fat', ['polyunsaturated fat', 'polyunsaturates']],
  ['transFat', 'Trans fat', 'g', 'fat', ['trans fat']],
  ['omega3', 'Omega-3', 'g', 'fat', ['omega 3', 'omega-3', 'n-3 fatty acids']],
  ['omega6', 'Omega-6', 'g', 'fat', ['omega 6', 'omega-6', 'n-6 fatty acids']],
  ['salt', 'Salt', 'g', 'other', ['salt']],
  ['sodium', 'Sodium', 'mg', 'minerals', ['sodium']],
  ['cholesterol', 'Cholesterol', 'mg', 'other', ['cholesterol']],
  ['vitaminA', 'Vitamin A', 'µg', 'vitamins', ['vitamin a', 'retinol activity equivalents']],
  ['vitaminC', 'Vitamin C', 'mg', 'vitamins', ['vitamin c', 'ascorbic acid']],
  ['vitaminD', 'Vitamin D', 'µg', 'vitamins', ['vitamin d', 'vitamin d2', 'vitamin d3']],
  ['vitaminE', 'Vitamin E', 'mg', 'vitamins', ['vitamin e', 'alpha tocopherol']],
  ['vitaminK', 'Vitamin K', 'µg', 'vitamins', ['vitamin k', 'phylloquinone']],
  ['vitaminB1', 'Thiamin (B1)', 'mg', 'bVitamins', ['thiamin', 'thiamine', 'vitamin b1']],
  ['vitaminB2', 'Riboflavin (B2)', 'mg', 'bVitamins', ['riboflavin', 'vitamin b2']],
  ['vitaminB3', 'Niacin (B3)', 'mg', 'bVitamins', ['niacin', 'vitamin b3']],
  ['vitaminB5', 'Pantothenic acid (B5)', 'mg', 'bVitamins', ['pantothenic acid', 'vitamin b5']],
  ['vitaminB6', 'Vitamin B6', 'mg', 'bVitamins', ['vitamin b6', 'pyridoxine']],
  ['biotin', 'Biotin (B7)', 'µg', 'bVitamins', ['biotin', 'vitamin b7']],
  ['folate', 'Folate (B9)', 'µg', 'bVitamins', ['folate', 'folic acid', 'vitamin b9']],
  ['vitaminB12', 'Vitamin B12', 'µg', 'bVitamins', ['vitamin b12', 'cobalamin']],
  ['calcium', 'Calcium', 'mg', 'minerals', ['calcium']],
  ['iron', 'Iron', 'mg', 'minerals', ['iron']],
  ['magnesium', 'Magnesium', 'mg', 'minerals', ['magnesium']],
  ['phosphorus', 'Phosphorus', 'mg', 'minerals', ['phosphorus']],
  ['potassium', 'Potassium', 'mg', 'minerals', ['potassium']],
  ['zinc', 'Zinc', 'mg', 'minerals', ['zinc']],
  ['copper', 'Copper', 'mg', 'minerals', ['copper']],
  ['manganese', 'Manganese', 'mg', 'minerals', ['manganese']],
  ['selenium', 'Selenium', 'µg', 'minerals', ['selenium']],
  ['iodine', 'Iodine', 'µg', 'minerals', ['iodine']],
];

export const NUTRIENT_REGISTRY = definitions.map(([id, label, canonicalUnit, group, aliases]) => ({
  id, label, canonicalUnit, group, aliases, detailed: true,
  defaultSummary: ['calories', 'protein', 'carbs', 'fat', 'fiber'].includes(id),
  precision: canonicalUnit === 'kcal' || canonicalUnit === 'kJ' ? 0 : 1,
}));
export const NUTRIENTS = NUTRIENT_REGISTRY.map(({ id, label, canonicalUnit }) => [id, label, canonicalUnit]);
export const nutrientKeys = NUTRIENT_REGISTRY.map(({ id }) => id);
export const nutrientById = Object.fromEntries(NUTRIENT_REGISTRY.map((entry) => [entry.id, entry]));
export const nutrientByAlias = new Map(NUTRIENT_REGISTRY.flatMap((entry) => entry.aliases.map(alias => [alias.toLowerCase(), entry])));

export const validNutrient = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export const cleanNutrients = (values = {}) => Object.fromEntries(nutrientKeys.map(key => [key, validNutrient(values?.[key]) ? values[key] : null]));
export function nutritionCoverage(values = {}, keys = nutrientKeys) {
  const known = keys.filter(key => validNutrient(values?.[key])).length;
  return { known, total: keys.length, missing: keys.length - known, percent: keys.length ? Math.round(known / keys.length * 100) : 100 };
}

export function cleanNutrientSources(sources = {}) {
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) return {};
  return Object.fromEntries(nutrientKeys.flatMap(key => {
    const source = sources[key];
    if (!source || typeof source !== 'object' || Array.isArray(source)) return [];
    return [[key, {
      sourceType: String(source.sourceType || source.provider || 'unknown').slice(0, 80),
      sourceId: source.sourceId == null ? '' : String(source.sourceId).slice(0, 200),
      sourceName: String(source.sourceName || source.name || '').slice(0, 300),
      confidence: ['high', 'medium', 'low'].includes(source.confidence) ? source.confidence : 'medium',
      estimated: source.estimated === true,
      ...(source.derived === true ? { derived: true } : {}),
      ...(source.unit ? { sourceUnit: String(source.unit).slice(0, 20) } : {}),
      ...(source.convention ? { convention: String(source.convention).slice(0, 80) } : {}),
    }]];
  }));
}

export function nutrientSourcesForValues(values = {}, source = {}) {
  const provider = String(source?.provider || 'Manual');
  const normalized = provider.toLowerCase();
  const type = normalized.includes('cofid') ? 'cofid' : normalized.includes('usda') ? 'usda'
    : normalized.includes('food facts') || normalized.includes('open food') ? 'openfoodfacts'
      : normalized.includes('ocr') || normalized.includes('label') ? 'label' : normalized.includes('manual') ? 'manual'
        : normalized.includes('ai') ? 'ai' : normalized;
  const estimated = ['cofid', 'usda', 'ai'].includes(type);
  return Object.fromEntries(nutrientKeys.filter(key => validNutrient(values?.[key])).map(key => [key, {
    sourceType: type, sourceId: String(source?.code || ''), sourceName: String(source?.name || provider),
    confidence: type === 'ai' ? 'low' : estimated ? 'medium' : 'high', estimated,
  }]));
}

// Convert supported mass units only. Unitless and unlike units stay unknown.
export function convertNutrientValue(value, fromUnit, toUnit) {
  if (!validNutrient(value) || !fromUnit || !toUnit) return null;
  if (fromUnit === toUnit) return value;
  const factors = { g: 1, mg: 1e-3, µg: 1e-6, 'μg': 1e-6, mcg: 1e-6 };
  const from = factors[String(fromUnit).toLowerCase()];
  const to = factors[String(toUnit).toLowerCase()];
  if (from == null || to == null) return null;
  return value * from / to;
}

export function offNutrients(values = {}) {
  const fields = {
    calories: ['energy-kcal_100g', 1], energyKJ: ['energy-kj_100g', 1], protein: ['proteins_100g', 1],
    carbs: ['carbohydrates_100g', 1], fat: ['fat_100g', 1], fiber: ['fiber_100g', 1], sugars: ['sugars_100g', 1],
    saturatedFat: ['saturated-fat_100g', 1], monounsaturatedFat: ['monounsaturated-fat_100g', 1],
    polyunsaturatedFat: ['polyunsaturated-fat_100g', 1], transFat: ['trans-fat_100g', 1], omega3: ['omega-3-fat_100g', 1], omega6: ['omega-6-fat_100g', 1],
    salt: ['salt_100g', 1], sodium: ['sodium_100g', 1000], cholesterol: ['cholesterol_100g', 1000],
    vitaminA: ['vitamin-a_100g', 1e6], vitaminC: ['vitamin-c_100g', 1000], vitaminD: ['vitamin-d_100g', 1e6], vitaminE: ['vitamin-e_100g', 1000], vitaminK: ['vitamin-k_100g', 1e6],
    vitaminB1: ['vitamin-b1_100g', 1000], vitaminB2: ['vitamin-b2_100g', 1000], vitaminB3: ['vitamin-pp_100g', 1000], vitaminB5: ['pantothenic-acid_100g', 1000], vitaminB6: ['vitamin-b6_100g', 1000], biotin: ['biotin_100g', 1e6], folate: ['folates_100g', 1e6], vitaminB12: ['vitamin-b12_100g', 1e6],
    calcium: ['calcium_100g', 1000], iron: ['iron_100g', 1000], magnesium: ['magnesium_100g', 1000], phosphorus: ['phosphorus_100g', 1000], potassium: ['potassium_100g', 1000], zinc: ['zinc_100g', 1000], copper: ['copper_100g', 1000], manganese: ['manganese_100g', 1000], selenium: ['selenium_100g', 1e6], iodine: ['iodine_100g', 1e6],
  };
  return Object.fromEntries(nutrientKeys.map(key => {
    const [field, factor] = fields[key];
    const value = values[field];
    return [key, validNutrient(value) ? value * factor : null];
  }));
}
