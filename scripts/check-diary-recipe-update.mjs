// Run against the dedicated test Vite server on port 5181 (see GROCERIES.md).
// Every Supabase request is intercepted: this never reads or writes a real account.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium, expect } = require(
  process.env.GROCERY_PLAYWRIGHT_PATH || "@playwright/test",
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const output =
  process.env.GROCERY_QA_OUTPUT ||
  "C:/Users/Ayyaz/AppData/Local/Temp/cboard-grocery-qa/screenshots";
await fs.mkdir(output, { recursive: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
let remote = null,
  offline = false,
  errors = [];
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  aud: "authenticated",
  role: "authenticated",
  email: "training@example.test",
  user_metadata: { username: "training_test" },
  app_metadata: { provider: "email" },
  created_at: new Date().toISOString(),
};
const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated" })).toString("base64url")}.test`;
await context.addInitScript(
  ({ user, token }) => {
    if (!localStorage.getItem("sb-training-qa-auth-token"))
      localStorage.setItem(
        "sb-training-qa-auth-token",
        JSON.stringify({
          access_token: token,
          refresh_token: "test-refresh",
          expires_at: 4102444800,
          expires_in: 360000,
          token_type: "bearer",
          user,
        }),
      );
  },
  { user, token },
);

const records = new Map();
const { emptyDay, newMeal, foodItem, localDate } = await import('../src/features/diary/diaryData.js');
const today = localDate();
const diaryMeal = { ...newMeal('Breakfast'), title: 'My breakfast', items: [foodItem({ quantity: 100, unit: 'g', calories: 100, protein: 8, source: { provider: 'Recipe ingredient', name: 'Yogurt breakfast', modified: true } }, 'Added yogurt')] };
records.set('food-diary:v1:' + today, { key: 'food-diary:v1:' + today, value: { ...emptyDay(today), meals: [diaryMeal] }, updated_at: '2026-09-29T00:00:00Z' });

const fixture = JSON.parse(await fs.readFile('public/recipes/greek-yogurt-oats.json', 'utf8'));
fixture.title = 'Yogurt breakfast';
fixture.ingredients = [{ name: 'Brooklea Fat Free Yogurt', amount: 150, unit: 'g', nutritionLabel: { quantity: 100, unit: 'g', calories: 59, protein: 10, carbs: 4, fat: 0, calcium: 110, source: { provider: 'Label', name: 'Brooklea' } } }];
fixture.sauces = [];
fixture.alternatives = {};
delete fixture.productNutrition;
records.set('recipe:v1:' + fixture.slug, { key: 'recipe:v1:' + fixture.slug, value: { recipe: fixture }, updated_at: '2026-09-28T00:00:00Z' });
await context.route('https://training-qa.supabase.co/**', async route => {
  const req = route.request(), url = new URL(req.url());
  let data = [];
  if (url.pathname.endsWith('/auth/v1/user')) data = user;
  else if (url.pathname.includes('/profiles')) data = { username: 'grocery_test' };
  else if (url.pathname.includes('/user_tool_preferences')) {
    if (req.method() === 'GET') {
      const key = url.searchParams.get('key');
      if (key?.startsWith('eq.')) data = records.get(key.slice(3)) || null;
      else if (key?.startsWith('like.')) data = [...records.values()].filter(row => row.key.startsWith(key.slice(5).replace('%', '')));
    } else {
      const value = req.postDataJSON();
      const key = value.key || url.searchParams.get('key')?.slice(3);
      if (key?.startsWith('recipe:v1:') && url.searchParams.get('updated_at') && records.get(key)?.updated_at !== url.searchParams.get('updated_at').slice(3)) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
        return;
      }
      const row = { ...records.get(key), ...value, key, updated_at: new Date().toISOString() };
      records.set(key, row);
      data = { updated_at: row.updated_at };
    }
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
});

const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on('pageerror', error => errors.push(error.message));
const recipeKey = 'recipe:v1:' + fixture.slug;
try {
  const originalRecipe = structuredClone(records.get(recipeKey));
  await page.goto('http://127.0.0.1:5181/cboard/food-diary');
  await page.getByRole('button', { name: 'Edit My breakfast', exact: true }).click();
  await page.getByRole('button', { name: 'Save meal entry', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Update the original recipe too?' })).toBeVisible();
  assert.deepEqual(records.get(recipeKey), originalRecipe);
  await dialog.getByRole('button', { name: 'Save diary only', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  assert.deepEqual(records.get(recipeKey), originalRecipe);
  assert.equal(records.has('food-catalog:v1'), false);
  await page.getByRole('button', { name: 'Edit My breakfast', exact: true }).click();
  await page.getByRole('button', { name: 'Save meal entry', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Recipe to update')).toHaveValue(fixture.slug);
  await dialog.getByRole('checkbox', { name: 'Add Added yogurt', exact: true }).check();
  await dialog.getByLabel('Whole-recipe amount').fill('300');
  await dialog.getByRole('button', { name: 'Save diary and update recipe', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const added = records.get(recipeKey).value.recipe.ingredients.find(item => item.name === 'Added yogurt');
  assert.equal(added.amount, 300);
  assert.equal(added.nutrition.protein, 24);
  assert.equal(added.nutritionLabel.source.recipeOnly, true);
  assert.equal(records.has('food-catalog:v1'), false);
  assert.equal(records.get('food-diary:v1:' + today).value.meals[0].items[0].quantity, 100);
  await page.reload();
  await page.getByRole('button', { name: 'Edit My breakfast', exact: true }).click();
  await page.getByRole('button', { name: 'Save meal entry', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: output + '/diary-recipe-confirm-mobile.png' });
  await expect(page.getByRole('dialog').getByRole('checkbox', { name: 'Update Added yogurt', exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('checkbox', { name: 'Update Added yogurt', exact: true }).check();
  await page.getByRole('dialog').getByRole('checkbox', { name: /Also update shared/ }).check();
  records.get(recipeKey).updated_at = '2030-01-01T00:00:00Z';
  await page.getByRole('dialog').getByRole('button', { name: 'Save diary and update recipe', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('changed in another tab');
  assert.equal(records.has('food-catalog:v1'), false);
  await page.getByRole('dialog').getByRole('button', { name: 'Save diary only', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Edit My breakfast', exact: true }).click();
  await page.getByRole('button', { name: 'Save meal entry', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox', { name: 'Update Added yogurt', exact: true }).check();
  await page.getByRole('dialog').getByRole('checkbox', { name: /Also update shared/ }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Save diary and update recipe', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  assert.equal(records.get('food-catalog:v1').value.items.length, 1);
  assert.equal(records.get('food-catalog:v1').value.items[0].name, 'Added yogurt');
  assert.equal(records.get(recipeKey).value.recipe.ingredients.filter(item => item.name === 'Added yogurt').length, 1);
  assert.deepEqual(errors, []);
  console.log('PASS: confirmation, diary-only isolation, explicit recipe addition, recipe-only nutrition, independent diary amount and persisted update');
} catch (error) { console.error(errors); console.error((await page.locator('body').innerText()).slice(-3000)); throw error; }
finally { await browser.close(); }
