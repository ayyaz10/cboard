// Vite on 5177. Real local OCR and real editors; persistence/auth are isolated test doubles.
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=process.env.NUTRITION_TEST_URL||'http://127.0.0.1:5177/cboard/';
const fixture=JSON.parse(fs.readFileSync('public/recipes/greek-yogurt-oats.json','utf8'));
Object.assign(fixture,{title:'Label test recipe',servings:1,updatedAt:'fixture-v1',ingredients:[{id:'ingredient-id',name:'Original ingredient',amount:150,unit:'g',nutrition:{calories:270,protein:18,fat:9,fiber:4.5}}],sauces:[],alternatives:{},nutritionFromIngredients:true});
delete fixture.productNutrition;
const main=`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CalorieCalculator} from '/cboard/src/features/calculators/calorie/CalorieCalculator.jsx';
import {FoodItemEditor} from '/cboard/src/features/nutrition/FoodItemEditor.jsx';
import {RecipeFormEditor} from '/cboard/src/features/recipes/RecipeFormEditor.jsx';
import {IngredientList} from '/cboard/src/features/recipes/RecipeComponents.jsx';
import {RecipeProducts} from '/cboard/src/features/recipes/RecipeProducts.jsx';
import {DiaryMealEditor} from '/cboard/src/features/diary/DiaryMealEditor.jsx';
import {NutritionLookup} from '/cboard/src/features/groceries/NutritionLookup.jsx';
import {validateRecipe} from '/cboard/src/features/recipes/recipeData.js';
import '/cboard/src/styles/index.css';
const h=React.createElement,kind=new URLSearchParams(location.search).get('case');
const initial=${JSON.stringify(fixture)};
window.qaFixture=initial;
const save=value=>{localStorage.setItem('nutrition-qa-'+kind,JSON.stringify(value));window.qaSaved=value;};
function Harness(){
 const [recipe,setRecipe]=useState(initial),[closed,setClosed]=useState(false);
 const existing={name:'Existing food',quantity:100,unit:'g',nutrition:{calories:180,protein:12,fat:6,fiber:3},source:{provider:'Manual'}};
 const [meal,setMeal]=useState({id:'meal-id',meal:'Breakfast',title:'Test meal',time:'08:00',notes:'',items:[{id:'food-id',name:'Original food',quantity:150,unit:'g',basis:100,nutritionUnit:'g',nutrition:{calories:180,protein:12,fat:6,fiber:3},source:{provider:'Manual'}}]});
 window.qaRecipe=recipe;window.qaMeal=meal;
 if(kind==='calorie')return h(CalorieCalculator);
 if(kind==='food'||kind==='existing')return closed?h('p',null,'Saved food'):h(FoodItemEditor,{catalog:kind==='existing'?[existing]:[],initial:kind==='existing'?existing:null,onClose:()=>setClosed(true),onSave:save});
 if(kind==='recipe')return h('main',null,h(RecipeFormEditor,{recipe,onChange:setRecipe}),h('button',{onClick:()=>save(validateRecipe(recipe))},'Save test recipe'));
 if(kind==='pen')return h(IngredientList,{recipe,onRecipeUpdated:value=>{setRecipe(value);save(value);}});
 if(kind==='products')return h(RecipeProducts,{recipe,onSaved:save});
 if(kind==='diary')return h(DiaryMealEditor,{initial:meal,recipes:[],busy:false,onDraftChange:()=>{},onSave:value=>{setMeal(value);save(value);},onCancel:()=>{},foodLibrary:[]});
 return h(NutritionLookup,{name:'Original food',active:true,visible:true,currentNutrition:{...existing.nutrition,quantity:100,unit:'g'},onSelect:save});
}
createRoot(document.getElementById('root')).render(h(Harness));`;

(async()=>{
 const entry='src/__nutrition_qa__.jsx';fs.writeFileSync(entry,main);
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
 const context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage();
 page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(60000);const errors=[],ocrRequests=[],external=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(request.url().includes('/cboard/ocr/'))ocrRequests.push(request.url());if(new URL(request.url()).origin!==new URL(base).origin && /supabase|generativelanguage|gemini|amazonaws/.test(request.url()))external.push(request.url());});
 await page.route('**/src/main.jsx*',route=>route.fulfill({contentType:'application/javascript',body:"import '/cboard/src/__nutrition_qa__.jsx';"}));
 await page.route('**/src/contexts/AuthContext.jsx*',route=>route.fulfill({contentType:'application/javascript',body:'export const useAuth=()=>({user:null,isAuthenticated:false});export const AuthProvider=({children})=>children;'}));
 await page.route('**/src/services/supabaseCrud.js*',route=>route.fulfill({contentType:'application/javascript',body:`
 export const isUuid=()=>true,normalizeLegacyUuid=value=>value,parseNullableNumber=value=>value,isMissingColumnError=()=>false;
 export function assertSupabaseResult(result){if(result.error)throw result.error;}
 export async function getUserScopedClient(){return {userId:'test',client:{from(){let patch=null;const query={select(){return query;},eq(){return query;},update(value){patch=value;return query;},async single(){return {data:{value:{recipe:window.qaFixture},updated_at:'fixture-v1'}};},async maybeSingle(){window.qaDbPatch=patch;return {data:{updated_at:'saved-v2'}};}};return query;}}};}
 `}));
 await page.goto(base+'?case=food');
 await page.getByRole('dialog',{name:'Add food item'}).waitFor();
 const png=Buffer.from(await page.evaluate(()=>{
   const c=document.createElement('canvas');c.width=1450;c.height=950;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.fillStyle='black';x.font='30px Arial';
   x.fillText('Nutrition Information',45,55);x.fillText('Typical values',45,135);x.fillText('Per 100g',720,135);x.fillText('Per serving (40g)',1040,135);
   const rows=[['Energy','840 kJ / 200 kcal','336 kJ / 80 kcal'],['Fat','8 g','3.2 g'],['of which saturates','1.2 g','0.48 g'],['Carbohydrate','25 g','10 g'],['of which sugars','4 g','1.6 g'],['Fibre','3 g','1.2 g'],['Protein','20 g','8 g'],['Salt','0.4 g','0.16 g']];
   rows.forEach(([name,a,b],i)=>{const y=215+i*78;x.fillText(name,45,y);x.fillText(a,720,y);x.fillText(b,1040,y);});
   return c.toDataURL('image/png').split(',')[1];
 }),'base64');
 async function scan(scope){await scope.getByRole('button',{name:'Scan nutrition label',exact:true}).click();await upload(scope);}
 async function upload(scope){await scope.getByLabel('Upload nutrition label',{exact:true}).setInputFiles({name:'nutrition-table.png',mimeType:'image/png',buffer:png});await scope.getByRole('button',{name:'Apply nutrition',exact:true}).waitFor({timeout:120000});}
 async function checked(scope,label){return scope.getByLabel('Scanned '+label,{exact:true}).inputValue();}
 let dialog=page.getByRole('dialog');
 await dialog.getByLabel('Food name',{exact:true}).fill('Retained product name');await scan(dialog);
 assert.equal(await checked(dialog,'Calories (kcal)'),'200');assert.equal(await checked(dialog,'Protein (g)'),'20');assert.equal(await checked(dialog,'Fat (g)'),'8');
 assert.equal(await dialog.getByLabel('Nutrition column',{exact:true}).locator('option').count(),2);
 await dialog.getByLabel('Nutrition column',{exact:true}).selectOption({index:1});
 assert.equal(await checked(dialog,'Calories (kcal)'),'80');assert.equal(await checked(dialog,'Protein (g)'),'8');assert.equal(await dialog.getByLabel('Values per quantity').inputValue(),'40');
 await dialog.getByLabel('Nutrition column',{exact:true}).selectOption({index:0});
 assert.equal(await page.evaluate(()=>window.qaSaved),undefined);
 const workers=ocrRequests.filter(url=>url.endsWith('/worker.min.js')).length;
 await dialog.getByText('Original image, crop and rotation',{exact:true}).click();await dialog.getByRole('button',{name:'Rescan label'}).click();await dialog.getByRole('button',{name:'Apply nutrition',exact:true}).waitFor({timeout:120000});
 assert.equal(ocrRequests.filter(url=>url.endsWith('/worker.min.js')).length,workers);
 await page.setViewportSize({width:390,height:844});
 assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
 await dialog.getByText('Original image, crop and rotation',{exact:true}).click();await dialog.getByLabel('Nutrition column',{exact:true}).scrollIntoViewIfNeeded();
 await dialog.screenshot({path:process.env.TEMP+'/cboard-nutrition-review.png'});
 await dialog.getByRole('button',{name:'Apply nutrition',exact:true}).click();
 assert.equal(await dialog.getByLabel('Food name',{exact:true}).inputValue(),'Retained product name');
 await dialog.getByRole('button',{name:'Save food item',exact:true}).click();await page.getByText('Saved food',{exact:true}).waitFor();
 assert.equal((await page.evaluate(()=>window.qaSaved)).nutrition.energyKJ,840);
 await page.setViewportSize({width:1280,height:1000});await page.goto(base+'?case=existing');dialog=page.getByRole('dialog');await scan(dialog);
 await dialog.locator('.nscan-check').filter({hasText:'Protein (g)'}).getByRole('checkbox').uncheck();
 await dialog.getByLabel('Scanned Calories (kcal)',{exact:true}).fill('201');await dialog.getByRole('button',{name:'Apply nutrition',exact:true}).click();
 assert.equal(await dialog.getByLabel('Protein (g)',{exact:true}).inputValue(),'12');await dialog.getByRole('button',{name:'Save food item',exact:true}).click();await page.getByText('Saved food',{exact:true}).waitFor();
 assert.equal((await page.evaluate(()=>window.qaSaved)).name,'Existing food');assert.equal((await page.evaluate(()=>window.qaSaved)).nutrition.calories,201);
 // Save through the real ingredient form and recipe validator.
 await page.goto(base+'?case=recipe');await page.locator('summary').filter({hasText:'Original ingredient'}).click();
 let scope=page.locator('details').filter({has:page.getByRole('combobox',{name:'Name',exact:true})}).last();await scan(scope);await scope.getByRole('button',{name:'Apply nutrition',exact:true}).click();
 await page.getByRole('button',{name:'Save test recipe'}).click();let saved=await page.evaluate(()=>window.qaSaved);
 assert.equal(saved.ingredients[0].nutritionLabel.calories,200);assert.equal(saved.ingredients[0].nutrition.calories,300);assert.equal(saved.ingredients[0].amount,150);
 // Pen editor uses the actual save service with a database boundary double.
 await page.goto(base+'?case=pen');await page.getByRole('button',{name:/Edit nutrition for/}).click();await scan(page);await page.getByRole('button',{name:'Apply nutrition',exact:true}).click();await page.getByRole('button',{name:'Save nutrition',exact:true}).click();
 await page.waitForFunction(()=>window.qaSaved);saved=await page.evaluate(()=>window.qaSaved);assert.equal(saved.ingredients[0].nutritionLabel.quantity,100);assert.equal(saved.ingredients[0].nutrition.calories,300);
 await page.goto(base+'?case=diary');await page.getByRole('button',{name:/Original food/}).click();await scan(page);await page.getByRole('button',{name:'Apply nutrition',exact:true}).click();await page.getByRole('button',{name:'Save meal entry',exact:true}).click();await page.waitForFunction(()=>window.qaSaved);saved=await page.evaluate(()=>window.qaSaved);
 assert.equal(saved.items[0].id,'food-id');assert.equal(saved.items[0].name,'Original food');assert.equal(saved.items[0].quantity,150);assert.equal(saved.items[0].nutrition.calories,200);
 await page.goto(base+'?case=products');await page.getByText('Choose products & calculate nutrition',{exact:true}).click();await scan(page);await page.getByRole('button',{name:'Apply nutrition',exact:true}).click();await page.getByRole('button',{name:'Save products & nutrition',exact:true}).click();await page.waitForFunction(()=>window.qaSaved);saved=await page.evaluate(()=>window.qaSaved);assert.equal(saved.productNutrition.items[0].nutrition.calories,200);assert.equal(saved.nutrition.calories,300);
 await page.goto(base+'?case=lookup');await page.getByRole('button',{name:'Scan nutrition label',exact:true}).click();await upload(page);await page.getByRole('button',{name:'Apply nutrition',exact:true}).click();assert.equal((await page.evaluate(()=>window.qaSaved)).quantity,100);
 await page.goto(base+'?case=calorie');await scan(page);await page.getByRole('button',{name:'Apply nutrition',exact:true}).click();
 assert.equal(await page.getByLabel('Total calories',{exact:true}).inputValue(),'200');assert.equal(await page.getByLabel('Total quantity',{exact:true}).inputValue(),'100');await page.getByLabel('Desired quantity',{exact:true}).fill('150');await page.getByRole('button',{name:'Calculate',exact:true}).click();await page.getByText('300',{exact:true}).waitFor();
 // Invalid files and cancellation are recoverable and cannot apply stale results.
 await page.goto(base+'?case=food');dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Scan nutrition label',exact:true}).click();
 await dialog.getByLabel('Upload nutrition label',{exact:true}).setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('invalid')});await dialog.getByRole('alert').waitFor();
 await dialog.getByLabel('Upload nutrition label',{exact:true}).setInputFiles({name:'nutrition.png',mimeType:'image/png',buffer:png});await dialog.getByRole('button',{name:'Cancel scan',exact:true}).click();assert.equal(await dialog.getByRole('button',{name:'Apply nutrition',exact:true}).count(),0);await upload(dialog);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.ok(ocrRequests.every(url=>url.startsWith(new URL(base).origin+'/cboard/ocr/')));
 console.log('PASS: real two-column OCR, field selection/edit, worker reuse, mobile review, food/recipe/pen/diary/products/lookup saves, cancellation/retry, local-only assets.');
 }finally{await browser.close();fs.unlinkSync(entry);}
})().catch(error=>{console.error(error);process.exitCode=1;});
