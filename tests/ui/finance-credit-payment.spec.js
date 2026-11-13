import { test, expect } from '@playwright/test';

for (const width of [390, 768, 1024, 1366, 1920]) {
  test('Credit Purchase payment stays linked and usable at ' + width + 'px', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width === 390, hasTouch: width === 390 });
    const page = await context.newPage();
    await page.goto('/cboard/tests/ui/fixtures/finance-credit-payment.html');
    await page.getByRole('button', { name: 'Open Credit Purchases' }).click();
    await page.getByRole('button', { name: /Add Credit Purchase/ }).click();

    const form = page.getByRole('dialog', { name: 'Credit Purchase' });
    await form.getByLabel('Purchase name').fill('Philips Series 9000 Trimmer');
    await form.getByLabel('Provider / lender').fill('Klarna');
    await form.getByLabel('Cash purchase price').fill('103.50');
    await form.getByLabel('Upfront payment paid now').fill('45.00');
    await form.getByLabel('Counts as payment 1 of the plan').check();
    await form.getByLabel('Total payments in plan').fill('3');
    await form.getByLabel('First future payment date').fill('2026-11-25');
    await form.getByRole('button', { name: 'Create credit agreement' }).click();

    const detail = page.locator('.f-credit-detail-header');
    await expect(detail.getByRole('heading', { name: 'Philips Series 9000 Trimmer' })).toBeVisible();
    const nextCard = page.locator('.f-credit-detail-metrics > div').filter({ hasText: 'Next payment' });
    await expect(nextCard).toContainText('29.25');
    await expect(nextCard).toContainText('29.25');
    await nextCard.getByRole('button', { name: 'Record payment' }).click();

    const paymentForm = page.locator('form.f-credit-form').filter({ has: page.getByRole('heading', { name: 'Record a payment' }) });
    await expect(paymentForm.getByLabel('Instalment')).toHaveValue(/.+/);
    await expect(paymentForm.getByLabel('Amount')).toHaveValue('29.25');
    await expect(paymentForm.getByLabel('Payment date')).not.toHaveValue('2026-11-25');
    await expect(paymentForm.getByLabel('Paid from')).toHaveValue('account:account-current');
    await paymentForm.getByLabel('Paid from').selectOption('account:account-current');
    await paymentForm.getByRole('button', { name: 'Record real payment' }).dblclick();

    const state = JSON.parse(await page.getByTestId('finance-state').textContent());
    const payments = state.transactions.filter(item => item.type === 'creditPayment' && item.creditAgreementId === state.creditAgreements[0].id);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ amount: 2925, accountId: 'account-current', creditPrincipalAmount: 2925, creditFinanceCostAmount: 0, creditPaymentKind: 'scheduled' });
    expect(payments[0].scheduledInstalmentId).toBe(state.creditAgreements[0].schedule.find(item => item.dueDate === '2026-11-25').id);
    await expect(page.locator('.f-credit-detail-metrics > div').filter({ hasText: 'Principal remaining' })).toContainText('29.25');
    await expect(page.locator('.f-credit-detail-metrics > div').filter({ hasText: 'Next payment' })).toContainText('Dec 25, 2026');
    await expect(page.locator('.f-credit-schedule-row').filter({ hasText: 'Nov 25, 2026' })).toContainText('Paid');

    await page.getByRole('button', { name: 'View transaction' }).click();
    const transaction = page.getByRole('dialog', { name: /Philips Series 9000 Trimmer credit payment/ });
    await expect(transaction).toContainText('Credit Purchase payment');
    await expect(transaction).toContainText('Principal');
    await expect(transaction).toContainText('Finance cost');
    await expect(transaction.getByRole('button', { name: 'View Credit Purchase' })).toBeVisible();
    await transaction.getByRole('button', { name: 'View Credit Purchase' }).click(); await expect(page.locator('.f-credit-detail-header').getByRole('heading', { name: 'Philips Series 9000 Trimmer' })).toBeVisible(); await page.getByRole('button', { name: 'Mark unpaid' }).click(); const reversedState = JSON.parse(await page.getByTestId('finance-state').textContent()); expect(reversedState.transactions.find(item => item.id === payments[0].id).reversedAt).toBeTruthy(); await expect(page.locator('.f-credit-detail-metrics > div').filter({ hasText: 'Principal remaining' })).toContainText('58.50'); expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await context.close();
  });
}
