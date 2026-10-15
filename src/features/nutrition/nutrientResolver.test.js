import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCanonicalNutrient} from './nutrients.js';

const cases=[
  ['Dietary Fibre','fiber'],['Dietary Fiber','fiber'],['Total Dietary Fibre','fiber'],['Dietary Fibre, Total','fiber'],['Fibre - Dietary','fiber'],
  ['Total Sugars','sugars'],['Total Sugar','sugars'],['of which sugars','sugars'],
  ['Protein','protein'],['Proteins','protein'],['Total Protein','protein'],['Total Fat','fat'],['Total Lipids','fat'],
  ['Saturated fatty acids','saturatedFat'],['MUFA','monounsaturatedFat'],['Monounsaturated fatty acids','monounsaturatedFat'],
  ['PUFA','polyunsaturatedFat'],['Polyunsaturated fatty acids','polyunsaturatedFat'],['Trans fatty acids','transFat'],
  ['Total Carbohydrates','carbs'],['Total Carbohydrate','carbs'],['Total Cholesterol','cholesterol'],
  ['Vitamin B12 (Cobalamin)','vitaminB12'],['Cobalamin','vitaminB12'],['Cobalamin (Vitamin B12)','vitaminB12'],['Cyanocobalamin','vitaminB12'],
  ['Vitamin B9 (Folate)','folate'],['Vitamin E (Alpha-tocopherol)','vitaminE'],['Vitamin B5 (Pantothenic acid)','vitaminB5'],
  ['Vitamin B2 (Riboflavin)','vitaminB2'],['Vitamin B1 (Thiamin)','vitaminB1'],['Vitamin B3 (Niacin)','vitaminB3'],
  ['Vitamin D (D2 + D3)','vitaminD'],['Vitamin A (RAE)','vitaminA'],
];

for(const [label,nutrientId] of cases)test(`${label} resolves to ${nutrientId}`,()=>{
  const result=resolveCanonicalNutrient(label);
  assert.equal(result?.nutrientId,nutrientId);
  assert.equal(result?.confidence,'high');
});

test('conservative OCR typos use fuzzy aliases without claiming an exact match',()=>{
  for(const [label,nutrientId] of [['Dietary Fibr','fiber'],['Total Sugrs','sugars'],['Prote1n','protein']]){
    const result=resolveCanonicalNutrient(label);
    assert.equal(result?.nutrientId,nutrientId,label);
    assert.equal(result?.confidence,'medium',label);
    assert.equal(result?.matchType,'fuzzy',label);
  }
});

test('short chemical aliases need the mineral category, while units alone never identify nutrients',()=>{
  for(const [label,nutrientId] of [['Na','sodium'],['Ca','calcium'],['Fe','iron'],['Mg','magnesium'],['K','potassium'],['Zn','zinc']])
    assert.equal(resolveCanonicalNutrient(label,{category:'Minerals'})?.nutrientId,nutrientId,label);
  assert.equal(resolveCanonicalNutrient('',{unit:'mg'}),null);
});
