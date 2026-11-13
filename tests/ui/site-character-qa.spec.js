import { test, expect } from '@playwright/test';

const markers = [
  String.fromCodePoint(0x00c3, 0x201a),
  String.fromCodePoint(0x00c3, 0x0192),
  String.fromCodePoint(0x00c3, 0x00a2, 0x00e2, 0x20ac),
  String.fromCodePoint(0x00c3, 0x00a2, 0x00e2, 0x201a, 0x00ac),
  String.fromCodePoint(0x00c3, 0x00a2, 0x00cb, 0x2020),
  String.fromCodePoint(0x00ef, 0x00bc),
  String.fromCodePoint(0x00e2, 0x20ac),
  String.fromCodePoint(0x00e2, 0x2020),
  String.fromCodePoint(0x00e2, 0x02c6),
  String.fromCodePoint(0x00e2, 0x2021),
];

async function expectVisibleTextClean(page, screen) {
  const text = await page.locator('body').innerText();
  for (const marker of markers) expect(text, `${screen} contains possible mojibake`).not.toContain(marker);
}

test('Finance transaction, import, debt, reporting and transfer screens render clean text', async ({ page }) => {
  await page.goto('/cboard/tests/ui/fixtures/finance.html');
  await expectVisibleTextClean(page, 'Finance overview');

  await page.getByRole('button', { name: 'Open Add Transaction' }).click();
  await expectVisibleTextClean(page, 'Add transaction');

  await page.reload();
  await page.getByRole('button', { name: 'Open Transaction Import' }).click();
  await expectVisibleTextClean(page, 'Transaction import');

  await page.reload();
  await page.getByRole('button', { name: 'Prepare Debt Detail' }).click();
  await expectVisibleTextClean(page, 'Debt details');

  await page.reload();
  await page.getByRole('button', { name: 'Prepare Credit Purchase Reports' }).click();
  await page.getByRole('button', { name: 'Open Overview report' }).click();
  await expectVisibleTextClean(page, 'Finance overview report');
  await page.reload();
  await page.getByRole('button', { name: 'Open Monthly Reports' }).click();
  await expectVisibleTextClean(page, 'Monthly reports');

  await page.reload();
  await page.getByRole('button', { name: 'Prepare Send Money' }).click();
  await page.getByRole('button', { name: 'Open Send Money' }).click();
  await expectVisibleTextClean(page, 'Send Money');
});
