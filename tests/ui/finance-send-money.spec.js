import { test, expect } from '@playwright/test';

for (const width of [390, 768, 1024, 1366, 1920]) {
  test(`Family Support Send Money workflow is usable at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true, isMobile: width === 390 });
    const page = await context.newPage();
    await page.goto('/cboard/tests/ui/fixtures/finance.html');
    await page.getByRole('button', { name: 'Prepare Send Money' }).click();
    await page.getByRole('button', { name: 'Open Family Support' }).click();
    await expect(page.getByRole('heading', { name: 'Family Support' })).toBeVisible();
    await expect(page.getByText('Available', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Send money', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Send money' });
    await dialog.getByRole('button', { name: /Family Support/ }).click();
    await dialog.locator('.f-send-amount input').fill('20.00');
    await dialog.getByLabel(/Exchange rate/).fill('370');
    await expect(dialog.locator('.f-send-total strong').first()).toContainText('20.00');
    await expect(dialog.getByText(/7,400/)).toBeVisible();
    const recordButton = dialog.getByRole('button', { name: 'Record as sent' });
    await recordButton.focus();
    await recordButton.press('Enter');
    await expect(page.getByTestId('finance-state')).toContainText('send_money_family_support');
    await page.getByRole('button', { name: 'Open Send Money' }).click();
    const history = page.locator('.f-send-history'); await history.locator('summary').click();
    await history.getByRole('button', { name: 'View details' }).click();
    const details = page.getByRole('dialog', { name: 'Transfer details' });
    await expect(details.getByText('Family Support', { exact: true }).first()).toBeVisible();
    await details.getByRole('button', { name: 'View transaction' }).last().click();
    const transactionDetails = page.getByRole('button', { name: 'View transfer details' });
    await expect(transactionDetails).toBeVisible();
    await transactionDetails.focus();
    await transactionDetails.press('Enter');
    const linkedTransfer = page.getByRole('dialog', { name: 'Transfer details' });
    await expect(linkedTransfer.getByText('Family Support', { exact: true }).first()).toBeVisible();
    const reverseButton = linkedTransfer.getByRole('button', { name: 'Reverse transfer record' });
    await reverseButton.focus();
    await reverseButton.press('Enter');
    await expect(linkedTransfer.getByRole('alertdialog')).toContainText('does not retrieve money');
    const confirmButton = linkedTransfer.getByRole('button', { name: 'Confirm reversal' });
    await confirmButton.focus();
    await confirmButton.press('Enter');
    await expect(page.getByTestId('finance-state')).toContainText('"status":"reversed"');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await context.close();
  });
}
