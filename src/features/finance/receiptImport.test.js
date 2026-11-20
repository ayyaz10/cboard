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


test('ChatGPT receipt JSON with store, numeric totals, and amount aliases imports item rows', () => {
  const result = parseReceiptImportJson(json({ store:{name:'ALDI',location:'McKenzie Street, Kirkcaldy'}, date:'2026-11-17', time:'20:31', currency:'GBP', item_count:4, total:11.26, items:[
    {code:'586719',name:'CRUNCHY NUT 720G',quantity:1,unit:'each',unitPrice:3.99,amount:3.99,tax_code:'A'},
    {code:'386021',name:'MILLED/WHOLE CHIA',quantity:1,unit:'each',unitPrice:1.79,amount:1.79,tax_code:'A'},
    {code:'761542',name:'MILLED FLAXSEED',quantity:1,unit:'each',unitPrice:1.79,amount:1.79,tax_code:'A'},
    {code:'656970',name:'AUTH GREEK YOG 1KG',quantity:1,unit:'each',unitPrice:3.69,amount:3.69,tax_code:'A'}
  ]}), 'GBP');
  assert.deepEqual(result.transaction, { title:'ALDI', date:'2026-11-17', amount:'11.26', type:'expense' });
  assert.deepEqual(result.items.map(item => [item.name,item.code,item.quantity,item.unitPrice,item.lineTotal]), [
    ['CRUNCHY NUT 720G','586719',1,'3.99','3.99'],
    ['MILLED/WHOLE CHIA','386021',1,'1.79','1.79'],
    ['MILLED FLAXSEED','761542',1,'1.79','1.79'],
    ['AUTH GREEK YOG 1KG','656970',1,'3.69','3.69']
  ]);
  assert.deepEqual(result.receipt.items.map(item => item.retailerProductCode), ['586719','386021','761542','656970']);
  assert.equal(result.receipt.time, '20:31');
  assert.equal(result.itemCount, 4);
  assert.deepEqual(result.fieldErrors, {});
});

test('malformed or incomplete line items are rejected rather than silently dropped', () => {
  assert.throws(() => parseReceiptImportJson(json({ ...valid, items:[{name:'Unknown price',amount:null}] }), 'GBP'), error => Boolean(error.fieldErrors['items[1].lineTotal']));
  assert.throws(() => parseReceiptImportJson(json({ ...valid, items:[{name:'Milk',amount:2,cardNumber:'1234'}] }), 'GBP'), error => Boolean(error.fieldErrors['items[1].cardNumber']));
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
  assert.throws(() => parseReceiptImportJson(json({ ...valid, total: 10.123 }), 'GBP'), error => Boolean(error.fieldErrors.total));
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

