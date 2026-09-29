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
try {
  await page.goto('http://127.0.0.1:5181/cboard/groceries');
  await page.getByRole('button', { name: /Quick add/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('textarea').fill('2 L milk\n500 g Brooklea Fat');
  await dialog.getByRole('button', { name: /Brooklea Fat Free Yogurt/ }).click();
  await expect(dialog.locator('textarea')).toHaveValue('2 L milk\n500 g Brooklea Fat Free Yogurt');
  await dialog.getByRole('button', { name: /Review items/ }).click();
  await expect(dialog.getByLabel('Brooklea Fat Free Yogurt amount')).toHaveValue('500');
  await dialog.getByText('Nutrition saved \u00b7 per 100 g', { exact: true }).click();
  await expect(dialog.getByLabel('Calcium (mg)', { exact: true }).last()).toHaveValue('110');
  await expect(dialog.getByRole('button', { name: 'My saved foods', exact: true }).last()).toBeVisible();
  await page.screenshot({ path: output + '/grocery-review-desktop.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Save 2 items', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  assert.equal(records.get('groceries:v1').value.items.find(item => item.name === 'Brooklea Fat Free Yogurt').nutrition.calcium, 110);
  assert.equal(records.get('food-catalog:v1').value.items.find(item => item.name === 'Brooklea Fat Free Yogurt').nutrition.calcium, 110);
  await page.reload();
  await page.getByRole('button', { name: /Quick add/ }).click();
  await page.getByRole('dialog').locator('textarea').fill('Brooklea');
  await expect(page.getByRole('dialog').getByRole('button', { name: /Brooklea Fat Free Yogurt/ })).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: output + '/grocery-suggestions-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log('PASS: recipe autocomplete, multiline amount preservation, full nutrition, shared catalog save, reload, mobile layout');
} catch (error) { console.error(errors); console.error((await page.locator('body').innerText()).slice(-4000)); throw error; } finally { await browser.close(); }
