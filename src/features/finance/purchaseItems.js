import { optionalReceiptMoney } from './receiptData.js';


export function draftPurchaseItemsFromReceipt(items, defaultCategoryId = '') {
  return (items || []).map(item => ({ id:item.id || crypto.randomUUID(), name:item.name || item.rawName || '', quantity:item.quantity || '1', unitPrice:item.unitPrice || '', lineTotal:item.lineTotal || '', categoryId:item.categoryId || defaultCategoryId }));
}

export function purchaseCategoryAllocations(transaction) {
  const items = transaction?.purchaseItems;
  if (!Array.isArray(items) || !items.length) return [{ categoryId: transaction?.categoryId || '', amount: Number(transaction?.amount || 0) }];
  return items.map(item => ({ categoryId: item.categoryId || '', amount: Number(item.lineTotal || 0) }));
}

export function purchaseCategoryAmount(transaction, categoryId) {
  return purchaseCategoryAllocations(transaction).filter(item => item.categoryId === categoryId).reduce((sum, item) => sum + item.amount, 0);
}

export function normalizePurchaseItems(items, transactionId, timestamp) {
  if (!Array.isArray(items) || !items.length) return [];
  return items.map(item => {
    const name = String(item.name || '').trim();
    const lineTotal = typeof item.lineTotal === 'string' ? optionalReceiptMoney(item.lineTotal) : Number(item.lineTotal);
    const quantity = Number(item.quantity ?? 1);
    if (!name) throw new Error('Give each purchase item a name, or remove the empty row.');
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Item quantities must be greater than zero.');
    if (!Number.isSafeInteger(lineTotal) || lineTotal < 0 && item.name !== 'Receipt adjustment') throw new Error('Enter a valid line total for every purchase item.');
    return { id: item.id || crypto.randomUUID(), transactionId, name: name.slice(0, 200), quantity, unitPrice: item.unitPrice === '' || item.unitPrice == null ? null : typeof item.unitPrice === 'string' ? optionalReceiptMoney(item.unitPrice) : Number(item.unitPrice), lineTotal, categoryId: item.categoryId || '', createdAt: item.createdAt || timestamp, updatedAt: timestamp };
  });
}
