import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePurchaseItems, purchaseCategoryAmount, draftPurchaseItemsFromReceipt } from './purchaseItems.js';

test('item categories allocate one transaction across category totals and preserve legacy fallback', () => {
  const transaction = { amount:1000, categoryId:'groceries', purchaseItems:[{categoryId:'weight-loss',lineTotal:600},{categoryId:'groceries',lineTotal:400}] };
  assert.equal(purchaseCategoryAmount(transaction,'weight-loss'),600);
  assert.equal(purchaseCategoryAmount(transaction,'groceries'),400);
  assert.equal(purchaseCategoryAmount({amount:1000,categoryId:'groceries'},'groceries'),1000);
});

test('purchase items validate names, quantities, line totals, and keep stable IDs', () => {
  const row = {id:'stable',name:'Greek yogurt',quantity:'1',unitPrice:'3.50',lineTotal:'3.50',categoryId:'weight-loss'};
  const saved = normalizePurchaseItems([row], 'transaction', 'now')[0];
  assert.deepEqual([saved.id,saved.transactionId,saved.name,saved.quantity,saved.unitPrice,saved.lineTotal,saved.categoryId], ['stable','transaction','Greek yogurt',1,350,350,'weight-loss']);
  assert.throws(() => normalizePurchaseItems([{...row,name:''}], 't', 'now'), /name/);
  assert.throws(() => normalizePurchaseItems([{...row,lineTotal:''}], 't', 'now'), /line total/);
});

test('OCR receipt rows prefill purchase item names, quantities, prices, and a reviewable category', () => {
  const rows=draftPurchaseItemsFromReceipt([{id:'ocr-1',name:'Greek yogurt',quantity:1,unitPrice:'3.50',lineTotal:'3.50'},{id:'ocr-2',name:'Frozen berries',quantity:2,unitPrice:'1.25',lineTotal:'2.50'}],'groceries');
  assert.deepEqual(rows.map(item=>[item.id,item.name,item.quantity,item.unitPrice,item.lineTotal,item.categoryId]),[['ocr-1','Greek yogurt',1,'3.50','3.50','groceries'],['ocr-2','Frozen berries',2,'1.25','2.50','groceries']]);
});
