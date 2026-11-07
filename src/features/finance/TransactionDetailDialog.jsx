import { useEffect, useRef, useState } from 'react';
import { formatMoney } from './financeMath.js';
import { canDeleteTransaction, canDuplicateTransaction, canEditTransaction, canOpenLinkedRecord, canReclassifyTransaction, getTransactionAmountPresentation, getTransactionDisplayType, getTransactionLinkedContext } from './transactionPresentation.js';
import { ReceiptItems } from './ReceiptEditor.jsx';

const dateLabel = value => {
  const date=String(value||'').slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Date not recorded';
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined,{day:'numeric',month:'long',year:'numeric'});
};

export function TransactionDetailDialog({ transaction, data, busy, close, edit, remove, duplicate, reclassify, openLinked, markDonationUnpaid, markDebtUnpaid, canMarkDonationUnpaid, canMarkDebtUnpaid }) {
  const dialogRef = useRef(null);
  const [categoryId,setCategoryId] = useState(transaction?.categoryId || '');
  const [categoryMode,setCategoryMode] = useState(false);
  const [actionError,setActionError] = useState(''),[deleting,setDeleting] = useState(false);
  useEffect(()=>{dialogRef.current?.showModal();return ()=>{if(dialogRef.current?.open)dialogRef.current.close()}},[]);
  if (!transaction) return null;
  const linked=getTransactionLinkedContext(transaction,data);
  const amount=getTransactionAmountPresentation(transaction);
  const category=data.categories.find(item=>item.id===transaction.categoryId)?.name || 'Uncategorized';
  const fundLabel=value=>{if(!value)return 'Spendable money';const [kind,id]=String(value).split(':',2);if(kind==='goal')return `${data.goals.find(item=>item.id===id)?.title||'Fund'} goal`;if(kind==='investment')return data.investments.find(item=>item.id===id)?.name||'Investment fund';if(kind==='savings')return 'Savings';return value};
  const transferFrom=fundLabel(transaction.fromFundId);
  const transferTo=fundLabel(transaction.toFundId);
  const categoryOptions=data.categories.filter(item=>!item.archived||item.id===transaction.categoryId).filter(item=>transaction.type==='income'?item.type==='income':item.type==='expense'?['expense','donation'].includes(item.type):item.type===transaction.type);
  const safeClose=()=>{if(dialogRef.current?.open)dialogRef.current.close();close()};
  async function saveCategory(){
    try{if(await reclassify(transaction,categoryId)){setCategoryMode(false);setActionError('')}}
    catch(error){setActionError(error.message||'Could not update the category. Finance data was not changed.')}
  }
  return <dialog ref={dialogRef} className="f-dialog f-transaction-dialog" aria-labelledby="transaction-detail-title" onCancel={event=>{event.preventDefault();safeClose()}}>
    <div className="f-between"><h2 id="transaction-detail-title">{transaction.title || getTransactionDisplayType(transaction,data)}</h2><button type="button" className="f-button" aria-label="Close transaction details" onClick={safeClose}>Close</button></div>
    <div className="f-transaction-detail"><p aria-label={`${amount.prefix==='-'?'Outflow':amount.prefix==='+'?'Income':'Transfer amount'} ${formatMoney(transaction.amount,data.settings.currency)}`} className={`f-transaction-detail-amount ${amount.tone==='positive'?'f-positive':amount.tone==='negative'?'f-negative':''}`}>{amount.prefix}{formatMoney(transaction.amount,data.settings.currency)}</p>
      <dl><div><dt>Type</dt><dd>{getTransactionDisplayType(transaction,data)}</dd></div><div><dt>Date</dt><dd>{dateLabel(transaction.date)}</dd></div><div><dt>Category</dt><dd>{category}{transaction.categoryId&&data.categories.find(item=>item.id===transaction.categoryId)?.archived?' (archived)':''}</dd></div>
        {transaction.type==='transfer'&&<><div><dt>From</dt><dd>{transferFrom}</dd></div><div><dt>To</dt><dd>{transferTo}</dd></div></>}
        {transaction.paidFromFundId&&<div><dt>Paid from</dt><dd>{fundLabel(transaction.paidFromFundId)}</dd></div>}
        {transaction.paymentMethod&&<div><dt>Payment source</dt><dd>{transaction.paymentMethod}</dd></div>}
        {transaction.note&&<div><dt>Note</dt><dd>{transaction.note}</dd></div>}{transaction.reference&&<div><dt>Reference</dt><dd>{transaction.reference}</dd></div>}
        {linked&&<div><dt>Linked record</dt><dd>{linked.label} ({linked.kind==='debt'?'Debt':linked.kind==='credit'?'Credit purchase':linked.kind==='donation'?'Donation':linked.kind==='goal'?'Fund or goal':'Investment'})</dd></div>}
        {transaction.reversedAt&&<div><dt>Status</dt><dd>Reversed on {dateLabel(transaction.reversedAt)}</dd></div>}
        {transaction.receipt&&<div className="f-transaction-receipt" id={`receipt-${transaction.id}`}><dt>Receipt attached</dt><dd><p>{transaction.receipt.merchantName||transaction.title} · Total {formatMoney(transaction.receipt.total??transaction.amount,data.settings.currency)}</p><details><summary>View receipt items and details</summary><ReceiptItems receipt={transaction.receipt} currency={data.settings.currency}/></details></dd></div>}
      </dl>
      {categoryMode&&<div className="f-form f-transaction-category-editor"><label>Category<select className="f-input" value={categoryId} onChange={event=>setCategoryId(event.target.value)}><option value="">Uncategorized</option>{categoryOptions.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="f-actions"><button type="button" className="f-primary" disabled={busy||categoryId===transaction.categoryId} onClick={saveCategory}>{busy?'Saving…':'Save category'}</button><button type="button" className="f-button" onClick={()=>{setCategoryMode(false);setCategoryId(transaction.categoryId||'')}}>Cancel</button></div></div>}
      {actionError&&<p className="f-alert" role="alert">{actionError}</p>}
      <div className="f-actions f-transaction-detail-actions">
        {canOpenLinkedRecord(linked)&&<button type="button" className="f-primary" disabled={busy} onClick={()=>openLinked(linked,transaction)}>{linked.kind==='debt'?'Open debt':linked.kind==='credit'?'Open credit purchase':linked.kind==='donation'?'Open donation':linked.kind==='goal'?'Open fund or goal':'Open investment'}</button>}
        {canMarkDonationUnpaid&&<button type="button" className="f-button danger-action" disabled={busy} onClick={()=>markDonationUnpaid(transaction)}>Mark as unpaid</button>}
        {canMarkDebtUnpaid&&<button type="button" className="f-button danger-action" disabled={busy} onClick={()=>markDebtUnpaid(transaction)}>Mark as unpaid</button>}
        {canEditTransaction(transaction,data)&&<button type="button" className="f-button" disabled={busy} onClick={()=>edit(transaction)}>Edit</button>}
        {canReclassifyTransaction(transaction,data)&&!categoryMode&&<button type="button" className="f-button" disabled={busy} onClick={()=>setCategoryMode(true)}>Change category</button>}
        {canDuplicateTransaction(transaction,data)&&<button type="button" className="f-button" disabled={busy} onClick={()=>duplicate({...transaction,id:undefined,title:transaction.title?`${transaction.title} copy`:'Copy'})}>Duplicate</button>}
        {canDeleteTransaction(transaction,data)&&<button type="button" className="f-button danger-action" disabled={busy||deleting} onClick={async()=>{setDeleting(true);setActionError('');try{if(await remove(transaction))safeClose()}catch(error){setActionError(error.message||'Could not delete this transaction. Finance data was not changed.')}finally{setDeleting(false)}}}>{deleting||busy?'Deleting…':'Delete'}</button>}
      </div>
    </div>
  </dialog>;
}
