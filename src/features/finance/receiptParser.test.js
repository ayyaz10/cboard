import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceipt, receiptDate, receiptWarnings, reconcileReceipt } from './receiptParser.js';
import { aldiPhotoOcrTranscript } from './fixtures/aldiPhotoReceipt.js';
import { receiptDraft, serializeReceipt, likelyReceiptDuplicate, optionalReceiptMoney } from './receiptData.js';
import { normalizeFinanceState } from './financeData.js';
import { validateReceiptImage } from './receiptOcr.js';

test('simple prices preserve unknown quantities instead of fabricating counts', () => {
  const item = parseReceipt('TESCO\nOATS 2.30\nTOTAL 2.30').items[0];
  assert.equal(item.name, 'OATS'); assert.equal(item.lineTotal, 230); assert.equal(item.quantity, null);
  assert.equal(item.rawText, 'OATS 2.30');
});
test('count, weight, unit price, currency and volume patterns', () => {
  const items = parseReceipt('TESCO\nMILK 2 x 1.45 2.90\nBANANAS 0.850kg 1.02\nCHICKEN 1.250kg @ 6.00/kg 7.50\nYOGURT 3 @ 1.50 4.50\nSOAP 3 X £2.00 6.00\nJUICE 500ml 1.25\nFLOUR 750g 0.90\nWATER 1L 1.00').items;
  assert.equal(items.length, 8);
  assert.deepEqual(items.slice(0, 5).map(({ quantity, unitPrice, lineTotal }) => [quantity, unitPrice, lineTotal]), [[2,145,290],[null,null,102],[1.25,600,750],[3,150,450],[3,200,600]]);
  assert.deepEqual(items.slice(5).map(({ quantity, unit, packSize, packUnit }) => [quantity, unit, packSize, packUnit]), [[null,'',500,'ml'],[null,'',750,'g'],[null,'',1,'l']]);
  assert.equal(items[2].name, 'CHICKEN');
});
test('two-line quantities and price per different weight unit', () => {
  const items = parseReceipt('ALDI\nAPPLES\n2 x 1.50 3.00\nBANANAS 750g @ 1.20/kg 0.90').items;
  assert.equal(items.length, 2); assert.equal(items[0].quantity, 2);
  assert.equal(items[1].unit, 'kg'); assert.equal(items[1].quantity, 0.75);
});
test('quantity with unit price but no line total keeps the missing total visible', () => {
  const result = parseReceipt('TESCO\nMILK 2 x 1.45');
  assert.equal(result.items[0].quantity, 2); assert.equal(result.items[0].unitPrice, 145);
  assert.equal(result.items[0].lineTotal, null);
  assert.ok(receiptWarnings(result).some(message => message.includes('no price')));
});
test('UK dates, ISO dates, time and invalid dates', () => {
  for (const value of ['02/10/2026','02-10-2026','02/10/26','2026-10-02']) assert.equal(receiptDate(value), '2026-10-02');
  assert.equal(receiptDate('31/02/2026'), ''); assert.equal(receiptDate(''), '');
  assert.equal(parseReceipt('Tesco\n02/10/26 14:52:01').time, '14:52');
});
test('totals ignore tender, change, payment cards, loyalty and VAT table', () => {
  const result = parseReceipt('TESCO\n21 High Street\nTel 01234567890\nVAT No 123456789\n02/10/26 12:20\nOATS 2.30\nCard 4444 3333 2222 1111\nSUBTOTAL 2.30\nVAT 0.20\nA 20% 0.20\nTOTAL 2.30\nCASH 10.00\nCHANGE 7.70\nLoyalty balance 100.00\nThank you');
  assert.equal(result.total, 230); assert.equal(result.subtotal, 230); assert.equal(result.tax, 20);
  assert.equal(result.items.length, 1); assert.equal(result.merchantName, 'TESCO');
});
test('discounts, mismatch, total on next line, strongest total and no false payment total', () => {
  const result = parseReceipt('LOCAL SHOP\nMILK 2.90\nDISCOUNT -0.40\nSUBTOTAL 2.50\nGRAND TOTAL\n2.50\nBALANCE 9.00');
  assert.equal(result.discounts, 40); assert.equal(result.total, 250);
  assert.equal(result.items.length, 1);
  assert.ok(receiptWarnings(result).some(message => message.includes('2.90') && message.includes('2.50')));
  assert.equal(parseReceipt('CASH 20.00\nCHANGE 5.00').total, null);
});
test('malformed and incomplete text remains reviewable; duplicate lines warn', () => {
  for (const text of [null, '', '####\nunknown']) assert.doesNotThrow(() => parseReceipt(text));
  const result = parseReceipt('Shop\nOATS 2.30\nOATS 2.30');
  assert.ok(receiptWarnings(result).some(message => message.includes('Repeated')));
  assert.ok(receiptWarnings(result).some(message => message.includes('missing')));
});
test('receipt serialization roundtrip uses minor units, preserves IDs and replaces items on edit', () => {
  const draft = receiptDraft(parseReceipt('Tesco\nOATS 2.30\nMILK 2 x 1.45 2.90\nTOTAL 5.20'));
  draft.currency = 'GBP'; draft.rawText = '4444 3333 2222 1111'; draft.image = 'private image';
  const transaction = { id:'tx1', title:'Tesco', date:'2026-10-02', type:'expense', amount:520, updatedAt:'first' };
  const saved = serializeReceipt(draft, transaction);
  assert.equal(saved.items[0].transactionId, 'tx1'); assert.equal(saved.items[1].unitPrice, 145);
  assert.ok(saved.rawText);assert.equal(saved.rawText.includes('4444 3333 2222 1111'),false);assert.equal(saved.image, undefined);
  const edit = receiptDraft(saved); edit.items.splice(1, 1); edit.items[0].name = 'Rolled oats';
  const updated = serializeReceipt(edit, { ...transaction, updatedAt:'second' }, saved);
  assert.equal(updated.items.length, 1); assert.equal(updated.items[0].id, saved.items[0].id);
  assert.equal(updated.items[0].normalizedName, 'rolled oats'); assert.equal(updated.items[0].createdAt, 'first');
  const copy = serializeReceipt(edit, { ...transaction, id:'tx2' });
  assert.notEqual(copy.items[0].id, saved.items[0].id);
  const legacy = { ...transaction, id:'legacy' };
  const state = normalizeFinanceState({ transactions:[legacy, { ...transaction, receipt:updated }] });
  assert.deepEqual(state.transactions[0], legacy); assert.deepEqual(state.transactions[1].receipt, updated);
});
test('invalid numeric inputs fail; missing values and zero prices remain valid', () => {
  assert.equal(optionalReceiptMoney(''), null); assert.equal(optionalReceiptMoney('0.00'), 0);
  for (const value of ['NaN','1.001','Infinity','2x']) assert.throws(() => optionalReceiptMoney(value));
  const draft = receiptDraft(parseReceipt('OATS 2.30')); draft.items[0].quantity = '-1';
  assert.throws(() => serializeReceipt(draft, { title:'Shop' }), /quantities/);
});
test('duplicate detection excludes edited transaction; validation rejects invalid images', () => {
  const transactions = [{ id:'one', title:'TESCO', date:'2026-10-02', amount:230 }];
  assert.equal(likelyReceiptDuplicate(transactions, null, 'Tesco', '2026-10-02', 230), true);
  assert.equal(likelyReceiptDuplicate(transactions, 'one', 'Tesco', '2026-10-02', 230), false);
  for (const file of [{ type:'image/svg+xml',size:100 }, { type:'image/png',size:0 }, { type:'image/jpeg',size:16000000 }]) assert.throws(() => validateReceiptImage(file));
  assert.doesNotThrow(() => validateReceiptImage({ type:'image/webp',size:1000 }));
});

test('Aldi photo transcript keeps AUTH product and reconciles five lines to £8.86', () => {
  const result = parseReceipt(aldiPhotoOcrTranscript);
  assert.equal(result.merchantName, 'ALDI STORES');
  assert.equal(result.currency, 'GBP');
  assert.equal(result.date,'2026-10-19');assert.equal(result.time,'14:17');assert.equal(result.tax,0);
  assert.equal(result.total, 886);
  assert.equal(result.itemCount, 5);
  assert.equal(result.classifiedLines.length,aldiPhotoOcrTranscript.split('\n').length);
  assert.ok(result.classifiedLines.every(line=>['HEADER','MERCHANT','ADDRESS','DATE_TIME','CURRENCY','PRODUCT_ITEM','DISCOUNT','SUBTOTAL','TOTAL','TAX','PAYMENT','FOOTER','UNRESOLVED_CANDIDATE'].includes(line.type)));
  assert.deepEqual(result.items.map(item => [item.retailerProductCode, item.name, item.quantity, item.unit, item.packSize, item.packUnit, item.lineTotal]), [
    ['335763','OATS PORRIDGE',1,'each',1,'kg',109],
    ['386021','MILLED/WHOLE CHIA',1,'each',null,'',179],
    ['656970','AUTH GREEK YOG',1,'each',1,'kg',369],
    ['339817','CUT CORIANDER',1,'each',null,'',50],
    ['761542','MILLED FLAXSEED',1,'each',null,'',179],
  ]);
  assert.deepEqual(reconcileReceipt(result), { computedItemsTotal:886, total:886, totalDifference:0, productLineCount:5, computedUnitCount:5, declaredItemCount:5, itemCountMatches:true, unresolvedLineCount:0, complete:true });
  assert.deepEqual(receiptWarnings(result), []);
  const saved=serializeReceipt(receiptDraft(result),{id:'tx-aldi',title:'AG ALDI STORES',date:'2026-10-19',amount:886,updatedAt:'now'});
  assert.equal(saved.merchantName,'ALDI STORES');assert.equal(saved.items[0].packSize,1);assert.equal(saved.items[0].packUnit,'kg');
  assert.ok(saved.classifiedLines.some(line=>line.type==='PRODUCT_ITEM'&&line.rawText.includes('AUTH GREEK YOG')));
});

test('unresolved candidates retain redacted text, original line index, geometry and confidence', () => {
  const result = parseReceipt({ text:'SHOP\nMYSTERY PRODUCT unclear\nTOTAL 4.20', lines:[
    { text:'SHOP', lineIndex:10, confidence:90, bbox:{x0:1,y0:2,x1:3,y1:4} },
    { text:'MYSTERY PRODUCT unclear', lineIndex:11, confidence:32, bbox:{x0:5,y0:6,x1:7,y1:8} },
    { text:'TOTAL 4.20', lineIndex:12, confidence:90, bbox:{x0:1,y0:9,x1:3,y1:10} },
  ] });
  assert.ok(result.unresolvedLines.some(line => line.lineIndex === 11 && line.confidence === 32 && line.bbox.x0 === 5));
  const saved=serializeReceipt(receiptDraft(result),{id:'tx-review',title:'SHOP',date:'2026-10-19',amount:420,updatedAt:'now'});
  assert.equal(saved.unresolvedLines[0].rawText,'MYSTERY PRODUCT unclear');assert.equal(saved.classifiedLines[1].bbox.x0,5);
});

test('saved OCR transcript remains available while payment card numbers are redacted',()=>{
  const raw='SHOP\nOATS 2.30\nCard 4111 1111 1111 1111';
  const parsed=parseReceipt(raw);const saved=serializeReceipt(receiptDraft(parsed),{id:'tx-raw',title:'Shop',date:'2026-10-19',amount:230,updatedAt:'now'});
  assert.ok(saved.rawText.includes('OATS 2.30'));assert.ok(saved.rawText.includes('[redacted]'));assert.equal(saved.rawText.includes('4111 1111 1111 1111'),false);
  assert.ok(saved.classifiedLines.some(line=>line.type==='PAYMENT'&&line.rawText.includes('[redacted]')));
});
