import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNutritionLabel} from './nutritionLabelParser.js';
import {applyNutritionReview, currentAtBasis} from './nutritionLabelReview.js';
import {ingredientLabelNutrition,cleanIngredientLabel} from '../recipes/ingredientNutrition.js';
import {cleanFoodCatalogItem} from './foodCatalog.js';
import {validateItem} from '../diary/diaryData.js';
import {processReceiptPixels} from '../../services/ocr/imageProcessing.js';

const UK=`Nutrition Information
Typical values per 100g
Energy 420 kJ / 100 kcal
Fat 2.5 g
of which saturates 0.5 g
Carbohydrate 15 g
of which sugars 4 g
Fibre 3 g
Protein 8 g
Salt 0.4 g`;
const first=text=>parseNutritionLabel(text).columns[0];
const value=(column,key)=>column.nutrients[key]?.value;

test('UK per-100g table extracts every core nutrient and both energy units',()=>{
 const column=first(UK);assert.equal(column.quantity,100);assert.equal(column.unit,'g');
 assert.deepEqual(Object.fromEntries(Object.entries(column.nutrients).map(([key,item])=>[key,item.value])),{energyKJ:420,calories:100,fat:2.5,saturatedFat:.5,carbs:15,sugars:4,fiber:3,protein:8,salt:.4});
 assert.equal(column.nutrients.saturatedFat.rawText,'of which saturates 0.5 g');
});
test('per serving and explicit serving size stay separate from per 100g',()=>{
 const column=first('Serving size: 30g\nNutrition Facts\nCalories 120\nProtein 6g');
 assert.equal(column.kind,'serving');assert.equal(column.quantity,30);assert.equal(value(column,'calories'),120);
 const other=first('Per serving (40g)\nFat 8g');assert.equal(other.serving.quantity,40);
});
test('two nutrition columns retain their values and exclude reference-intake percentages',()=>{
 const result=parseNutritionLabel('Typical values Per 100g Per 30g serving %RI\nCalories 400 120 6%\nProtein 20g 6g 12%\nCarbohydrate 50g 15g 6%\nEnergy 1680kJ / 400kcal 504kJ / 120kcal');
 assert.equal(result.columns.length,2);
 assert.deepEqual(result.columns.map(column=>[column.quantity,value(column,'protein'),value(column,'carbs'),value(column,'calories'),value(column,'energyKJ')]),[[100,20,50,400,1680],[30,6,15,120,504]]);
});
test('US label aliases and percentage-only micronutrients',()=>{
 const column=first('Nutrition Facts\nServing size: 40g\nCalories 200\nTotal Fat 8g 10%\nSaturated Fat 1g 5%\nTotal Carbohydrate 25g 9%\nDietary Fiber 3g\nTotal Sugars 4g\nProtein 10g\nSodium 120mg 5%\nCalcium 10%');
 assert.equal(value(column,'fiber'),3);assert.equal(value(column,'sodium'),120);assert.equal(value(column,'calcium'),undefined);assert.equal(value(column,'salt'),undefined);
});
test('mass units normalize safely without equating salt and sodium',()=>{
 const column=first('Per 100g\nSalt 400mg\nSodium 0.12g\nIron 2mg\nVitamin D 0.005mg\nVitamin B12 2mcg');
 assert.equal(value(column,'salt'),.4);assert.equal(value(column,'sodium'),120);assert.equal(value(column,'iron'),2);assert.equal(value(column,'vitaminD'),5);assert.equal(value(column,'vitaminB12'),2);
});
test('simple lists and compact labels require basis confirmation when no basis is printed',()=>{
 const column=first('Energy 100 kcal\nProtein 8g\nCarbs 15g\nFat 2.5g\nFibre 3g');
 assert.equal(column.confirmed,false);assert.equal(column.quantity,null);assert.equal(value(column,'calories'),100);
 assert.throws(()=>applyNutritionReview(null,column,['calories']),/basis/);
});
test('website screenshots do not need a grid and retain missing fields as unknown',()=>{
 const column=first('Buy our product\nNutritional information\nPer 100ml\nCalories 45\nProtein 3.2 g\nAdd to basket');
 assert.equal(column.unit,'ml');assert.equal(value(column,'protein'),3.2);assert.equal(value(column,'fat'),undefined);
});
test('restricted OCR typo repair preserves raw text and flags repaired amounts',()=>{
 const column=first('Per 100g\nPr0tein 8g\nFat 2.Sg\nSalt O.4g\nF1bre 3g');
 assert.equal(value(column,'protein'),8);assert.equal(value(column,'fat'),2.5);assert.equal(value(column,'salt'),.4);assert.equal(value(column,'fiber'),3);
 assert.equal(column.nutrients.fat.uncertain,true);assert.equal(column.nutrients.fat.rawValue,'2.Sg');
});
test('missing units and upper limits are flagged, negative values are excluded',()=>{
 const column=first('Per 100g\nFat 8\nSalt <0.01g\nProtein -3g');
 assert.equal(column.nutrients.fat.missingUnit,true);assert.equal(column.nutrients.salt.upperBound,true);assert.equal(value(column,'protein'),undefined);
});
test('kJ without kcal is not imported as calories',()=>{
 const column=first('Per 100g\nEnergy 420kJ\nFat 2g');assert.equal(value(column,'energyKJ'),420);assert.equal(value(column,'calories'),undefined);
});
test('ambiguous partial columns are left empty rather than mixed',()=>{
 const result=parseNutritionLabel('Per 100g Per serving (30g)\nProtein 20g 6g\nFat 3g');
 assert.equal(value(result.columns[0],'fat'),undefined);assert.equal(value(result.columns[1],'fat'),undefined);assert.ok(result.columns[0].warnings.length);
});
test('word coordinates assign a single partial value to its actual column',()=>{
 const line=words=>({text:words.map(([text])=>text).join(' '),confidence:90,words:words.map(([text,x])=>({text,confidence:95,bbox:{x0:x,y0:0,x1:x+text.length*8,y1:20}}))});
 const result=parseNutritionLabel({lines:[line([['Per',250],['100g',285],['Per',500],['serving',535],['(30g)',600]]),line([['Protein',10],['20g',250],['6g',500]]),line([['Fat',10],['2.5g',500]])]});
 assert.equal(value(result.columns[0],'fat'),undefined);assert.equal(value(result.columns[1],'fat'),2.5);assert.equal(value(result.columns[1],'protein'),6);
});
test('separate tables remain selectable and ingredients/footer are excluded',()=>{
 const result=parseNutritionLabel(UK+'\nIngredients: flour, water\nSalt 100g\nNutrition Information\nPer 100ml\nFat 1g\nProtein 2g');
 assert.equal(result.columns.length,2);assert.equal(value(result.columns[0],'salt'),.4);assert.equal(value(result.columns[1],'fat'),1);assert.match(result.warnings[0],/Multiple/);
});
test('ingredient-list quantities before a nutrition section are ignored',()=>{
 assert.equal(parseNutritionLabel('Ingredients\nProtein 30g\nSalt 2g\nStore in a cool place').columns.length,0);
});
for(const basis of ['item','pack','slice','scoop','container','portion'])test(`recognizes per-${basis} basis without inventing a weight`,()=>{
 const column=first(`Per ${basis}\nCalories 100\nProtein 2g`);assert.equal(column.kind,basis);assert.equal(column.unit,'pieces');assert.equal(column.quantity,1);
});
test('replacement preserves unchecked values and compares equivalent quantities',()=>{
 const current={quantity:100,unit:'g',calories:280,protein:11,fat:9};const column={...first('Per serving (40g)\nCalories 120\nProtein 6g')};
 assert.equal(currentAtBasis(current,column).calories,112);
 const result=applyNutritionReview(current,column,['calories']);assert.equal(result.calories,120);assert.equal(result.protein,4.4);assert.equal(result.fat,3.6);assert.equal(result.quantity,40);
 assert.equal(current.calories,280);
});
test('incompatible basis requires explicit clearing; clear/edit/select actions are honored',()=>{
 const current={quantity:100,unit:'ml',protein:5,fat:3};const column={...first('Per 100g\nProtein 8g'),values:{protein:7}};
 assert.throws(()=>applyNutritionReview(current,column,['protein']),/different unit/);
 const result=applyNutritionReview(current,column,['protein'],{clearIncompatible:true});assert.equal(result.protein,7);assert.equal(result.fat,null);
 assert.equal(applyNutritionReview(current,{...column,values:{protein:null}},['protein'],{clearIncompatible:true}).protein,null);
 assert.throws(()=>applyNutritionReview(current,column,[]),/Select/);
});
test('per-pack and per-item quantities cannot silently retain each other\'s nutrients',()=>{
 const current={quantity:1,unit:'pieces',protein:5,fat:3,source:{labelBasis:{kind:'pack'}}};
 const column=first('Per item\nProtein 8g');assert.equal(currentAtBasis(current,column),null);
 assert.throws(()=>applyNutritionReview(current,column,['protein']),/different unit/);
});
test('150g recipe amount scales per-100g nutrition without changing the label',()=>{
 const column=first('Per 100g\nCalories 200\nProtein 20g');const label=applyNutritionReview(null,column,['calories','protein']);
 const cleaned=cleanIngredientLabel(label);const nutrition=ingredientLabelNutrition({amount:150,unit:'g',nutritionLabel:cleaned});
 assert.equal(nutrition.calories,300);assert.equal(nutrition.protein,30);assert.equal(cleaned.calories,200);assert.equal(cleaned.quantity,100);
});
test('reviewed basis, serving size and energy survive existing catalog/diary/ingredient cleaners',()=>{
 const column=first('Per serving (40g)\nEnergy 420kJ / 100kcal\nProtein 8g');const label=applyNutritionReview(null,column,Object.keys(column.nutrients));
 const catalog=cleanFoodCatalogItem({name:'Existing food',quantity:40,unit:'g',nutrition:label,source:label.source});
 const diary=validateItem({id:'same-id',name:'Existing food',quantity:150,unit:'g',basis:40,nutritionUnit:'g',nutrition:label,source:label.source});
 for(const source of [catalog.source,diary.source,cleanIngredientLabel(label).source])assert.equal(source.labelBasis.servingQuantity,40);
 assert.equal(catalog.nutrition.energyKJ,420);assert.equal(diary.id,'same-id');
});
test('nutrition preprocessing preserves table geometry and falls back on a borderless screenshot',()=>{
 const width=300,height=200,data=new Uint8ClampedArray(width*height*4).fill(255);
 const result=processReceiptPixels({data,width,height},{layout:'nutrition'});
 assert.equal(result.region,null);assert.equal(result.cropped.width,width);assert.equal(result.aligned,undefined);assert.equal(result.variants.adaptive.length,width*height);
});
test('coherent label panels can be cropped and straightened without receipt-only row stacking',()=>{
 const width=300,height=300,data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;const paper=x>60+y*.04&&x<230+y*.04&&y>35&&y<265;data[i]=paper?245:40;data[i+1]=paper?245:80;data[i+2]=paper?245:160;data[i+3]=255;}
 const result=processReceiptPixels({data,width,height},{layout:'nutrition'});assert.ok(result.region);assert.ok(result.cropped.width<width);assert.equal(result.aligned,undefined);
});
