const PREFIX = /^\s*(\d+(?:\.\d+)?|\d+\/\d+|[½¼¾⅓⅔⅛⅜⅝⅞])\s*(tsp\.?|teaspoons?|tbsp\.?|tablespoons?|cups?|g|grams?|kg|kilograms?|ml|millilit(?:er|re)s?|oz\.?|ounces?|lb|pounds?|pieces?|cloves?)\s+(.+)$/i;

export function parseFoodQuantityPrefix(value) {
  const match = String(value || '').match(PREFIX);
  if (!match) return null;
  const fractions = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
  const quantity = fractions[match[1]] ?? (match[1].includes('/') ? Number(match[1].split('/')[0]) / Number(match[1].split('/')[1]) : Number(match[1]));
  const foodName = match[3].trim();
  return quantity > 0 && foodName ? { quantity, unit: match[2].toLocaleLowerCase().replace(/\.$/, ''), foodName } : null;
}

export function normalizeFoodText(value) {
  const text = String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
    .replace(/[’‘`']/g, '').replace(/[‐‑‒–—-]/g, ' ').replace(/[^\p{L}\p{N}%]+/gu, ' ').trim().replace(/\s+/g, ' ');
  const synonyms = new Map([['tomatoes', 'tomato'], ['tomatoe', 'tomato'], ['chilli', 'chili'], ['chillies', 'chili']]);
  return text.split(' ').map(token => synonyms.get(token) || token).join(' ');
}

export const normalizeFoodName = value => normalizeFoodText(parseFoodQuantityPrefix(value)?.foodName || value);
export const recipeFoodName = value => parseFoodQuantityPrefix(value)?.foodName || String(value || '').trim();

export function validFoodBarcode(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(digits.length)) return '';
  const body = digits.slice(0, -1).split('').reverse().map(Number);
  const sum = body.reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - sum % 10) % 10 === Number(digits.at(-1)) ? digits : '';
}

const barcode = food => validFoodBarcode(food?.barcode || food?.source?.barcode || food?.source?.code);
const sku = food => String(food?.sku || food?.source?.sku || '').trim().toLocaleLowerCase();
const retailer = food => normalizeFoodText(food?.retailer || food?.source?.retailer || '');
const brand = food => normalizeFoodText(food?.brand || food?.source?.brand || '');

function similarity(a, b) {
  if (!a || !b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return 1 - row[b.length] / Math.max(a.length, b.length);
}

function nutritionDifferences(a, b) {
  return ['calories', 'protein', 'carbs', 'fat', 'fiber'].filter(key => {
    if (a?.nutrition?.[key] == null || b?.nutrition?.[key] == null) return false;
    const left = Number(a?.nutrition?.[key]), right = Number(b?.nutrition?.[key]);
    return Number.isFinite(left) && Number.isFinite(right) && Math.max(Math.abs(left), Math.abs(right)) > 0 && Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), 1) > 0.45;
  });
}

export function scoreFoodMatch(candidate, existing) {
  const aBarcode = barcode(candidate), bBarcode = barcode(existing);
  if (aBarcode && bBarcode) return aBarcode === bBarcode
    ? { score: 100, confidence: 'certain', reasons: ['same valid barcode'], conflict: false }
    : { score: 0, confidence: 'different-product', reasons: ['different valid barcodes'], conflict: true };
  const aSku = sku(candidate), bSku = sku(existing), aRetailer = retailer(candidate), bRetailer = retailer(existing);
  if (aSku && bSku && aRetailer && bRetailer) return aSku === bSku && aRetailer === bRetailer
    ? { score: 100, confidence: 'certain', reasons: ['same retailer and SKU'], conflict: false }
    : { score: 0, confidence: 'different-product', reasons: ['different retailer or SKU'], conflict: true };
  if (aBarcode && bBarcode && aBarcode !== bBarcode) return { score: 0, confidence: 'different-product', reasons: ['product identifiers differ'], conflict: true };
  const aBrand = brand(candidate), bBrand = brand(existing);
  if (aBrand && bBrand && aBrand !== bBrand) return { score: 0, confidence: 'different-product', reasons: ['brand differs'], conflict: true };
  const left = normalizeFoodName(candidate?.name), right = normalizeFoodName(existing?.name);
  if (!left || !right) return { score: 0, confidence: 'none', reasons: [], conflict: false };
  const differences = nutritionDifferences(candidate, existing);
  if (left === right) return differences.length
    ? { score: 88, confidence: 'review', reasons: [`nutrition differs: ${differences.join(', ')}`], conflict: true }
    : { score: 95, confidence: 'high', reasons: [normalizeFoodText(candidate.name) === normalizeFoodText(existing.name) ? 'canonical name matches' : 'quantity or common alias normalized'], conflict: false };
  const score = similarity(left, right);
  return score >= 0.62 ? { score: Math.round(score * 70), confidence: 'suggestion', reasons: ['similar spelling; review before reuse'], conflict: false }
    : { score: 0, confidence: 'none', reasons: [], conflict: false };
}

export function findFoodMatches(candidate, foods = []) {
  return foods.map(food => ({ food, ...scoreFoodMatch(candidate, food) })).filter(match => match.score >= 50).sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name));
}

export function findPossibleFoodDuplicateGroups(foods = []) {
  const links = new Map();
  for (let i = 0; i < foods.length; i++) for (let j = i + 1; j < foods.length; j++) {
    if (scoreFoodMatch(foods[i], foods[j]).score < 55) continue;
    for (const [a, b] of [[foods[i].id, foods[j].id], [foods[j].id, foods[i].id]]) {
      if (!links.has(a)) links.set(a, new Set());
      links.get(a).add(b);
    }
  }
  const visited = new Set(), groups = [];
  for (const id of links.keys()) {
    if (visited.has(id)) continue;
    const stack = [id], group = [];
    visited.add(id);
    while (stack.length) {
      const current = stack.pop(); group.push(foods.find(food => food.id === current));
      for (const next of links.get(current) || []) if (!visited.has(next)) { visited.add(next); stack.push(next); }
    }
    if (group.length > 1) groups.push(group);
  }
  return groups;
}

export function auditFoodDuplicates(foods = []) {
  const pairs = [];
  const counts = { exactName: 0, quantityOrAlias: 0, fuzzySuggestion: 0, sameBarcode: 0, sameRetailerSku: 0 };
  for (let i = 0; i < foods.length; i++) for (let j = i + 1; j < foods.length; j++) {
    const match = scoreFoodMatch(foods[i], foods[j]);
    if (match.score < 50) continue;
    let type;
    if (match.reasons.includes('same valid barcode')) type = 'sameBarcode';
    else if (match.reasons.includes('same retailer and SKU')) type = 'sameRetailerSku';
    else if (match.confidence === 'suggestion') type = 'fuzzySuggestion';
    else if (normalizeFoodText(foods[i].name) !== normalizeFoodText(foods[j].name)) type = 'quantityOrAlias';
    else type = 'exactName';
    counts[type]++;
    pairs.push({ foods: [foods[i], foods[j]], type, score: match.score, reasons: match.reasons });
  }
  return { counts, pairs };
}
