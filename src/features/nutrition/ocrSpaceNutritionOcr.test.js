import test from 'node:test';
import assert from 'node:assert/strict';
import { ocrSpaceDocumentToNutritionInput } from './nutritionOcrDocument.js';
import { parseNutritionLabel } from './nutritionLabelParser.js';

test('normalizes OCR.Space overlay rows and preserves decimal nutrition values and zero',()=>{
  const text='Nutrition Information\nPer 100g\nCalories 143 kcal\nProtein 12.56 g\nTotal Fat 9.51 g\nCarbohydrates 0.72 g\nDietary Fibre 0.00 g\nTotal Sugars 0.37 g\nVitamin B12 (Cobalamin) 0.89 mcg\nIron 1.75 mg\nZinc 1.29 mg';
  const words=(line,y)=>line.split(' ').map((word,index)=>({text:word,bbox:{x0:index*35,y0:y,x1:index*35+30,y1:y+14}}));
  const lines=text.split('\n').map((line,index)=>({text:line,words:words(line,index*20),bbox:{x0:0,y0:index*20,x1:500,y1:index*20+14}}));
  const normalized=ocrSpaceDocumentToNutritionInput({provider:'ocr-space',engine:'2',processingStatus:'success',pages:[{rawText:text,lines,words:lines.flatMap(line=>line.words),boxes:lines.map(line=>line.bbox)}]});
  const column=parseNutritionLabel({text:normalized.text,lines:normalized.lines}).columns[0];
  assert.equal(column.kind,'100g');
  assert.equal(column.nutrients.protein.value,12.56);
  assert.equal(column.nutrients.fat.value,9.51);
  assert.equal(column.nutrients.carbs.value,0.72);
  assert.equal(column.nutrients.fiber.value,0);
  assert.equal(column.nutrients.sugars.value,0.37);
  assert.equal(column.nutrients.vitaminB12.value,0.89);
  assert.equal(column.nutrients.iron.value,1.75);
  assert.equal(column.nutrients.zinc.value,1.29);
  assert.ok(column.nutrients.fat.rawCells==null||column.nutrients.fat.bbox);
});

test('keeps missing OCR.Space values unknown and retains word positions',()=>{
  const normalized=ocrSpaceDocumentToNutritionInput({pages:[{rawText:'Per 100g\nProtein 12.56 g',lines:[{text:'Protein 12.56 g',words:[{text:'Protein',bbox:{x0:1,y0:2,x1:30,y1:10}},{text:'12.56',bbox:{x0:100,y0:2,x1:130,y1:10}},{text:'g',bbox:{x0:135,y0:2,x1:140,y1:10}}],bbox:{x0:1,y0:2,x1:140,y1:10}}]}]});
  const column=parseNutritionLabel({text:'Per 100g\n'+normalized.text,lines:[{text:'Per 100g'},...normalized.lines]}).columns[0];
  assert.equal(normalized.lines[0].words[1].bbox.x0,100);
  assert.equal(column.nutrients.protein.value,12.56);
  assert.equal(column.nutrients.fat,undefined);
});

test('rejoins OCR.Space column overlays by row and assigns each value to the printed basis',()=>{
  const box=(text,x,y,width=text.length*12)=>({text,bbox:{x0:x,y0:y,x1:x+width,y1:y+20}});
  const overlayLines=[
    {text:'Per 100 g',words:[box('Per',300,10),box('100',350,10),box('g',390,10)]},
    {text:'Per serving (30 g)',words:[box('Per',700,10),box('serving',740,10),box('(30',820,10),box('g)',860,10)]},
    {text:'Protein',words:[box('Protein',30,50)]},
    {text:'12.56 g',words:[box('12.56',350,50),box('g',410,50)]},
    {text:'3.77 g',words:[box('3.77',750,50),box('g',800,50)]},
    {text:'Fat',words:[box('Fat',30,90)]},
    {text:'9.51 g',words:[box('9.51',350,90),box('g',410,90)]},
    {text:'2.85 g',words:[box('2.85',750,90),box('g',800,90)]},
  ];
  const normalized=ocrSpaceDocumentToNutritionInput({pages:[{rawText:'',lines:overlayLines}]});
  const parsed=parseNutritionLabel({text:normalized.text,lines:normalized.lines});
  assert.equal(normalized.lines.length,3);
  assert.deepEqual(normalized.lines.map(line=>line.text),['Per 100 g Per serving (30 g)','Protein 12.56 g 3.77 g','Fat 9.51 g 2.85 g']);
  assert.equal(parsed.columns.find(column=>column.kind==='100g').nutrients.protein.value,12.56);
  assert.equal(parsed.columns.find(column=>column.kind==='serving').nutrients.protein.value,3.77);
  assert.equal(parsed.columns.find(column=>column.kind==='100g').nutrients.fat.value,9.51);
  assert.equal(parsed.columns.find(column=>column.kind==='serving').nutrients.fat.value,2.85);
});
