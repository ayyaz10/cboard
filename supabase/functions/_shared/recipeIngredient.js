export const RECIPE_INGREDIENT_UNITS = [
  { id: 'g', label: 'g', dimension: 'mass', aliases: ['g', 'gram', 'grams'] },
  { id: 'kg', label: 'kg', dimension: 'mass', aliases: ['kg', 'kilogram', 'kilograms'] },
  { id: 'mg', label: 'mg', dimension: 'mass', aliases: ['mg', 'milligram', 'milligrams'] },
  { id: 'ml', label: 'ml', dimension: 'volume', aliases: ['ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters'] },
  { id: 'l', label: 'l', dimension: 'volume', aliases: ['l', 'litre', 'litres', 'liter', 'liters'] },
  { id: 'tsp', label: 'tsp', dimension: 'volume', aliases: ['tsp', 'tsp.', 'teaspoon', 'teaspoons'] },
  { id: 'tbsp', label: 'tbsp', dimension: 'volume', aliases: ['tbsp', 'tbsp.', 'tablespoon', 'tablespoons'] },
  { id: 'cup', label: 'cup', dimension: 'volume', aliases: ['cup', 'cups'] },
  { id: 'pieces', label: 'pieces', dimension: 'count', aliases: ['piece', 'pieces', 'pc', 'pcs', 'each'] },
  { id: 'slices', label: 'slices', dimension: 'count', aliases: ['slice', 'slices'] },
  { id: 'cloves', label: 'cloves', dimension: 'count', aliases: ['clove', 'cloves'] },
  { id: 'eggs', label: 'eggs', dimension: 'count', aliases: ['egg', 'eggs'] },
  { id: 'scoops', label: 'scoops', dimension: 'count', aliases: ['scoop', 'scoops'] },
  { id: 'servings', label: 'servings', dimension: 'count', aliases: ['serving', 'servings', 'portion', 'portions'] },
  { id: 'pinch', label: 'pinch', dimension: 'count', aliases: ['pinch', 'pinches'] },
];

const UNIT_ALIASES = new Map(RECIPE_INGREDIENT_UNITS.flatMap(unit => unit.aliases.map(alias => [alias.toLowerCase(), unit.id])));
const UNIT_PATTERN = [...UNIT_ALIASES.keys()].sort((a, b) => b.length - a.length).map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const QUANTITY_PATTERN = '(?:\\d+\\s+\\d+\\s*\\/\\s*\\d+|\\d+\\s*\\/\\s*\\d+|\\d+(?:\\.\\d+)?|[½⅓¼¾⅔⅛⅜⅝⅞])';
const MEASURED_PREFIX = new RegExp(`^\\s*(${QUANTITY_PATTERN})\\s*(${UNIT_PATTERN})\\s+(.+?)\\s*$`, 'iu');
const UNICODE_FRACTIONS = { '½': 0.5, '⅓': 1 / 3, '¼': 0.25, '¾': 0.75, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };

export function normalizeRecipeUnit(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  return UNIT_ALIASES.get(raw) || String(value ?? '').trim();
}

function parseQuantity(value) {
  const raw = String(value).trim().replace(/\s+/g, ' ');
  if (UNICODE_FRACTIONS[raw] != null) return UNICODE_FRACTIONS[raw];
  const mixed = raw.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed && Number(mixed[3])) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction && Number(fraction[2])) return Number(fraction[1]) / Number(fraction[2]);
  const number = Number(raw);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

const titleFirst = value => {
  const clean = String(value || '').trim().replace(/^[,;:–—-]+\s*/, '').replace(/[;,]+$/, '').trim();
  return clean ? clean[0].toLocaleUpperCase() + clean.slice(1) : '';
};

function splitContext(value) {
  let name = String(value || '').trim();
  let group = '';
  let note = '';
  let preparation = '';
  const parenthetical = name.match(/\s*\(([^()]*)\)\s*$/);
  if (parenthetical && /^(?:for|in|to)\s+/i.test(parenthetical[1].trim())) {
    const context = parenthetical[1].trim().replace(/^(?:for|in|to)\s+/i, '');
    name = name.slice(0, parenthetical.index).trim();
    if (/^(garnish|garnishing|serving|serve)$/i.test(context)) note = context.replace(/ing$/i, '').toLowerCase();
    else group = titleFirst(context);
  }
  const suffix = name.match(/^(.*?)\s+for\s+(garnish|garnishing|serving|serve|sauce|chicken|marinade|dressing|topping|finishing)\s*$/i);
  if (suffix) {
    name = suffix[1].trim();
    const context = suffix[2].toLowerCase();
    if (/^(garnish|garnishing|serving|serve)$/.test(context)) note ||= context.replace(/ing$/i, '').replace(/^serve$/, 'serving');
    else group ||= titleFirst(context);
  }
  const prep = name.match(/^(.*?)(?:,|\s+[-–—])\s*(finely chopped|roughly chopped|chopped|diced|minced|crushed|grated|sliced|divided|to taste|optional)\s*$/i);
  if (prep) {
    name = prep[1].trim();
    const descriptor = prep[2].toLowerCase();
    if (descriptor === 'optional' || descriptor === 'divided' || descriptor === 'to taste') note ||= descriptor;
    else preparation = descriptor;
  }
  const sourceName = name.trim();
  return { name: titleFirst(sourceName), sourceName, group, note, preparation };
}

// This parser intentionally requires a recognized measurement unit. It leaves
// food names such as 0% Greek yogurt, 2% milk, 5 Spice and 7UP intact.
export function parseIngredientText(value) {
  const rawText = String(value ?? '').trim().replace(/^[•*\-–—]+\s*/, '');
  if (!rawText) return null;
  const eggCount = rawText.match(new RegExp(`^(${QUANTITY_PATTERN})\\s+eggs?$`, 'iu'));
  if (eggCount) return { name: 'Eggs', sourceName: 'eggs', amount: parseQuantity(eggCount[1]), unit: 'pieces', rawText, parsed: true };
  const match = rawText.match(MEASURED_PREFIX);
  if (!match) {
    const split = splitContext(rawText);
    return { ...split, amount: null, unit: '', rawText, parsed: split.name !== rawText };
  }
  const split = splitContext(match[3]);
  if (!split.name) return { name: titleFirst(rawText), sourceName: rawText, amount: null, unit: '', note: '', group: '', preparation: '', rawText, parsed: false };
  return {
    ...split,
    amount: parseQuantity(match[1]),
    unit: normalizeRecipeUnit(match[2]),
    rawText,
    parsed: true,
  };
}

function structuredAmount(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== 'string' || !value.trim()) return value == null ? null : value;
  return parseQuantity(value) ?? value.trim();
}

export function normalizeRecipeIngredient(candidate) {
  const source = typeof candidate === 'string' ? { name: candidate } : candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : {};
  const originalName = String(source.name ?? '').trim();
  const parsed = parseIngredientText(originalName);
  const hasExplicitAmount = source.amount != null && source.amount !== '';
  const hasExplicitUnit = String(source.unit ?? '').trim() !== '';
  const amount = hasExplicitAmount ? structuredAmount(source.amount) : parsed?.amount ?? null;
  const unit = hasExplicitUnit ? normalizeRecipeUnit(source.unit) : parsed?.unit || '';
  const name = parsed && (parsed.parsed || parsed.name !== originalName) ? parsed.name : titleFirst(originalName);
  return {
    ...source,
    name: name || titleFirst(originalName),
    amount,
    unit,
    ...(source.group || parsed?.group ? { group: String(source.group || parsed.group).trim() } : {}),
    ...(source.preparation || parsed?.preparation ? { preparation: String(source.preparation || parsed.preparation).trim() } : {}),
    ...(source.note || parsed?.note ? { note: [String(source.note || '').trim(), String(parsed?.note || '').trim()].filter(Boolean).join('; ') } : {}),
  };
}
