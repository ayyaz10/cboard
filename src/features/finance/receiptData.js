import { normalizedName, redactPaymentData } from './receiptParser.js';

export const receiptMoneyInput = value => value == null ? '' : (value / 100).toFixed(2);
export function optionalReceiptMoney(value) {
  if (value === '' || value == null) return null;
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(String(value).trim())) throw new Error('Receipt prices must be numbers with at most two decimal places.');
  const result = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(result)) throw new Error('Receipt price is too large.');
  return result;
}
export function receiptDraft(receipt) {
  return { ...receipt, subtotal: receiptMoneyInput(receipt.subtotal), tax: receiptMoneyInput(receipt.tax), discounts: receiptMoneyInput(receipt.discounts),
    items: receipt.items.map(item => ({ ...item, id: item.id || crypto.randomUUID(), quantity: item.quantity ?? '', unit: item.unit || '', packSize: item.packSize ?? '', unitPrice: receiptMoneyInput(item.unitPrice), lineTotal: receiptMoneyInput(item.lineTotal) })) };
}
// The redacted OCR transcript and classified line evidence persist for review.
// Images, unredacted payment numbers and transient UI flags never persist.
export function serializeReceipt(draft, transaction, previous) {
  const ids = new Set();
  const confidence = value => Object.fromEntries(['name','quantity','unitPrice','lineTotal'].filter(key=>Number.isFinite(value?.[key])).map(key=>[key,Math.max(0,Math.min(100,value[key]))]));
  const cleanBox = value => {
    if (!value || typeof value !== 'object') return null;
    const box = Object.fromEntries(['x0','y0','x1','y1','width','height'].filter(key=>Number.isFinite(value[key])).map(key=>[key,value[key]]));
    return Object.keys(box).length ? box : null;
  };
  const safeLine = line => ({ lineIndex: Number.isSafeInteger(line?.lineIndex) && line.lineIndex >= 0 ? line.lineIndex : 0,
    rawText: redactPaymentData(line?.rawText).slice(0, 1000), type: ['HEADER','MERCHANT','ADDRESS','DATE_TIME','CURRENCY','PRODUCT_ITEM','DISCOUNT','SUBTOTAL','TOTAL','TAX','PAYMENT','FOOTER','UNRESOLVED_CANDIDATE'].includes(line?.type) ? line.type : 'UNRESOLVED_CANDIDATE',
    confidence: Number.isFinite(line?.confidence) ? Math.max(0,Math.min(100,line.confidence)) : 0, bbox: cleanBox(line?.bbox) });
  return { version: 2, merchantName: redactPaymentData(draft.merchantName || transaction.title), date: transaction.date, time: draft.time || '', currency: draft.currency,
    rawText: redactPaymentData(draft.rawText).slice(0,100000),
    editedFields: Array.isArray(draft.editedFields) ? [...new Set(draft.editedFields.filter(key=>['time','currency','subtotal','tax','discounts'].includes(key)))] : [],
    subtotal: optionalReceiptMoney(draft.subtotal), tax: optionalReceiptMoney(draft.tax), discounts: optionalReceiptMoney(draft.discounts), total: transaction.amount,
    itemCount: Number.isSafeInteger(draft.itemCount) ? draft.itemCount : null,
    classifiedLines: Array.isArray(draft.classifiedLines) ? draft.classifiedLines.slice(0,2000).map(safeLine) : [],
    unresolvedLines: Array.isArray(draft.unresolvedLines) ? draft.unresolvedLines.slice(0,2000).map(safeLine) : [],
    classifiedLineOverflow: Math.max(0,draft.unprocessedLineCount || (draft.classifiedLines?.length || 0)-2000),
    items: draft.items.map(item => {
      const quantity = item.quantity === '' || item.quantity == null ? null : Number(item.quantity);
      if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) throw new Error('Item quantities must be positive, or left blank.');
      const name = redactPaymentData(item.name).trim();
      if (!name) throw new Error('Give each receipt item a name, or remove the empty item.');
      // IDs survive edits. Copying a transaction generates fresh item IDs.
      const old = previous?.items?.find(oldItem => oldItem.id === item.id);
      const itemId = old && !ids.has(old.id) ? old.id : crypto.randomUUID();
      ids.add(itemId);
      const packSize = item.packSize === '' || item.packSize == null ? null : Number(item.packSize);
      if (packSize !== null && (!Number.isFinite(packSize) || packSize <= 0)) throw new Error('Package sizes must be positive, or left blank.');
      return { id: itemId, transactionId: transaction.id, name, normalizedName: normalizedName(name), rawText: redactPaymentData(item.rawText).slice(0, 1000),
        rawName: redactPaymentData(item.rawName || item.name).slice(0,200), retailerProductCode: /^\d{5,8}$/.test(item.retailerProductCode || '') ? item.retailerProductCode : null,
        lineIndex: Number.isSafeInteger(item.lineIndex) && item.lineIndex >= 0 ? item.lineIndex : null, bbox: cleanBox(item.bbox),
        packSize, packUnit: String(item.packUnit || '').slice(0,20), canonicalFoodId: typeof item.canonicalFoodId === 'string' ? item.canonicalFoodId.slice(0,150) : null,
        rememberFoodMapping: item.rememberFoodMapping === true,
        foodMappingReviewed: item.foodMappingReviewed === true,
        manuallyAdded: item.manuallyAdded === true,
        editedFields: Array.isArray(item.editedFields) ? [...new Set(item.editedFields.filter(key=>['name','quantity','unit','unitPrice','lineTotal','packSize','packUnit','canonicalFoodId'].includes(key)))] : [],
        quantityRawText: redactPaymentData(item.quantityRawText || '').slice(0,100),
        confidence: confidence(item.confidence),
        quantity, unit: String(item.unit || '').slice(0, 30), unitPrice: optionalReceiptMoney(item.unitPrice), lineTotal: optionalReceiptMoney(item.lineTotal),
        createdAt: old?.createdAt || transaction.updatedAt, updatedAt: transaction.updatedAt };
    }) };
}
export function likelyReceiptDuplicate(transactions, currentId, title, date, amount) {
  if (!title || !date || amount == null) return false;
  return transactions.some(item => item.id !== currentId && item.date === date && item.amount === amount && normalizedName(item.title) === normalizedName(title));
}
