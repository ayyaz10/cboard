import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {paddleDocumentToNutritionInput} from '../src/features/nutrition/nutritionOcrDocument.js';
import {parseNutritionLabel} from '../src/features/nutrition/nutritionLabelParser.js';

const endpoint=process.env.VITE_NUTRITION_OCR_URL||'http://localhost:8765/api/nutrition-ocr';
const imagePath=process.env.MILKA_IMAGE||fileURLToPath(new URL('../src/features/nutrition/fixtures/milka.png',import.meta.url));
const expected={
  'per 100 g':{energyKJ:2234,calories:535,fat:31,saturatedFat:18,carbs:56,sugars:43,fiber:2.8,protein:6.7,salt:.28},
  'per 30 g':{energyKJ:670,calories:160,fat:9.3,saturatedFat:5.3,carbs:17,sugars:13,fiber:.8,protein:2,salt:.08},
};

const image=await readFile(imagePath);
const form=new FormData();form.append('image',new Blob([image],{type:'image/png'}),'milka.png');
console.log(`Scanning ${imagePath} with ${endpoint}`);
const headers=process.env.NUTRITION_OCR_ACCESS_TOKEN?{Authorization:`Bearer ${process.env.NUTRITION_OCR_ACCESS_TOKEN}`} : {};
const response=await fetch(endpoint,{method:'POST',body:form,headers,signal:AbortSignal.timeout(15*60*1000)});
const body=await response.json().catch(()=>({}));
if(!response.ok)throw new Error(body.detail||`OCR service returned HTTP ${response.status}`);
const normalized=paddleDocumentToNutritionInput(body);
const parsed=parseNutritionLabel(normalized);
const matches={};
for(const [basis,fields] of Object.entries(expected)){
  const column=basis==='per 100 g'?parsed.columns.find(item=>item.kind==='100g'):parsed.columns.find(item=>item.quantity===30);
  matches[basis]={};
  for(const [field,want] of Object.entries(fields)){
    const got=column?.nutrients[field]?.value??null;
    matches[basis][field]={expected:want,actual:got,match:got!=null&&Math.abs(got-want)<=.0001};
  }
}
const tableBoxes=(body.document?.res||body.document)?.layout_det_res?.boxes?.filter(box=>box.label==='table')||[];
console.log(JSON.stringify({provider:body.provider,tableCount:normalized.tableCount,detectedTableRegions:tableBoxes.map(box=>({score:box.score,coordinate:box.coordinate})),columns:parsed.columns.map(column=>({basis:column.label,nutrients:column.nutrients})),fieldComparison:matches},null,2));
const passed=Object.values(matches).flatMap(row=>Object.values(row)).filter(item=>item.match).length;
const total=Object.values(matches).reduce((sum,row)=>sum+Object.keys(row).length,0);
console.log(`Milka OCR gate: ${passed}/${total} exact expected fields matched.`);
if(passed<total)process.exitCode=1;
