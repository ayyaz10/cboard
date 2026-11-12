import { test, expect } from '@playwright/test';

const statement = `Date,Description,Debit,Credit,Balance
05/11/2026,Amazon,60.00,,954.80
05/11/2026,Stagecoach,89.60,,865.20
06/11/2026,City Shop,2.64,,862.56
12/11/2026,Salary,,225.00,1087.56
`;

for (const width of [390, 768, 1024, 1366, 1920]) {
  test(`statement preview stays readable and imports selected rows at ${width}px`, async ({ browser }) => {
    test.setTimeout(120000);
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390 });
    const page = await context.newPage();
    await page.goto('/cboard/tests/ui/fixtures/finance.html');
    await page.getByRole('button', { name: 'Prepare import rules and matches' }).click();
    await page.getByRole('button', { name: 'Open Transaction Import' }).click();
    const dialog = page.getByRole('dialog', { name: 'Import transactions' });
    await dialog.getByLabel('Import into account').selectOption('account-current');
    await dialog.locator('#finance-import-file').setInputFiles({ name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(statement) });

    await expect(dialog.getByTestId('finance-import-count-found')).toHaveText('4 transactions found');
    await expect(dialog.getByTestId('finance-import-count-ready')).toHaveText('2');
    await expect(dialog.getByTestId('finance-import-count-review')).toHaveText('1');
    await expect(dialog.getByTestId('finance-import-count-duplicates')).toHaveText('1');
    await expect(dialog.getByRole('button', { name: 'Import 2 transactions' })).toBeEnabled();
    await expect(dialog.getByText(/Duplicate.*skipped/)).toHaveCount(1);
    await expect(dialog.getByLabel('Classification for Salary')).toBeVisible();
    await dialog.getByRole('button', { name: 'Deselect duplicates' }).click();
    await dialog.getByLabel('Classification for Salary').selectOption('income');
    await expect(dialog.getByTestId('finance-import-count-ready')).toHaveText('3');
    await expect(dialog.getByTestId('finance-import-count-review')).toHaveText('0');
    await dialog.getByRole('button', { name: 'Select all ready' }).click();
    await expect(dialog.getByRole('button', { name: 'Import 3 transactions' })).toBeEnabled();

    const cityShop = dialog.getByTestId('finance-import-row').filter({ hasText: 'City Shop' });
    await cityShop.getByText('Edit details').click();
    await cityShop.getByLabel('Description').fill('City Shop corrected');
    await expect(cityShop.getByText('City Shop corrected')).toBeVisible();

    const layout = await dialog.evaluate(node => {
      const workspace = node.querySelector('.f-import-workspace');
      const rows = [...node.querySelectorAll('.f-import-row-summary')];
      const overlaps = rows.some(row => {
        const boxes = [...row.children].map(child => child.getBoundingClientRect()).filter(box => box.width && box.height);
        return boxes.some((a, index) => boxes.slice(index + 1).some(b => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1));
      });
      return { horizontalOverflow: workspace.scrollWidth > workspace.clientWidth + 1, pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1, overlaps };
    });
    expect(layout).toEqual({ horizontalOverflow: false, pageOverflow: false, overlaps: false });

    await dialog.getByRole('button', { name: 'Import 3 transactions' }).click();
    await expect(dialog.getByRole('status')).toContainText('3 transactions imported');
    const state = JSON.parse(await page.getByTestId('finance-state').textContent());
    expect(state.transactions.some(item => item.title === 'City Shop corrected' && item.accountId === 'account-current')).toBe(true);
    expect(state.transactions.some(item => item.title === 'Salary' && item.type === 'income' && item.accountId === 'account-current')).toBe(true);
    expect(state.transactions.filter(item => item.title === 'Amazon' && item.date === '2026-11-05')).toHaveLength(1);
    await context.close();
  });
}

test('large statement preview renders in reviewable batches', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
  const page = await context.newPage();
  await page.goto('/cboard/tests/ui/fixtures/finance.html');
  await page.getByRole('button', { name: 'Open Transaction Import' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import transactions' });
  const rows = Array.from({ length: 120 }, (_, index) => `2026-10-${String(index % 28 + 1).padStart(2, '0')},Sample purchase ${index},1.00,,`);
  const csv = `Date,Description,Debit,Credit,Balance\n${rows.join('\n')}`;
  await dialog.locator('#finance-import-file').setInputFiles({ name: 'large-statement.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(dialog.getByTestId('finance-import-count-found')).toHaveText('120 transactions found');
  await expect(dialog.getByTestId('finance-import-row')).toHaveCount(100);
  await dialog.getByRole('button', { name: 'Show 100 more (20 remaining)' }).click();
  await expect(dialog.getByTestId('finance-import-row')).toHaveCount(120);
  await context.close();
});