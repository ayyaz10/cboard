import { test, expect } from '@playwright/test';

for (const width of [390, 768, 1024, 1366, 1920]) {
  test(`flexible finance entry and repayment stay usable at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true, isMobile: width === 390 });
    const page = await context.newPage();
    await page.goto('/cboard/tests/ui/fixtures/finance.html');
    const launch = page.getByRole('button', { name: 'Open Add Transaction' });
    if (width === 390) { const box = await launch.boundingBox(); await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); }
    else await launch.click();
    const form = page.getByRole('dialog', { name: 'Add transaction' });
    await expect(form.getByRole('textbox', { name: 'Amount' }).first()).toBeVisible();
    await expect(form.getByLabel('Paid with')).toBeVisible();
    await form.getByLabel('Merchant or title').fill('Dinner');
    await form.getByRole('textbox', { name: 'Amount' }).first().fill('120.00');
    await form.getByLabel('Paid with').selectOption('person');
    await form.getByLabel('Person name').fill('Ahmed');
    await expect(form.getByRole('button', { name: 'Add transaction' })).toBeVisible();
    await page.keyboard.press('Tab');
    await form.getByRole('button', { name: 'Add transaction' }).click();
    await expect(page.getByTestId('finance-state')).toContainText('"type":"expense"');
    await expect(page.getByTestId('finance-state')).toContainText('"remainingAmount":12000');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

    await page.getByRole('button', { name: 'Open People and Shared Costs' }).click();
    await expect(page.getByText('You owe Ahmed')).toBeVisible();
    await page.getByLabel('Who are you repaying?').selectOption({ index: 1 });
    await page.getByLabel('Amount', { exact: true }).fill('50.00');
    await page.getByRole('button', { name: 'Record repayment' }).click();
    await expect(page.getByTestId('finance-state')).toContainText('"remainingAmount":7000');
    await page.getByLabel('Amount', { exact: true }).fill('70.00');
    await page.getByRole('button', { name: 'Record repayment' }).click();
    await expect(page.getByTestId('finance-state')).toContainText('"remainingAmount":0');
    await page.getByLabel('What happened?').selectOption('borrow');
    await page.locator('form.f-card.f-form select').nth(1).selectOption('person-ahmed');
    await page.getByLabel('Amount', { exact: true }).fill('200.00');
    await page.getByRole('button', { name: 'Record borrowed money' }).click();
    await expect(page.getByTestId('finance-state')).toContainText('"type":"borrowedCash"');
    await expect(page.getByTestId('finance-state')).toContainText('"remainingAmount":20000');
    await expect(page.getByTestId('finance-summary')).toContainText('"income":0');
    await expect(page.getByTestId('finance-summary')).toContainText('"owned":8000');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await context.close();
  });
}

test('split BNPL, shared reimbursement, and person refund work in the mobile browser', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto('/cboard/tests/ui/fixtures/finance.html');
  await page.getByRole('button', { name: 'Open Add Transaction' }).click();
  let form = page.getByRole('dialog', { name: 'Add transaction' });
  await form.getByLabel('Merchant or title').fill('Laptop');
  await form.getByRole('textbox', { name: 'Amount' }).first().fill('500.00');
  await form.getByLabel('Split payment').check();
  await form.locator('.f-item.f-form').nth(0).getByLabel('Amount').fill('100.00');
  await form.getByRole('button', { name: 'Add payment source' }).click();
  await form.getByRole('button', { name: 'Add payment source' }).click();
  await form.locator('.f-item.f-form').nth(1).getByLabel('Source').selectOption('creditor');
  await form.locator('.f-item.f-form').nth(1).getByRole('combobox').nth(1).selectOption('person-klarna');
  await form.locator('.f-item.f-form').nth(1).getByLabel('Amount').fill('300.00');
  await form.locator('.f-item.f-form').nth(2).getByLabel('Source').selectOption('person');
  await form.locator('.f-item.f-form').nth(2).getByRole('combobox').nth(1).selectOption('person-ahmed');
  await form.locator('.f-item.f-form').nth(2).getByLabel('Amount').fill('100.00');
  await form.getByRole('button', { name: 'Add transaction' }).click();
  await expect(page.getByTestId('finance-state')).toContainText('"paymentSourceType":"split"');
  await expect(page.getByTestId('finance-state')).toContainText('"kind":"creditor"');
  await expect(page.getByTestId('finance-summary')).toContainText('"expenses":50000');

  await page.getByRole('button', { name: 'Open Add Transaction' }).click();
  form = page.getByRole('dialog', { name: 'Add transaction' });
  await form.getByLabel('Merchant or title').fill('Dinner');
  await form.getByRole('textbox', { name: 'Amount' }).first().fill('80.00');
  await form.getByText('Shared purchase / reimbursement expected').click();
  await form.getByLabel('Owed by').selectOption('person-ahmed');
  await form.getByLabel('Amount they owe').fill('40.00');
  await form.getByRole('button', { name: 'Add transaction' }).click();
  await expect(page.getByTestId('finance-summary')).toContainText('"receivables":4000');
  await page.getByRole('button', { name: 'Open People and Shared Costs' }).click();
  await page.getByLabel('What happened?').selectOption('reimburse');
  await page.getByLabel('Who paid you back?').selectOption({ index: 1 });
  await page.getByLabel('Amount', { exact: true }).fill('15.00');
  await page.getByRole('button', { name: 'Record reimbursement' }).click();
  await expect(page.getByTestId('finance-summary')).toContainText('"receivables":2500');
  await expect(page.getByTestId('finance-summary')).toContainText('"income":0');

  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'View first purchase details' }).click();
  const detail = page.getByRole('dialog', { name: 'Laptop' });
  await expect(detail.getByText('Paid using')).toBeVisible();
  await expect(detail.getByText('Outstanding')).toBeVisible();
  await expect(detail.getByRole('button', { name: /Refund remaining/ })).toBeVisible();
  const refundButton = detail.getByRole('button', { name: /Refund remaining/ });
  await refundButton.evaluate(button => button.focus());
  await page.keyboard.press('Enter');
  await expect(detail.getByLabel('Refund amount')).toBeVisible();
  await detail.getByLabel('Refund amount').fill('25.00');
  await detail.locator('.f-refund-form select').first().selectOption('person:person-ahmed');
  await detail.getByRole('button', { name: 'Save refund' }).evaluate(button => button.focus());
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('finance-state')).toContainText('"refundToPerson":true');
  await expect(page.getByTestId('finance-summary')).toContainText('"expenses":54000');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await context.close();
});
