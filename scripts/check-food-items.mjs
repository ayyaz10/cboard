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
const notes = [];
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
  else if (url.pathname.includes('/notes')) {
    if (req.method() === 'POST') { const note = { ...req.postDataJSON(), id: crypto.randomUUID() }; notes.push(note); data = note; }
    else data = notes;
  }
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
let aiCalls = 0, barcodeCalls = 0;
await context.route('https://training-qa.supabase.co/functions/v1/**', async route => {
  const data = route.request().postDataJSON();
  if (route.request().url().endsWith('parse-recipe')) {
    assert.equal(data.mode, 'food'); aiCalls++;
    return route.fulfill({ json: { success: true, food: { name: 'AI burger', quantity: 1, unit: 'pieces', nutrition: { calories: 250, protein: 12, fiber: null } } } });
  }
  if (data.barcode) { assert.equal(data.barcode, '5901234123457'); barcodeCalls++; }
  return route.fulfill({ json: { hits: [{ code: '5901234123457', product_name: 'Barcode burger', nutriments: { 'energy-kcal_100g': 240, proteins_100g: 12, carbohydrates_100g: 25, fat_100g: 10, fiber_100g: 2 } }] } });
});
try {
  await page.goto('http://127.0.0.1:5181/cboard/recipes/import');
  await page.getByRole('button', { name: 'Add food item', exact: true }).click();
  let modal = page.getByRole('dialog', { name: 'Add food item' });
  await modal.getByLabel('Food name', { exact: true }).fill("McDonald's burger");
  await modal.getByLabel('Calories (kcal)', { exact: true }).fill('250');
  await modal.getByLabel('Protein (g)', { exact: true }).fill('12');
  await modal.getByRole('button', { name: 'Save food item', exact: true }).click();
  await expect(modal).not.toBeVisible();
  assert.equal(records.get('food-catalog:v1').value.items[0].name, "McDonald's burger");
  assert.equal([...records.keys()].filter(key => key.startsWith('recipe:v1:')).length, 1);
  await page.goto('http://127.0.0.1:5181/cboard/food-diary');
  await page.getByRole('button', { name: 'Edit My breakfast', exact: true }).click();
  await page.getByRole('button', { name: 'Enter food manually', exact: true }).click();
  await page.getByRole('combobox', { name: 'Food name', exact: true }).fill('mcdonald');
  await page.getByRole('option').filter({ hasText: "McDonald's burger" }).first().click();
  await expect(page.getByRole('combobox', { name: 'Food name', exact: true })).toHaveValue("McDonald's burger");
  // Leave only the unsaved fixture meal; the shared food record is already saved.
  page.on('dialog', dialog => dialog.accept());
  await page.goto('http://127.0.0.1:5181/cboard/recipes/import');
  await page.getByRole('button', { name: 'Add food item', exact: true }).click();
  modal = page.getByRole('dialog', { name: 'Add food item' });
  await modal.getByRole('button', { name: 'JSON', exact: true }).click();
  await modal.getByLabel('Food JSON', { exact: true }).fill(JSON.stringify({ name: 'Invalid', quantity: 1, unit: 'pieces', nutrition: { calories: -20 } }));
  await modal.getByRole('button', { name: 'Review food JSON' }).click();
  await expect(modal.getByRole('alert')).toContainText('non-negative');
  await modal.getByLabel('Food JSON', { exact: true }).fill(JSON.stringify({ name: 'JSON burger', quantity: 1, unit: 'pieces', nutrition: { calories: 300, fiber: 0 } }));
  await modal.getByRole('button', { name: 'Review food JSON' }).click();
  await expect(modal.getByLabel('Calories (kcal)', { exact: true })).toHaveValue('300');
  await expect(modal.getByLabel('Fibre (g)', { exact: true })).toHaveValue('0');
  await modal.getByRole('button', { name: 'AI text', exact: true }).click();
  await modal.getByLabel('Describe the food').fill('A burger with 250 kcal and 12 g protein');
  await modal.getByRole('button', { name: 'Create food draft with AI' }).click();
  await expect(modal.getByLabel('Food name', { exact: true })).toHaveValue('AI burger');
  assert.equal(aiCalls, 1);
  assert.equal(records.get('food-catalog:v1').value.items.length, 1);
  await modal.getByRole('button', { name: 'Open Food Facts / barcode', exact: true }).click();
  await modal.getByRole('button', { name: 'Scan barcode', exact: true }).click();
  await modal.getByLabel('Barcode number', { exact: true }).fill('5901234123457');
  await modal.getByRole('button', { name: 'Look up barcode' }).click();
  await expect(modal.getByText('Barcode burger', { exact: true })).toBeVisible();
  const png = await page.evaluate(() => {
    // EAN-13 fixture, including valid check digit, with a quiet zone on both sides.
    const left = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
    const right = left.map(bits => [...bits].map(bit => bit === '0' ? '1' : '0').join(''));
    const even = right.map(bits => [...bits].reverse().join(''));
    const code = '5901234123457', parity = 'LGGLLG';
    const bits = '101' + [...code.slice(1,7)].map((n,i) => (parity[i] === 'L' ? left : even)[Number(n)]).join('') + '01010' + [...code.slice(7)].map(n => right[Number(n)]).join('') + '101';
    const canvas = document.createElement('canvas'); canvas.width = 460; canvas.height = 160;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0,0,460,160); ctx.fillStyle = 'black';
    [...bits].forEach((bit,i) => { if (bit === '1') ctx.fillRect(40+i*4,10,4,140); });
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await modal.getByLabel('Upload barcode image').setInputFiles({ name: 'ean13.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect.poll(() => barcodeCalls).toBe(2);
  await modal.getByLabel('Paste barcode image', { exact: true }).evaluate((element, base64) => {
    const file = new File([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], 'pasted.png', { type: 'image/png' });
    const transfer = new DataTransfer(); transfer.items.add(file);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, png);
  await expect.poll(() => barcodeCalls).toBe(3);
  await modal.getByRole('button', { name: 'Use these values', exact: true }).click();
  await expect(modal.getByLabel('Food name', { exact: true })).toHaveValue('Barcode burger');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: output + '/food-item-mobile.png' });
  await modal.getByRole('button', { name: 'Save food item', exact: true }).click();
  await expect(modal).not.toBeVisible();
  const saved = records.get('food-catalog:v1').value.items.find(item => item.name === 'Barcode burger');
  assert.equal(saved.source.code, '5901234123457');
  assert.equal(saved.nutrition.calories, 240);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Add food item', exact: true }).click();
  await modal.getByLabel('Food name', { exact: true }).fill('Barcode burger');
  await expect(modal.getByRole('button', { name: 'Save food item', exact: true })).toBeDisabled();
  await modal.getByRole('checkbox', { name: /Update the existing food/ }).check();
  await expect(modal.getByRole('button', { name: 'Save food item', exact: true })).toBeEnabled();
  assert.equal([...records.keys()].filter(key => key.startsWith('recipe:v1:')).length, 1);
  assert.deepEqual(errors, []);
  console.log('PASS: standalone food, diary search, JSON and AI drafts, barcode number, real EAN-13 image upload and paste, mobile save; no recipe created.');
} catch (error) { console.error(errors); console.error((await page.locator('body').innerText()).slice(-2000)); throw error; }
finally { await browser.close(); }
