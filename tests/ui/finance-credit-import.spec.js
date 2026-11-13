import { test, expect } from '@playwright/test';

test('a statement payment can be recorded through canonical Credit Purchase accounting', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/cboard/tests/ui/fixtures/finance-credit-import.html');
  const dialog = page.getByRole('dialog', { name: 'Import transactions' });
  await dialog.getByLabel('Import into account').selectOption('current');
  await dialog.locator('#finance-import-file').setInputFiles({
    name: 'klarna.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Date,Description,Amount\n25/11/2026,KLARNA payment,-50.00\n'),
  });
  await expect(dialog.getByTestId('finance-import-count-found')).toContainText('1 transactions found');
  const row = dialog.getByTestId('finance-import-row');
  await row.getByText('Link as Credit Purchase payment').click();
  await row.getByLabel('Credit Purchase').selectOption('agreement-1');
  await expect(row.getByLabel('Scheduled instalment')).toHaveValue(/.+/);
  await row.getByRole('button', { name: 'Record Credit Purchase payment' }).click();

  const state = JSON.parse(await page.getByTestId('finance-state').textContent());
  const payments = state.transactions.filter(item => item.type === 'creditPayment');
  expect(payments).toHaveLength(1);
  expect(payments[0]).toMatchObject({ amount: 5000, accountId: 'current', creditAgreementId: 'agreement-1', creditPaymentKind: 'scheduled', sourceType: 'file_import', importSource: 'csv' });
  expect(state.transactions.some(item => item.type === 'expense' && item.sourceType === 'file_import')).toBe(false);
  await expect(row).toContainText('Linked as Credit Purchase payment');
});
