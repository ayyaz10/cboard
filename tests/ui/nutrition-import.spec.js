import { test, expect } from '@playwright/test';
import { createNutritionJsonTemplate } from '../../src/features/nutrition/nutritionJsonImport.js';

const validNutrition = JSON.stringify({
  ...createNutritionJsonTemplate({ foodName: 'Raw uncooked chickpeas', sourceName: 'USDA FoodData Central' }),
  nutrition: { calories: 164, protein: 8.9 },
});
const validLabelNutrition = JSON.stringify({
  ...createNutritionJsonTemplate({ foodName: 'Brand chickpeas', state: 'canned, drained', sourceType: 'nutrition_label', sourceName: 'Supplied nutrition label' }),
  nutrition: { calories: 130, protein: 7 },
});

for (const width of [390, 768, 1366, 1920]) {
  test(`nutrition import stays usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('tests/ui/fixtures/nutrition.html');
    await expect(page.getByRole('button', { name: 'Scan nutrition label' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import with ChatGPT' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Paste nutrition JSON' })).toHaveCount(0);
    await page.evaluate(() => { window.open = () => null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async text => { window.__prompt = text; }, readText: async () => window.__nutritionJson || '',
    } }); });
    await page.getByRole('button', { name: 'Import with ChatGPT' }).click();
    const dialog = page.getByRole('dialog', { name: 'Import with ChatGPT' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/Food \/ preparation/).fill('  Raw uncooked chickpeas  ');
    await dialog.getByLabel(/Food \/ preparation/).press('Tab');
    await expect(page.getByLabel('Canonical food item name')).toHaveValue('Raw uncooked chickpeas');
    await dialog.getByRole('button', { name: 'Copy prompt & open ChatGPT' }).click();
    await expect.poll(() => page.evaluate(() => window.__prompt)).toContain('Food: Raw uncooked chickpeas');
    await page.evaluate(json => { window.__nutritionJson = json; window.dispatchEvent(new Event('focus')); }, validNutrition);
    await expect(page.getByLabel('Applied food name')).toHaveText('Raw uncooked chickpeas|164');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, `${width}px should not overflow horizontally`).toBe(false);
  });
}

test('notifications sit above an open nutrition dialog', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('tests/ui/fixtures/nutrition.html');
  await page.getByRole('button', { name: 'Import with ChatGPT' }).click();
  await page.evaluate(() => window.showNutritionTestToast());
  const toast = page.getByText('Nutrition test toast');
  await expect(toast).toBeVisible();
  const box = await toast.boundingBox();
  const dialogBox = await page.getByRole('dialog', { name: 'Import with ChatGPT' }).boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(dialogBox.y + 2);
});


test('clipboard permission failure offers a manual JSON fallback in the same panel', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('tests/ui/fixtures/nutrition.html');
  await page.evaluate(() => {
    window.open = () => null;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async () => {}, readText: async () => { throw new Error('Clipboard permission denied'); },
    } });
  });
  await page.getByRole('button', { name: 'Import with ChatGPT' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import with ChatGPT' });
  await dialog.getByRole('button', { name: 'Copy prompt & open ChatGPT' }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog.getByRole('button', { name: 'Paste from clipboard' })).toBeVisible();
  await dialog.getByLabel('Paste returned nutrition JSON').fill(`\`\`\`json\n${validNutrition}\n\`\`\``);
  await dialog.getByRole('button', { name: 'Validate JSON' }).click();
  await dialog.getByRole('button', { name: 'Apply nutrition to draft' }).click();
  await expect(page.getByLabel('Applied food name')).toHaveText('Raw uncooked chickpeas|164');
});


test('ChatGPT label extraction is available inside Scan Nutrition Label', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('tests/ui/fixtures/nutrition.html');
  await page.evaluate(json => {
    window.open = () => null;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async text => { window.__prompt = text; }, readText: async () => window.__nutritionJson || '',
    } });
    window.__nutritionJson = json;
  }, validLabelNutrition);
  await page.getByRole('button', { name: 'Scan nutrition label' }).click();
  await page.getByRole('button', { name: 'Use ChatGPT to read this label' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import with ChatGPT' });
  await expect(dialog.getByText('Read the label image')).toBeVisible();
  await dialog.getByRole('button', { name: 'Copy label prompt & open ChatGPT' }).click();
  await expect.poll(() => page.evaluate(() => window.__prompt)).toContain('Do not use general food knowledge');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('Applied food name')).toHaveText('Brand chickpeas|130');
});
