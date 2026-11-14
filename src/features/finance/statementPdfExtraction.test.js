import test from 'node:test';
import assert from 'node:assert/strict';
import { assessPdfPageQuality, mergePdfExtractionRecords, reconcileStatementBalances } from './statementPdfExtraction.js';

const record = (overrides = {}) => ({ date: '2026-10-05', description: 'Coffee House branch 55881000214', amount: 1299, direction: 'expense', confidence: 'ready', sourceType: 'pdf', sourceRow: '1:8', reference: '', validation: '', ...overrides });

test('page quality requests OCR when native text is empty or garbled', () => {
  assert.ok(assessPdfPageQuality([], [], {}, {}).reasons.includes('empty-native-page'));
  assert.ok(assessPdfPageQuality([{ text: '\uFFFD\uFFFD\uFFFD\uFFFD' }], [], {}, {}).reasons.includes('garbled-native-text'));
});

test('partial native extraction requests OCR even when it already parsed one transaction', () => {
  const quality = assessPdfPageQuality([{ text: '05 OCT Salary 100.00' }], [record()], {}, { unparsedCandidateRows: 1 });
  assert.equal(quality.status, 'needs-review');
  assert.ok(quality.reasons.includes('unparsed-transaction-candidate'));
});

test('date and amount candidates without a transaction, and pending descriptions at page end, request OCR', () => {
  const noRecord = assessPdfPageQuality([{ text: '05 OCT' }, { text: 'Paid In £100.00' }], [], {}, {});
  assert.ok(noRecord.reasons.includes('transaction-signals-with-no-valid-rows'));
  const pending = assessPdfPageQuality([{ text: '05 OCT Salary' }], [], { pendingDescription: ['Salary'] }, {});
  assert.ok(pending.reasons.includes('description-incomplete-at-page-end'));
});

test('reliable searchable native text does not request OCR', () => {
  const quality = assessPdfPageQuality([{ text: '05 OCT Salary payment Paid In £100.00' }], [record()], {}, {});
  assert.equal(quality.status, 'reliable');
  assert.deepEqual(quality.reasons, []);
});

test('normal PDF line breaks are not treated as garbled native text', () => {
  const quality = assessPdfPageQuality([{ text: 'Date Description Paid In Withdrawn Balance' }, { text: '05 OCT 2026 Shop 12.34' }], [record()], {}, {});
  assert.equal(quality.status, 'reliable');
  assert.ok(!quality.reasons.includes('garbled-native-text'));
});

test('native and OCR copies merge while preserving the fuller narrative and both source rows', () => {
  const native = record({ description: 'Coffee House 55881000214', sourceRow: '1:8' });
  const ocr = record({ description: 'Coffee House branch 55881000214 UK', sourceType: 'pdf-scan', sourceRow: '1:11' });
  const [merged] = mergePdfExtractionRecords([native], [ocr]);
  assert.equal(merged.description, 'Coffee House branch 55881000214 UK');
  assert.equal(merged.sourceType, 'pdf-merged');
  assert.deepEqual(merged.sourceRows, ['1:8', '1:11']);
  assert.equal(merged.confidence, 'ready');
});

test('native and OCR disagreements merge into one manual-review transaction', () => {
  const native = record({ description: 'Salary transfer reference 55881000214', amount: 120000, direction: 'income' });
  const ocr = record({ description: 'Salary transfer reference 55881000214', amount: 12000, direction: 'expense', sourceType: 'pdf-scan' });
  const merged = mergePdfExtractionRecords([native], [ocr]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].confidence, 'review');
  assert.match(merged[0].validation, /disagree/);
  assert.equal(merged[0].amount, native.amount);
  assert.equal(merged[0].direction, native.direction);
});

test('same date and amount with unrelated narratives are never silently merged', () => {
  const native = record({ description: 'Coffee House', amount: 550, sourceRow: '1:8' });
  const ocr = record({ description: 'Bus ticket', amount: 550, sourceType: 'pdf-scan', sourceRow: '1:9' });
  const merged = mergePdfExtractionRecords([native], [ocr]);
  assert.equal(merged.length, 2);
  assert.ok(merged.every(item => item.confidence === 'review'));
});

test('\u00a333.75 with a missing description and several OCR candidates keeps each review reason once', () => {
  const native = record({ description: '', amount: 3375, sourceRow: '2:8', validation: 'Description missing', confidence: 'review', reviewReasons: [{ id: 'description-missing', message: 'Description missing' }] });
  const ocr = ['Corner shop', 'Coffee kiosk', 'Market stall'].map((description, index) => record({ description, amount: 3375, sourceType: 'pdf-scan', sourceRow: `2:${index + 10}` }));
  const merged = mergePdfExtractionRecords([native], ocr);
  const affected = merged.filter(item => item.reviewReasons?.some(reason => reason.id === 'native-ocr-ambiguous-match'));
  assert.equal(affected.length, 4);
  assert.ok(affected.every(item => item.reviewReasons.filter(reason => reason.id === 'native-ocr-ambiguous-match').length === 1));
  assert.ok(affected.every(item => (item.reviewReasons.find(reason => reason.id === 'native-ocr-ambiguous-match').candidates || []).length === 4));
  const missingDescription = merged.find(item => item.sourceRow === '2:8');
  assert.equal(missingDescription.reviewReasons.filter(reason => reason.id === 'description-missing').length, 1);
  assert.equal(missingDescription.reviewReasons.filter(reason => reason.id === 'native-ocr-ambiguous-match').length, 1);
  assert.equal(mergePdfExtractionRecords([native], ocr).find(item => item.sourceRow === '2:8').reviewReasons.length, 2);
  const repeated = mergePdfExtractionRecords(merged.filter(item => item.sourceType === 'pdf'), merged.filter(item => item.sourceType === 'pdf-scan'));
  assert.equal(repeated.find(item => item.sourceRow === '2:8').reviewReasons.length, 2);
});

test('non-unique identical native/OCR candidates are retained for review instead of duplicated imports', () => {
  const native = [record({ sourceRow: '1:8' }), record({ sourceRow: '1:9' })];
  const ocr = [record({ sourceType: 'pdf-scan', sourceRow: '1:10' }), record({ sourceType: 'pdf-scan', sourceRow: '1:11' })];
  const merged = mergePdfExtractionRecords(native, ocr);
  assert.equal(merged.length, 4);
  assert.ok(merged.every(item => item.confidence === 'review'));
});

test('balance reconciliation uses integer minor units, excludes running balances, and tolerates one penny', () => {
  const records = [record({ amount: 1234, direction: 'expense', balance: 98766 }), record({ amount: 1, direction: 'income', balance: 98767 })];
  assert.deepEqual(reconcileStatementBalances(records, { opening: 100000, closing: 98767 }), {
    status: 'reconciled', opening: 100000, closing: 98767, paidIn: 1, withdrawn: 1234, difference: 0, tolerance: 1,
  });
  assert.equal(reconcileStatementBalances(records, { opening: 100000, closing: 98765 }).status, 'discrepancy');
  assert.equal(reconcileStatementBalances(records, {}).status, 'unavailable');
});

test('missing or incorrectly directed transactions produce a reconciliation discrepancy', () => {
  const balances = { opening: 100000, closing: 80000 };
  assert.equal(reconcileStatementBalances([record({ amount: 10000, direction: 'expense' })], balances).difference, 10000);
  assert.equal(reconcileStatementBalances([record({ amount: 20000, direction: 'income' })], balances).status, 'discrepancy');
});
