import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNutritionLabel} from './nutritionLabelParser.js';
import {milkaExpected,milkaLabelText} from './fixtures/milka-label.js';

const columns=()=>parseNutritionLabel(milkaLabelText).columns;
const values=column=>Object.fromEntries(Object.entries(column.nutrients).map(([key,field])=>[key,field.value]));

test('Milka bilingual table selects per-100g values and retains its separate 30g column',()=>{
 const [per100,per30]=columns();
 assert.equal(per100.kind,'100g');assert.equal(per100.quantity,100);assert.equal(per100.unit,'g');
 assert.deepEqual(values(per100),milkaExpected);
 assert.equal(per30.kind,'portion');assert.equal(per30.quantity,30);assert.equal(per30.unit,'g');
 assert.deepEqual(values(per30),{energyKJ:670,calories:160,fat:9.3,saturatedFat:5.3,carbs:17,sugars:13,fiber:.8,protein:2,salt:.08});
 assert.ok(Object.values(per100.nutrients).every(field=>!/%/.test(field.rawValue)));
});

test('Portuguese and Spanish accents normalize without changing raw label text',()=>{
 const result=parseNutritionLabel('Por 100 g\nEnergia 2234 kJ / 535 kcal\nL\u00edpidos 31 g\nDos quais saturados 18 g\nHidratos de carbono 56 g\nDos quais a\u00e7\u00facares 43 g\nFibra alimentar 2,8 g\nProte\u00ednas 6,7 g\nSal 0,28 g');
 const column=result.columns[0];
 assert.equal(column.nutrients.fat.value,31);assert.equal(column.nutrients.saturatedFat.value,18);
 assert.equal(column.nutrients.sugars.value,43);assert.equal(column.nutrients.protein.value,6.7);
 assert.equal(column.nutrients.fiber.value,2.8);assert.equal(column.nutrients.salt.value,.28);
 assert.match(column.nutrients.protein.rawText,/Prote\u00ednas/);
});
