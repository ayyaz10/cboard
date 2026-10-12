import test from 'node:test';
import assert from 'node:assert/strict';
import { convertNutrientValue, NUTRIENT_REGISTRY, cleanNutrients, nutritionCoverage } from './nutrients.js';
import { adaptOpenFoodFactsProduct, adaptCoFIDFood, mergeNutritionByNutrient } from './sourceAdapters.js';

test('central nutrient registry covers requested fats, vitamins and minerals', () => {
  const keys = new Set(NUTRIENT_REGISTRY.map(item => item.id));
  for (const key of ['energyKJ', 'calories', 'fiber', 'omega3', 'omega6', 'vitaminK', 'vitaminB1', 'biotin', 'folate', 'iodine', 'selenium']) assert.ok(keys.has(key), key);
  assert.equal(nutritionCoverage({ calcium: 0 }).known, 1);
  assert.equal(cleanNutrients({ calcium: 0, vitaminD: null }).calcium, 0);
  assert.equal(cleanNutrients({ calcium: 0, vitaminD: null }).vitaminD, null);
});

test('mass unit conversions are explicit and never interpret unitless values', () => {
  assert.equal(convertNutrientValue(1000, 'mg', 'g'), 1);
  assert.equal(convertNutrientValue(1000, 'µg', 'mg'), 1);
  assert.equal(convertNutrientValue(1, 'kcal', 'kJ'), null);
  assert.equal(convertNutrientValue(4, null, 'mg'), null);
});

test('Open Food Facts adapter preserves unknowns, zeroes, energy units and per-nutrient provenance', () => {
  const product = adaptOpenFoodFactsProduct({ code: '12345678', product_name: 'Test yoghurt', brands: 'Example', nutriments: {
    'energy-kj_100g': 251, proteins_100g: 10, 'saturated-fat_100g': 0, salt_100g: 0.2, sodium_100g: 0.08, 'vitamin-d_100g': null,
  } });
  assert.equal(product.nutrition.calories, 59.99);
  assert.equal(product.nutrition.energyKJ, 251);
  assert.equal(product.nutrition.saturatedFat, 0);
  assert.equal(product.nutrition.salt, 0.2);
  assert.equal(product.nutrition.sodium, 80);
  assert.equal(product.nutrition.vitaminD, null);
  assert.equal(product.nutrientSources.protein.sourceType, 'openfoodfacts');
  assert.equal(product.nutrientSources.calories.derived, true);
});

test('CoFID adapter keeps omitted nutrients unknown and attributes reference values', () => {
  const food = adaptCoFIDFood({ id: '13-145', name: 'Example fruit', nutrition: { calories: 38, vitaminC: 12, vitaminD: 0 } });
  assert.equal(food.nutrition.calcium, null);
  assert.equal(food.nutrition.vitaminD, 0);
  assert.equal(food.nutrientSources.vitaminC.sourceType, 'cofid');
  assert.equal(food.nutrientSources.vitaminC.estimated, true);
  assert.equal(food.nutrientSources.vitaminA, undefined);
});

test('reference enrichment fills only missing fields and leaves exact label values untouched', () => {
  const merged = mergeNutritionByNutrient({ protein: 10, calories: 100, calcium: null, nutrientSources: { protein: { sourceType: 'label', sourceName: 'Package label', confidence: 'high' } } },
    { protein: 9, calories: 90, calcium: 120 },
    { incomingSources: { protein: { sourceType: 'cofid' }, calcium: { sourceType: 'cofid', confidence: 'medium', estimated: true } } });
  assert.equal(merged.nutrition.protein, 10);
  assert.equal(merged.nutrition.calories, 100);
  assert.equal(merged.nutrition.calcium, 120);
  assert.equal(merged.nutrientSources.protein.sourceType, 'label');
  assert.equal(merged.nutrientSources.calcium.sourceType, 'cofid');
});
