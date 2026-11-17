import { test, expect } from '@playwright/test';

async function armConflict(page) {
  await page.getByRole('button', { name: 'Arm next conflict' }).click();
}

async function retryAndExpectSingleSave(page) {
  await expect(page.getByRole('alert')).toContainText('Finance changed in another tab');
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.getByRole('button', { name: /Save changes|Add category|Add transaction/ }).click();
  await expect(page.getByTestId('successful-saves')).toHaveText('1');
  await expect(page.getByTestId('save-attempts')).toHaveText('2');
}

test('Categories keeps its draft after conflict and saves once on retry', async ({ page }) => {
  await page.goto('/cboard/tests/ui/fixtures/finance-save-conflict.html');
  await page.getByRole('button', { name: 'Open Categories' }).click();
  await page.getByLabel('Name').fill('Conflict draft category');
  await armConflict(page);
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByLabel('Name')).toHaveValue('Conflict draft category');
  await retryAndExpectSingleSave(page);
  await expect(page.getByTestId('finance-state')).toContainText('Conflict draft category');
});

test('Transactions keeps its draft after conflict and saves once on retry', async ({ page }) => {
  await page.goto('/cboard/tests/ui/fixtures/finance-save-conflict.html');
  await page.getByRole('button', { name: 'Open Transactions' }).click();
  await page.getByLabel('Merchant or title').fill('Conflict draft transaction');
  await page.getByRole('textbox', { name: 'Amount' }).first().fill('13.00');
  await armConflict(page);
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await expect(page.getByLabel('Merchant or title')).toHaveValue('Conflict draft transaction');
  await expect(page.getByRole('textbox', { name: 'Amount' }).first()).toHaveValue('13.00');
  await retryAndExpectSingleSave(page);
  await expect(page.getByTestId('finance-state')).toContainText('Conflict draft transaction');
});
