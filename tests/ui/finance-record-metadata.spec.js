import { test, expect } from '@playwright/test';

test('vehicle transaction metadata saves, displays, and stays usable across standard widths', async ({ page }) => {
  await page.goto('/cboard/tests/ui/fixtures/finance.html');
  await page.getByRole('button', { name: 'Open Add Transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add transaction' });
  await form.getByLabel('Merchant or title').fill('Car');
  await form.getByLabel('Amount').first().fill('2275.00');
  await form.getByLabel('Category').selectOption({ label: 'Vehicle Purchase' });
  await form.getByLabel('Mileage at purchase').fill('82450');
  await form.getByLabel('Mileage unit').selectOption('miles');
  await form.getByLabel('Registration').fill('AB12 CDE');
  await form.getByText(/Advanced details/).click();
  await form.getByRole('button', { name: '+ Add custom field' }).click();
  await form.getByLabel('Label').fill('Warranty expiry');
  await form.getByLabel('Type for Warranty expiry').selectOption('date');
  await form.getByLabel('Value').fill('2027-11-14');
  await form.getByRole('button', { name: 'Add transaction' }).click();
  const state = page.getByTestId('finance-state');
  await expect(state).toContainText('"mileage":82450');
  await expect(state).toContainText('"mileageUnit":"miles"');
  await expect(state).toContainText('"Warranty expiry"');
  await page.getByRole('button', { name: 'View first purchase details' }).click();
  await expect(page.getByText('82,450 miles')).toBeVisible();
  await expect(page.getByText('AB12 CDE', { exact: true })).toBeVisible();
  await expect(page.locator('.f-record-metadata-view').getByText(/2027/)).toBeVisible();
  await page.locator('output').evaluateAll(elements => elements.forEach(element => { element.style.display = 'none'; }));
  for (const width of [390, 768, 1024, 1366, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(node => node.getBoundingClientRect().right > window.innerWidth + 1).map(node => ({ tag: node.tagName, cls: String(node.className).slice(0, 100), right: Math.round(node.getBoundingClientRect().right) })).slice(0, 10));
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), `horizontal overflow at ${width}px: ${JSON.stringify(overflow)}`).toBe(false);
  }
});


test('Credit Purchase vehicle metadata edits without changing the schedule or deposit', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/cboard/tests/ui/fixtures/finance-record-metadata.html');
  const launch = page.getByRole('button', { name: /Credit Purchase/ });
  await expect(launch.first()).toBeVisible();
  await launch.first().click();
  const dialog = page.getByRole('dialog', { name: 'Credit Purchase' });
  await dialog.getByLabel('Purchase name').fill('Car');
  await dialog.getByLabel('Purchase date').fill('2026-10-25');
  await dialog.getByLabel('Cash purchase price').fill('2275.00');
  await dialog.getByLabel('Upfront payment paid now').fill('100.00');
  await dialog.getByLabel('Expense category').selectOption({ label: 'Vehicle Purchase' });
  await dialog.getByLabel('Mileage at purchase').fill('82450');
  await dialog.getByLabel('Mileage unit').selectOption('miles');
  await dialog.getByLabel('Registration').fill('AB12 CDE');
  await dialog.getByText(/Advanced details/).click();
  await dialog.getByRole('button', { name: '+ Add custom field' }).click();
  await dialog.getByLabel('Label').fill('Warranty expiry');
  await dialog.getByLabel('Type for Warranty expiry').selectOption('date');
  await dialog.getByLabel('Value').fill('2027-11-14');
  await dialog.getByRole('button', { name: 'Create credit agreement' }).click();
  await expect(page.getByText('82,450 miles')).toBeVisible();
  const state = page.getByTestId('finance-state');
  await expect(state).toContainText('"creditPaymentKind":"deposit"');
  await expect(state).toContainText('"mileage":82450');
  await expect(state).toContainText('"amount":10000');
  const before = JSON.parse(await state.textContent());
  const originalSchedule = before.creditAgreements[0].schedule;
  await page.locator('details.f-credit-more summary').click();
  await page.getByRole('button', { name: 'Edit agreement' }).click();
  const edit = page.locator('section.f-credit-form').filter({ has: page.getByText('Purchase details') });
  await edit.getByLabel('Mileage at purchase').fill('82700');
  await page.getByRole('button', { name: 'Save agreement' }).click();
  await expect(page.getByText('82,700 miles')).toBeVisible();
  const after = JSON.parse(await state.textContent());
  expect(after.creditAgreements[0].schedule).toEqual(originalSchedule);
  expect(after.transactions.filter(item => item.creditPaymentKind === 'deposit')).toHaveLength(1);
  expect(after.transactions.find(item => item.creditPaymentKind === 'deposit').amount).toBe(10000);
  expect(after.transactions.find(item => item.creditPaymentKind === 'deposit').vehicleMetadata.mileage).toBe(82700);
  await page.locator('output').evaluate(element => { element.style.display = 'none'; });
  for (const width of [390, 768, 1024, 1366, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  }
});
