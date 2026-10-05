import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFoodName, parseFoodQuantityPrefix, scoreFoodMatch, validFoodBarcode, findPossibleFoodDuplicateGroups, auditFoodDuplicates } from './foodIdentity.js';
import { foodNutritionConflicts, mergeCanonicalFoods, mergeFoodCatalog } from './foodCatalog.js';

test('canonical names normalize case, punctuation, unicode spaces and safe common variants', () => {
  assert.equal(normalizeFoodName('  CORIANDER   POWDER '), 'coriander powder');
  assert.equal(normalizeFoodName('1 tbsp. Coriander Powder'), 'coriander powder');
  assert.equal(normalizeFoodName('Tomatoes'), 'tomato');
  assert.equal(normalizeFoodName('Chilli'), 'chili');
});

test('quantity parser separates common recipe units without stripping meaningful numbers', () => {
  assert.deepEqual(parseFoodQuantityPrefix('1 tbsp coriander powder'), { quantity: 1, unit: 'tbsp', foodName: 'coriander powder' });
  assert.deepEqual(parseFoodQuantityPrefix('250g Oats'), { quantity: 250, unit: 'g', foodName: 'Oats' });
  for (const name of ['5 Spice', '0% Greek Yogurt', '7UP']) assert.equal(normalizeFoodName(name), name.toLocaleLowerCase());
  assert.equal(parseFoodQuantityPrefix('7UP'), null);
});

test('canonical upsert reuses case and quantity variants and preserves the original display name', () => {
  const existing = { id: 'spice', name: 'Coriander Powder', quantity: 100, unit: 'g', nutrition: { calories: 300 } };
  const merged = mergeFoodCatalog([existing], [{ name: '1 TBSP coriander powder', quantity: 100, unit: 'g', nutrition: { calories: null } }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'spice');
  assert.equal(merged[0].name, 'Coriander Powder');
  assert.equal(merged[0].nutrition.calories, 300);
});

test('meaningful food qualifiers and distinct valid product barcodes prevent automatic matching', () => {
  const zero = { name: 'Greek Yogurt 0%' }, full = { name: 'Greek Yogurt Full Fat' };
  assert.equal(scoreFoodMatch(zero, full).confidence, 'none');
  const ean = '4006381333931';
  assert.equal(validFoodBarcode(ean), ean);
  assert.equal(scoreFoodMatch({ name: 'Milk', barcode: ean }, { name: 'Milk', barcode: '5901234123457' }).confidence, 'different-product');
  assert.equal(scoreFoodMatch({ name: 'Milk', barcode: ean }, { name: 'Different name', barcode: ean }).confidence, 'certain');
});

test('same retailer and SKU is a strong match; invalid codes are not identity keys', () => {
  assert.equal(scoreFoodMatch({ name: 'Food', retailer: 'Aldi', sku: '762747' }, { name: 'Other', retailer: 'aldi', sku: '762747' }).confidence, 'certain');
  assert.equal(validFoodBarcode('1234567890123'), '');
});

test('OCR spelling errors are suggestions and do not auto-match', () => {
  const match = scoreFoodMatch({ name: 'Coriander Powdr' }, { id: 'spice', name: 'Coriander Powder' });
  assert.equal(match.confidence, 'suggestion');
  assert.equal(match.score < 95, true);
});

test('possible duplicate groups include quantity variants but exclude different barcodes', () => {
  const foods = [
    { id: 'a', name: 'Coriander Powder' },
    { id: 'b', name: '1 tbsp coriander powder' },
    { id: 'milk-a', name: 'Milk', barcode: '4006381333931' },
    { id: 'milk-b', name: 'Milk', barcode: '5901234123457' },
  ];
  const groups = findPossibleFoodDuplicateGroups(foods);
  assert.deepEqual(groups.map(group => group.map(food => food.id).sort()), [['a', 'b']]);
});

test('food audit reports exact, quantity-normalized, fuzzy, barcode and SKU matches separately', () => {
  const audit = auditFoodDuplicates([
    { id: 'a', name: 'Coriander Powder' }, { id: 'b', name: '1 tbsp coriander powder' },
    { id: 'c', name: 'Coriander Powdr' }, { id: 'd', name: 'Milk', barcode: '4006381333931' },
    { id: 'e', name: 'Milk', barcode: '4006381333931' }, { id: 'f', name: 'Aldi Flour', retailer: 'Aldi', sku: '762747' },
    { id: 'g', name: 'Other Flour', retailer: 'Aldi', sku: '762747' },
  ]);
  assert.equal(audit.counts.quantityOrAlias, 1);
  assert.equal(audit.counts.fuzzySuggestion > 0, true);
  assert.equal(audit.counts.sameBarcode, 1);
  assert.equal(audit.counts.sameRetailerSku, 1);
});

test('merge keeps canonical identity, preserves aliases, and exposes nutrition conflicts', () => {
  const foods = [
    { id: 'a', name: 'Coriander Powder', quantity: 100, unit: 'g', nutrition: { calories: 300, protein: null }, source: { provider: 'Manual' } },
    { id: 'b', name: '1 tbsp coriander powder', quantity: 100, unit: 'g', nutrition: { calories: 295, protein: 10 }, source: { provider: 'OCR' } },
  ];
  assert.deepEqual(foodNutritionConflicts(foods), ['calories']);
  const merged = mergeCanonicalFoods(foods, 'a', ['b'], 'b');
  assert.equal(merged.id, 'a');
  assert.equal(merged.name, 'Coriander Powder');
  assert.deepEqual(merged.aliases, ['1 tbsp coriander powder']);
  assert.equal(merged.nutrition.calories, 295);
  assert.equal(merged.nutrition.protein, 10);
});
