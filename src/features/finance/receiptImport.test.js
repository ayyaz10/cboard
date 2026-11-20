import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceiptImportJson, receiptImportSaveError } from './receiptImport.js';

const valid = { documentType: 'purchase_receipt', merchant: 'Corner Market', date: '2026-11-18', total: '12.34', currency: 'GBP' };
const json = value => JSON.stringify(value);

test('valid receipt maps the final total to an expense amount without losing cents', () => {
  const result = parseReceiptImportJson(json(valid), 'GBP');
  assert.deepEqual(result.transaction, { title: 'Corner Market', date: '2026-11-18', amount: '12.34', type: 'expense' });
  assert.deepEqual(result.fieldErrors, {});
});

test('malformed JSON is rejected with a paste field error', () => {
  assert.throws(() => parseReceiptImportJson('{"total":', 'GBP'), error => error.fieldErrors.json === 'Malformed JSON.');
});

test('missing or ambiguous values map to empty form fields and actionable field errors', () => {
  const result = parseReceiptImportJson(json({ ...valid, merchant: null, date: null, total: null, currency: null }), 'GBP');
  assert.deepEqual(result.transaction, { title: '', date: '', amount: '', type: 'expense' });
  assert.match(result.fieldErrors.merchant, /missing or unreadable/);
  assert.match(result.fieldErrors.date, /missing or ambiguous/);
  assert.match(result.fieldErrors.total, /missing or ambiguous/);
  assert.match(result.fieldErrors.currency, /missing or ambiguous/);
});

test('invalid dates, extra fields, ambiguous totals, and unsupported document types are rejected', () => {
  assert.throws(() => parseReceiptImportJson(json({ ...valid, date: '2026-02-31' }), 'GBP'), error => Boolean(error.fieldErrors.date));
  assert.throws(() => parseReceiptImportJson(json({ ...valid, total: 10 }), 'GBP'), error => Boolean(error.fieldErrors.total));
  assert.throws(() => parseReceiptImportJson(json({ ...valid, cardNumber: '4111111111111111' }), 'GBP'), error => Boolean(error.fieldErrors.cardNumber));
  assert.throws(() => parseReceiptImportJson(json({ ...valid, documentType: 'refund_receipt' }), 'GBP'), error => /not a completed purchase receipt/.test(error.fieldErrors.documentType));
});

test('receipt currency mismatch is never converted and requires manual entry', () => {
  const result = parseReceiptImportJson(json({ ...valid, total: '1.05', currency: 'EUR' }), 'GBP');
  assert.equal(result.transaction.amount, '1.05');
  assert.match(result.fieldErrors.currency, /conversion is not supported/);
  assert.match(receiptImportSaveError({ fieldErrors: result.fieldErrors, currencyBlocked: true }), /manual/);
});

test('unreadable currency requires explicit user confirmation before save', () => {
  const result = parseReceiptImportJson(json({ ...valid, currency: null }), 'GBP');
  assert.match(receiptImportSaveError({ fieldErrors: result.fieldErrors }), /Confirm the receipt currency/);
  assert.equal(receiptImportSaveError({ fieldErrors: result.fieldErrors, currencyConfirmed: true }), '');
});

