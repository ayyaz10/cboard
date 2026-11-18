import { test, expect } from '@playwright/test';

async function openPopup(page) {
  await page.goto('tests/ui/fixtures/diary-recipe-confirm.html');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Recipe to update').selectOption('test-recipe');
  const row = dialog.locator('.diary-recipe-choice').filter({ hasText: 'Update Oats' });
  await row.getByRole('checkbox').check();
  return { dialog, row, amount: row.getByLabel('Whole-recipe amount') };
}

test('a drag from the amount field to the backdrop preserves the popup and draft', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { dialog, row, amount } = await openPopup(page);
  await amount.fill('275');
  const inputBox = await amount.boundingBox();
  const dialogBox = await dialog.boundingBox();
  const start = { x: inputBox.x + Math.min(17, inputBox.width / 2), y: inputBox.y + inputBox.height / 2 };
  const end = { x: dialogBox.x + dialogBox.width + 40, y: Math.max(dialogBox.y + 10, Math.min(start.y, dialogBox.y + dialogBox.height - 10)) };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await expect(row.getByRole('checkbox')).toBeChecked();
  await expect(amount).toHaveValue('275');
  await amount.fill('276');
  await expect(amount).toHaveValue('276');
});

test('only a direct backdrop click dismisses and dismissal buttons continue to work', async ({ page }) => {
  const { dialog } = await openPopup(page);
  const closeButton = dialog.getByRole('button', { name: 'Close popup' });
  await closeButton.click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__recipeHarness.closes)).toBe(1);

  const back = await openPopup(page);
  await back.dialog.getByRole('button', { name: 'Back to editing' }).click();
  await expect(back.dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__recipeHarness.closes)).toBe(1);

  const backdrop = await openPopup(page);
  const box = await backdrop.dialog.boundingBox();
  await page.mouse.click(8, Math.max(8, box.y - 8));
  await expect(backdrop.dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__recipeHarness.closes)).toBe(1);
});

test('diary-only, update, and new-recipe save actions still call their handlers', async ({ page }) => {
  let popup = await openPopup(page);
  await popup.dialog.getByRole('button', { name: 'Save diary only' }).click();
  await expect.poll(() => page.evaluate(() => window.__recipeHarness.saves.length)).toBe(1);
  expect(await page.evaluate(() => window.__recipeHarness.saves[0].slice(0, 3))).toEqual([null, [], false]);

  popup = await openPopup(page);
  await popup.amount.fill('275');
  await popup.dialog.getByRole('button', { name: 'Save diary and update recipe' }).click();
  await expect.poll(() => page.evaluate(() => window.__recipeHarness.saves.length)).toBe(1);
  const update = await page.evaluate(() => window.__recipeHarness.saves[0]);
  expect(update[0].slug).toBe('test-recipe');
  expect(update[1]).toContainEqual(expect.objectContaining({ selected: true, amount: '275' }));
  expect(update[2]).toBe(false);

  await page.reload();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Recipe action').selectOption('new');
  await dialog.getByLabel('Recipe name').fill('New breakfast');
  await dialog.getByLabel('Preparation steps (one per line)').fill('Mix and serve.');
  await dialog.getByRole('button', { name: 'Save diary and new recipe' }).click();
  await expect.poll(() => page.evaluate(() => window.__recipeHarness.saves.length)).toBe(1);
  const saveNew = await page.evaluate(() => window.__recipeHarness.saves[0]);
  expect(saveNew.slice(0, 3)).toEqual([null, [], false]);
  expect(saveNew[3]).toEqual({ title: 'New breakfast', servings: 1, steps: 'Mix and serve.' });
});
