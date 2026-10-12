import { cleanNutrients, cleanNutrientSources, nutrientKeys, offNutrients, validNutrient } from './nutrients.js';

function sourceMap(values, source, { estimated = false, confidence = 'high', conventions = {} } = {}) {
  return Object.fromEntries(nutrientKeys.filter(key => validNutrient(values[key])).map(key => [key, {
    sourceType: source.type, sourceId: source.id || '', sourceName: source.name || source.type,
    confidence, estimated, ...(source.derived?.includes(key) ? { derived: true } : {}),
    ...(conventions[key] ? { convention: conventions[key] } : {}),
  }]));
}

function energyValues(raw, data = {}) {
  const calories = raw.calories;
  const kj = raw.energyKJ;
  const derived = [];
  if (calories == null && kj != null) { raw.calories = Math.round(kj / 4.184 * 100) / 100; derived.push('calories'); }
  if (raw.energyKJ == null && calories != null) { raw.energyKJ = Math.round(calories * 4.184 * 100) / 100; derived.push('energyKJ'); }
  // Salt and sodium are deliberately not inferred here: many label systems
  // report one independently, and a conversion must be explicitly requested.
  return { raw, derived };
}

export function adaptOpenFoodFactsProduct(product) {
  if (!product || !/^\d+$/.test(String(product.code || ''))) return null;
  const name = String(product.product_name_en || product.product_name || '').trim();
  if (!name) return null;
  const energy = energyValues(offNutrients(product.nutriments || {}));
  const nutrition = cleanNutrients(energy.raw);
  const code = String(product.code);
  const source = { type: 'openfoodfacts', id: code, name: 'Open Food Facts', derived: energy.derived };
  const nutrientSources = sourceMap(nutrition, source, { confidence: 'medium', conventions: { vitaminA: 'Open Food Facts value retained as reported', folate: 'Open Food Facts value retained as reported' } });
  if (!Object.values(nutrition).some(validNutrient)) return null;
  return {
    code, name, brand: Array.isArray(product.brands) ? product.brands.filter(v => typeof v === 'string').join(', ') : String(product.brands || ''),
    pack: typeof product.quantity === 'string' ? product.quantity : '', nutrition, nutrientSources,
    source: { provider: 'Open Food Facts', code, name, url: `https://world.openfoodfacts.org/product/${code}`, license: 'ODbL', updatedAt: product.last_modified_t ? new Date(product.last_modified_t * 1000).toISOString() : '' },
  };
}

export function adaptCoFIDFood(food) {
  if (!food || typeof food !== 'object' || !food.id || !food.name || !food.nutrition) return null;
  const nutrition = cleanNutrients(energyValues({ ...food.nutrition }).raw);
  const sourceId = String(food.id);
  const source = { type: 'cofid', id: sourceId, name: 'UK CoFID' };
  return { code: `cofid-${sourceId}`, name: String(food.name), brand: '', pack: `CoFID ${food.version || ''}`.trim(),
    nutrition, nutrientSources: sourceMap(nutrition, source, { estimated: true, confidence: 'medium', conventions: { vitaminA: 'retinol equivalents', folate: 'folate' } }), unit: food.unit || 'g',
    source: { provider: 'UK CoFID', code: sourceId, name: String(food.name), url: 'https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid', license: 'OGL-3.0', version: food.version || '' } };
}

export function adaptUSDAFood(food) {
  if (!food || food.id == null || !food.name || !food.nutrition) return null;
  const nutrition = cleanNutrients(energyValues({ ...food.nutrition }).raw);
  const sourceId = String(food.id);
  const source = { type: 'usda', id: sourceId, name: 'USDA FoodData Central' };
  return { code: `usda-${sourceId}`, name: String(food.name), brand: '', pack: `${food.type || 'Reference'} · ${food.release || ''}`.trim(),
    nutrition, nutrientSources: sourceMap(nutrition, source, { estimated: true, confidence: 'medium', conventions: { vitaminA: 'retinol activity equivalents', folate: 'USDA folate convention' } }),
    source: { provider: 'USDA FoodData Central', code: sourceId, name: String(food.name), url: `https://fdc.nal.usda.gov/food-details/${sourceId}/nutrients`, license: 'CC0', release: food.release || '' } };
}

// Exact values always win. Incoming sources only fill fields that are unknown;
// the result stays numeric-compatible and carries attribution per nutrient.
export function mergeNutritionByNutrient(current = {}, incoming = {}, { currentSource, incomingSources = {}, onlyMissing = true } = {}) {
  const values = cleanNutrients(current);
  const sources = cleanNutrientSources(current.nutrientSources);
  const candidateSources = cleanNutrientSources(incomingSources);
  for (const key of nutrientKeys) {
    if (!validNutrient(incoming[key]) || (onlyMissing && values[key] != null)) continue;
    values[key] = incoming[key];
    sources[key] = candidateSources[key] || {
      sourceType: currentSource?.provider || 'reference', sourceId: currentSource?.code || '',
      sourceName: currentSource?.name || currentSource?.provider || 'Reference', confidence: 'medium', estimated: true,
    };
  }
  if (currentSource) for (const key of nutrientKeys) if (values[key] != null && !sources[key]) sources[key] = {
    sourceType: currentSource.provider || 'manual', sourceId: currentSource.code || '', sourceName: currentSource.name || currentSource.provider || 'Manual', confidence: 'high', estimated: false,
  };
  return { nutrition: values, nutrientSources: cleanNutrientSources(sources) };
}
