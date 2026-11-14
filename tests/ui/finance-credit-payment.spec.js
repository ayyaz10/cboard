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

for (const width of [390, 1366]) {
  test('remaining schedule revision preview and next payment stay usable at ' + width + 'px', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390 });
    const page = await context.newPage();
    await page.goto('/cboard/tests/ui/fixtures/finance-credit-payment.html');
    await page.getByRole('button', { name: 'Open Credit Purchases' }).click();
    await page.getByRole('button', { name: 'Seed schedule revision plan' }).click();
    await page.locator('.f-credit-plan').getByText('Schedule revision test').click();
    await expect(page.locator('.f-credit-detail-header').getByRole('heading', { name: 'Schedule revision test' })).toBeVisible();
    await page.locator('.f-credit-detail-header').getByRole('button', { name: 'Revise remaining schedule' }).click();
    const dialog = page.getByRole('dialog', { name: 'Revise remaining schedule' });
    await expect(dialog.getByLabel('Count input mode')).toHaveValue('remaining');
    await dialog.getByLabel('Future instalments to recalculate').fill('2');
    await expect(dialog.getByLabel('Total payments in revised plan')).toHaveValue('2');
    await expect(dialog.getByRole('heading', { name: 'Current schedule' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Revised schedule' })).toBeVisible();
    await expect(dialog.getByText('Review proposed instalments (2)')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    const before = JSON.parse(await page.getByTestId('finance-state').textContent()).transactions.length;
    await dialog.getByRole('button', { name: 'Save revised schedule' }).click();
    await expect(dialog).not.toBeVisible();
    let state = JSON.parse(await page.getByTestId('finance-state').textContent());
    expect(state.creditAgreements[0].schedule.filter(row => !row.supersededAt)).toHaveLength(2);
    expect(state.creditAgreements[0].history.filter(row => row.type === 'schedule_revised')).toHaveLength(1);
    expect(state.transactions).toHaveLength(before);
    const next = page.locator('.f-credit-detail-metrics > div').filter({ hasText: 'Next payment' });
    await next.getByRole('button', { name: 'Record payment' }).click();
    const paymentForm = page.locator('form.f-credit-form').filter({ has: page.getByRole('heading', { name: 'Record a payment' }) });
    await expect(paymentForm.getByLabel('Amount')).toHaveValue('60.00');
    await paymentForm.getByRole('button', { name: 'Record real payment' }).click();
    state = JSON.parse(await page.getByTestId('finance-state').textContent());
    const payments = state.transactions.filter(row => row.type === 'creditPayment' && row.creditAgreementId === state.creditAgreements[0].id);
    expect(payments).toHaveLength(1);
    expect(payments[0].scheduledInstalmentId).toBe(state.creditAgreements[0].schedule.find(row => !row.supersededAt && row.amount === 6000).id);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await context.close();
  });
}

for (const width of [390, 1366]) {
  test(`Credit Purchase row actions stay aligned and keyboard accessible at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 640 }, isMobile: width === 390, hasTouch: width === 390 });
    const page = await context.newPage();
    await page.goto('/cboard/tests/ui/fixtures/finance-credit-payment.html');
    await page.getByRole('button', { name: 'Open Credit Purchases' }).click();
    await page.getByRole('button', { name: 'Seed menu positioning plans' }).click();
    await expect(page.locator('.f-credit-plan')).toHaveCount(3);
    const plansHeading = page.getByRole('heading', { name: 'Active plans' });
    await expect(plansHeading).toBeVisible();

    const trigger = page.getByRole('button', { name: 'More actions for Menu positioning plan 3' });
    const targetBox = await trigger.boundingBox();
    expect(targetBox.width).toBeGreaterThanOrEqual(44);
    expect(targetBox.height).toBeGreaterThanOrEqual(44);
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    const menu = page.getByRole('menu', { name: 'Menu positioning plan 3 actions' });
    await expect(menu).toBeVisible();
    const menuThemeContrast = await page.evaluate(() => {
      const root = document.documentElement;
      const original = root.dataset.theme;
      const luminance = (rgb) => {
        const channels = rgb.match(/[\d.]+/g).slice(0, 3).map(value => Number(value) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      };
      const result = {};
      for (const theme of ['default', 'matrix', 'midnight']) {
        if (theme === 'default') delete root.dataset.theme;
        else root.dataset.theme = theme;
        const menu = document.querySelector('.f-credit-plan-menu');
        const foreground = luminance(getComputedStyle(menu).color);
        const background = luminance(getComputedStyle(menu).backgroundColor);
        result[theme] = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      }
      if (original) root.dataset.theme = original;
      else delete root.dataset.theme;
      return result;
    });
    for (const contrast of Object.values(menuThemeContrast)) expect(contrast).toBeGreaterThanOrEqual(4.5);
    await page.keyboard.press('Tab');
    await expect(menu.getByRole('menuitem', { name: 'Open details' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Edit agreement' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(plansHeading).toBeVisible();

    await page.evaluate(() => {
      const trigger = document.querySelector('.f-credit-menu-trigger[aria-label="More actions for Menu positioning plan 3"]');
      trigger.closest('.f-credit-card-entry').style.zIndex = '70';
      trigger.style.position = 'fixed';
      trigger.style.top = '560px';
      trigger.style.right = '12px';
      trigger.style.zIndex = '95';
    });
    if (width === 390) await trigger.tap();
    else await trigger.click();
    await expect(menu).toBeVisible();
    const triggerBox = await trigger.boundingBox();
    const menuBox = await menu.boundingBox();
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);
    expect(menuBox.y).toBeGreaterThanOrEqual(0);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(640);
    expect(menuBox.y + menuBox.height).toBeLessThan(triggerBox.y);
    await expect(plansHeading).toBeVisible();

    await page.getByRole('heading', { name: 'Active plans' }).click();
    await expect(menu).toBeHidden();
    await trigger.click();
    await menu.getByRole('menuitem', { name: 'Open details' }).click();
    await expect(page.locator('.f-credit-detail-header').getByRole('heading', { name: 'Menu positioning plan 3' })).toBeVisible();
    await context.close();
  });
}
