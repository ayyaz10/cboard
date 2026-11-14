import { test, expect } from '@playwright/test';

async function openPreview(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/cboard/tests/ui/fixtures/finance.html');
  await page.getByRole('button', { name: 'Open Native OCR Match Preview' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import transactions' });
  await expect(dialog.getByTestId('finance-import-count-found')).toHaveText('5 transactions found');
  await expect(dialog.getByTestId('finance-import-count-review')).toHaveText('4');
  await expect(dialog.getByTestId('finance-import-count-ready')).toHaveText('1');
  const missing = dialog.getByTestId('finance-import-row').filter({ hasText: 'Description missing' }).first();
  await expect(missing.locator('.f-import-badge')).toHaveText('Needs review');
  await expect(missing.getByText('Possible duplicate', { exact: true })).toHaveCount(1);
  await expect(missing.getByRole('button', { name: 'Review match' })).toBeVisible();
  await expect(missing.getByRole('checkbox')).not.toBeChecked();
  await expect(dialog).toContainText('Provisional totals');
  return dialog;
}

test('native/OCR Same transaction resolves one ?33.75 row and imports one amount', async ({ page }) => {
  const dialog = await openPreview(page, 1280);
  await dialog.getByRole('button', { name: 'Review match' }).first().click();
  const review = dialog.getByTestId('finance-import-match-review');
  await expect(review.getByLabel('Candidate rows').locator('article')).toHaveCount(4);
  await expect(review).toContainText('Native PDF text');
  await expect(review).toContainText('OCR');
  await review.getByLabel('Use fields from candidate').selectOption('1:10');
  await review.getByLabel('Keep or correct this description').fill('Coffee purchase');
  await review.getByRole('button', { name: 'Same transaction' }).click();
  await expect(dialog.getByTestId('finance-import-count-found')).toHaveText('2 transactions found');
  await expect(dialog.getByTestId('finance-import-count-review')).toHaveText('0');
  await expect(dialog.getByTestId('finance-import-count-ready')).toHaveText('2');
  await expect(dialog).not.toContainText('Provisional totals');
  await expect(dialog.getByRole('button', { name: 'Import 2 transactions' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Import 2 transactions' }).click();
  const state = JSON.parse(await page.getByTestId('finance-state').textContent());
  expect(state.transactions.filter(item => item.sourceType === 'file_import' && item.date === '2026-10-05')).toHaveLength(1);
  expect(state.transactions.find(item => item.title === 'Coffee purchase').amount).toBe(3375);
  expect(state.transactions.filter(item => item.sourceType === 'file_import')).toHaveLength(2);
});

test('native/OCR Separate transactions keeps candidates and requires missing description correction', async ({ page }) => {
  const dialog = await openPreview(page, 1280);
  await dialog.getByRole('button', { name: 'Review match' }).first().click();
  await dialog.getByTestId('finance-import-match-review').getByRole('button', { name: 'Separate transactions' }).click();
  await expect(dialog.getByTestId('finance-import-count-found')).toHaveText('5 transactions found');
  await expect(dialog.getByTestId('finance-import-count-review')).toHaveText('1');
  await expect(dialog.getByTestId('finance-import-count-ready')).toHaveText('4');
  const missing = dialog.getByTestId('finance-import-row').filter({ hasText: 'Description missing' }).first();
  await missing.getByRole('button', { name: 'Edit' }).click();
  await dialog.getByLabel('Merchant / title').fill('Native shop transaction');
  await dialog.getByRole('button', { name: 'Apply changes' }).click();
  await expect(dialog.getByTestId('finance-import-count-review')).toHaveText('0');
  await expect(dialog.getByTestId('finance-import-count-ready')).toHaveText('5');
  await expect(dialog.getByRole('button', { name: 'Import 5 transactions' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Import 5 transactions' }).click();
  const state = JSON.parse(await page.getByTestId('finance-state').textContent());
  expect(state.transactions.filter(item => item.sourceType === 'file_import')).toHaveLength(5);
  expect(state.transactions.filter(item => item.amount === 3375 && item.date === '2026-10-05')).toHaveLength(4);
});

test('native/OCR Skip excludes just the selected candidate while leaving others unresolved', async ({ page }) => {
  const dialog = await openPreview(page, 390);
  const missing = dialog.getByTestId('finance-import-row').filter({ hasText: 'Description missing' }).first();
  await missing.getByRole('button', { name: 'Review match' }).click();
  await dialog.getByTestId('finance-import-match-review').getByRole('button', { name: 'Skip selected row' }).click();
  await expect(dialog.getByTestId('finance-import-count-found')).toHaveText('4 transactions found');
  await expect(dialog.getByTestId('finance-import-count-review')).toHaveText('3');
  await expect(dialog.getByRole('button', { name: 'Import 1 transaction' })).toBeEnabled();
  expect(await dialog.locator('.f-import-workspace').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Import 1 transaction' }).click();
  const state = JSON.parse(await page.getByTestId('finance-state').textContent());
  expect(state.transactions.filter(item => item.sourceType === 'file_import')).toHaveLength(1);
  expect(state.transactions.find(item => item.sourceType === 'file_import').title).toBe('Bus fare');
});
