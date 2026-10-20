import { canonicalUnit, convert, newItem, normalizeName, normalizeGroceryState, round } from './groceryData.js';
import { reconcileReceipt } from '../finance/receiptParser.js';

const receiptEventKey = (transactionId, itemId) => `${transactionId}:${itemId}`;
const receiptUnit = value => {
  const unit = String(value || '').trim().toLowerCase();
  if (['each','unit','piece','pieces','pc','pcs','ea'].includes(unit)) return 'pieces';
  if (['gram','grams'].includes(unit)) return 'g';
  if (['kilogram','kilograms'].includes(unit)) return 'kg';
  if (['millilitre','milliliter','millilitres','milliliters'].includes(unit)) return 'ml';
  if (['litre','liter','litres','liters','l'].includes(unit)) return 'L';
  return ['g','kg','ml','L','pieces','packs','cans','bottles'].includes(value) ? value : null;
};

function matchesFoodName(name, food) {
  const wanted = normalizeName(name);
  return [food.name, ...(food.aliases || []), ...(food.receiptMappings || []).map(mapping => mapping.alias)]
    .filter(Boolean).some(value => normalizeName(value) === wanted);
}

function restorePriorPurchases(state, transactionId) {
  state.receiptPurchaseLedger ||= {};
  const entries = Object.entries(state.receiptPurchaseLedger).filter(([,event]) => event.transactionId === transactionId);
  const warnings = [];
  for (const [key,event] of entries) {
    const stock = state.items.find(item => item.id === event.stockItemId);
    if (stock && Number.isFinite(stock.quantity)) {
      const amount = convert(event.stockAmount,event.stockUnit,stock.unit);
      if (amount == null) { warnings.push(`${stock.name}: stock unit changed, so the saved receipt adjustment could not be reversed automatically.`); delete state.receiptPurchaseLedger[key]; continue; }
      const next = round(stock.quantity - amount);
      if (next < 0) warnings.push(`${stock.name}: the receipt purchase has already been partly used; available stock was set to zero when removing the receipt link.`);
      stock.quantity = Math.max(0,next);
    }
    const shopping = state.shopping.find(item => item.id === event.shoppingItemId);
    if (shopping && Number.isFinite(shopping.quantity)) shopping.quantity = round(shopping.quantity + event.shoppingConsumed);
    else if (!shopping && event.shoppingRemovedByReceipt && event.shoppingSnapshot) state.shopping.push(structuredClone(event.shoppingSnapshot));
    delete state.receiptPurchaseLedger[key];
  }
  return warnings;
}

function findStock(state, food, sourceUnit) {
  const byId = state.items.filter(item => !item.removed && item.foodId === food.id);
  if (byId.length > 1) throw new Error(`${food.name}: multiple stock records use this All Food Items link. Resolve the duplicate stock records first.`);
  if (byId.length === 1) return byId[0];
  const byName = state.items.filter(item => !item.removed && matchesFoodName(item.name,food) && convert(1,sourceUnit,item.unit) != null);
  if (byName.length > 1) throw new Error(`${food.name}: multiple stock records have the same food name. Link one stock record to All Food Items first.`);
  if (byName.length === 1) { byName[0].foodId = food.id; return byName[0]; }
  const unit = sourceUnit || (food.unit === 'ml' ? 'ml' : food.unit === 'g' ? 'g' : 'pieces');
  const created = { ...newItem(food.name,0,unit), foodId:food.id };
  state.items.push(created);
  return created;
}

function consumeShopping(state, food, stockAmount, stockUnit) {
  if (food.shoppingListEnabled === false || food.groceryTrackingEnabled === false) return null;
  const candidates = state.shopping.filter(item => (item.foodId === food.id || matchesFoodName(item.name,food)) && convert(1,stockUnit,item.unit) != null);
  if (candidates.length > 1) throw new Error(`${food.name}: multiple matching shopping entries need review. Stock was not changed.`);
  const entry = candidates[0];
  if (!entry || !Number.isFinite(entry.quantity) || entry.quantity <= 0) return null;
  const amountInListUnit = convert(stockAmount,stockUnit,entry.unit);
  if (amountInListUnit == null) return null;
  const consumed = Math.min(entry.quantity,amountInListUnit), snapshot = structuredClone(entry);
  entry.quantity = round(entry.quantity - consumed);
  const removed = entry.quantity <= 0;
  if (removed) state.shopping = state.shopping.filter(item => item.id !== entry.id);
  return { shoppingItemId:entry.id, shoppingConsumed:consumed, shoppingSnapshot:snapshot, shoppingRemovedByReceipt:removed };
}

function applyReceiptItems(state, transaction, catalog) {
  const receipt = transaction?.receipt;
  if (!receipt || transaction.type !== 'expense') return { applied:0, warnings:[] };
  const reconciliation = reconcileReceipt(receipt,transaction.amount);
  const linkedItems=(receipt.items||[]).filter(item=>item.canonicalFoodId&&catalog.some(food=>food.id===item.canonicalFoodId&&food.groceryTrackingEnabled!==false));
  if (!reconciliation.complete || reconciliation.itemCountMatches === false || receipt.items.some(item => item.lineTotal == null))
    return { applied:0, warnings:linkedItems.length?['Receipt stock was left unchanged because the receipt total, item count or unresolved lines still need review.']:[] };
  let applied = 0; const warnings=[];
  for (const item of receipt.items || []) {
    const food = catalog.find(candidate => candidate.id === item.canonicalFoodId);
    if (!food || food.groceryTrackingEnabled === false) continue;
    const sourceAmount = Number(item.packSize) > 0 ? Number(item.packSize) : Number(item.quantity);
    const sourceUnit = receiptUnit(Number(item.packSize) > 0 ? item.packUnit : item.unit);
    if (!Number.isFinite(sourceAmount) || sourceAmount <= 0 || !sourceUnit) { warnings.push(`${food.name}: no usable purchase quantity or pack size was recorded, so stock was left unchanged.`); continue; }
    const stock = findStock(state,food,sourceUnit), amount = convert(sourceAmount,sourceUnit,stock.unit);
    if (amount == null) { warnings.push(`${food.name}: receipt quantity cannot be converted to the tracked stock unit (${stock.unit}), so stock was left unchanged.`); continue; }
    stock.quantity = round((Number.isFinite(stock.quantity) ? stock.quantity : 0) + amount); stock.recipeOnly = false;
    const shopping = consumeShopping(state,food,amount,stock.unit);
    state.receiptPurchaseLedger[receiptEventKey(transaction.id,item.id)] = { transactionId:transaction.id, receiptItemId:item.id, foodId:food.id,
      stockItemId:stock.id, stockAmount:amount, stockUnit:canonicalUnit(stock.unit), ...(shopping || {}), transactionDate:transaction.date, lineTotal:item.lineTotal };
    applied++;
  }
  return { applied, warnings };
}

export function updateReceiptPurchasesState(inputState, transaction, catalog) {
  const state = normalizeGroceryState(inputState), warnings = restorePriorPurchases(state,transaction?.id);
  const applied = applyReceiptItems(state,transaction,catalog);
  return { state, applied:applied.applied, warnings:[...warnings,...applied.warnings] };
}
