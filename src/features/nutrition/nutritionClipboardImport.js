import { NUTRITION_BASIS_UNITS } from './nutritionJsonImport.js';

export const NUTRITION_IMPORT_SESSION_TTL_MS = 20 * 60 * 1000;

export function createPendingNutritionImport({ foodName, amount, unit, draftId, mode = 'food_reference', id, startedAt = Date.now() }) {
  if (typeof foodName !== 'string' || !foodName.trim()) throw new Error('Enter a food name or preparation first.');
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) throw new Error('Enter an amount greater than zero.');
  if (!NUTRITION_BASIS_UNITS.includes(unit)) throw new Error('Choose a supported nutrition unit.');
  if (!['food_reference', 'nutrition_label'].includes(mode)) throw new Error('Choose a supported nutrition prompt.');
  return { id: id || `${startedAt}-${Math.random().toString(36).slice(2)}`, foodName, amount: Number(amount), unit, draftId, mode, startedAt, awaitingNutritionJson: true };
}

export function isPendingNutritionImportExpired(pending, now = Date.now()) {
  return !pending || !Number.isFinite(pending.startedAt) || now - pending.startedAt > NUTRITION_IMPORT_SESSION_TTL_MS;
}

function normalizeFoodIdentity(value) {
  return [...new Set(String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}%]+/gu, ' ').trim().split(/\s+/).filter(Boolean))].sort().join(' ');
}

export function nutritionJsonMatchesFood(requestedFoodName, food) {
  const requested = normalizeFoodIdentity(requestedFoodName);
  const described = normalizeFoodIdentity(`${food?.name || ''} ${food?.state || ''}`);
  return Boolean(requested && described && requested === described);
}

export function formatNutritionFoodName(food) {
  return [String(food?.name || '').trim(), String(food?.state || '').trim()]
    .filter(Boolean).join(' · ');
}