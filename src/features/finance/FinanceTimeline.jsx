import { useEffect, useMemo, useRef, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { budgetTarget, formatMoney, moneyInput, monthKey, shiftMonth } from './financeMath.js';
import { parseOpeningBalance } from './financeChartData.js';
import { balanceViewValue, calculateFinanceBalances } from './financeBalances.js';
import { MerchantLogo } from './MerchantLogo.jsx';
import { debtAccrualSettlementStatus, debtRemainingAmount } from './debtAccounting.js';

const markerTypes = ['income', 'expense', 'savings', 'goal', 'investment', 'donation', 'budget', 'debt', 'transfer'];
const markerLabels = { income:'Income', expense:'Spending', savings:'Savings', goal:'Goals', investment:'Investments', donation:'Donations', budget:'Budget pots', debt:'Repayments', transfer:'Transfers' };
const progressLabels = { savings:'Savings', goals:'Goals', investments:'Investments', donations:'Donations', budgets:'Budgets', debts:'Repayments' };
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function MerchantMark({ transaction, showLogos, merchants=[], compact = false }) {
  return <MerchantLogo transaction={transaction} merchants={merchants} showLogos={showLogos} className={`f-merchant-mark${compact?' f-merchant-mark-small':''}`}/>;
}

function TimelineDot({ cx, cy, payload, visibleTypes, showLogos, merchants, selectTransaction }) {
  const transaction = payload?.transaction;
  if (!transaction || !visibleTypes.has(transaction.type)) return null;
  return <foreignObject x={cx-17} y={cy-17} width="34" height="34" className="f-chart-dot"><button type="button" className="f-chart-dot-button" title={`Select ${transaction.title}`} aria-label={`Select ${transaction.title}`} onClick={(event)=>{event.stopPropagation();selectTransaction(transaction)}}><MerchantMark transaction={transaction} showLogos={showLogos} merchants={merchants}/></button></foreignObject>;
}

function TimelineTooltip({ active, payload, currency, showLogos, merchants }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const balanceDetails=<><div className="f-between"><span>Spendable</span><strong>{formatMoney(point.availableCash,currency)}</strong></div><div className="f-between"><span>Protected / reserved</span><strong>{formatMoney(point.reservedTotal,currency)}</strong></div><div className="f-between"><span>Total owned</span><strong>{formatMoney(point.overallOwned,currency)}</strong></div></>;
  if (!point.transaction && point.eventKind==='snapshot') return <div className="f-chart-tooltip"><strong>Current goal reserve snapshot</strong><span>{point.date}</span>{balanceDetails}</div>;
  if (!point.transaction) return <div className="f-chart-tooltip"><strong>Opening balance</strong><span>{formatMoney(point.balance,currency)}</span>{balanceDetails}</div>;
  const transaction = point.transaction;
  const sign = point.change > 0 ? '+' : point.change < 0 ? '−' : '';
  const isReservation=point.eventKind==='reserve';
  const isRelease=point.eventKind==='release';
  return <div className="f-chart-tooltip">
    <div className="f-chart-tooltip-title"><MerchantMark transaction={transaction} showLogos={showLogos} merchants={merchants} compact/><div><strong>{transaction.title}</strong><span>{markerLabels[transaction.type] || transaction.type} · {point.date}</span></div></div>
    <div className="f-between"><span>{isReservation?'Reserved':isRelease?'Reserve released':'Cash movement'}</span><strong className={!isReservation&&!isRelease&&transaction.type==='income'?'f-positive':''}>{isReservation||isRelease?formatMoney(transaction.amount,currency):`${sign}${formatMoney(Math.abs(point.change),currency)}`}</strong></div>
    {balanceDetails}
  </div>;
}

function TargetCard({ item, currency }) {
  const percent = item.target > 0 ? Math.min(10000, Math.round(item.value * 10000 / item.target)) : null;
  return <article className="f-target-card">
    <div className="f-between"><div><span className="f-tag">{progressLabels[item.group]}</span><h4>{item.title}</h4></div>{percent!=null&&<strong>{(percent/100).toFixed(0)}%</strong>}</div>
    <p><strong>{formatMoney(item.value,currency)}</strong>{item.target>0&&<> of {formatMoney(item.target,currency)}</>}</p>
    {percent!=null&&<div className="f-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(percent/100)}><span style={{width:`${percent/100}%`}} /></div>}
    <small>{item.caption}</small>
  </article>;
}

function buildTargetCards(data, month) {
  const currency = data.settings.currency;
  const transactions = data.transactions.filter(item => !item.source || item.providerStatus === 'BOOK');
  const monthly = transactions.filter((item) => (month===null || item.date.startsWith(month)));
  const cards = [];
  const saved = transactions.filter((item)=>item.type==='savings').reduce((sum,item)=>sum+item.amount,0);
  cards.push({group:'savings',title:'Total savings moved',value:saved,target:0,caption:'All recorded savings allocations.'});
  for (const goal of data.goals) cards.push({group:'goals',title:goal.title,value:goal.saved,target:goal.target,caption:goal.status==='completed'?'Target reached.':`${formatMoney(Math.max(0,goal.target-goal.saved),currency)} left.`});
  for (const investment of data.investments) cards.push({group:'investments',title:investment.name,value:investment.currentValue,target:investment.target||0,caption:`${formatMoney(investment.contributed,currency)} contributed · ${formatMoney(investment.currentValue-investment.contributed,currency)} gain/loss.`});
  const donationCategories = new Set(data.categories.filter((item)=>item.type==='donation').map((item)=>item.id));
  const scopedBudgets = (month===null?Object.keys(data.budgets):[month]).flatMap(key=>{
    const monthIncome=transactions.filter(item=>item.type==='income'&&item.date.startsWith(key)).reduce((sum,item)=>sum+item.amount,0);
    return (data.budgets[key]||[]).map(item=>({...item,month:key,target:budgetTarget(item,monthIncome||data.settings.monthlyIncome)}));
  });
  const donationTargets = scopedBudgets.filter((item)=>donationCategories.has(item.categoryId)).reduce((sum,item)=>sum+item.target,0);
  const donated = monthly.filter((item)=>item.type==='donation').reduce((sum,item)=>sum+item.amount,0);
  cards.push({group:'donations',title:month===null?'Giving across all time':'Giving this month',value:donated,target:donationTargets,caption:donationTargets?(month===null?'Against all monthly giving targets.':'Against your monthly giving target.'):'Add a donation target in Monthly Budget.'});
  const expenseCategories = new Set(data.categories.filter((item)=>item.type==='expense').map((item)=>item.id));
  for (const budget of scopedBudgets.filter((item)=>expenseCategories.has(item.categoryId))) {
    const category = data.categories.find((item)=>item.id===budget.categoryId);
    const actual = monthly.filter((item)=>item.type==='expense'&&item.categoryId===budget.categoryId&&item.date.startsWith(budget.month)).reduce((sum,item)=>sum+item.amount,0);
    cards.push({group:'budgets',title:(category?.name||'Deleted category')+(month===null?' · '+budget.month:''),value:actual,target:budget.target,caption:'Spent against the monthly budget.'});
  }
  for (const debt of data.debts) {const remaining=debtRemainingAmount(data,debt.id);cards.push({group:'debts',title:debt.name,value:Math.max(0,debt.original-remaining),target:debt.original,caption:`${formatMoney(remaining,currency)} left to pay.`});}
  return cards;
}

export function FinanceTimeline({ data, month, setMonth, change, transactionScope, setTransactionScope, openTransaction, deleteTransaction, markUnpaid, canMarkUnpaid, markDebtUnpaid, canMarkDebtUnpaid }) {
  const merchants=data.merchantProfiles||[];
  const allTime = transactionScope === 'all';
  const transactions = useMemo(() => data.transactions.filter(item => !item.reversedAt && (!item.source || item.providerStatus === 'BOOK')), [data.transactions]);
  const rangeMonth = allTime ? null : month;
  const activity = useMemo(() => {
    const categories = new Map((data.donationCategories || []).map(item => [item.id, item.name]));
    const activityTransactions = data.transactions.filter(item => !item.source || item.providerStatus === 'BOOK');
    const transactionEvents = activityTransactions.filter(item => !item.reversedAt && item.allocationStatus !== 'allocated' && item.type !== 'goal' && (allTime || item.date?.startsWith(month))).map(item => {
      const donation = item.type === 'donation' || item.financeGroup === 'donation' || data.categories.some(category => category.id === item.categoryId && category.type === 'donation');
      return { id: `tx-${item.id}`, date: item.date, title: donation ? `${categories.get(item.donationCategoryId) || 'Donation'} paid${item.reversedAt?' · undone':''}` : item.title || markerLabels[item.type] || item.type, kind: item.reversedAt?'UNDONE':donation ? 'PAID' : markerLabels[item.type] || item.type, amount: item.type === 'income' ? item.amount : ['transfer','savings','budget','goal'].includes(item.type) ? 0 : -item.amount, type: 'transaction' };
    });
    const reversalEvents = (data.donationReversals || []).filter(item => allTime || item.date?.startsWith(month)).map(item => ({ id: `reversal-${item.id}`, date: item.date, title: `${categories.get(item.categoryId) || 'Donation'} payment undone${item.linkedReservationId?' · returned to reserve':' · returned to Due'}`, kind: 'UNDO', amount: item.amount, type: 'reversal' }));
    const accrualEvents = (data.donationAccruals || []).filter(item => allTime || item.effectiveDate?.startsWith(month)).map(item => ({ id: `due-${item.id}`, date: item.effectiveDate, title: `${categories.get(item.categoryId) || 'Donation'} ${item.status === 'reversed' ? 'due reversed' : 'added to due'}`, kind: 'DUE', amount: item.status === 'reversed' ? -item.amount : item.amount, type: 'due' }));
    const goalEvents = (data.goalContributions || []).filter(item => allTime || item.date?.startsWith(month)).map(item => ({ id: `goal-${item.id}`, date: item.date, title: `${data.goals.find(goal => goal.id === item.goalId)?.title || 'Goal'} ${item.kind === 'spending' ? 'spending' : 'allocated'}`, kind: 'GOAL', amount: 0, type: 'goal' }));
    const debtAccrualEvents = (data.debtAccruals || []).filter(item => allTime || item.effectiveDate?.startsWith(month)).map(item => ({ id: `debt-due-${item.id}`, date: item.effectiveDate, title: `${data.debts.find(debt => debt.id === item.debtId)?.name || 'Debt'} ${item.status === 'reversed' ? 'payment due reversed' : 'added to payment due'}${debtAccrualSettlementStatus(item) === 'settled' ? ' - settled' : debtAccrualSettlementStatus(item) === 'partially_settled' ? ' - partially settled' : debtRemainingAmount(data, item.debtId) === 0 && Number(item.accruedAmount ?? item.amount) > Number(item.paidAmount || 0) ? ' - debt settled; due no longer payable' : ''}`, kind: item.status === 'reversed' ? 'DUE REVERSED' : 'DUE', amount: item.status === 'reversed' ? -Number(item.accruedAmount ?? item.amount) : Number(item.accruedAmount ?? item.amount), type: 'debt-due' }));
    const debtReversalEvents = (data.debtPayments || []).filter(item => item.reversedAt && (allTime || item.reversalDate?.startsWith(month))).map(item => ({ id: `debt-undo-${item.id}`, date: item.reversalDate, title: `${data.debts.find(debt => debt.id === item.debtId)?.name || 'Debt'} payment marked unpaid · returned to due`, kind: 'UNDO', amount: Number(item.amount || 0), type: 'debt-reversal' }));
    return [...transactionEvents, ...reversalEvents, ...accrualEvents, ...goalEvents, ...debtAccrualEvents, ...debtReversalEvents].filter(item => item.date).sort((a,b) => String(b.date).localeCompare(String(a.date)) || a.id.localeCompare(b.id));
  }, [data.transactions, data.donationReversals, data.donationCategories, data.donationAccruals, data.goalContributions, data.goals, data.categories, data.debtAccruals, data.debtPayments, data.debts, allTime, month]);
  const openingMonth = transactions.map(item=>item.date.slice(0,7)).sort()[0] || month;
  const currency = data.settings.currency;
  const [showLogos,setShowLogos] = useState(true);
  const [selectedTransactionId,setSelectedTransactionId] = useState(null);
  const [visibleTypes,setVisibleTypes] = useState(()=>new Set(markerTypes));
  const [visibleProgress,setVisibleProgress] = useState(()=>new Set(Object.keys(progressLabels)));
  const [balanceView,setBalanceView] = useState('available');
  const savedOpening = data.openingBalances?.[openingMonth] || 0;
  const [opening,setOpening] = useState(moneyInput(savedOpening));
  const [openingError,setOpeningError] = useState('');
  const chartViewport = useRef(null);
  const drag = useRef(null);
  const pinch = useRef(null);
  const wheelHandler = useRef(null);
  useEffect(()=>setOpening(moneyInput(savedOpening)),[openingMonth,savedOpening]);
  const balanceState = useMemo(()=>({...data,transactions}),[data,transactions]);
  const balances = useMemo(()=>calculateFinanceBalances(balanceState,{month:rangeMonth,openingBalance:savedOpening}),[balanceState,rangeMonth,savedOpening]);
  const timeline = useMemo(()=>balances.timeline.map(point=>({...point,balance:balanceViewValue(point,balanceView)})),[balances,balanceView]);
  const selectedTransaction=transactions.find(item=>item.id===selectedTransactionId)||null;
  useEffect(()=>{if(selectedTransactionId&&!selectedTransaction)setSelectedTransactionId(null)},[selectedTransactionId,selectedTransaction]);
  const fullViewport = useMemo(()=>{
    const balances=timeline.map((point)=>point.balance);
    const minimum=Math.min(0,...balances);
    const maximum=Math.max(0,...balances);
    const range=Math.max(1000,maximum-minimum);
    const padding=Math.max(1000,range*.16);
    return {x0:-.35,x1:Math.max(.65,timeline.length-.65),y0:minimum-padding,y1:maximum+padding};
  },[timeline]);
  const [viewport,setViewport] = useState(fullViewport);
  const [dragging,setDragging] = useState(false);
  useEffect(()=>setViewport(fullViewport),[rangeMonth,fullViewport.x0,fullViewport.x1,fullViewport.y0,fullViewport.y1]);
  const targets = useMemo(()=>buildTargetCards(data,rangeMonth),[data,rangeMonth]);
  const endBalance = balanceViewValue(balances,balanceView);
  const fullXSpan=fullViewport.x1-fullViewport.x0;
  const fullYSpan=fullViewport.y1-fullViewport.y0;
  const chartZoom=Math.round(fullXSpan/(viewport.x1-viewport.x0)*100);
  const toggle=(setter,current,key)=>setter(()=>{const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next});
  function chartRatios(clientX,clientY) {
    const bounds=chartViewport.current?.getBoundingClientRect();
    if(!bounds)return {x:.5,y:.5};
    return {x:clamp((clientX-bounds.left)/bounds.width,0,1),y:clamp(1-(clientY-bounds.top)/bounds.height,0,1)};
  }
  function zoomChart(factor,clientX,clientY) {
    const ratios=clientX==null?{x:.5,y:.5}:chartRatios(clientX,clientY);
    setViewport((current)=>{
      const oldX=current.x1-current.x0;
      const oldY=current.y1-current.y0;
      const nextX=clamp(oldX*factor,fullXSpan/5,fullXSpan*4);
      const nextY=clamp(oldY*factor,fullYSpan/5,fullYSpan*4);
      const anchorX=current.x0+ratios.x*oldX;
      const anchorY=current.y0+ratios.y*oldY;
      return {x0:anchorX-ratios.x*nextX,x1:anchorX+(1-ratios.x)*nextX,y0:anchorY-ratios.y*nextY,y1:anchorY+(1-ratios.y)*nextY};
    });
  }
  function panFrom(origin,clientX,clientY,horizontalOnly=false) {
    const bounds=chartViewport.current?.getBoundingClientRect();
    if(!bounds)return;
    const xSpan=origin.viewport.x1-origin.viewport.x0;
    const ySpan=origin.viewport.y1-origin.viewport.y0;
    const xMove=-(clientX-origin.x)/Math.max(1,bounds.width)*xSpan;
    const yMove=horizontalOnly?0:(clientY-origin.y)/Math.max(1,bounds.height)*ySpan;
    setViewport({x0:origin.viewport.x0+xMove,x1:origin.viewport.x1+xMove,y0:origin.viewport.y0+yMove,y1:origin.viewport.y1+yMove});
  }
  function scaleFrom(origin,clientY) {
    const bounds=chartViewport.current?.getBoundingClientRect();
    if(!bounds)return;
    const oldY=origin.viewport.y1-origin.viewport.y0;
    const nextY=clamp(oldY*Math.exp((clientY-origin.y)*2/Math.max(1,bounds.height)),fullYSpan/5,fullYSpan*4);
    const anchorY=origin.viewport.y0+origin.yRatio*oldY;
    setViewport({...origin.viewport,y0:anchorY-origin.yRatio*nextY,y1:anchorY+(1-origin.yRatio)*nextY});
  }
  function touchDistance(touches) {
    const x = touches[0].clientX - touches[1].clientX;
    const y = touches[0].clientY - touches[1].clientY;
    return Math.hypot(x,y);
  }
  function startPinch(event) {
    if(event.touches.length===1)pinch.current={mode:'pan',x:event.touches[0].clientX,y:event.touches[0].clientY,viewport};
    else if(event.touches.length===2)pinch.current={mode:'pinch',distance:touchDistance(event.touches)};
  }
  function movePinch(event) {
    if(!pinch.current)return;
    if(event.touches.length===2){
      event.preventDefault();
      const distance=touchDistance(event.touches);
      const centerX=(event.touches[0].clientX+event.touches[1].clientX)/2;
      const centerY=(event.touches[0].clientY+event.touches[1].clientY)/2;
      zoomChart(pinch.current.distance/distance,centerX,centerY);
      pinch.current={mode:'pinch',distance};
    }else if(event.touches.length===1&&pinch.current.mode==='pan'){
      const touch=event.touches[0];
      const dx=touch.clientX-pinch.current.x;
      const dy=touch.clientY-pinch.current.y;
      if(Math.abs(dx)>Math.abs(dy)){event.preventDefault();panFrom(pinch.current,touch.clientX,touch.clientY,true)}
    }
  }
  wheelHandler.current=(event)=>{
    const scalingAxis=event.target.closest('.recharts-yAxis');
    if(!scalingAxis&&!(event.ctrlKey||event.metaKey))return;
    event.preventDefault();
    if(scalingAxis){
      const factor=event.deltaY<0?.9:1.1;
      setViewport((current)=>{
        const oldY=current.y1-current.y0;
        const nextY=clamp(oldY*factor,fullYSpan/5,fullYSpan*4);
        const ratio=chartRatios(event.clientX,event.clientY).y;
        const anchorY=current.y0+ratio*oldY;
        return {...current,y0:anchorY-ratio*nextY,y1:anchorY+(1-ratio)*nextY};
      });
    }else zoomChart(event.deltaY<0?.86:1.16,event.clientX,event.clientY);
  };
  useEffect(()=>{
    const element=chartViewport.current;
    if(!element)return undefined;
    const handleWheel=(event)=>wheelHandler.current?.(event);
    element.addEventListener('wheel',handleWheel,{passive:false});
    return ()=>element.removeEventListener('wheel',handleWheel);
  },[timeline.length]);
  async function saveOpening(event){event.preventDefault();try{const amount=parseOpeningBalance(opening);await change(state=>{state.openingBalances||={};state.openingBalances[openingMonth]=amount;return state},'Opening balance saved');setOpeningError('')}catch(error){setOpeningError(error.message)}}
  return <div className="f-timeline-page">
    <div className="f-tabs f-scope-picker" role="group" aria-label="Timeline date range"><button type="button" className={!allTime?'is-active':''} aria-pressed={!allTime} onClick={()=>setTransactionScope('month')}>By month</button><button type="button" className={allTime?'is-active':''} aria-pressed={allTime} onClick={()=>setTransactionScope('all')}>All time</button></div>
    {!allTime&&<div className="f-between f-timeline-month"><div className="f-actions"><button className="f-button" onClick={()=>setMonth(shiftMonth(month,-1))} aria-label="Previous month">←</button><span className="f-month">{new Date(`${month}-15`).toLocaleDateString([],{month:'long',year:'numeric'})}</span><button className="f-button" onClick={()=>setMonth(shiftMonth(month,1))} aria-label="Next month">→</button></div><button className="f-button" onClick={()=>setMonth(monthKey())}>Current month</button></div>}
    <div className="f-between f-timeline-heading"><div><span className="pill">Money movement</span><h2 className="text-3xl font-bold mt-4">Money Timeline</h2><p className="f-help mt-2">See how your spendable money changes over time.</p></div><div className="f-stat" data-tone={endBalance>=0?'blue':'pink'}><strong>{formatMoney(endBalance,currency)}</strong><span>{balanceView==='available'?'Spendable now':'Total owned'} · {allTime?'all time':'selected month'}</span></div></div>
    <section className="f-card f-timeline-card mt-5">
      <div className="f-timeline-controls"><form className="f-opening-form" onSubmit={saveOpening}><label>Opening balance for {openingMonth}<input inputMode="decimal" value={opening} onChange={(event)=>setOpening(event.target.value)} /></label><button className="f-button">Save</button></form><label className="f-logo-toggle"><input type="checkbox" checked={showLogos} onChange={(event)=>setShowLogos(event.target.checked)}/> Show recognised merchant logos</label></div>
      {allTime&&<p className="f-help">Starts with the opening balance for the earliest transaction month ({openingMonth}), then applies every recorded transaction once. Later monthly opening balances are not added again.</p>}
      {openingError&&<p className="f-alert" role="alert">{openingError}</p>}
      <div className="f-tabs f-scope-picker" role="group" aria-label="Timeline balance"><button type="button" className={balanceView==='available'?'is-active':''} aria-pressed={balanceView==='available'} onClick={()=>setBalanceView('available')}>Spendable</button><button type="button" className={balanceView==='overall'?'is-active':''} aria-pressed={balanceView==='overall'} onClick={()=>setBalanceView('overall')}>Total owned</button></div>
      <details className="f-balance-breakdown"><summary>Current balance breakdown</summary><dl>
        <div><dt>Spendable now</dt><dd>{formatMoney(balances.availableCash,currency)}</dd></div>
        <div><dt>Protected / reserved</dt><dd>{formatMoney(balances.reservedTotal,currency)}</dd></div>
        <div><dt>Total owned</dt><dd>{formatMoney(balances.overallOwned,currency)}</dd></div>
      </dl><p className="f-help">Moving money into your own funds lowers Spendable, but does not lower Total owned. Debt owed is shown separately.</p></details>
      <details className="f-filter-fieldset"><summary>Choose which events to show</summary><div className="f-filter-chips">{markerTypes.map((type)=><label key={type} className="f-filter-chip" data-active={visibleTypes.has(type)}><input type="checkbox" checked={visibleTypes.has(type)} onChange={()=>toggle(setVisibleTypes,visibleTypes,type)}/>{markerLabels[type]}</label>)}</div></details>
      {timeline.length===1?<div className="f-empty mt-5">{allTime?'No transactions recorded yet.':'No transactions in this month yet.'} Your opening balance is ready for the first movement.</div>:<div className="f-chart-shell">
        <div className="f-chart-toolbar">
          <p><strong>Explore timeline</strong><span>Drag to pan · Drag or scroll the right scale to stretch · Ctrl/⌘ + wheel or pinch to zoom</span></p>
          <div className="f-chart-zoom" aria-label="Timeline zoom controls">
            <button type="button" onClick={()=>zoomChart(1.25)} disabled={chartZoom<=25} aria-label="Zoom out">−</button>
            <output aria-live="polite">{chartZoom}%</output>
            <button type="button" onClick={()=>zoomChart(.8)} disabled={chartZoom>=500} aria-label="Zoom in">+</button>
            <button type="button" onClick={()=>setViewport(fullViewport)} disabled={viewport.x0===fullViewport.x0&&viewport.x1===fullViewport.x1&&viewport.y0===fullViewport.y0&&viewport.y1===fullViewport.y1}>Reset</button>
          </div>
        </div>
        <div
          ref={chartViewport}
          className={`f-chart-viewport${dragging?' is-dragging':''}${dragging&&drag.current?.mode==='scale'?' is-scaling':''}`}
          tabIndex="0"
          aria-label="Pannable and zoomable money timeline"
          onPointerDown={(event)=>{if(event.target.closest('.f-chart-dot-button')||event.pointerType==='touch'||event.button!==0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);const bounds=chartViewport.current?.getBoundingClientRect();const axisDrag=Boolean(event.target.closest('.recharts-yAxis'));drag.current={mode:axisDrag?'scale':'pan',x:event.clientX,y:event.clientY,yRatio:bounds?clamp(1-(event.clientY-bounds.top)/bounds.height,0,1):.5,viewport};setDragging(true)}}
          onPointerMove={(event)=>{if(drag.current){if(drag.current.mode==='scale')scaleFrom(drag.current,event.clientY);else panFrom(drag.current,event.clientX,event.clientY)}}}
          onPointerUp={(event)=>{if(drag.current){drag.current=null;setDragging(false);event.currentTarget.releasePointerCapture(event.pointerId)}}}
          onPointerCancel={()=>{drag.current=null;setDragging(false)}}
          onTouchStart={startPinch}
          onTouchMove={movePinch}
          onTouchEnd={(event)=>{if(event.touches.length<2)pinch.current=null}}
        >
        <div className="f-chart-wrap" role="img" aria-label={`Available cash timeline ending at ${formatMoney(endBalance,currency)}`}>
        <ResponsiveContainer width="100%" height="100%"><ComposedChart data={timeline} margin={{top:30,right:28,bottom:12,left:8}}>
          <defs><linearGradient id="financeBalanceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--finance-chart-fill,var(--f-green))" stopOpacity=".24"/><stop offset="100%" stopColor="var(--finance-chart-fill,var(--f-green))" stopOpacity=".03"/></linearGradient></defs>
          <CartesianGrid stroke="var(--finance-chart-grid,#1112)" strokeDasharray="4 5" vertical={false}/>
          <XAxis type="number" dataKey="index" domain={[viewport.x0,viewport.x1]} allowDataOverflow ticks={timeline.map((_,index)=>index)} interval="preserveStartEnd" minTickGap={22} tickFormatter={(index)=>timeline[index]?.date!==timeline[index-1]?.date?(allTime?timeline[index]?.date:timeline[index]?.date?.slice(8,10)):''} tick={{fontSize:12,fontWeight:700,fill:'currentColor'}} axisLine={{stroke:'var(--finance-chart-line,#111)'}} tickLine={false}/>
          <YAxis orientation="right" width={74} domain={[viewport.y0,viewport.y1]} allowDataOverflow tickFormatter={(value)=>new Intl.NumberFormat(undefined,{style:'currency',currency,notation:'compact',maximumFractionDigits:1}).format(value/100)} tick={{fontSize:11,fontWeight:700,fill:'currentColor'}} axisLine={{stroke:'var(--finance-chart-line,#111)'}} tickLine={false}/>
          <ReferenceLine y={0} stroke="var(--finance-chart-line,#111)" strokeDasharray="6 4"/>
          <Tooltip content={<TimelineTooltip currency={currency} showLogos={showLogos} merchants={merchants}/>} cursor={{stroke:'var(--finance-chart-line,#111)',strokeDasharray:'3 3'}}/>
          <Area type="monotoneX" dataKey="balance" stroke="none" fill="url(#financeBalanceFill)" isAnimationActive={false}/>
          <Line type="monotoneX" dataKey="balance" stroke="var(--finance-balance-line,var(--finance-chart-line,#111))" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" dot={<TimelineDot visibleTypes={visibleTypes} showLogos={showLogos} merchants={merchants} selectTransaction={(transaction)=>setSelectedTransactionId(transaction.id)}/>} activeDot={{r:7,fill:'var(--finance-chart-fill,var(--f-green))',stroke:'var(--finance-balance-line,var(--finance-chart-line,#111))',strokeWidth:2}} isAnimationActive={false}/>
        </ComposedChart></ResponsiveContainer>
        </div>
        </div>
      </div>}
      {selectedTransaction&&<article className="f-chart-selected" aria-live="polite"><div className="f-between"><div><span className="f-tag">Selected transaction</span><h3>{selectedTransaction.title}</h3><p className="f-meta">{markerLabels[selectedTransaction.type]||selectedTransaction.type} &middot; {selectedTransaction.date} &middot; {formatMoney(selectedTransaction.amount,currency)}</p></div><button type="button" className="f-button" aria-label="Close selected transaction actions" onClick={()=>setSelectedTransactionId(null)}>Close</button></div><div className="f-actions mt-3"><button type="button" className="f-primary" onClick={()=>openTransaction(selectedTransaction)}>Open record</button>{canMarkUnpaid?.(selectedTransaction)?<button type="button" className="f-button danger-action" onClick={()=>markUnpaid(selectedTransaction)}>Mark as unpaid</button>:canMarkDebtUnpaid?.(selectedTransaction)?<button type="button" className="f-button danger-action" onClick={()=>markDebtUnpaid(selectedTransaction)}>Mark as unpaid</button>:selectedTransaction.source!=='bank'&&selectedTransaction.sourceType!=='bank_import'&&<button type="button" className="f-button danger-action" onClick={()=>deleteTransaction(selectedTransaction)}>Delete</button>}</div></article>}
      <p className="f-help">{allTime?'Transaction dates run along the bottom.':'Day of month runs along the bottom.'} Zoom ranges from 25% to 500%. Saved merchant logos appear when available; unknown or unavailable logos use a letter badge. Transfers use a transfer marker and do not change available cash.</p>
    </section>
    <section className="f-card mt-6" aria-labelledby="finance-activity-heading"><div><h3 id="finance-activity-heading" className="text-2xl font-bold">Finance activity</h3><p className="f-help mt-1">Transactions plus Donation and debt due events. Due events do not change the cash line.</p></div>{activity.length?<div className="f-list mt-4">{activity.map(item=><article className="f-item f-between" key={item.id}><div><span className="f-tag">{item.kind}</span><p className="f-item-title mt-2">{item.title}</p><p className="f-meta">{item.date}</p></div><strong>{item.amount===0?'':`${item.amount>0?'+':'−'}${formatMoney(Math.abs(item.amount),currency)}`}</strong></article>)}</div>:<p className="f-help mt-4">No finance activity in this range.</p>}</section>
    <section className="mt-6" aria-labelledby="target-progress-heading"><div><h3 id="target-progress-heading" className="text-2xl font-bold">Targets and progress</h3><p className="f-help mt-1">Progress is kept separate from the cash line so percentages and money are never mixed.</p></div>
      <details className="f-filter-fieldset"><summary>Choose which targets to show</summary><div className="f-filter-chips">{Object.entries(progressLabels).map(([key,label])=><label key={key} className="f-filter-chip" data-active={visibleProgress.has(key)}><input type="checkbox" checked={visibleProgress.has(key)} onChange={()=>toggle(setVisibleProgress,visibleProgress,key)}/>{label}</label>)}</div></details>
      <div className="f-target-grid">{targets.filter((item)=>visibleProgress.has(item.group)).map((item,index)=><TargetCard key={`${item.group}-${item.title}-${index}`} item={item} currency={currency}/>)}</div>
    </section>
  </div>;
}
