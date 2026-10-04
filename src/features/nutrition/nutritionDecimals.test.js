import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNutritionLabel,scoreNutritionCandidate,nutritionConsistency} from './nutritionLabelParser.js';
import {finalizeNutritionCandidates,nutritionCandidatesAgree} from './nutritionCandidateSelection.js';
import {reconstructOcrLines} from '../../services/ocr/ocrLayout.js';
import {aldiText,aldiExpected} from './fixtures/aldi-website.js';
import {applyNutritionReview} from './nutritionLabelReview.js';
import {cleanFoodCatalogItem} from './foodCatalog.js';
import {validateItem} from '../diary/diaryData.js';
import {cleanIngredientLabel,ingredientLabelNutrition} from '../recipes/ingredientNutrition.js';

const parse=text=>parseNutritionLabel(text).columns[0];
const amounts=column=>Object.fromEntries(Object.entries(column.nutrients).map(([key,field])=>[key,field.value]));
const word=(text,x0,y0=0,x1=x0+text.length*10,y1=20,confidence=95)=>({text,confidence,bbox:{x0,y0,x1,y1}});
const ocr=words=>({blocks:[{paragraphs:[{lines:words.map(w=>({words:[w]}))}]}]});
const spatial=words=>parse({lines:reconstructOcrLines(ocr(words),{preserveNumericPunctuation:true})});
test('Aldi website transcription retains every decimal, unit, zero and unknown basis',()=>{
 const column=parse(aldiText);assert.deepEqual(amounts(column),aldiExpected);
 for(const [key,field] of Object.entries(column.nutrients)){assert.equal(field.unit,key==='calories'?'kcal':key==='energyKJ'?'kJ':'g');assert.equal(field.uncertain,false);}
 assert.equal(column.confirmed,false);assert.equal(column.basisStatus,'not-found');assert.deepEqual(nutritionConsistency(column),[]);
});
for(const [label,key,number] of [['Protein','protein','0.6'],['Fat','fat','0.5'],['Carbohydrate','carbs','6.1'],['Fibre','fiber','3.8'],['Energy kcal','calories','38.9'],['Energy kJ','energyKJ','162.8']]) {
 for(const separator of ['.',' . ', ' .', '. ', ','])test(`${label} preserves decimal separator ${JSON.stringify(separator)}`,()=>{
  const unit=key==='calories'?'kcal':key==='energyKJ'?'kJ':'g';const column=parse(`${label} ${number.replace('.',separator)} ${unit}`);
  assert.equal(column.nutrients[key].value,Number(number));assert.equal(column.nutrients[key].uncertain,false);
 });
}
test('small separate baseline dot stays with close digits and correct visual row',()=>{
 const column=spatial([word('Protein',20),word('0',610),word('.',622,18,624,22,15),word('6',626),word('g',647),word('Fat',20,60,50,80),word('10',610,60,630,80),word('g',647,60,657,80)]);
 assert.equal(column.nutrients.protein.value,.6);assert.equal(column.nutrients.protein.uncertain,false);assert.equal(column.nutrients.fat.value,10);
});
test('far apart tokens are never reconstructed as a decimal across columns',()=>{
 const words=[word('Protein',20),word('0',310),word('.',460,18,462,22),word('6',610),word('g',640)];
 const lines=reconstructOcrLines(ocr(words),{preserveNumericPunctuation:true});
 assert.ok(!lines.find(line=>line.text.includes('Protein')).text.includes('.'));
 const sameRow={text:words.map(w=>w.text).join(' '),words,confidence:90};
 assert.equal(parseNutritionLabel({lines:[sameRow]}).columns.length,0);
});
test('integer values and high-fat foods are never divided by ten',()=>{
 const c=parse('Per 100g\nEnergy 3372 kJ / 806 kcal\nFat 90 g\nProtein 10 g\nCarbohydrate 0 g\nSaturates 0 g\nSalt 0 g');
 assert.equal(c.nutrients.fat.value,90);assert.equal(c.nutrients.protein.value,10);assert.equal(c.nutrients.saturatedFat.value,0);assert.deepEqual(nutritionConsistency(c),[]);
});
test('implausible decimal-loss candidate is penalized, never numerically rewritten',()=>{
 const broken=aldiText.replace('0.5 g','54 g').replace('0.6 g','6 g').replace('3.8 g','38 g').replace('Carbohydrate 6.1','Carbohydrate 61');
 const bad=parseNutritionLabel(broken),good=parseNutritionLabel(aldiText);
 assert.ok(scoreNutritionCandidate(good,80).score>scoreNutritionCandidate(bad,99).score+10);
 assert.equal(bad.columns[0].nutrients.fat.value,54);
 const best={name:'bad',parsed:bad,score:1};finalizeNutritionCandidates(best,[best]);
 assert.equal(best.parsed.columns[0].nutrients.fat.value,54);assert.match(best.parsed.columns[0].nutrients.fat.reasons.join(' '),/calories/);
});
test('a weak alternate scan does not turn correct fields into generic warnings',()=>{
 const good={name:'original',parsed:parseNutritionLabel(aldiText),score:42};
 const poor={name:'poor',parsed:parseNutritionLabel(aldiText.replace('0.5 g','54 g')),score:24};
 finalizeNutritionCandidates(good,[good,poor]);assert.ok(Object.values(good.parsed.columns[0].nutrients).every(field=>!field.uncertain));
});
test('credible contradictory scans remain visible; consensus permits early stop',()=>{
 const a={name:'a',parsed:parseNutritionLabel(aldiText),score:42};
 const b={name:'b',parsed:parseNutritionLabel(aldiText.replace('0.6 g','0.8 g')),score:42};
 assert.equal(nutritionCandidatesAgree([a,b]),false);finalizeNutritionCandidates(a,[a,b]);assert.match(a.parsed.columns[0].nutrients.protein.reasons.join(' '),/disagree/);
 assert.equal(nutritionCandidatesAgree([{parsed:parseNutritionLabel(aldiText)},{parsed:parseNutritionLabel(aldiText)}]),true);
});
test('full-image basis context is retained only for matching single tables',()=>{
 const crop={name:'crop',parsed:parseNutritionLabel(aldiText),score:42};const full={name:'full',parsed:parseNutritionLabel('Per 100g\n'+aldiText),score:42};
 finalizeNutritionCandidates(crop,[crop,full]);assert.equal(crop.parsed.columns[0].kind,'100g');
 assert.equal(parse('Per 10Og\n'+aldiText).basisStatus,'unreadable');
});
test('exact decimals persist in catalog, diary and recipe cleaners and scale once',()=>{
 const column={...parse(aldiText),kind:'100g',quantity:100,unit:'g',confirmed:true};
 const label=applyNutritionReview(null,column,Object.keys(column.nutrients));
 const roundtrip=JSON.parse(JSON.stringify(label));
 const food=cleanFoodCatalogItem({name:'Aldi fixture',quantity:100,unit:'g',nutrition:roundtrip,source:label.source});
 const diary=validateItem({id:'aldi-fixture',name:'Aldi fixture',quantity:150,unit:'g',basis:100,nutritionUnit:'g',nutrition:roundtrip,source:label.source});
 for(const data of [food.nutrition,diary.nutrition,cleanIngredientLabel(roundtrip)])for(const [key,value] of Object.entries(aldiExpected))assert.equal(data[key],value);
 const scaled=ingredientLabelNutrition({amount:150,unit:'g',nutritionLabel:roundtrip});
 assert.ok(Math.abs(scaled.calories-58.35)<.001);assert.ok(Math.abs(scaled.protein-.9)<.001);assert.equal(scaled.fat,.75);
});
