import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_WEIGHT_FOOD_PAIRING,
  SAME_DAY_PAIRING,
  getFoodDiaryDateForWeight,
  getWeightDateForFoodDiary,
  getLinkedCaloriesForWeight,
  getLinkedWeightForFoodDiary,
  normalizeWeightFoodPairing,
} from './weightFoodPairing.js';

const diaryDay = (date, calories = 2050) => ({
  date,
  meals: [{ items: [{ quantity: 1, basis: 1, unit: 'g', nutritionUnit: 'g', nutrition: { calories } }] }],
});

test('previous-day pairing links morning weight with the prior calendar date both ways', () => {
  const day = diaryDay('2026-10-31');
  const linked = getLinkedCaloriesForWeight({ date: '2026-11-01' }, new Map([[day.date, day]]));
  assert.equal(linked.date, '2026-10-31');
  assert.equal(linked.report.calories, 2050);
  assert.deepEqual(getLinkedWeightForFoodDiary('2026-10-31', new Map([['2026-11-01', { date: '2026-11-01', weight_kg: 77.2 }]])), {
    date: '2026-11-01', entry: { date: '2026-11-01', weight_kg: 77.2 },
  });
});

test('same-day pairing links the matching date both ways', () => {
  assert.equal(getFoodDiaryDateForWeight('2026-11-01', SAME_DAY_PAIRING), '2026-11-01');
  assert.equal(getWeightDateForFoodDiary('2026-11-01', SAME_DAY_PAIRING), '2026-11-01');
  assert.equal(getLinkedCaloriesForWeight({ date: '2026-11-01' }, new Map([['2026-11-01', diaryDay('2026-11-01', 1900)]]), SAME_DAY_PAIRING).report.calories, 1900);
});

test('missing diary and weight stay missing instead of becoming zero', () => {
  const linkedCalories = getLinkedCaloriesForWeight({ date: '2026-11-01' }, new Map());
  assert.equal(linkedCalories.date, '2026-10-31');
  assert.equal(linkedCalories.day, null);
  assert.equal(linkedCalories.report, null);
  assert.equal(getLinkedWeightForFoodDiary('2026-10-31', new Map()).entry, null);
});

test('diary edits are reflected by recalculating the derived daily calorie report', () => {
  const first = diaryDay('2026-10-31', 1800);
  const changed = diaryDay('2026-10-31', 2000);
  assert.equal(getLinkedCaloriesForWeight({ date: '2026-11-01' }, new Map([[first.date, first]])).report.calories, 1800);
  assert.equal(getLinkedCaloriesForWeight({ date: '2026-11-01' }, new Map([[changed.date, changed]])).report.calories, 2000);
});

test('partial diary days use the current known calorie subtotal', () => {
  const partial = diaryDay('2026-10-31', 1450);
  partial.meals[0].items.push({ quantity: 1, basis: 1, unit: 'g', nutritionUnit: 'g', nutrition: {} });
  const linked = getLinkedCaloriesForWeight({ date: '2026-11-01' }, new Map([[partial.date, partial]]));
  assert.equal(linked.report.calories, 1450);
  assert.equal(linked.report.missing, 1);
});

test('weight edits and deletes are reflected by rebuilding the date lookup', () => {
  const original = { date: '2026-11-01', weight_kg: 77.2 };
  const changed = { ...original, weight_kg: 77 };
  assert.equal(getLinkedWeightForFoodDiary('2026-10-31', new Map([[original.date, original]])).entry.weight_kg, 77.2);
  assert.equal(getLinkedWeightForFoodDiary('2026-10-31', new Map([[changed.date, changed]])).entry.weight_kg, 77);
  assert.equal(getLinkedWeightForFoodDiary('2026-10-31', new Map()).entry, null);
});

test('date pairing handles month/year boundaries and daylight-saving transitions as calendar dates', () => {
  assert.equal(getFoodDiaryDateForWeight('2027-01-01'), '2026-12-31');
  assert.equal(getWeightDateForFoodDiary('2026-12-31'), '2027-01-01');
  assert.equal(getFoodDiaryDateForWeight('2026-03-30'), '2026-03-29');
  assert.equal(getWeightDateForFoodDiary('2026-03-29'), '2026-03-30');
});

test('previous day remains default, and invalid modes normalize without changing data', () => {
  assert.equal(DEFAULT_WEIGHT_FOOD_PAIRING, 'previous-day');
  assert.equal(normalizeWeightFoodPairing(null), 'previous-day');
  assert.equal(normalizeWeightFoodPairing('unknown'), 'previous-day');
  assert.equal(normalizeWeightFoodPairing('same-day'), 'same-day');
  assert.equal(getFoodDiaryDateForWeight('not-a-date'), null);
});
