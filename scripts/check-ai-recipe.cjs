const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/src/contexts/AuthContext.jsx*', route => route.fulfill({
      contentType: 'application/javascript',
      body: `export const useAuth=()=>({user:{id:'recipe-ai-test'},isAuthenticated:true,isLoading:false,displayName:'Test'});export const AuthProvider=({children})=>children;`,
    }));
    await page.route('**/src/services/dataMigrationService.js*', route => route.fulfill({ contentType: 'application/javascript', body: 'export async function migrateLocalStorageData(){}' }));
    await page.route('**/src/services/recipeService.js*', route => route.fulfill({
      contentType: 'application/javascript',
      body: `
        let recipes=[];
        export async function getRecipes(){return recipes}
        export async function saveRecipe(){} export async function saveRecipeBatch(){return []} export async function deleteRecipe(){}
        export async function parseRecipeText(text){
          if(!text.trim())throw new Error('Paste some recipe text first.');
          const recipe={schemaVersion:1,source:null,title:'Chicken fried rice',slug:'chicken-fried-rice',mealType:'Other',description:'',nutrition:{calories:null,protein:null,carbs:null,fat:null},prepTime:null,cookTime:'25 minutes',servings:1,ingredients:[{name:'120g chicken',amount:null,unit:'',note:'',nutrition:{calories:null,protein:null,carbs:null,fat:null}}],steps:['Cook chicken','Add rice'],sauces:[],alternatives:{},tags:['AI imported'],image:null,updatedAt:new Date().toISOString()};recipes=[recipe];return recipe;
        }
      `,
    }));
    await page.goto('http://localhost:5173/cboard/recipes/import');
    await page.getByRole('button', { name: 'AI text import' }).click();
    const text = page.getByLabel('Recipe text');
    await text.fill('Chicken fried rice. Use 120g chicken. Cook chicken, add rice. Takes 25 minutes.');
    await page.getByRole('button', { name: 'Create recipe with AI' }).click();
    await page.getByRole('heading', { name: 'Chicken fried rice', exact: true }).waitFor();
    assert.match(page.url(), /\/recipes\/chicken-fried-rice$/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    console.log('PASS: mobile AI import creates and opens a saved recipe with no browser errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
