import { useEffect, useMemo, useRef, useState } from 'react';
import { Filter, Search, X } from 'lucide-react';
import { formatMoney, parseMoney, monthKey, shiftMonth } from './financeMath.js';
import { filterTransactions, isValidFinanceDate, orderedTransactions } from './transactionOrder.js';
import { transactionViewDateRange, activeTransactionFilterCount } from './transactionView.js';
import { getTransactionAmountPresentation, getTransactionDisplayType, getTransactionLinkedContext, summarizeTransactions } from './transactionPresentation.js';
import { MerchantLogo } from './MerchantLogo.jsx';
import { receivedRefundTotal } from './refunds.js';

const typeLabels={income:'Income',expense:'Expense',refund:'Refund',creditPurchaseRefund:'Credit purchase refund',donation:'Donation payment',transfer:'Transfer',debt:'Debt repayment',creditPayment:'Credit purchase payment',investment:'Investment',savings:'Savings',budget:'Budget allocation',goal:'Fund contribution'};
const typeOptions=['expense','income','refund','transfer','debt','donation','creditPayment','investment','savings','budget','goal'];
const currencyLabel=(amount,currency)=>formatMoney(amount,currency);
const transactionSubLabel=(transaction,data)=>{if(transaction.type==='expense'){const refunded=receivedRefundTotal(data.transactions,transaction.id);if(refunded>0)return `${formatMoney(refunded,data.settings.currency)} refunded · ${formatMoney(Math.max(0,transaction.amount-refunded),data.settings.currency)} net`}return getTransactionDisplayType(transaction,data)};
const dateText=(value,options={day:'numeric',month:'short',year:'numeric'})=>new Date(`${value}T12:00:00`).toLocaleDateString(undefined,options);

export function TransactionsLoadingSkeleton(){
  return <section className="f-transactions" aria-labelledby="transactions-loading-title" aria-busy="true"><div><h2 id="transactions-loading-title" className="text-3xl font-bold">Transactions</h2><p className="f-help">Loading your transaction history…</p></div><div className="f-transaction-controls f-transaction-skeleton-toolbar" aria-hidden="true"><span/><span/><span/></div><div className="f-transaction-list" aria-hidden="true">{Array.from({length:7},(_,index)=><div className="f-transaction-skeleton-row" key={index}><span/><span/><span/></div>)}</div><span className="sr-only" role="status">Loading transactions</span></section>;
}

function FilterDialog({open,view,setView,data,onClose,onApply,onClear}){
  const ref=useRef(null),[draft,setDraft]=useState(view),[error,setError]=useState('');
  useEffect(()=>{if(open){setDraft(view);setError('');ref.current?.showModal()}else if(ref.current?.open)ref.current.close()},[open,view]);
  if(!open)return null;
  const month=monthKey();
  const setField=(key,value)=>setDraft(current=>({...current,[key]:value}));
  const custom=draft.period==='custom';
  const invalidRange=custom&&(!isValidFinanceDate(draft.from)||!isValidFinanceDate(draft.to)||draft.from>draft.to);
  function save(){
    if(invalidRange){setError('Choose valid dates. The start date must be on or before the end date.');return}
    try{
      if(draft.minAmount!=='')parseMoney(draft.minAmount,{allowZero:true});
      if(draft.maxAmount!=='')parseMoney(draft.maxAmount,{allowZero:true});
      if(draft.minAmount!==''&&draft.maxAmount!==''&&parseMoney(draft.minAmount,{allowZero:true})>parseMoney(draft.maxAmount,{allowZero:true}))throw new Error('Minimum amount must be less than or equal to the maximum.');
      onApply(draft);
    }catch(caught){setError(caught.message)}
  }
  const sources=[...new Set(data.transactions.flatMap(item=>[item.paidFromFundId,item.paymentMethod]).filter(Boolean))];
  const sourceLabel=value=>{const goal=(data.goals||[]).find(item=>`goal:${item.id}`===value);if(goal)return `${goal.title} fund`;if(String(value).startsWith('investment:'))return 'Investment fund';if(String(value).startsWith('savings:'))return 'Savings';return value};
  return <dialog ref={ref} className="f-dialog f-filter-sheet" aria-labelledby="transaction-filters-title" onCancel={event=>{event.preventDefault();onClose()}} onClose={onClose}>
    <div className="f-between"><div><h2 id="transaction-filters-title">Date and filters</h2><p className="f-help">Choose which transactions to show.</p></div><button type="button" className="f-icon" aria-label="Close filters" onClick={onClose}><X size={18}/></button></div>
    <div className="f-form f-filter-sheet-fields">
      <label>Date period<select className="f-input" value={draft.period} onChange={event=>{const period=event.target.value;setDraft(current=>period==='custom'?{...current,period,from:`${month}-01`,to:`${month}-${String(new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate()).padStart(2,'0')}`}: {...current,period,month})}}><option value="this-month">This month</option><option value="previous-month">Previous month</option><option value="year">This year</option><option value="all">All time</option><option value="custom">Custom range</option>{draft.period==='month'&&<option value="month">{dateText(`${draft.month}-15`,{month:'long',year:'numeric'})}</option>}</select></label>
      {custom&&<div className="f-row"><label>From<input className="f-input" type="date" value={draft.from} onChange={event=>setField('from',event.target.value)}/></label><label>To<input className="f-input" type="date" value={draft.to} onChange={event=>setField('to',event.target.value)}/></label></div>}
      {invalidRange&&<p className="f-alert" role="alert">Choose valid dates. The start date must be on or before the end date.</p>}
      <label>Transaction type<select className="f-input" value={draft.type} onChange={event=>setField('type',event.target.value)}><option value="all">All types</option>{typeOptions.map(type=><option key={type} value={type}>{typeLabels[type]}</option>)}</select></label>
      <label>Category<select className="f-input" value={draft.category} onChange={event=>setField('category',event.target.value)}><option value="all">All categories</option><option value="uncategorized">Uncategorized</option>{data.categories.map(item=><option key={item.id} value={item.id}>{item.name}{item.archived?' (archived)':''}</option>)}</select></label>
      <label>Payment source<select className="f-input" value={draft.source} onChange={event=>setField('source',event.target.value)}><option value="all">All sources</option>{sources.map(value=><option key={value} value={value}>{sourceLabel(value)}</option>)}</select></label>
      <label>Linked record<select className="f-input" value={draft.linkedType} onChange={event=>setField('linkedType',event.target.value)}><option value="all">All records</option><option value="debt">Debt</option><option value="donation">Donation</option><option value="credit">Credit purchase</option><option value="fund">Fund or investment</option></select></label>
      <div className="f-row"><label>Minimum amount<input className="f-input" inputMode="decimal" placeholder="No minimum" value={draft.minAmount} onChange={event=>setField('minAmount',event.target.value)}/></label><label>Maximum amount<input className="f-input" inputMode="decimal" placeholder="No maximum" value={draft.maxAmount} onChange={event=>setField('maxAmount',event.target.value)}/></label></div>
      <label>Reversed transactions<select className="f-input" value={draft.reversed} onChange={event=>setField('reversed',event.target.value)}><option value="active">Hide reversed</option><option value="all">Show all</option><option value="reversed">Reversed only</option></select></label>
      {error&&<p role="alert" className="f-alert">{error}</p>}
      <div className="f-actions"><button type="button" className="f-primary" disabled={invalidRange} onClick={save}>Apply filters</button><button type="button" className="f-button" onClick={onClear}>Clear all</button></div>
    </div>
  </dialog>;
}

export function Transactions({data,view,setView,onOpenTransaction,searchRef,children}){
  const [filtersOpen,setFiltersOpen]=useState(false),[visibleCount,setVisibleCount]=useState(100);
  const currentMonth=monthKey();
  const dateRange=transactionViewDateRange(view,currentMonth);
  const categoryMap=useMemo(()=>new Map(data.categories.map(item=>[item.id,item.name])),[data.categories]);
  const donationMap=useMemo(()=>new Map((data.donationCategories||[]).map(item=>[item.id,item.name])),[data.donationCategories]);
  const debtMap=useMemo(()=>new Map((data.debts||[]).map(item=>[item.id,item.name])),[data.debts]);
  const creditMap=useMemo(()=>new Map((data.creditAgreements||[]).map(item=>[item.id,item.title||item.name])),[data.creditAgreements]);
  const goalMap=useMemo(()=>new Map((data.goals||[]).map(item=>[item.id,item.title])),[data.goals]);
  const investmentMap=useMemo(()=>new Map((data.investments||[]).map(item=>[item.id,item.name])),[data.investments]);
  const fundLabel=value=>{if(!value)return 'Spendable money';const [kind,id]=String(value).split(':',2);if(kind==='goal')return `${goalMap.get(id)||'Fund'} goal`;if(kind==='investment')return investmentMap.get(id)||'Investment fund';if(kind==='savings')return 'Savings';return value};
  const sourceContext=view.source==='all'?null:data.transactions.find(item=>item.paidFromFundId===view.source)?fundLabel(view.source):view.source;
  const linkedNamesById=useMemo(()=>Object.fromEntries(data.transactions.map(item=>[item.id,[debtMap.get(item.debtId||item.targetId),creditMap.get(item.creditAgreementId),goalMap.get(item.goalId||item.targetId),investmentMap.get(item.targetId)].filter(Boolean)])),[data.transactions,debtMap,creditMap,goalMap,investmentMap]);
  const minAmount=useMemo(()=>{try{return view.minAmount===''?'':parseMoney(view.minAmount,{allowZero:true})}catch{return ''}},[view.minAmount]);
  const maxAmount=useMemo(()=>{try{return view.maxAmount===''?'':parseMoney(view.maxAmount,{allowZero:true})}catch{return ''}},[view.maxAmount]);
  const rows=useMemo(()=>{
    const filtered=filterTransactions(data.transactions,{...dateRange,query:view.query,type:view.type,category:view.category,source:view.source,linkedType:view.linkedType,minAmount,maxAmount,reversed:view.reversed,categories:data.categories,donationCategories:data.donationCategories,linkedNamesById});
    if(view.sort==='oldest')return orderedTransactions(filtered,false);
    if(view.sort==='highest')return [...filtered].sort((a,b)=>b.amount-a.amount||b.date.localeCompare(a.date));
    if(view.sort==='lowest')return [...filtered].sort((a,b)=>a.amount-b.amount||b.date.localeCompare(a.date));
    return filtered;
  },[data.transactions,data.categories,data.donationCategories,dateRange,view.query,view.type,view.category,view.source,view.linkedType,view.reversed,view.sort,minAmount,maxAmount,linkedNamesById]);
  useEffect(()=>setVisibleCount(100),[view.query,view.type,view.category,view.source,view.linkedType,view.period,view.from,view.to,view.sort,view.reversed,view.minAmount,view.maxAmount]);
  const visible=rows.slice(0,visibleCount);
  const summary=summarizeTransactions(rows,data);
  const rangeTitle=view.period==='all'?'All time':view.period==='year'?`${view.month.slice(0,4)}`:view.period==='custom'?`${dateText(view.from,{day:'numeric',month:'short',year:'numeric'})} – ${dateText(view.to,{day:'numeric',month:'short',year:'numeric'})}`:view.period==='previous-month'?dateText(dateRange.from,{month:'long',year:'numeric'}):view.period==='month'?dateText(`${view.month}-15`,{month:'long',year:'numeric'}):dateText(`${currentMonth}-15`,{month:'long',year:'numeric'});
  const filterCount=activeTransactionFilterCount(view);
  const activeContext=[view.period==='all'?'All time':rangeTitle,view.category!=='all'?(view.category==='uncategorized'?'Uncategorized':categoryMap.get(view.category)):null,view.type!=='all'?typeLabels[view.type]:null,sourceContext,view.linkedType!=='all'?({debt:'Debt',donation:'Donation',credit:'Credit purchase',fund:'Funds and investments'}[view.linkedType]):null].filter(Boolean).join(' · ');
  const update=(patch)=>setView(current=>({...current,...patch}));
  const clearAll=()=>{const next={period:'this-month',month:currentMonth,from:'',to:'',query:'',type:'all',category:'all',source:'all',linkedType:'all',minAmount:'',maxAmount:'',reversed:'active',sort:'newest'};setView(next);setFiltersOpen(false)};
  const setPeriod=period=>{if(period==='custom'){update({period,from:dateRangeForThisMonth(currentMonth).from,to:dateRangeForThisMonth(currentMonth).to});return}if(period==='month'){update({period,month:view.month,from:'',to:''});return}update({period,month:currentMonth,from:'',to:''})};
  const periodControl=<select className="f-input f-transaction-period-control" aria-label="Transaction date period" value={view.period} onChange={event=>setPeriod(event.target.value)}><option value="this-month">This month</option><option value="previous-month">Previous month</option><option value="year">This year</option><option value="all">All time</option><option value="custom">Custom range</option>{view.period==='month'&&<option value="month">{dateText(`${view.month}-15`,{month:'long',year:'numeric'})}</option>}</select>;
  function applyFilters(next){setView(next);setFiltersOpen(false)}
  const fromLabel=`${view.from||dateRange.from} through ${view.to||dateRange.to}`;
  const desktopCustom=view.period==='custom'&&<div className="f-transaction-custom-date"><label>From<input aria-label="From date" type="date" value={view.from} onChange={event=>update({from:event.target.value})}/></label><label>To<input aria-label="To date" type="date" value={view.to} onChange={event=>update({to:event.target.value})}/></label>{(!isValidFinanceDate(view.from)||!isValidFinanceDate(view.to)||view.from>view.to)&&<span className="f-transaction-date-error" role="alert">Choose valid dates; From must be on or before To.</span>}</div>;
  const mobilePeriodLabel=view.period==='all'?'All time':view.period==='year'?`Year ${view.month.slice(0,4)}`:view.period==='custom'?`${dateText(view.from,{day:'numeric',month:'short'})} – ${dateText(view.to,{day:'numeric',month:'short'})}`:rangeTitle;
  const searchMatches=view.query?rows.length:0;
  const anyFilters=filterCount>0||view.period!=='this-month';
  return <section className="f-transactions" aria-labelledby="transactions-title">
    <div className="f-between"><div><h2 id="transactions-title" className="text-3xl font-bold">Transactions</h2><p className="f-help">Find and understand money in and out.</p></div></div>
    <div className="f-transaction-controls">
      <label className="f-transaction-search"><Search size={18} aria-hidden="true"/><span className="sr-only">Search transactions</span><input ref={searchRef} className="f-input" placeholder="Search transactions" value={view.query} onChange={event=>update({query:event.target.value})}/>{view.query&&<button type="button" className="f-icon" aria-label="Clear search" onClick={()=>update({query:''})}><X size={16}/></button>}</label>
      <div className="f-transaction-date-desktop">{periodControl}{desktopCustom}</div>
      <button type="button" className="f-button f-transaction-date-mobile" aria-label={`Date period: ${mobilePeriodLabel}`} onClick={()=>setFiltersOpen(true)}>{mobilePeriodLabel}</button>
      <label className="f-transaction-desktop-filter">Type<select className="f-input" value={view.type} onChange={event=>update({type:event.target.value})}><option value="all">All types</option>{typeOptions.map(type=><option value={type} key={type}>{typeLabels[type]}</option>)}</select></label>
      <label className="f-transaction-desktop-filter f-transaction-category">Category<select className="f-input" value={view.category} onChange={event=>update({category:event.target.value})}><option value="all">All categories</option><option value="uncategorized">Uncategorized</option>{data.categories.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="f-transaction-sort">Sort<select className="f-input" value={view.sort} onChange={event=>update({sort:event.target.value})}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="highest">Highest amount</option><option value="lowest">Lowest amount</option></select></label>
      <button type="button" className="f-button f-transaction-filter-button" onClick={()=>setFiltersOpen(true)}><Filter size={16} aria-hidden="true"/>{filterCount>0?`Filters · ${filterCount}`:'Filter'}</button>
    </div>
    {anyFilters&&<div className="f-transaction-filter-summary"><span>{activeContext}{view.query?`${activeContext?' · ':''}Search “${view.query}”`:''}{filterCount?` · ${filterCount} filter${filterCount===1?'':'s'}`:''}</span><button type="button" className="f-link-button" onClick={clearAll}>Clear all</button></div>}
    <div className="f-transaction-summary" aria-label={`${rangeTitle} transaction summary`}><strong>{rangeTitle}</strong><span><small>Income</small><b className="f-positive">+{currencyLabel(summary.income,data.settings.currency)}</b></span><span><small>Spent</small><b className="f-negative">-{currencyLabel(summary.spent,data.settings.currency)}</b></span><span><small>Net</small><b className={summary.net>=0?'f-positive':'f-negative'}>{summary.net>=0?'+':'-'}{currencyLabel(Math.abs(summary.net),data.settings.currency)}</b></span><small className="f-transaction-count">{rows.length} transaction{rows.length===1?'':'s'}</small></div>
    {rows.length?<><div className="f-transaction-list" aria-label="Transactions">{visible.map(transaction=>{const amount=getTransactionAmountPresentation(transaction),context=getTransactionLinkedContext(transaction,data);const title=transaction.type==='transfer'?`${fundLabel(transaction.fromFundId)} → ${fundLabel(transaction.toFundId)}`:transaction.title||getTransactionDisplayType(transaction,data);const category=transaction.donationCategoryId?data.donationCategories?.find(item=>item.id===transaction.donationCategoryId)?.name:categoryMap.get(transaction.categoryId);const bank=transaction.source==='bank'||transaction.sourceType==='bank_import';return <button type="button" className={`f-transaction-row ${transaction.type==='transfer'?'is-transfer':''}`} key={transaction.id} onClick={()=>onOpenTransaction(transaction)} aria-label={`${title}, ${getTransactionDisplayType(transaction,data)}, ${currencyLabel(transaction.amount,data.settings.currency)}, ${dateText(transaction.date)}`}><span className="f-transaction-copy"><span className="f-transaction-heading"><MerchantLogo transaction={transaction} merchants={data.merchantProfiles}/><strong>{title}</strong></span><span className="f-transaction-meta">{context?.label||category||getTransactionDisplayType(transaction,data)}{transaction.paidFromFundId?` · Paid from ${fundLabel(transaction.paidFromFundId)}`:''}</span><span className="f-transaction-meta">{dateText(transaction.date,{day:'numeric',month:'short'})}{transaction.reversedAt?' · Reversed':''}{bank?' · Bank synced':''}{transaction.receipt?' · Receipt attached':''}</span></span><span className={`f-transaction-amount ${amount.tone==='positive'?'f-positive':amount.tone==='negative'?'f-negative':'f-neutral'}`}><strong>{amount.prefix}{currencyLabel(transaction.amount,data.settings.currency)}</strong><small>{transactionSubLabel(transaction,data)}</small></span></button>})}</div>{visibleCount<rows.length&&<button type="button" className="f-button f-transaction-show-more" onClick={()=>setVisibleCount(count=>Math.min(count+100,rows.length))}>Show 100 more ({rows.length-visibleCount} remaining)</button>}</>:<div className="f-empty f-transaction-empty" role="status">{data.transactions.length===0?<><strong>No transactions yet.</strong><p>Record income, expenses and money movements here.</p></>:view.query&&searchMatches===0?<><strong>No transactions match “{view.query}”.</strong><button type="button" className="f-link-button" onClick={()=>update({query:''})}>Clear search</button></>:<><strong>No transactions match these filters.</strong><button type="button" className="f-link-button" onClick={clearAll}>Clear filters</button></>}</div>}
    <FilterDialog open={filtersOpen} view={view} setView={setView} data={data} onClose={()=>setFiltersOpen(false)} onApply={applyFilters} onClear={clearAll}/>
    {children}
  </section>;
}

function dateRangeForThisMonth(month){return {from:`${month}-01`,to:`${month}-${String(new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate()).padStart(2,'0')}`}}
