import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOcrSpaceReceipt } from './receiptOcrDocument.js';

test('OCR.Space Costco SKU price rows join to receipt item names and keep the records total', () => {
  const rawText = `COSTCO WHOLESALE
PLEASE KEEP THIS FOR YOUR RECORDS GBP 58.51
PEPPER 6 PACK
SWEET POTATOES 3KG
80245 1x 11.76 11.76 Z
7602 1x 13.40 13.40 Z
144313 1x 7.29 7.29-A
3 Items`;
  const { parsed } = parseOcrSpaceReceipt({ pages: [{ rawText, lines: [] }] });

  assert.equal(parsed.merchantName, 'COSTCO WHOLESALE');
  assert.equal(parsed.total, 5851);
  assert.equal(parsed.itemCount, 3);
  assert.deepEqual(parsed.items.map(item => [item.name, item.retailerProductCode, item.quantity, item.unitPrice, item.lineTotal]), [
    ['PEPPER 6 PACK', '80245', 1, 1176, 1176],
    ['SWEET POTATOES 3KG', '7602', 1, 1340, 1340],
    ['Costco item 144313', '144313', 1, 729, 729],
  ]);
  assert.ok(parsed.classifiedLines.some(line => line.type === 'TOTAL' && line.rawText.includes('PLEASE KEEP THIS')));
  assert.ok(parsed.classifiedLines.filter(line => line.type === 'PRODUCT_ITEM').length >= 4);
});
