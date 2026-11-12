import { test, expect } from '@playwright/test';

for (const width of [390, 768, 1024, 1366, 1920]) {
  test(`Send Money workflow is usable at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true, isMobile: width === 390 });
    const page = await context.newPage();
    await page.goto('/cboard/tests/ui/fixtures/finance.html');
    await page.getByRole('button', { name: 'Prepare Send Money' }).click();
    await page.getByRole('button', { name: 'Open Send Money' }).click();
    const dialog = page.getByRole('dialog', { name: 'Send money' });
    await dialog.getByRole('button', { name: '+ Add other payment' }).click();
    await dialog.getByLabel('Recipient / description').fill('Ali');
    await dialog.locator('.f-send-amount input').fill('60.00');
    await dialog.getByLabel('Exchange rate, PKR for one GBP').fill('370');
    await expect(dialog.getByText('£60.00')).toBeVisible();
    await expect(dialog.getByText(/222,000/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Record as sent' }).click();
    await expect(page.getByTestId('finance-state')).toContainText('"sendMoneyHistory"');
    await expect(page.getByTestId('finance-state')).toContainText('"title":"Ali"');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await context.close();
  });
}
