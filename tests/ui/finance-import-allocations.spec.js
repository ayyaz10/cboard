import { test, expect } from '@playwright/test';

const statement = `Date,Description,Amount
2026-11-10,Salary,2000.00
2026-11-10,Amazon,10.00
2026-11-10,Ahmed,40.00
2026-11-10,Savings transfer,150.00
`;

for (const width of [390, 1366]) {
  test(`import classifications allocate genuine income once at ${width}px`, async ({ browser }) => {
    test.setTimeout(120000);
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390 });
    const page = await context.newPage();
    await page.goto('/cboard/tests/ui/fixtures/finance.html');
    await page.getByRole('button', { name: 'Prepare import rules and matches' }).click();
    await page.getByRole('button', { name: 'Open Transaction Import' }).click();
    const dialog = page.getByRole('dialog', { name: 'Import transactions' });
    await dialog.getByLabel('Import into account').selectOption('account-savings');
    const upload = async target => target.locator('#finance-import-file').setInputFiles({ name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(statement) });
    await upload(dialog);
    await expect(dialog.getByLabel('Classification for Salary')).toHaveValue('review');
    await expect(dialog.getByText(/Needs review.*choose Income/)).toHaveCount(4);
    await expect(page.getByTestId('finance-state')).not.toContainText('sourceIncomeId');
    await dialog.getByLabel('Classification for Salary').selectOption('income');
    await expect(dialog.getByRole('button', { name: 'Import 1 transaction' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Import 1 transaction' }).click();
    await expect(dialog.getByRole('status')).toContainText('1 transaction imported');
    const importedState = JSON.parse(await page.getByTestId('finance-state').textContent());
    const salary = importedState.transactions.find(item => item.title === 'Salary' && item.type === 'income');
    expect(salary).toBeTruthy();
    expect(importedState.donationAccruals[0].linkedIncomeTransactionId).toBe(salary.id);
    expect(importedState.debtAccruals[0].linkedIncomeTransactionId).toBe(salary.id);
    expect(importedState.goalContributions[0].sourceIncomeId).toBe(salary.id);
    expect(importedState.donationAccruals[0].amount).toBe(10000);
    expect(importedState.debtAccruals[0].amount).toBe(25000);
    expect(importedState.goalContributions[0].amount).toBe(20000);

    await dialog.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Open salary details' }).click();
    const salaryDetails = page.getByRole('dialog', { name: 'Salary' });
    const allocations = salaryDetails.getByRole('region', { name: 'Automatic allocations' });
    await expect(allocations).toContainText('General Charity');
    await expect(allocations).toContainText('Emergency Fund');
    await expect(allocations).toContainText('Card debt');
    await salaryDetails.getByRole('button', { name: 'Change classification' }).click({ force: true });
    await salaryDetails.getByLabel('New classification').selectOption('reimbursement');
    await salaryDetails.getByLabel('Reimbursement from').selectOption('receivable-ahmed');
    await salaryDetails.getByRole('button', { name: 'Save classification' }).click({ force: true });

        let state = JSON.parse(await page.getByTestId('finance-state').textContent());
    expect(state.transactions.find(item => item.id === salary.id).type).toBe('reimbursement');
    expect(state.personalReceivables[0].remainingAmount).toBe(300000);
    expect(state.transactions.some(item => item.sourceIncomeId === salary.id)).toBe(false);
    expect(state.goalContributions.some(item => item.sourceIncomeId === salary.id)).toBe(false);
    expect(state.donationAccruals.some(item => item.linkedIncomeTransactionId === salary.id && item.status === 'reversed')).toBe(true);
    expect(state.debtAccruals.some(item => item.originalSourceIncomeId === salary.id && item.status === 'reversed')).toBe(true);

    await salaryDetails.getByRole('button', { name: 'Change classification' }).click({ force: true });
    await salaryDetails.getByLabel('New classification').selectOption('income');
    await salaryDetails.getByRole('button', { name: 'Save classification' }).click({ force: true });
    await expect(salaryDetails.getByRole('region', { name: 'Automatic allocations' })).toContainText('Emergency Fund');
    state = JSON.parse(await page.getByTestId('finance-state').textContent());
    expect(state.personalReceivables[0].remainingAmount).toBe(500000);
    expect(state.transactions.filter(item => item.sourceIncomeId === salary.id).length).toBe(1);
    expect(state.goalContributions.filter(item => item.sourceIncomeId === salary.id).length).toBe(1);
    expect(state.donationAccruals.filter(item => item.linkedIncomeTransactionId === salary.id && item.status !== 'reversed').length).toBe(1);
    expect(state.debtAccruals.filter(item => item.linkedIncomeTransactionId === salary.id && item.status !== 'reversed').length).toBe(1);

    await salaryDetails.getByRole('button', { name: 'Change classification' }).click({ force: true });
    await salaryDetails.getByLabel('New classification').selectOption('borrowedCash');
    await salaryDetails.getByLabel('Who lent you this money?').selectOption('person-ahmed');
    await salaryDetails.getByRole('button', { name: 'Save classification' }).click({ force: true });
    state = JSON.parse(await page.getByTestId('finance-state').textContent());
    expect(state.personalLiabilities.some(item => item.transactionId === salary.id)).toBe(true);
    expect(state.transactions.some(item => item.sourceIncomeId === salary.id)).toBe(false);
    await salaryDetails.getByRole('button', { name: 'Change classification' }).click({ force: true });
    await salaryDetails.getByLabel('New classification').selectOption('income');
    await salaryDetails.getByRole('button', { name: 'Save classification' }).click({ force: true });
    state = JSON.parse(await page.getByTestId('finance-state').textContent());
    expect(state.personalLiabilities.find(item => item.transactionId === salary.id).remainingAmount).toBe(0);
    expect(state.transactions.filter(item => item.sourceIncomeId === salary.id).length).toBe(1);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Open Transaction Import' }).click();
    const duplicateDialog = page.getByRole('dialog', { name: 'Import transactions' });
    await duplicateDialog.getByLabel('Import into account').selectOption('account-savings');
    await upload(duplicateDialog);
    await expect(duplicateDialog.getByText(/Duplicate.*skipped/)).toHaveCount(1);
    await duplicateDialog.getByRole('button', { name: 'Link as refund' }).first().click({ force: true });
    await duplicateDialog.getByRole('button', { name: 'Link as reimbursement to Ahmed' }).click({ force: true });
    await duplicateDialog.getByRole('button', { name: 'Link transfer' }).click({ force: true });
    const linkedState = JSON.parse(await page.getByTestId('finance-state').textContent());
    expect(linkedState.transactions.find(item => item.id === 'amazon-purchase').type).toBe('expense');
    expect(linkedState.transactions.some(item => item.type === 'refund' && item.originalTransactionId === 'amazon-purchase')).toBe(true);
    expect(linkedState.transactions.some(item => item.type === 'reimbursement' && item.personalEntryId === 'receivable-ahmed')).toBe(true);
    expect(linkedState.transactions.filter(item => item.linkedTransferId).length).toBe(2);
    expect(linkedState.donationAccruals.filter(item => item.status !== 'reversed').length + linkedState.debtAccruals.filter(item => item.status !== 'reversed').length + linkedState.goalContributions.filter(item => item.sourceIncomeId === salary.id).length).toBe(3);
    expect(linkedState.donationAccruals.filter(item => item.status === 'reversed').length + linkedState.debtAccruals.filter(item => item.status === 'reversed').length).toBeGreaterThanOrEqual(4);
    await duplicateDialog.getByRole('button', { name: 'Choose another file' }).click();
    await upload(duplicateDialog);
    await expect(duplicateDialog.getByText(/Duplicate.*skipped/)).toHaveCount(4);
    await expect(duplicateDialog.getByRole('button', { name: 'Import 0 transactions' })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await context.close();
  });
}
