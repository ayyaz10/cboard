import { test, expect } from '@playwright/test';

function pdfText(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function makePdf(pages) {
  const objects = new Map();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const kids = [];
  pages.forEach((lines, index) => {
    const pageId = 4 + index * 2, contentId = pageId + 1;
    kids.push(pageId + ' 0 R');
    const commands = lines.map(({ x, y, text }) => 'BT /F1 10 Tf ' + x + ' ' + y + ' Td (' + pdfText(text) + ') Tj ET').join('\n');
    objects.set(pageId, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + contentId + ' 0 R >>');
    objects.set(contentId, '<< /Length ' + Buffer.byteLength(commands, 'ascii') + ' >>\nstream\n' + commands + '\nendstream');
  });
  objects.set(2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages.length + ' >>');
  const lastId = 3 + pages.length * 2;
  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (let id = 1; id <= lastId; id++) {
    offsets[id] = Buffer.byteLength(output, 'ascii');
    output += id + ' 0 obj\n' + objects.get(id) + '\nendobj\n';
  }
  const xrefOffset = Buffer.byteLength(output, 'ascii');
  output += 'xref\n0 ' + (lastId + 1) + '\n0000000000 65535 f \n';
  for (let id = 1; id <= lastId; id++) output += String(offsets[id]).padStart(10, '0') + ' 00000 n \n';
  output += 'trailer\n<< /Size ' + (lastId + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF\n';
  return Buffer.from(output, 'ascii');
}

const statementPage = [
  { x: 40, y: 750, text: 'Date' }, { x: 110, y: 750, text: 'Description' }, { x: 300, y: 750, text: 'Paid In' }, { x: 390, y: 750, text: 'Withdrawn' }, { x: 500, y: 750, text: 'Balance' },
  { x: 40, y: 720, text: '01 OCT 2026' }, { x: 110, y: 720, text: 'OPENING BALANCE' }, { x: 500, y: 720, text: '100.00' },
  { x: 40, y: 690, text: '05 OCT 2026' }, { x: 110, y: 690, text: 'Coffee Shop 55881000214' }, { x: 390, y: 690, text: '12.34' }, { x: 500, y: 690, text: '87.66' },
  { x: 40, y: 660, text: '06 OCT 2026' }, { x: 110, y: 660, text: 'CLOSING BALANCE' }, { x: 500, y: 660, text: '87.66' },
];

test('generated searchable PDF runs through PDF.js and imports from the preview', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/cboard/tests/ui/fixtures/finance.html');
  await page.getByRole('button', { name: 'Prepare import rules and matches' }).click();
  await page.getByRole('button', { name: 'Open Transaction Import' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import transactions' });
  await dialog.getByLabel('Import into account').selectOption('account-current');
  await dialog.locator('#finance-import-file').setInputFiles({ name: 'searchable-statement.pdf', mimeType: 'application/pdf', buffer: makePdf([statementPage]) });

  await expect(dialog.getByTestId('finance-import-count-found')).toHaveText('1 transactions found', { timeout: 120000 });
  await expect(dialog.getByTestId('finance-import-count-ready')).toHaveText('1');
  await expect(dialog.getByTestId('finance-import-ocr-pages')).toHaveText('None');
  await expect(dialog.getByTestId('finance-import-reconciliation')).toContainText('reconcile');
  const row = dialog.getByTestId('finance-import-row');
  await expect(row).toContainText('Coffee Shop 55881000214');
  await expect(row.getByTestId('finance-import-source')).toContainText('1:');
  await row.getByText('Edit details').click();
  await row.getByLabel('Description').fill('Coffee Shop corrected');
  await expect(row).toContainText('Coffee Shop corrected');
  await dialog.getByRole('button', { name: 'Import 1 transaction' }).click();
  await expect(dialog.getByRole('status')).toContainText('1 transaction imported');
  const state = JSON.parse(await page.getByTestId('finance-state').textContent());
  expect(state.transactions.some(item => item.title === 'Coffee Shop corrected' && item.accountId === 'account-current')).toBe(true);
});

test('PDF.js retries partial native extraction and OCRs a scanned page without duplicates', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/cboard/tests/ui/fixtures/finance.html');
  const pdfBytes = makePdf([
    [{ x: 40, y: 720, text: '05 OCT 2026 Salary paid in 100.00' }, { x: 40, y: 690, text: '06 OCT Water bill' }],
    [],
  ]);
  const result = await page.evaluate(async bytes => {
    const { extractPdfStatement } = await import('/cboard/src/features/finance/statementPdfExtraction.js');
    let scans = 0;
    let disposed = false;
    const file = new File([new Uint8Array(bytes)], 'mixed-statement.pdf', { type: 'application/pdf' });
    const extraction = await extractPdfStatement(file, () => {}, {
      createOcrSession: () => ({
        async scan() { scans++; return { text: scans === 1 ? '05 OCT 2026 Salary paid in 100.00\n06 OCT Water bill Paid Out 20.00' : '06 OCT Corner Shop Paid Out 5.00', confidence: 99 }; },
        dispose() { disposed = true; },
      }),
    });
    return { scans, disposed, records: extraction.records, diagnostics: extraction.diagnostics };
  }, [...pdfBytes]);

  expect(result.scans).toBe(2);
  expect(result.disposed).toBe(true);
  expect(result.records).toHaveLength(3);
  expect(result.records.map(record => record.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-06']);
  expect(result.records.map(record => record.sourceRow.split(':')[0])).toEqual(['1', '1', '2']);
  expect(result.diagnostics.pagesRequiringOcr).toEqual([1, 2]);
  expect(result.diagnostics.mergedTransactions).toBe(1);
  expect(result.records.filter(record => record.description === 'Salary').length).toBe(1);
  expect(result.records.some(record => record.description === 'Water bill' && record.sourceType === 'pdf-scan')).toBe(true);
});
