import test from 'node:test';
import assert from 'node:assert/strict';
import {paddleDocumentToNutritionInput} from './nutritionOcrDocument.js';
import {nutritionBasisConsistency,parseNutritionLabel} from './nutritionLabelParser.js';

// This is the sanitized table block returned by PaddleOCR-VL 1.6 for milka.png.
const actualMilkaDocument={res:{
  parsing_res_list:[{block_label:'table',block_bbox:[214,681,1057,953],block_content:'<table><tr><td colspan="4">Información Nutricional / Declaração Nutricional</td></tr><tr><td>Valor energético/Energia</td><td>100g</td><td>30g</td><td>%* / 30 g</td></tr><tr><td>Grasa/Lípidos</td><td>2234 kJ / 535 kcal</td><td>670 kJ / 160 kcal</td><td>8 %</td></tr><tr><td>de las cuales saturadas/dos quais saturados</td><td>31 g</td><td>9.2 g</td><td>13 %</td></tr><tr><td></td><td>18 g</td><td>5.3 g</td><td>27 %</td></tr><tr><td>Hidratos de carbono/Hidratos de carbono</td><td>56 g</td><td>17 g</td><td>6 %</td></tr><tr><td>de las cuales azúcares/dos quais açúcares</td><td>43 g</td><td>13 g</td><td>14 %</td></tr><tr><td>Fibra alimentaria/Fibra</td><td>2.8 g</td><td>0.8 g</td><td>4 %</td></tr><tr><td>Proteínas/Proteínas</td><td>6.7 g</td><td>2.0 g</td><td>1 %</td></tr><tr><td>Sal/Sal</td><td>0.28 g</td><td>0.08 g</td><td></td></tr></table>'}],
  layout_det_res:{boxes:[{label:'table',score:.897873342,coordinate:[214,681,1057,953]}]},
}};

test('PaddleOCR-VL Milka table maps both nutrient columns and excludes reference-intake percentages',()=>{
  const document=paddleDocumentToNutritionInput({provider:{name:'paddleocr-vl'},document:actualMilkaDocument});
  const parsed=parseNutritionLabel(document);
  assert.equal(document.tableCount,1);
  assert.equal(parsed.columns.length,2);
  const per100=parsed.columns.find(column=>column.kind==='100g');
  const serving=parsed.columns.find(column=>column.quantity===30);
  assert.ok(per100&&serving);
  for(const [key,value] of Object.entries({energyKJ:2234,calories:535,fat:31,saturatedFat:18,carbs:56,sugars:43,fiber:2.8,protein:6.7,salt:.28}))assert.equal(per100.nutrients[key]?.value,value,key);
  for(const [key,value] of Object.entries({energyKJ:670,calories:160,fat:9.2,saturatedFat:5.3,carbs:17,sugars:13,fiber:.8,protein:2,salt:.08}))assert.equal(serving.nutrients[key]?.value,value,key);
  assert.equal(Object.keys(per100.nutrients).includes('percent'),false);
  assert.ok(serving.nutrients.fat.confidence<70,'serving fat remains highlighted because Paddle provides no per-cell confidence');
  assert.ok(document.lines.every(line=>line.tableDetectionConfidence===.897873342));
  assert.deepEqual(nutritionBasisConsistency(parsed.columns),[],'independent rounding at the two printed bases is allowed');
  const wrongServing=structuredClone(parsed.columns);
  wrongServing.find(column=>column.quantity===30).nutrients.fat.value=8;
  wrongServing.find(column=>column.quantity===30).nutrients.fat.rawValue='8 g';
  assert.equal(nutritionBasisConsistency(wrongServing)[0]?.field,'fat','large cross-basis disagreements are flagged');
});

test('PaddleOCR-VL mojibake is repaired before canonical nutrient alias matching',()=>{
  const document=paddleDocumentToNutritionInput({document:{res:{parsing_res_list:[{block_label:'table',block_bbox:[0,0,10,10],block_content:'<table><tr><td>ProteÃ­nas/ProteÃ­nas</td><td>100g</td><td>30g</td></tr><tr><td>Grasa/LÃ­pidos</td><td>31 g</td><td>9.2 g</td></tr></table>'}]}}});
  assert.match(document.rawText,/Proteínas/);
  assert.match(document.rawText,/Lípidos/);
});

test('correctly aligned tables keep energy and fat labels on their own rows',()=>{
  const document=paddleDocumentToNutritionInput({document:{res:{parsing_res_list:[{block_label:'table',block_content:'<table><tr><td>Nutrient</td><td>100 g</td><td>30 g</td></tr><tr><td>Energy</td><td>2234 kJ / 535 kcal</td><td>670 kJ / 160 kcal</td></tr><tr><td>Fat</td><td>31 g</td><td>9.3 g</td></tr></table>'}]}}});
  const parsed=parseNutritionLabel(document);
  assert.ok(document.text.includes('Energy | 2234 kJ'));
  assert.ok(document.text.includes('Fat | 31 g'));
  const per100=parsed.columns.find(column=>column.kind==='100g');
  const serving=parsed.columns.find(column=>column.quantity===30);
  assert.equal(per100.nutrients.fat.value,31);
  assert.equal(serving.nutrients.fat.value,9.3);
});
