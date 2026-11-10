import { test, expect } from '@playwright/test';

for (const width of [390, 768, 1024, 1366, 1920]) {
  test(`automatic allocation history stays readable at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390 });
    const page = await context.newPage();
    await page.goto('/cboard/tests/ui/fixtures/finance.html');
    await page.getByRole('button', { name: 'Create three allocations' }).click();
    const history = page.getByRole('region', { name: 'Automatic allocation history' });
    await expect(history.getByRole('heading', { name: 'Auto allocation history' })).toBeVisible();
    await history.getByText('Salary', { exact: false }).first().click();
    await expect(history.getByText('Donation', { exact: false }).last()).toBeVisible();
    await expect(history.getByText('Emergency Fund', { exact: false }).last()).toBeVisible();
    await expect(history.getByText('Card debt', { exact: false }).last()).toBeVisible();
    await expect(history).toContainText('$1,025.00');
    await expect(history).toContainText('Skipped');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    if (width === 390) {
      await page.getByRole('button', { name: 'Donation history only' }).click();
      await expect(history.getByRole('heading', { name: 'Donation history' })).toBeVisible();
      await expect(history).toContainText('This allocation $75.00');
      await expect(history).not.toContainText('This allocation $475.00');
      await history.getByText('Salary', { exact: false }).first().click();
      await expect(history).toContainText('Donation');
      await expect(history).not.toContainText('Card debt');
      await page.getByRole('button', { name: 'Open salary details' }).click();
      await expect(page.getByRole('region', { name: 'Automatic allocations' })).toContainText('Total allocated');
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    }
    await context.close();
  });
}
