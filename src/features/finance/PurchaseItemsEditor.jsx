import { useRef } from 'react';
import { formatMoney, parseMoney } from './financeMath.js';
import { optionalReceiptMoney } from './receiptData.js';

const minor = value => { try { return value === '' || value == null ? 0 : optionalReceiptMoney(value); } catch { return 0; } };
const input = value => (Number(value || 0) / 100).toFixed(2);

export function PurchaseItemsEditor({ items, onChange, categories, currency, amount, adjustment, onAdjustmentChange, adjustmentCategory, onAdjustmentCategoryChange, onAmountChange, autoTotal=false }) {
  const newName = useRef(null);
  const itemSum = items.reduce((sum, item) => sum + minor(item.lineTotal), 0);
  let paid = 0; try { paid = amount ? parseMoney(amount) : 0; } catch { /* The transaction form reports invalid amounts. */ }
  const adjustmentMinor = minor(adjustment), categoryTotals = new Map();
  for (const item of items) categoryTotals.set(item.categoryId || '', (categoryTotals.get(item.categoryId || '') || 0) + minor(item.lineTotal));
  if (adjustmentMinor) categoryTotals.set(adjustmentCategory || '', (categoryTotals.get(adjustmentCategory || '') || 0) + adjustmentMinor);
  const difference = paid - itemSum - adjustmentMinor;
  const changeItem = (index, patch) => { const next=items.map((item, at) => at === index ? { ...item, ...patch } : item); onChange(next); if(autoTotal) onAmountChange(input(next.reduce((sum,item)=>sum+minor(item.lineTotal),0)+minor(adjustment))); };
  const recalc = item => item.unitPrice === '' || item.unitPrice == null ? item : { ...item, lineTotal:input(Math.round(minor(item.unitPrice) * Number(item.quantity || 1))) };
  const add = () => { onChange([...items, { id:crypto.randomUUID(), name:'', quantity:'1', unitPrice:'', lineTotal:'', categoryId:items[0]?.categoryId || categories[0]?.id || '' }]); setTimeout(() => newName.current?.focus(), 0); };
  return <section className="f-purchase-editor" aria-label="Purchase items">
    <div className="f-between"><h3>Items</h3><label className="f-purchase-bulk">Apply category to all<select aria-label="Apply category to all" value="" onChange={event => { if (event.target.value) onChange(items.map(item => ({ ...item, categoryId:event.target.value }))); }}><option value="">Choose category</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label></div>
    <div className="f-purchase-rows">{items.map((item,index)=><fieldset className="f-purchase-row" key={item.id}><legend className="sr-only">Item {index+1}</legend><label className="f-purchase-name">Item name<input ref={index===items.length-1 && !item.name ? newName : null} maxLength="200" value={item.name} onChange={event=>changeItem(index,{name:event.target.value})}/></label><label>Line total<input inputMode="decimal" aria-label={`Line total for item ${index+1}`} value={item.lineTotal ?? ''} onChange={event=>changeItem(index,{lineTotal:event.target.value})}/></label><label>Category<select aria-label={`Category for item ${index+1}`} value={item.categoryId||''} onChange={event=>changeItem(index,{categoryId:event.target.value})}><option value="">Choose</option>{categories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select></label><details className="f-purchase-more"><summary>Edit quantity, unit price, or remove</summary><div className="f-row"><label>Quantity<input inputMode="decimal" value={item.quantity ?? '1'} onChange={event=>changeItem(index,recalc({...item,quantity:event.target.value}))}/></label><label>Unit price<input inputMode="decimal" value={item.unitPrice ?? ''} onChange={event=>changeItem(index,recalc({...item,unitPrice:event.target.value}))}/></label></div><button type="button" className="f-button danger-action" onClick={()=>onChange(items.filter((_,at)=>at!==index))}>Remove item</button></details></fieldset>)}</div>
    <button type="button" className="f-button f-purchase-add" onClick={add}>+ Add item</button>
    <label>Discount, fee, or receipt adjustment<input inputMode="decimal" value={adjustment} onChange={event=>{onAdjustmentChange(event.target.value); if(autoTotal)onAmountChange(input(itemSum+minor(event.target.value)))}}/></label>
    {!!adjustmentMinor && <label>Adjustment category<select value={adjustmentCategory||''} onChange={event=>onAdjustmentCategoryChange(event.target.value)}><option value="">Choose category</option>{categories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select></label>}
    <div className="f-between f-purchase-paid"><strong>Amount paid</strong><strong>{formatMoney(paid,currency)}</strong></div>
    {difference !== 0 && <p className="f-alert" role="status">Item categories total {formatMoney(itemSum + adjustmentMinor,currency)}; difference {difference>0?'+':''}{formatMoney(difference,currency)}. Update the adjustment or paid amount to reconcile before saving.</p>}
    <details className="f-purchase-breakdown"><summary>Breakdown</summary>{categories.filter(category=>categoryTotals.has(category.id)).map(category=><p key={category.id}>{category.name}: <strong>{formatMoney(categoryTotals.get(category.id),currency)}</strong></p>)}<p>Total categories: <strong>{formatMoney(itemSum+adjustmentMinor,currency)}</strong></p></details>
  </section>;
}
