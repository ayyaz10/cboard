import { dailyCalorieReport, shiftDate, validDate } from '../features/diary/diaryData.js';

export const WEIGHT_FOOD_PAIRING_KEY = 'weight-food-pairing:v1';
export const PREVIOUS_DAY_PAIRING = 'previous-day';
export const SAME_DAY_PAIRING = 'same-day';
export const DEFAULT_WEIGHT_FOOD_PAIRING = PREVIOUS_DAY_PAIRING;

export function normalizeWeightFoodPairing(value) {
  return value === SAME_DAY_PAIRING ? SAME_DAY_PAIRING : DEFAULT_WEIGHT_FOOD_PAIRING;
}

export function getFoodDiaryDateForWeight(weightDate, pairingMode = DEFAULT_WEIGHT_FOOD_PAIRING) {
  if (!validDate(weightDate)) return null;
  return shiftDate(weightDate, normalizeWeightFoodPairing(pairingMode) === SAME_DAY_PAIRING ? 0 : -1);
}

export function getWeightDateForFoodDiary(diaryDate, pairingMode = DEFAULT_WEIGHT_FOOD_PAIRING) {
  if (!validDate(diaryDate)) return null;
  return shiftDate(diaryDate, normalizeWeightFoodPairing(pairingMode) === SAME_DAY_PAIRING ? 0 : 1);
}

export function getLinkedCaloriesForWeight(weightEntry, diaryByDate, pairingMode = DEFAULT_WEIGHT_FOOD_PAIRING) {
  const date = getFoodDiaryDateForWeight(weightEntry?.date, pairingMode);
  const day = date ? diaryByDate.get(date) || null : null;
  const report = day?.meals?.length ? dailyCalorieReport(day) : null;
  return { date, day: day?.meals?.length ? day : null, report };
}

export function getLinkedWeightForFoodDiary(diaryDate, weightByDate, pairingMode = DEFAULT_WEIGHT_FOOD_PAIRING) {
  const date = getWeightDateForFoodDiary(diaryDate, pairingMode);
  return { date, entry: date ? weightByDate.get(date) || null : null };
}
