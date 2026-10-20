import { loadGroceries, saveGroceries } from './groceryService.js';
import { getFoodCatalog } from './foodCatalogService.js';
import { updateReceiptPurchasesState } from '../features/groceries/receiptPurchases.js';

/** Apply, replace or reverse a transaction's receipt stock events idempotently. */
export async function syncReceiptPurchases(transaction, expectedUserId) {
  if (!transaction?.id) return { applied:0, warnings:[] };
  const catalog = await getFoodCatalog(expectedUserId);
  for (let attempt = 0; attempt < 2; attempt++) {
    const loaded = await loadGroceries();
    if (expectedUserId && loaded.userId !== expectedUserId) throw new Error('Your account changed. Reload before updating receipt stock.');
    const result = updateReceiptPurchasesState(loaded.state,transaction,catalog);
    try {
      const version = await saveGroceries(result.state,loaded.version,loaded.userId);
      return { applied:result.applied, warnings:result.warnings, version };
    } catch (error) {
      if (attempt === 1 || !/another tab|changed/i.test(error.message || '')) throw error;
    }
  }
  throw new Error('Receipt stock changed in another tab. Reload and retry the receipt save.');
}
