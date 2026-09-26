import { useEffect, useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { budgetTarget, formatMoney, moneyInput, monthKey, shiftMonth } from './financeMath.js';
import { buildCashTimeline, merchantLogoUrl, parseOpeningBalance } from './financeChartData.js';

const markerTypes = ['income', 'expense', 'savings', 'goal', 'investment', 'donation', 'budget', 'debt'];
const markerLabels = { income:'Income', expense:'Spending', savings:'Savings', goal:'Goals', investment:'Investments', donation:'Donations', budget:'Budget pots', debt:'Repayments' };
const markerSymbols = { income:'↑', expense:'−', savings:'S', goal:'★', investment:'↗', donation:'+', budget:'B', debt:'✓', transfer:'↔' };
const progressLabels = { savings:'Savings', goals:'Goals', investments:'Investments', donations:'Donations', budgets:'Budgets', debts:'Repayments' };

function MerchantMark({ transaction, showLogos, compact = false }) {
  const [failed, setFailed] = useState(false);
  const logo = showLogos && !failed ? merchantLogoUrl(transaction?.title) : '';
  return <span className={`f-merchant-mark${compact?' f-merchant-mark-small':''}`} data-type={transaction?.type || 'opening'} aria-hidden="true">
    <span>{markerSymbols[transaction?.type] || '£'}</span>
    {logo && <img src={logo} alt="" onError={() => setFailed(true)} />}
  </span>;
}

function TimelineDot({ cx, cy, payload, visibleTypes, showLogos }) {
  const transaction = payload?.transaction;
  if (!transaction || !visibleTypes.has(transaction.type)) return null;
  return <foreignObject x={cx-17} y={cy-17} width="34" height="34" className="f-chart-dot"><MerchantMark transaction={transaction} showLogos={showLogos}/></foreignObject>;
}

function TimelineTooltip({ active, payload, currency, showLogos }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  if (!point.transaction) return <div className="f-chart-tooltip"><strong>Opening balance</strong><span>{formatMoney(point.balance,currency)}</span></div>;
  const transaction = point.transaction;
  const sign = point.change > 0 ? '+' : point.change < 0 ? '−' : '';
  return <div className="f-chart-tooltip">
    <div className="f-chart-tooltip-title"><MerchantMark transaction={transaction} showLogos={showLogos} compact/><div><strong>{transaction.title}</strong><span>{markerLabels[transaction.type] || transaction.type} · {transaction.date}</span></div></div>
    <div className="f-between"><span>Movement</span><strong className={transaction.type==='income'?'f-positive':''}>{sign}{formatMoney(Math.abs(point.change),currency)}</strong></div>
    <div className="f-between"><span>Available after</span><strong>{formatMoney(point.balance,currency)}</strong></div>
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
  const monthly = data.transactions.filter((item) => item.date.startsWith(month));
  const income = monthly.filter((item) => item.type==='income').reduce((sum,item)=>sum+item.amount,0);
  const cards = [];
  const saved = data.transactions.filter((item)=>item.type==='savings').reduce((sum,item)=>sum+item.amount,0);
  cards.push({group:'savings',title:'Total savings moved',value:saved,target:0,caption:'All recorded savings allocations.'});
  for (const goal of data.goals) cards.push({group:'goals',title:goal.title,value:goal.saved,target:goal.target,caption:goal.status==='completed'?'Target reached.':`${formatMoney(Math.max(0,goal.target-goal.saved),currency)} left.`});
  for (const investment of data.investments) cards.push({group:'investments',title:investment.name,value:investment.currentValue,target:investment.target||0,caption:`${formatMoney(investment.contributed,currency)} contributed · ${formatMoney(investment.currentValue-investment.contributed,currency)} gain/loss.`});
  const donationCategories = new Set(data.categories.filter((item)=>item.type==='donation').map((item)=>item.id));
  const donationTargets = (data.budgets[month]||[]).filter((item)=>donationCategories.has(item.categoryId)).reduce((sum,item)=>sum+budgetTarget(item,income||data.settings.monthlyIncome),0);
  const donated = monthly.filter((item)=>item.type==='donation').reduce((sum,item)=>sum+item.amount,0);
  cards.push({group:'donations',title:'Giving this month',value:donated,target:donationTargets,caption:donationTargets?'Against your monthly giving target.':'Add a donation target in Monthly Budget.'});
  const expenseCategories = new Set(data.categories.filter((item)=>item.type==='expense').map((item)=>item.id));
  for (const budget of (data.budgets[month]||[]).filter((item)=>expenseCategories.has(item.categoryId))) {
    const category = data.categories.find((item)=>item.id===budget.categoryId);
    const actual = monthly.filter((item)=>item.type==='expense'&&item.categoryId===budget.categoryId).reduce((sum,item)=>sum+item.amount,0);
    cards.push({group:'budgets',title:category?.name||'Deleted category',value:actual,target:budgetTarget(budget,income||data.settings.monthlyIncome),caption:'Spent against this month’s budget.'});
  }
  for (const debt of data.debts) cards.push({group:'debts',title:debt.name,value:Math.max(0,debt.original-debt.remaining),target:debt.original,caption:`${formatMoney(debt.remaining,currency)} left to pay.`});
  return cards;
}

export function FinanceTimeline({ data, month, setMonth, change }) {
  const currency = data.settings.currency;
  const [showLogos,setShowLogos] = useState(true);
  const [visibleTypes,setVisibleTypes] = useState(()=>new Set(markerTypes));
  const [visibleProgress,setVisibleProgress] = useState(()=>new Set(Object.keys(progressLabels)));
  const savedOpening = data.openingBalances?.[month] || 0;
  const [opening,setOpening] = useState(moneyInput(savedOpening));
  const [openingError,setOpeningError] = useState('');
  useEffect(()=>setOpening(moneyInput(savedOpening)),[month,savedOpening]);
  const timeline = useMemo(()=>buildCashTimeline(data.transactions,month,savedOpening),[data.transactions,month,savedOpening]);
  const targets = useMemo(()=>buildTargetCards(data,month),[data,month]);
  const endBalance = timeline.at(-1)?.balance || 0;
  const toggle=(setter,current,key)=>setter(()=>{const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next});
  async function saveOpening(event){event.preventDefault();try{const amount=parseOpeningBalance(opening);await change(state=>{state.openingBalances||={};state.openingBalances[month]=amount;return state},'Opening balance saved');setOpeningError('')}catch(error){setOpeningError(error.message)}}
  return <div className="f-timeline-page">
    <div className="f-between f-timeline-month"><div className="f-actions"><button className="f-button" onClick={()=>setMonth(shiftMonth(month,-1))} aria-label="Previous month">←</button><span className="f-month">{new Date(`${month}-15`).toLocaleDateString([],{month:'long',year:'numeric'})}</span><button className="f-button" onClick={()=>setMonth(shiftMonth(month,1))} aria-label="Next month">→</button></div><button className="f-button" onClick={()=>setMonth(monthKey())}>Current month</button></div>
    <div className="f-between"><div><span className="pill">Money movement</span><h2 className="text-3xl font-bold mt-4">Money Timeline</h2><p className="f-help mt-2">The line rises with income and falls when money leaves your available cash.</p></div><div className="f-stat" data-tone={endBalance>=0?'blue':'pink'}><strong>{formatMoney(endBalance,currency)}</strong><span>Available at month end</span></div></div>
    <section className="f-card f-timeline-card mt-5">
      <div className="f-timeline-controls"><form className="f-opening-form" onSubmit={saveOpening}><label>Opening balance for {month}<input inputMode="decimal" value={opening} onChange={(event)=>setOpening(event.target.value)} /></label><button className="f-button">Save</button></form><label className="f-logo-toggle"><input type="checkbox" checked={showLogos} onChange={(event)=>setShowLogos(event.target.checked)}/> Show recognised merchant logos</label></div>
      {openingError&&<p className="f-alert" role="alert">{openingError}</p>}
      <fieldset className="f-filter-fieldset"><legend>Marker visibility</legend><div className="f-filter-chips">{markerTypes.map((type)=><label key={type} className="f-filter-chip" data-active={visibleTypes.has(type)}><input type="checkbox" checked={visibleTypes.has(type)} onChange={()=>toggle(setVisibleTypes,visibleTypes,type)}/>{markerLabels[type]}</label>)}</div></fieldset>
      {timeline.length===1?<div className="f-empty mt-5">No transactions in this month yet. Your opening balance is ready for the first movement.</div>:<div className="f-chart-wrap" role="img" aria-label={`Available cash timeline ending at ${formatMoney(endBalance,currency)}`}>
        <ResponsiveContainer width="100%" height="100%"><ComposedChart data={timeline} margin={{top:28,right:18,bottom:8,left:4}}>
          <defs><linearGradient id="financeBalanceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--f-green)" stopOpacity=".42"/><stop offset="100%" stopColor="var(--f-green)" stopOpacity=".04"/></linearGradient></defs>
          <CartesianGrid stroke="var(--finance-chart-grid,#1112)" strokeDasharray="4 5" vertical={false}/>
          <XAxis dataKey="index" tickFormatter={(index)=>timeline[index]?.date?.slice(8,10)||''} tick={{fontSize:12,fontWeight:700,fill:'currentColor'}} axisLine={{stroke:'var(--finance-chart-line,#111)'}} tickLine={false}/>
          <YAxis width={74} tickFormatter={(value)=>new Intl.NumberFormat(undefined,{style:'currency',currency,notation:'compact',maximumFractionDigits:1}).format(value/100)} tick={{fontSize:11,fontWeight:700,fill:'currentColor'}} axisLine={false} tickLine={false}/>
          <ReferenceLine y={0} stroke="var(--finance-chart-line,#111)" strokeDasharray="6 4"/>
          <Tooltip content={<TimelineTooltip currency={currency} showLogos={showLogos}/>} cursor={{stroke:'var(--finance-chart-line,#111)',strokeDasharray:'3 3'}}/>
          <Area type="stepAfter" dataKey="balance" stroke="none" fill="url(#financeBalanceFill)" isAnimationActive={false}/>
          <Line type="stepAfter" dataKey="balance" stroke="var(--finance-chart-line,#111)" strokeWidth={3} dot={<TimelineDot visibleTypes={visibleTypes} showLogos={showLogos}/>} activeDot={{r:7,fill:'var(--f-green)',stroke:'var(--finance-chart-line,#111)',strokeWidth:2}} isAnimationActive={false}/>
        </ComposedChart></ResponsiveContainer>
      </div>}
      <p className="f-help">Day of month runs along the bottom. Recognised logos load from the merchant’s own website; failed or unknown logos automatically use a category marker. Transfers between your own accounts do not change available cash.</p>
    </section>
    <section className="mt-6" aria-labelledby="target-progress-heading"><div><h3 id="target-progress-heading" className="text-2xl font-bold">Targets and progress</h3><p className="f-help mt-1">Progress is kept separate from the cash line so percentages and money are never mixed.</p></div>
      <fieldset className="f-filter-fieldset"><legend>Show progress</legend><div className="f-filter-chips">{Object.entries(progressLabels).map(([key,label])=><label key={key} className="f-filter-chip" data-active={visibleProgress.has(key)}><input type="checkbox" checked={visibleProgress.has(key)} onChange={()=>toggle(setVisibleProgress,visibleProgress,key)}/>{label}</label>)}</div></fieldset>
      <div className="f-target-grid">{targets.filter((item)=>visibleProgress.has(item.group)).map((item,index)=><TargetCard key={`${item.group}-${item.title}-${index}`} item={item} currency={currency}/>)}</div>
    </section>
  </div>;
}
