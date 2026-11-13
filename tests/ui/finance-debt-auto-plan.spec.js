import { test, expect } from '@playwright/test';

for (const width of [390, 768, 1024, 1366, 1920]) {
  test(`debt detail automatic allocation setup stays usable at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390 });
    const page = await context.newPage();
    await page.goto('/cboard/tests/ui/fixtures/finance.html');
    await page.getByRole('button', { name: 'Prepare Debt Detail' }).click();
    const detail = page.locator('.f-debt-detail');
    await expect(detail.getByRole('heading', { name: 'Khurram Shehzad' })).toBeVisible();
    await detail.getByRole('button', { name: 'Set up automatic allocation' }).click();
    const dialog = page.getByRole('dialog', { name: 'Automatic accumulation: Khurram Shehzad' });
    await expect(dialog.getByLabel('Plan type')).toBeVisible();
    await dialog.getByLabel('Plan type').selectOption('income_amount');
    await dialog.getByLabel(/Amount per eligible income/).fill('50.00');
    await dialog.getByRole('button', { name: 'Save plan' }).click();
    await expect(detail).toContainText('$50.00 from each eligible income');
    const originalRule = JSON.parse(await page.getByTestId('finance-state').textContent()).allocationRules.find(rule => rule.targetType === 'debt' && rule.targetId === 'debt-khurram');
    expect(originalRule).toBeTruthy();
    await page.getByRole('button', { name: 'Open Auto Deductions' }).click();
    const centralRule = page.locator('.f-item').filter({ hasText: 'Khurram Shehzad accumulation' });
    await expect(centralRule).toContainText('$50.00');
    await centralRule.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Amount', { exact: true }).fill('75.00');
    await page.getByRole('button', { name: 'Save changes' }).click();
    const editedRule = JSON.parse(await page.getByTestId('finance-state').textContent()).allocationRules.find(rule => rule.targetType === 'debt' && rule.targetId === 'debt-khurram');
    expect(editedRule.id).toBe(originalRule.id);
    expect(editedRule.value).toBe(7500);
    await expect(page.locator('.f-item').filter({ hasText: 'Khurram Shehzad accumulation' })).toContainText('$75.00');
    await page.getByRole('button', { name: 'Return to Debt Detail' }).click();
    const updatedDetail = page.locator('.f-debt-detail');
    await expect(updatedDetail).toContainText('$75.00 from each eligible income');
    await updatedDetail.getByRole('button', { name: 'Pause plan' }).click();
    await expect(updatedDetail).toContainText('Paused');
    expect(JSON.parse(await page.getByTestId('finance-state').textContent()).allocationRules.find(rule => rule.id === originalRule.id).active).toBe(false);
    await updatedDetail.getByRole('button', { name: 'Resume plan' }).click();
    await expect(updatedDetail).toContainText('Active');
    await page.getByRole('button', { name: 'Add eligible Salary income' }).click();
    await expect(page.getByTestId('finance-state')).toContainText('"debtId":"debt-khurram"');
    await expect(page.getByTestId('finance-state')).toContainText('"linkedIncomeTransactionId":"salary-debt-test"');
    await expect(page.getByTestId('finance-state')).toContainText('"accruedAmount":7500');
    await expect(page.getByTestId('finance-state')).toContainText('"remaining":15400');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await context.close();
  });
}