import { test, expect } from '@playwright/test';

for (const width of [390, 768, 1024, 1366, 1920]) {
  test(`Credit Purchase cash-flow reports show only actual outflows at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390 });
    const page = await context.newPage();
    await page.goto('/cboard/tests/ui/fixtures/finance.html');
    await page.getByRole('button', { name: 'Prepare Credit Purchase Reports' }).click();

    const overview = page.locator('.f-overview');
    const overviewSpent = overview.locator('.f-overview-flow-item').filter({ hasText: 'Spent' });
    await expect(overviewSpent).toContainText('$0.00');
    await expect(overview.locator('.f-overview-categories')).not.toContainText('Car Insurance');

    await page.getByRole('button', { name: 'Open Monthly Reports' }).click();
    const monthly = page.locator('.f-reports');
    const featured = monthly.locator('.f-report-feature');
    const monthlySpent = featured.locator('.f-report-kpis > div').filter({ hasText: 'Spent' });
    const monthlyCreditPayments = featured.locator('.f-report-kpis > div').filter({ hasText: 'Credit payments' });
    await expect(monthlySpent).toContainText('$0.00');
    await expect(monthly.locator('.f-expense-category-list')).toHaveCount(0);

    await page.getByRole('button', { name: 'Add actual Credit Purchase deposit' }).click();
    await page.getByRole('button', { name: 'Open Overview report' }).click();
    await expect(overviewSpent).toContainText('$100.00');
    await expect(overview.locator('.f-overview-categories')).toContainText('Car Insurance');
    await expect(overview.locator('.f-overview-categories')).toContainText('$100.00');

    await page.getByRole('button', { name: 'Add actual Credit Purchase instalment' }).click();
    await page.getByRole('button', { name: 'Open Monthly Reports' }).click();
    await expect(monthlySpent).toContainText('$100.00');
    await expect(monthlyCreditPayments).toContainText('$75.53');
    await expect(monthly.locator('.f-expense-category-list')).toContainText('Car Insurance');
    await expect(monthly.locator('.f-expense-category-list')).toContainText('$100.00');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await context.close();
  });
}
