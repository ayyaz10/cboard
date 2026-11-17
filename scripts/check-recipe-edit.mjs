// Start Vite on port 5181 with the training-qa Supabase test URL and anon key, then run npm run test:recipe-edit.
// Every request is intercepted; no account data is read or written.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, expect: baseExpect } = require(process.env.GROCERY_PLAYWRIGHT_PATH || '@playwright/test');
const expect = baseExpect.configure({ timeout: 15000 });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const user = {
  id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated',
  email: 'recipe-test@example.test', user_metadata: { username: 'recipe_test' },
  app_metadata: { provider: 'email' }, created_at: new Date().toISOString(),
};
const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, exp: 4102444800, role: 'authenticated' })).toString('base64url')}.test`;
const fixtureIngredients = [
  ['Banana', 55, 'g'], ['Brooklea 0% Greek yogurt', 150, 'g'], ['Quaker oats original sachet', 30, 'g'],
  ['Rowse Honey', 11, 'g'], ['Walnut', 5, 'g'], ['Almonds', 5, 'g'], ['Crunchy 100% Peanut Butter', 10, 'g'],
  ['Milled flax seeds', 7, 'g'], ['Chia Seeds', 10, 'g'], ['Frozen Strawberries', 25, 'g'],
  ['Frozen Dark Sweet Cherries', 25, 'g'], ['Frozen Raspberries', 25, 'g'], ['Lidl Frozen Blackberries', 25, 'g'],
  ['Unsweetened Almond Drink', 80, 'ml'], ["Golden Raisins - Nisha's", 7, 'g'], ['Apple', 80, 'g'],
];
let recipe = {
  schemaVersion: 1, title: 'Banana Greek Yogurt Oat Bowl', slug: 'banana-greek-yogurt-oat-bowl', mealType: 'Breakfast',
  description: 'Saved breakfast description.', notes: 'Keep the fruit chilled until serving.', source: { type: 'website', label: 'Original recipe', url: 'https://example.test/oats', showOnRecipeCard: false },
  nutrition: { calories: 616.5, protein: 29.6, carbs: 77.3, fat: 20.3, fiber: 16.8 },
  nutritionFromIngredients: true, prepTime: '5 min', cookTime: null, servings: 1,
  ingredients: fixtureIngredients.map(([name, amount, unit], index) => ({
    id: `ingredient-${index + 1}`, name, amount, unit, note: index === 0 ? 'Ripe' : '',
    nutrition: { calories: index === 0 ? 48 : 12, protein: index === 0 ? 0.6 : 0.5, carbs: index === 0 ? 12 : 2, fat: 0, fiber: index === 0 ? 1.3 : 0.2 },
    ...(index === 1 ? { foodId: 'food-yogurt-1', nutritionLabel: { quantity: 100, unit: 'g', calories: 55, protein: 10, carbs: 4, fat: 0, fiber: 0, source: { provider: 'Saved food', name: 'Brooklea 0% Greek yogurt', foodName: 'Brooklea 0% Greek yogurt', foodId: 'food-yogurt-1' } } } : {}),
  })),
  steps: ['Mix the yogurt and oats.', 'Add the fruit and serve.'],
  sauces: [{ id: 'sauce-1', name: 'Honey drizzle', amount: 1, unit: 'tsp', note: 'Optional', nutrition: { calories: 21 } }],
  alternatives: { berries: { title: 'Fruit alternative', options: [{ id: 'alt-1', name: 'Blueberries', amount: 25, unit: 'g', nutrition: { calories: 14 } }] } },
  tags: ['Breakfast', 'Quick'],
};
let updatedAt = '2026-11-16T00:00:00.000Z';
const pageErrors = [];
await context.addInitScript(({ user, token }) => {
  if (!localStorage.getItem('sb-training-qa-auth-token')) localStorage.setItem('sb-training-qa-auth-token', JSON.stringify({
    access_token: token, refresh_token: 'test-refresh', expires_at: 4102444800, expires_in: 360000, token_type: 'bearer', user,
  }));
}, { user, token });
const pref = () => ({ key: `recipe:v1:${recipe.slug}`, value: { recipe, image: 'https://images.example.test/recipe.jpg' }, updated_at: updatedAt });
await context.route('https://training-qa.supabase.co/**', async route => {
  const request = route.request();
  const url = new URL(request.url());
  const method = request.method();
  let data = [];
  if (url.pathname.endsWith('/auth/v1/user')) data = user;
  else if (url.pathname.endsWith('/profiles')) data = [];
  else if (url.pathname.endsWith('/user_tool_preferences')) {
    const key = url.searchParams.get('key') || '';
    if (method === 'GET' && key === 'like.recipe:v1:%') data = [pref()];
    else if (method === 'GET' && key === 'like.recipe-favourite:v1:%') data = [];
    else if (method === 'GET' && key === `eq.recipe:v1:${recipe.slug}`) data = pref();
    else if (method === 'GET' && ['eq.food-catalog:v1', 'eq.nutrition:daily-goals:v1'].includes(key)) data = null;
    else if (method === 'GET' && ['eq.recipes:daily-plan:v1', 'eq.recipes:routine-presets:v1', 'eq.recipes:dated-plans:v1'].includes(key)) data = null;
    else if (method === 'GET' && key.startsWith('like.')) data = [];
    else if (method === 'PATCH' && key === `eq.recipe:v1:${recipe.slug}`) {
      const body = request.postDataJSON();
      recipe = body.value.recipe;
      updatedAt = body.updated_at;
      data = request.url().includes('select=key') ? { key: `recipe:v1:${recipe.slug}` } : { updated_at: updatedAt };
    } else if (method === 'PATCH' && key === 'eq.food-catalog:v1') data = { updated_at: new Date().toISOString() };
    else if (method === 'POST') data = request.postDataJSON();
  } else if (url.pathname.endsWith('/focus_sessions')) data = [];
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
});
await context.route('https://search.openfoodfacts.org/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hits: [] }) }));
await context.route('https://api.nal.usda.gov/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ foods: [] }) }));
await context.route('https://food.gov.uk/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }));
const page = await context.newPage();
page.setDefaultTimeout(12000);
page.on('pageerror', error => pageErrors.push(error.message));
const editUrl = 'http://127.0.0.1:5181/cboard/recipes/banana-greek-yogurt-oat-bowl/edit';
try {
  await page.goto(editUrl, { waitUntil: 'commit' });
  await expect(page.getByRole('heading', { name: 'Edit Recipe' })).toBeVisible();
  await expect(page.getByLabel('Recipe title')).toHaveValue('Banana Greek Yogurt Oat Bowl');
  await expect(page.getByLabel('Description')).toHaveValue('Saved breakfast description.');
  await expect(page.getByLabel('Recipe notes')).toHaveValue('Keep the fruit chilled until serving.');
  await expect(page.getByText('Recipe link: banana-greek-yogurt-oat-bowl')).toBeVisible();
  await expect(page.getByRole('button', { name: /Drag to reorder Banana/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Move Banana down/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Live recipe nutrition summary' })).toBeVisible();
  await page.reload({ waitUntil: 'commit' });
  await expect(page.getByLabel('Recipe title')).toHaveValue('Banana Greek Yogurt Oat Bowl');
  await expect(page.getByLabel('Source URL')).toHaveValue('https://example.test/oats');

  // Full editor: stable-ID reordering, food lookup, manual entry and removal all stay in the draft.
  await page.getByRole('button', { name: /Move Banana down/ }).click();
  await expect(page.getByRole('button', { name: /Move Banana up/ })).toBeVisible();
  await page.getByRole('button', { name: 'Add food', exact: true }).click();
  await expect(page.getByRole('button', { name: /Close food lookup/ })).toBeVisible();
  const foodRow = page.locator('.recipe-item-row').filter({ has: page.getByRole('button', { name: /Close food lookup/ }) });
  await foodRow.getByLabel('Search foods').fill('Brooklea');
  const foodRowId = await foodRow.getAttribute('data-ingredient-id');
  await page.getByRole('button', { name: /Use Brooklea 0% Greek yogurt/ }).click();
  const selectedFoodRow = page.locator(`.recipe-item-row[data-ingredient-id="${foodRowId}"]`);
  await expect(selectedFoodRow.getByRole('combobox', { name: 'Name' })).toHaveValue('Brooklea 0% Greek yogurt');
  await page.getByRole('button', { name: 'Add manually', exact: true }).click();
  const manualRow = page.locator('.recipe-item-row').filter({ has: page.getByRole('combobox', { name: 'Name' }) });
  await manualRow.getByRole('combobox', { name: 'Name' }).fill('Tested manual topping');
  await manualRow.getByRole('textbox', { name: 'Amount' }).fill('12');
  await manualRow.getByRole('textbox', { name: 'Unit' }).fill('g');
  await manualRow.getByRole('button', { name: 'Enter nutrition manually' }).click();
  await manualRow.getByLabel('Calories (kcal)').fill('0');
  await manualRow.getByLabel('Protein (g)').fill('0');
  await manualRow.getByRole('button', { name: 'Remove Tested manual topping' }).click();
  await expect(page.locator('.recipe-item-row')).toHaveCount(19);
  await page.getByRole('button', { name: 'Save Recipe', exact: true }).last().click();
  await expect(page).toHaveURL(/\/cboard\/recipes\/banana-greek-yogurt-oat-bowl$/);
  assert.equal(recipe.ingredients.length, 17);
  assert.equal(recipe.ingredients[0].name, 'Brooklea 0% Greek yogurt');
  assert.equal(recipe.ingredients.at(-2).name, 'Apple');
  assert.equal(recipe.ingredients.at(-1).name, 'Brooklea 0% Greek yogurt');
  assert.equal(recipe.ingredients[1].name, 'Banana');
  assert.equal(recipe.ingredients.find(item => item.foodId === 'food-yogurt-1')?.name, 'Brooklea 0% Greek yogurt');
  assert.equal(recipe.notes, 'Keep the fruit chilled until serving.');
  assert.equal(recipe.source.url, 'https://example.test/oats');
  assert.equal(recipe.sauces[0].id, 'sauce-1');
  assert.equal(recipe.alternatives.berries.options[0].id, 'alt-1');

  // Detail Quick Edit starts from saved amounts at base and scaled servings, and persists by ingredient ID.
  await page.getByRole('button', { name: 'Increase servings' }).click();
  const quickEdit = page.getByRole('button', { name: /Quick edit .* Banana/ });
  await quickEdit.click();
  const quickEditor = page.getByRole('group', { name: /Edit ingredient name and nutrition for/ }).first();
  await expect(quickEditor.getByLabel(/Saved amount/)).toHaveValue('55');
  await quickEditor.getByLabel(/Saved amount/).fill('60');
  await quickEditor.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: /Quick edit 60 g Banana/ })).toBeVisible();
  await expect(page.getByText('90 g Banana')).toBeVisible();
  assert.equal(recipe.ingredients.find(item => item.id === 'ingredient-1').amount, 60);
  await page.reload({ waitUntil: 'commit' });
  await expect(page.getByRole('heading', { name: 'Banana Greek Yogurt Oat Bowl' })).toBeVisible();
  await expect(page.getByText('60 g Banana')).toBeVisible();
  await page.getByRole('button', { name: /Quick edit 60 g Banana/ }).click();
  const unscaledEditor = page.getByRole('group', { name: /Edit ingredient name and nutrition for/ }).first();
  await expect(unscaledEditor.getByRole('spinbutton', { name: 'Amount' })).toHaveValue('60');
  await unscaledEditor.getByLabel('Food / ingredient name').fill('Ripe Cavendish Banana');
  await unscaledEditor.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('60 g Ripe Cavendish Banana')).toBeVisible();
  assert.equal(recipe.ingredients.find(item => item.id === 'ingredient-1').name, 'Ripe Cavendish Banana');

  await page.goto('http://127.0.0.1:5181/cboard/recipes/manage', { waitUntil: 'commit' });
  await expect(page.getByRole('heading', { name: 'Manage Recipes' })).toBeVisible();
  await page.locator('summary[aria-label="Actions for Banana Greek Yogurt Oat Bowl"]').click();
  await page.getByRole('button', { name: 'Edit recipe', exact: true }).click();
  await expect(page).toHaveURL(/\/cboard\/recipes\/banana-greek-yogurt-oat-bowl\/edit$/);
  await expect(page.getByLabel('Recipe title')).toHaveValue('Banana Greek Yogurt Oat Bowl');
  await page.getByLabel('Recipe title').fill('Discard this draft');
  await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
  await expect(page.getByRole('dialog', { name: /Discard unsaved recipe changes/ })).toBeVisible();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page).toHaveURL(/\/cboard\/recipes\/banana-greek-yogurt-oat-bowl$/);
  assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
  console.log('Recipe editing passed direct/refresh prefill, 16-row draft edits, food lookup, manual nutrition, reorder/remove, save/cancel, and scaled/unscaled Quick Edit.');
} finally {
  await context.close();
  await browser.close();
}
