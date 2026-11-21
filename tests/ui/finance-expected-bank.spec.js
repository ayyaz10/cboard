import { test, expect } from '@playwright/test';

test('Expected Bank Balance explains missing account setup and opens the setup form', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/cboard/tests/ui/fixtures/finance.html');
  await page.getByRole('button', { name: 'Show Expected Bank Balance empty state' }).click();

  const card = page.getByRole('region', { name: 'Expected Bank Balance' });
  await expect(card).toContainText('No active bank or savings account is configured');
  await expect(card).toContainText('Spendable now is a different ledger total');
  await expect(card.getByRole('button', { name: 'Set up bank or savings account' })).toBeVisible();
  await card.getByRole('button', { name: 'Set up bank or savings account' }).click();

  const dialog = page.getByRole('dialog', { name: 'Import transactions' });
  await expect(dialog.getByLabel('Account name')).toBeVisible();
  await expect(dialog.getByLabel('Type')).toHaveValue('bank');
  await expect(dialog.getByLabel('Opening balance')).toBeVisible();
  await expect(dialog).toContainText('Use the balance before the first transaction you will track');
});
