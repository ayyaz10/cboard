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
    items: receipt.items.map(item => ({ ...item, id: item.id || crypto.randomUUID(), quantity: item.quantity ?? '', unit: item.unit || '', unitPrice: receiptMoneyInput(item.unitPrice), lineTotal: receiptMoneyInput(item.lineTotal) })) };
}
// Explicit allowlist: images, raw full OCR, card details and transient UI flags never persist.
export function serializeReceipt(draft, transaction, previous) {
  const ids = new Set();
  const confidence = value => Object.fromEntries(['name','quantity','unitPrice','lineTotal'].filter(key=>Number.isFinite(value?.[key])).map(key=>[key,Math.max(0,Math.min(100,value[key]))]));
  return { version: 1, merchantName: redactPaymentData(transaction.title), date: transaction.date, time: draft.time || '', currency: draft.currency,
    subtotal: optionalReceiptMoney(draft.subtotal), tax: optionalReceiptMoney(draft.tax), discounts: optionalReceiptMoney(draft.discounts), total: transaction.amount,
    itemCount: Number.isSafeInteger(draft.itemCount) ? draft.itemCount : null,
    items: draft.items.map(item => {
      const quantity = item.quantity === '' || item.quantity == null ? null : Number(item.quantity);
      if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) throw new Error('Item quantities must be positive, or left blank.');
      const name = redactPaymentData(item.name).trim();
      if (!name) throw new Error('Give each receipt item a name, or remove the empty item.');
      // IDs survive edits. Copying a transaction generates fresh item IDs.
      const old = previous?.items?.find(oldItem => oldItem.id === item.id);
      const itemId = old && !ids.has(old.id) ? old.id : crypto.randomUUID();
      ids.add(itemId);
      return { id: itemId, transactionId: transaction.id, name, normalizedName: normalizedName(name), rawText: redactPaymentData(item.rawText).slice(0, 1000),
        rawName: redactPaymentData(item.rawName || item.name).slice(0,200), retailerProductCode: /^\d{5,8}$/.test(item.retailerProductCode || '') ? item.retailerProductCode : null,
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
