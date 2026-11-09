import { cleanNutrientSources, nutritionFieldDefinitions, nutrientKeys, nutrientSourcesForValues } from './nutrients.js';
import { currentAtBasis } from './nutritionLabelReview.js';

export const NUTRITION_JSON_SCHEMA = 'cboard-nutrition-v1';
export const NUTRITION_BASIS_UNITS = ['g', 'ml', 'pieces', 'servings'];
const rootKeys = ['schema', 'food', 'basis', 'source', 'nutrition'];
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };

export function createNutritionJsonTemplate({ foodName = 'Food name', state = '', amount = 100, unit = 'g', sourceType = 'food_reference', sourceName = 'Name of source actually used' } = {}) {
  return {
    schema: NUTRITION_JSON_SCHEMA,
    food: { name: foodName, state },
    basis: { amount, unit },
    source: { type: sourceType, name: sourceName },
    nutrition: Object.fromEntries(nutritionFieldDefinitions.map(({ key }) => [key, null])),
  };
}

export function nutritionSchemaPromptLines() {
  return nutritionFieldDefinitions.map(({ key, label, unit }) => `- ${key}: ${label}, ${unit}; value must be a non-negative number or null`).join('\n');
}

export function buildFoodLookupPrompt({ foodName, amount = 100, unit = 'g' }) {
  const fields = nutritionSchemaPromptLines();
  const template = JSON.stringify(createNutritionJsonTemplate({ foodName: foodName || '[FOOD_DESCRIPTION]', amount, unit }), null, 2);
  return `Create a CBoard-compatible nutrition JSON record for this food:

Food: ${foodName || '[FOOD_DESCRIPTION]'}
Amount: ${amount}
Unit: ${unit}

Respect the exact food state/preparation in the description. Do not silently treat raw, dry, cooked, boiled, canned, drained, roasted, or branded foods as equivalent. Do not substitute another state.

Use a reliable authoritative nutrition source.

For a generic food, prefer USDA FoodData Central or another authoritative official food-composition database.

For an exact branded product, prefer official manufacturer nutrition information when available.

Return as many reliable nutrition values as supported by the CBoard schema below, including calories/energy, macros, vitamins, minerals, and other supported nutrient fields.

Rules:

- Do not invent unavailable values.
- Use null when a nutrient is not reliably available.
- Use 0 only when the authoritative source reports a true zero.
- Keep the requested nutrition basis explicit.
- Use exact CBoard field names.
- Use exact CBoard units.
- Numeric nutrient fields must contain numbers only.
- Do not return values such as "12 g" if the schema expects 12.
- Do not add unsupported nutrient keys.
- Return exactly ONE valid JSON object inside a single \`\`\`json code block.
- Do not add Markdown outside the required JSON code block.
- Do not add explanation before or after the JSON code block.
- The JSON inside the code block must work with JSON.parse() after removing the code fence.

CBoard nutrition schema:
Schema identifier: "${NUTRITION_JSON_SCHEMA}"
${fields}

Use this JSON structure. Set source.type to "food_reference" and source.name to the authoritative source actually used. Preserve the food name and state/preparation in food.name and food.state when known. The basis amount and unit must match the requested amount and unit exactly. Include every nutrient key shown, using null for unavailable values:
${template}

If you need more information to identify the exact food, preparation/state, requested basis, or a reliable matching source, ask concise clarifying question(s) first and wait for the answer. Do not guess or return JSON until the clarification is resolved.

Before responding, verify internally that:

- the selected food matches the requested preparation/state
- the nutrition basis is correct
- the source is appropriate
- all available supported macros and micronutrients have been included
- unavailable values are null
- JSON syntax is valid

Return only the JSON object inside one \`\`\`json code block, with no text before or after.`;
}
export function buildLabelExtractionPrompt() {
  const fields = nutritionSchemaPromptLines();
  const template = JSON.stringify(createNutritionJsonTemplate({ sourceType: 'nutrition_label', sourceName: 'Supplied nutrition label' }), null, 2);
  return `Extract nutrition from only the supplied nutrition label image, screenshot, nutrition table, or copied label text. Do not use general food knowledge, a database, or estimates. Match the label's stated basis exactly. If the food identity, label text, or basis is unclear, ask concise clarifying question(s) first and wait for the answer. Do not guess or return JSON until the clarification is resolved. Missing, unreadable, or absent nutrient values must be null. Use 0 only when the label explicitly reports zero.\n\nAfter clarifications are resolved, return one JSON object inside a single \`\`\`json code block, with no commentary before or after. Use schema "${NUTRITION_JSON_SCHEMA}" and this exact structure and keys. Include every listed nutrition key. Set source.type to "nutrition_label" and source.name to "Supplied nutrition label". Include the food name and preparation/state only when supplied or explicitly shown.\n\nSupported CBoard nutrition fields and units:\n${fields}\n\nJSON code block shape:\n\`\`\`json\n${template}\n\`\`\``;
}

export function parseNutritionJson(input) {
  if (String(input).length > 50000) fail('Nutrition JSON must be 50 KB or smaller.');
  let value;
  const raw = String(input).trim();
  const fenced = raw.match(/^\`\`\`(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n\`\`\`$/i);
  try { value = JSON.parse(fenced ? fenced[1] : raw); }
  catch { fail('Enter valid JSON or one JSON code block.'); }
  if (!isRecord(value)) fail('The JSON must be one object.');
  const unknownRoot = Object.keys(value).filter(key => !rootKeys.includes(key));
  if (unknownRoot.length) fail(`Unknown top-level field${unknownRoot.length > 1 ? 's' : ''}: ${unknownRoot.join(', ')}.`);
  if (value.schema !== NUTRITION_JSON_SCHEMA) fail(`Schema must be "${NUTRITION_JSON_SCHEMA}".`);
  if (!isRecord(value.food) || Object.keys(value.food).some(key => !['name', 'state'].includes(key))) fail('Food must contain only name and state.');
  if (typeof value.food.name !== 'string' || !value.food.name.trim() || value.food.name.length > 160) fail('Food name is required and must be 160 characters or fewer.');
  if (value.food.state != null && (typeof value.food.state !== 'string' || value.food.state.length > 120)) fail('Food state must be text of 120 characters or fewer.');
  if (!isRecord(value.basis) || Object.keys(value.basis).some(key => !['amount', 'unit'].includes(key))) fail('Basis must contain only amount and unit.');
  if (typeof value.basis.amount !== 'number' || !Number.isFinite(value.basis.amount) || value.basis.amount <= 0 || value.basis.amount > 100000) fail('Basis amount must be a number greater than 0 and at most 100000.');
  if (!NUTRITION_BASIS_UNITS.includes(value.basis.unit)) fail(`Basis unit must be one of: ${NUTRITION_BASIS_UNITS.join(', ')}.`);
  if (!isRecord(value.source) || Object.keys(value.source).some(key => !['type', 'name'].includes(key))) fail('Source must contain only type and name.');
  if (!['food_reference', 'nutrition_label'].includes(value.source.type)) fail('Source type must be food_reference or nutrition_label.');
  if (typeof value.source.name !== 'string' || !value.source.name.trim() || value.source.name.length > 160) fail('Source name is required and must be 160 characters or fewer.');
  if (!isRecord(value.nutrition)) fail('Nutrition must be an object of CBoard nutrient keys.');
  const unknownNutrients = Object.keys(value.nutrition).filter(key => !nutrientKeys.includes(key));
  if (unknownNutrients.length) fail(`Unknown nutrient key${unknownNutrients.length > 1 ? 's' : ''}: ${unknownNutrients.join(', ')}.`);
  const nutrition = Object.fromEntries(nutritionFieldDefinitions.map(({ key }) => {
    const nutrient = hasOwn(value.nutrition, key) ? value.nutrition[key] : null;
    if (nutrient !== null && (typeof nutrient !== 'number' || !Number.isFinite(nutrient) || nutrient < 0)) fail(`${key} must be a non-negative number or null.`);
    return [key, nutrient];
  }));
  if (!Object.values(nutrition).some(nutrient => nutrient !== null)) fail('Include at least one known nutrition value.');
  return {
    schema: NUTRITION_JSON_SCHEMA,
    food: { name: value.food.name.trim(), state: String(value.food.state || '').trim() },
    quantity: value.basis.amount,
    unit: value.basis.unit,
    nutrition,
    source: {
      provider: value.source.type === 'nutrition_label' ? 'Nutrition JSON label import' : 'Nutrition JSON food reference',
      sourceType: value.source.type,
      name: value.source.name.trim(),
      modified: true,
    },
    nutrientSources: cleanNutrientSources(nutrientSourcesForValues(nutrition, {
      provider: value.source.type === 'nutrition_label' ? 'Nutrition label JSON' : 'AI food reference',
      name: value.source.name.trim(),
    })),
  };
}

export function hasExistingNutrition(current) {
  return nutrientKeys.some(key => current?.[key] !== null && current?.[key] !== undefined);
}

export function canFillMissingNutrition(current, imported) {
  if (!hasExistingNutrition(current)) return true;
  return currentAtBasis(current, { quantity: imported.quantity, unit: imported.unit, kind: imported.unit === 'pieces' ? 'item' : imported.unit === 'servings' ? 'serving' : imported.unit }) !== null;
}

export function createNutritionJsonApplication(imported, current, strategy = 'replace') {
  if (strategy === 'replace') return { ...imported.nutrition, foodName: imported.food.name, quantity: imported.quantity, unit: imported.unit, source: imported.source, nutrientSources: imported.nutrientSources };
  if (strategy !== 'fill-missing') fail('Choose Replace nutrition or Fill missing only.');
  if (!canFillMissingNutrition(current, imported)) fail('Existing values use a different basis. Replace nutrition to use this basis, or cancel.');
  const basis = { quantity: imported.quantity, unit: imported.unit, kind: imported.unit === 'pieces' ? 'item' : imported.unit === 'servings' ? 'serving' : imported.unit };
  const existing = currentAtBasis(current, basis) || {};
  const nutrition = Object.fromEntries(nutrientKeys.map(key => [key, existing[key] !== null && existing[key] !== undefined ? existing[key] : imported.nutrition[key]]));
  const nutrientSources = cleanNutrientSources({ ...(current?.nutrientSources || current?.nutrition?.nutrientSources || {}), ...Object.fromEntries(nutrientKeys.flatMap(key => existing[key] !== null && existing[key] !== undefined ? [] : imported.nutrition[key] === null ? [] : [[key, imported.nutrientSources[key]]])) });
  return { ...nutrition, foodName: imported.food.name, quantity: imported.quantity, unit: imported.unit, source: { ...current?.source, ...imported.source, provider: 'Nutrition JSON merged' }, nutrientSources };
}