// Start Vite on port 5181 with the training-qa Supabase test URL and anon key, then run npm run test:recipe-detail.
// Every Supabase request is intercepted, so this never reads or writes an account.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, expect } = require(process.env.GROCERY_PLAYWRIGHT_PATH || '@playwright/test');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const user = {
  id: '11111111-1111-4111-8111-111111111111',
  aud: 'authenticated', role: 'authenticated', email: 'recipe-test@example.test',
  user_metadata: { username: 'recipe_test' }, app_metadata: { provider: 'email' },
  created_at: new Date().toISOString(),
};
const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, exp: 4102444800, role: 'authenticated' })).toString('base64url')}.test`;
await context.addInitScript(({ user, token }) => {
  if (!localStorage.getItem('sb-training-qa-auth-token')) localStorage.setItem('sb-training-qa-auth-token', JSON.stringify({
    access_token: token, refresh_token: 'test-refresh', expires_at: 4102444800, expires_in: 360000, token_type: 'bearer', user,
  }));
}, { user, token });
const recipe = {
  schemaVersion: 1,
  title: 'Chicken Burrito', slug: 'chicken-burrito', mealType: 'Lunch',
  description: 'A simple chicken burrito.', nutrition: { calories: 605, protein: 58 },
  prepTime: '10 min', cookTime: '15 min', servings: 1,
  ingredients: [
    { name: 'Chicken Breast', amount: 110, unit: 'g' },
    { name: 'Cheddar Cheese', amount: 28, unit: 'g' },
    { name: 'Protein Tortilla', amount: 1, unit: 'wrap' },
  ],
  steps: ['Cook the chicken.', 'Fill the tortilla and wrap.'], sauces: [], alternatives: {}, tags: [],
};
const recipeRow = { key: 'recipe:v1:chicken-burrito', value: { recipe }, updated_at: '2026-11-16T00:00:00Z' };
const pageErrors = [];
await context.route('https://training-qa.supabase.co/**', async route => {
  const url = new URL(route.request().url());
  let data = null;
  if (url.pathname.endsWith('/auth/v1/user')) data = user;
  else if (url.pathname.endsWith('/user_tool_preferences')) {
    const key = url.searchParams.get('key') || '';
    const raw = url.searchParams.get('key') ?? '';
    const prefix = raw.startsWith('like.') ? raw.slice(5).replaceAll('%', '') : '';
    if (prefix === 'recipe:v1:') data = [recipeRow];
    else if (prefix === 'recipe-favourite:v1:') data = [];
    else if (key.startsWith('eq.recipe:v1:chicken-burrito')) data = recipeRow;
    else if (key === 'eq.food-catalog:v1') data = null;
    else if (raw.startsWith('like.')) data = [];
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on('pageerror', error => pageErrors.push(error.message));
try {
  await page.goto('http://127.0.0.1:5181/cboard/recipes', { waitUntil: 'commit' });
  await expect(page.getByRole('link', { name: 'Chicken Burrito' })).toBeVisible();
  await page.getByRole('link', { name: 'Chicken Burrito' }).click();
  await expect(page).toHaveURL(/\/cboard\/recipes\/chicken-burrito$/);
  await expect(page.getByRole('heading', { name: 'Chicken Burrito', level: 1 })).toBeVisible();
  let ingredients = page.getByRole('heading', { name: 'Ingredients' }).locator('xpath=ancestor::section[1]');
  await expect(ingredients.getByText('110 g Chicken Breast', { exact: true })).toBeVisible();
  await expect(ingredients.getByText('28 g Cheddar Cheese', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert', { name: 'This section could not load.' })).toHaveCount(0);

  await page.goto('http://127.0.0.1:5181/cboard/recipes/chicken-burrito', { waitUntil: 'commit' });
  await expect(page.getByRole('heading', { name: 'Chicken Burrito', level: 1 })).toBeVisible();
  ingredients = page.getByRole('heading', { name: 'Ingredients' }).locator('xpath=ancestor::section[1]');
  await expect(ingredients.getByText('110 g Chicken Breast', { exact: true })).toBeVisible();
  await expect(ingredients.getByText('28 g Cheddar Cheese', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert', { name: 'This section could not load.' })).toHaveCount(0);
  assert.deepEqual(pageErrors, []);
  console.log('Recipe detail passed list navigation and direct URL checks.');
} finally {
  await context.close();
  await browser.close();
}
