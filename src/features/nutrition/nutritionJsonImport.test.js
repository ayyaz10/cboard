import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFoodLookupPrompt, buildLabelExtractionPrompt, canFillMissingNutrition,
  createNutritionJsonApplication, createNutritionJsonTemplate, hasExistingNutrition,
  NUTRITION_JSON_SCHEMA, nutritionSchemaPromptLines, parseNutritionJson,
} from './nutritionJsonImport.js';
import { nutritionFieldDefinitions, nutrientKeys } from './nutrients.js';

const payload = overrides => ({
  ...createNutritionJsonTemplate({ foodName: 'Uncooked white chickpeas', state: 'uncooked', sourceName: 'USDA FoodData Central' }),
  nutrition: { calories: 378, protein: 20.5, carbs: 63, fat: 6, fiber: 12.2, calcium: 57, iron: 4.3, vitaminC: null, ...overrides?.nutrition },
  ...overrides,
});

test('the JSON schema, prompt, and import keys come from the canonical nutrient registry', () => {
  assert.equal(NUTRITION_JSON_SCHEMA, 'cboard-nutrition-v1');
  assert.deepEqual(nutrientKeys, nutritionFieldDefinitions.map(field => field.key));
  const prompt = buildFoodLookupPrompt({ foodName: 'uncooked chickpeas', amount: 100, unit: 'g' });
  for (const field of nutritionFieldDefinitions) assert.ok(prompt.includes(`"${field.key}"`), field.key);
  assert.match(prompt, /USDA FoodData Central/);
  assert.match(prompt, /Do not substitute another state/i);
  assert.match(prompt, /Use null when a nutrient is not reliably available/);
  assert.match(prompt, /Use 0 only when the authoritative source reports a true zero/);
});

test('imports a complete branded/reference-style macro and micronutrient payload with provenance', () => {
  const result = parseNutritionJson(JSON.stringify(payload({
    food: { name: 'Brand Chickpeas', state: 'canned, drained' },
    source: { type: 'food_reference', name: 'Manufacturer nutrition panel' },
    nutrition: { calories: 130, protein: 7, carbs: 20, fat: 2, fiber: 6, sugars: 1, sodium: 240, iron: 2.1, folate: 80, vitaminC: 0 },
  })));
  assert.equal(result.quantity, 100);
  assert.equal(result.unit, 'g');
  assert.equal(result.nutrition.vitaminC, 0);
  assert.equal(result.nutrition.calcium, null);
  assert.equal(result.nutrientSources.iron.sourceType, 'ai');
  assert.equal(result.nutrientSources.iron.sourceName, 'Manufacturer nutrition panel');
  assert.equal(result.nutrientSources.iron.estimated, true);
  assert.equal(result.nutrientSources.iron.confidence, 'low');
});

test('accepts partial fields and explicit nulls without turning unknowns into zero', () => {
  const result = parseNutritionJson(JSON.stringify(payload({ nutrition: { calories: null, protein: 0 } })));
  assert.equal(result.nutrition.calories, null);
  assert.equal(result.nutrition.protein, 0);
  assert.equal(result.nutrition.carbs, null);
  assert.equal(result.nutrition.vitaminA, null);
});

test('accepts a JSON code block and carries the food name into the applied item', () => {
  const wrapped = '```json\n' + JSON.stringify(payload({ food: { name: 'Dry red lentils', state: 'dry' }, nutrition: { calories: 352, protein: 24 } }), null, 2) + '\n```';
  const imported = parseNutritionJson(wrapped);
  assert.equal(imported.food.name, 'Dry red lentils');
  const application = createNutritionJsonApplication(imported, null, 'replace');
  assert.equal(application.foodName, 'Dry red lentils');
});
test('supports per 100 ml and 1 serving bases without conversion', () => {
  for (const [amount, unit] of [[100, 'ml'], [1, 'servings']]) {
    const result = parseNutritionJson(JSON.stringify(payload({ basis: { amount, unit }, nutrition: { calories: 45 } })));
    assert.equal(result.quantity, amount);
    assert.equal(result.unit, unit);
  }
});

test('label mode accepts partial nutrients and marks supplied values as label-derived', () => {
  const result = parseNutritionJson(JSON.stringify(payload({
    basis: { amount: 30, unit: 'g' },
    source: { type: 'nutrition_label', name: 'Supplied nutrition label' },
    nutrition: { calories: 120, protein: 4, sodium: null },
  })));
  assert.equal(result.quantity, 30);
  assert.equal(result.nutrition.sodium, null);
  assert.equal(result.nutrientSources.calories.sourceType, 'label');
  assert.equal(result.nutrientSources.calories.estimated, false);
  assert.match(buildLabelExtractionPrompt(), /Do not use general food knowledge/);
  assert.match(buildLabelExtractionPrompt(), /Missing, unreadable, or absent nutrient values must be null/);
  assert.match(buildLabelExtractionPrompt(), /ask concise clarifying question\(s\) first and wait for the answer/);
  assert.ok(buildLabelExtractionPrompt().includes(String.fromCharCode(96).repeat(3)+'json code block'));
});

test('rejects malformed, incompatible, unknown, wrongly typed, and impossible payloads', () => {
  assert.throws(() => parseNutritionJson('{'), /valid JSON/);
  assert.throws(() => parseNutritionJson(JSON.stringify({ ...payload(), schema: 'other' })), /Schema/);
  assert.throws(() => parseNutritionJson(JSON.stringify({ ...payload(), extra: true })), /Unknown top-level/);
  assert.throws(() => parseNutritionJson(JSON.stringify(payload({ nutrition: { calories: 1, madeUp: 2 } }))), /Unknown nutrient/);
  assert.throws(() => parseNutritionJson(JSON.stringify(payload({ nutrition: { calories: '50' } }))), /non-negative number or null/);
  assert.throws(() => parseNutritionJson(JSON.stringify(payload({ nutrition: { calories: -1 } }))), /non-negative number or null/);
  assert.throws(() => parseNutritionJson(JSON.stringify(payload({ basis: { amount: 0, unit: 'g' } }))), /Basis amount/);
  assert.throws(() => parseNutritionJson(JSON.stringify(payload({ basis: { amount: 100, unit: 'cup' } }))), /Basis unit/);
  assert.throws(() => parseNutritionJson(JSON.stringify(payload({ nutrition: {} }))), /at least one known/);
});

test('existing-value detection treats zero as present and offers basis-safe fill-missing', () => {
  const current = { quantity: 100, unit: 'g', calories: 0, protein: null, fiber: 5, nutrientSources: { calories: { sourceType: 'label' } } };
  const imported = parseNutritionJson(JSON.stringify(payload({ nutrition: { calories: 200, protein: 9, fiber: 8, iron: 3 } })));
  assert.equal(hasExistingNutrition(current), true);
  assert.equal(canFillMissingNutrition(current, imported), true);
  const result = createNutritionJsonApplication(imported, current, 'fill-missing');
  assert.equal(result.calories, 0);
  assert.equal(result.protein, 9);
  assert.equal(result.fiber, 5);
  assert.equal(result.iron, 3);
  assert.equal(result.nutrientSources.calories.sourceType, 'label');
});

test('replace resets absent imported values and incompatible fill-missing is rejected', () => {
  const imported = parseNutritionJson(JSON.stringify(payload({ nutrition: { calories: 200 } })));
  const current = { quantity: 1, unit: 'pieces', calories: 100 };
  const replaced = createNutritionJsonApplication(imported, current, 'replace');
  assert.equal(replaced.calories, 200);
  assert.equal(replaced.protein, null);
  assert.equal(replaced.quantity, 100);
  assert.equal(canFillMissingNutrition(current, imported), false);
  assert.throws(() => createNutritionJsonApplication(imported, current, 'fill-missing'), /different basis/);
});

test('food lookup prompt fills the supplied request and includes authoritative-source and JSON rules', () => {
  const prompt = buildFoodLookupPrompt({ foodName: 'cooked chickpeas', amount: 150, unit: 'g' });
  assert.match(prompt, /Create a CBoard-compatible nutrition JSON record for this food/);
  assert.match(prompt, /Food: cooked chickpeas/);
  assert.match(prompt, /Amount: 150\nUnit: g/);
  assert.match(prompt, /USDA FoodData Central/);
  assert.match(prompt, /official manufacturer nutrition information/);
  assert.match(prompt, /Do not silently treat raw, dry, cooked, boiled, canned, drained, roasted, or branded foods as equivalent/);
  assert.match(prompt, /ask concise clarifying question\(s\) first and wait for the answer/);
  assert.ok(prompt.includes(String.fromCharCode(96).repeat(3)+'json code block'));
  assert.match(prompt, /Numeric nutrient fields must contain numbers only/);
  assert.match(prompt, /"schema": "cboard-nutrition-v1"/);
  assert.doesNotMatch(prompt, /\{\{(?:FOOD_DESCRIPTION|AMOUNT|UNIT|CBOARD_NUTRITION_SCHEMA)\}\}/);
});

test('uses an explicit matching serving basis for fill-missing values', () => {
  const current = { quantity: 1, unit: 'servings', protein: 8 };
  const imported = parseNutritionJson(JSON.stringify(payload({ basis: { amount: 2, unit: 'servings' }, nutrition: { calories: 100 } })));
  assert.equal(canFillMissingNutrition(current, imported), true);
  const result = createNutritionJsonApplication(imported, current, 'fill-missing');
  assert.equal(result.protein, 16);
  assert.equal(result.calories, 100);
});

test('bounds pasted JSON input size', () => {
  assert.throws(() => parseNutritionJson(' '.repeat(50001)), /50 KB or smaller/);
});

test('trims the canonical food and source fields and maps source.name independently', () => {
  const input = payload({
    food: { name: '  Raw uncooked chickpeas  ', state: '  dry  ' },
    source: { type: 'food_reference', name: '  USDA FoodData Central  ' },
  });
  const imported = parseNutritionJson(JSON.stringify(input));
  assert.equal(imported.food.name, 'Raw uncooked chickpeas');
  assert.equal(imported.food.state, 'dry');
  assert.equal(imported.source.name, 'USDA FoodData Central');
  assert.equal(createNutritionJsonApplication(imported, null).foodName, 'Raw uncooked chickpeas');
});

test('requires the source.name field and accepts only a recognized json fence', () => {
  const input = payload();
  assert.throws(() => parseNutritionJson(JSON.stringify({ ...input, source: { type: 'food_reference', name: '' } })), /source\.name/);
  assert.throws(() => parseNutritionJson('```\n' + JSON.stringify(input) + '\n```'), /valid JSON/);
  assert.equal(parseNutritionJson('```json\n' + JSON.stringify(input) + '\n```').food.name, 'Uncooked white chickpeas');
});

test('food preparation is optional and normalized before its length check', () => {
  const base = payload();
  const cases = [
    [{ name: 'Food' }, ''],
    [{ name: 'Food', state: null }, ''],
    [{ name: 'Food', state: '' }, ''],
    [{ name: 'Food', state: 'grilled' }, 'grilled'],
    [{ name: 'Food', state: '  grilled  ' }, 'grilled'],
    [{ name: 'Food', state: 'x'.repeat(120) }, 'x'.repeat(120)],
    [{ name: 'Food', preparation: '  boiled  ' }, 'boiled'],
    [{ name: 'Food', foodState: 'drained' }, 'drained'],
  ];
  for (const [food, state] of cases) {
    const imported = parseNutritionJson(JSON.stringify({ ...base, food }));
    assert.equal(imported.food.state, state);
  }
});

test('invalid preparation types and values report a preparation-specific validation error', () => {
  const base = payload();
  for (const state of [{ cooked: true }, ['cooked'], true, 7, 'x'.repeat(121)]) {
    assert.throws(
      () => parseNutritionJson(JSON.stringify({ ...base, food: { name: 'Food', state } })),
      /Preparation must be text up to 120 characters\./,
    );
  }
});
