import { useMemo } from 'react';
import { formatMoney, financeSummary, monthKey, shiftMonth } from './financeMath.js';
import { expenseCategoryReport } from './financeReports.js';
import { deriveFinancePosition, inspectFinanceIntegrity } from './financeLedger.js';
import { donationDue } from './donationAccounting.js';
import { debtPaymentDue } from './debtAccounting.js';
import { orderedTransactions } from './transactionOrder.js';

const labels = { income: 'Income', expense: 'Expense', donation: 'Donation', debt: 'Debt payment', transfer: 'Transfer' };
const monthTitle = month => new Date(`${month}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

function Money({ amount, currency }) { return <>{formatMoney(amount, currency)}</>; }

export function FinanceOverview({ data, month, setMonth, setTab, setTransactionScope, openTransaction, openTransactionDetail, setOverviewCategory }) {
  const currency = data.settings.currency;
  const monthly = financeSummary(data, month);
  const position = deriveFinancePosition(data);
  const categoryReport = expenseCategoryReport(data, { mode: 'month', month });
  const trend = useMemo(() => Array.from({ length: 6 }, (_, index) => { const period = shiftMonth(month, index - 5); return { month: period, expenses: financeSummary(data, period).expenses }; }), [data, month]);
  const maxTrend = Math.max(0, ...trend.map(item => item.expenses));
  const recent = orderedTransactions(data.transactions.filter(item => (!item.source || item.providerStatus === 'BOOK') && !item.reversedAt && !['cancelled', 'planned'].includes(item.allocationStatus))).slice(0, 4);
  const donationOutstanding = donationDue(data), debtDue = debtPaymentDue(data);
  const uncategorised = monthly.transactions.filter(item => ['expense', 'donation'].includes(item.type) && !item.categoryId).length;
  const noTransactions = data.transactions.length === 0;
  const protectedRows = [...Object.entries(position.funds).map(([key, amount]) => [key.startsWith('goal:') ? data.goals.find(goal => goal.id === key.slice(5))?.title || 'Goal fund' : key.startsWith('savings:') ? 'Savings' : key.startsWith('investment:') ? 'Investment fund' : key, amount]), ...Object.entries(position.reserves).map(([key, amount]) => [`${key[0].toUpperCase()}${key.slice(1)} reserved`, amount])].filter(([, amount]) => amount > 0);
  const integrityIssues = inspectFinanceIntegrity(data);
  const net = monthly.income - monthly.expenses;
  const resetTransactionFilter = () => { setOverviewCategory(''); setTransactionScope('all'); };
  const showMonthlyTransactions = () => { setOverviewCategory(''); setTransactionScope('month'); setTab('transactions'); };

  return <div className="f-overview">
    <div className="f-overview-top">
      <section className="f-overview-balance" aria-labelledby="spendable-heading">
        <div className="f-overview-primary"><span className="f-overview-eyebrow">Current balance</span><h2 id="spendable-heading">Spendable now</h2><strong className="f-overview-spendable"><Money amount={position.spendable} currency={currency}/></strong><p>Available for everyday spending</p></div>
        <div className="f-overview-secondary" aria-label="Other current balances">
          <div><span>Protected</span><strong><Money amount={position.protected} currency={currency}/></strong></div>
          <div><span>Total owned</span><strong><Money amount={position.totalOwned} currency={currency}/></strong></div>
          <div><span>Debt outstanding</span><strong><Money amount={position.debtOutstanding} currency={currency}/></strong></div>
        </div>
        <details className="f-balance-breakdown"><summary>See what is protected or reserved</summary><dl>{protectedRows.map(([label, amount]) => <div key={label}><dt>{label}</dt><dd><Money amount={amount} currency={currency}/></dd></div>)}</dl><p className="f-help">Protected money is still yours. Moving money between your own funds does not count as spending.</p></details>
      </section>
      <section className="f-overview-actions" aria-label="Quick transaction actions"><span className="f-overview-eyebrow">Quick actions</span><div className="f-actions"><button className="f-primary" onClick={() => openTransaction({ type: 'expense' })}>＋ Expense</button><button className="f-button" onClick={() => openTransaction({ type: 'income' })}>＋ Income</button><button className="f-button" onClick={() => openTransaction({ type: 'transfer' })}>Move money</button></div></section>
    </div>

    <section className="f-overview-flow" aria-labelledby="monthly-flow-heading">
      <div className="f-overview-section-heading"><div><span className="f-overview-eyebrow">Monthly flow</span><h2 id="monthly-flow-heading">This month</h2></div><div className="f-overview-month"><button className="f-button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">‹</button><strong aria-live="polite">{monthTitle(month)}</strong><button className="f-button" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">›</button><button className="f-button f-overview-current" onClick={() => setMonth(monthKey())}>This month</button></div></div>
      <div className="f-overview-flow-grid">
        <button className="f-overview-flow-item" onClick={showMonthlyTransactions}><span>Income</span><strong className="f-positive"><Money amount={monthly.income} currency={currency}/></strong><small>Received in {monthTitle(month)}</small></button>
        <button className="f-overview-flow-item" onClick={showMonthlyTransactions}><span>Spent</span><strong><Money amount={monthly.expenses} currency={currency}/></strong><small>External expenses</small></button>
        <div className="f-overview-flow-item f-overview-net"><span>Net</span><strong className={net >= 0 ? 'f-positive' : 'f-negative'}>{net > 0 ? '+' : net < 0 ? '−' : ''}<Money amount={Math.abs(net)} currency={currency}/></strong><small>Income minus spending</small></div>
      </div>
      <p className="f-help">Transfers between your own funds are excluded. Donation payments appear in category spending when paid; amounts due are not expenses.</p>
    </section>

    <div className="f-overview-content">
      <section className="f-overview-section f-overview-categories" aria-labelledby="category-spending-heading"><div className="f-overview-section-heading"><div><span className="f-overview-eyebrow">Actual payments</span><h2 id="category-spending-heading">Where your money went</h2></div><span className="f-overview-period">{monthTitle(month)}</span></div>
        {categoryReport.categories.length ? <div className="f-overview-category-list">{categoryReport.categories.slice(0, 6).map(item => <button type="button" className="f-overview-category" key={item.id} onClick={() => { setOverviewCategory(item.id); setTransactionScope('month'); setTab('transactions'); }} aria-label={`${item.name}: ${formatMoney(item.amount, currency)}, ${item.percentage.toFixed(1)} percent. View transactions.`}><span className="f-overview-category-name">{item.name}</span><strong><Money amount={item.amount} currency={currency}/></strong><span className="f-overview-category-percent">{item.percentage.toFixed(0)}%</span><span className="f-overview-category-bar" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, item.percentage))}%` }}/></span></button>)}</div> : <p className="f-overview-empty">No spending recorded in {monthTitle(month)}.</p>}
        <p className="f-help">Booked expense and donation payments only. Reserved amounts and debt repayments are not included.</p>
      </section>
      <section className="f-overview-section f-overview-trend" aria-labelledby="spending-trend-heading"><div className="f-overview-section-heading"><div><span className="f-overview-eyebrow">Six month view</span><h2 id="spending-trend-heading">Spending trend</h2></div></div>
        {trend.some(item => item.expenses > 0) ? <div className="f-overview-trend-list" role="img" aria-label={`Monthly external expenses over the last ${trend.length} months: ${trend.map(item => `${new Date(`${item.month}-15T12:00:00`).toLocaleDateString(undefined, { month: 'short' })} ${formatMoney(item.expenses, currency)}`).join(', ')}`}>
          {trend.map(item => <div className="f-overview-trend-row" key={item.month}><span>{new Date(`${item.month}-15T12:00:00`).toLocaleDateString(undefined, { month: 'short' })}</span><span className="f-overview-trend-bar"><span style={{ width: `${maxTrend ? Math.max(item.expenses ? 3 : 0, item.expenses * 100 / maxTrend) : 0}%` }}/></span><strong><Money amount={item.expenses} currency={currency}/></strong></div>)}
        </div> : <p className="f-overview-empty">Add expenses to see a six month trend.</p>}
      </section>
    </div>

    {(donationOutstanding > 0 || debtDue > 0 || uncategorised > 0) && <section className="f-overview-section f-overview-attention" aria-labelledby="needs-attention-heading"><div className="f-overview-section-heading"><div><span className="f-overview-eyebrow">Actionable items</span><h2 id="needs-attention-heading">Needs attention</h2></div></div><div className="f-overview-attention-list">
      {donationOutstanding > 0 && <button type="button" onClick={() => setTab('donations')}><span>Donation due <small>Reserved or accrued; not yet an expense</small></span><strong><Money amount={donationOutstanding} currency={currency}/></strong><span aria-hidden="true">›</span></button>}
      {debtDue > 0 && <button type="button" onClick={() => setTab('debts')}><span>Debt accumulated to pay <small>Payment due; not yet repaid</small></span><strong><Money amount={debtDue} currency={currency}/></strong><span aria-hidden="true">›</span></button>}
      {uncategorised > 0 && <button type="button" onClick={() => { setOverviewCategory('uncategorized'); setTransactionScope('month'); setTab('transactions'); }}><span>Uncategorised expenses <small>Review {monthTitle(month)}</small></span><strong>{uncategorised}</strong><span aria-hidden="true">›</span></button>}
    </div></section>}

    <section className="f-overview-section f-overview-recent" aria-labelledby="recent-activity-heading"><div className="f-overview-section-heading"><div><span className="f-overview-eyebrow">Latest entries</span><h2 id="recent-activity-heading">Recent activity</h2></div><button type="button" className="f-button" onClick={() => { resetTransactionFilter(); setTab('transactions'); }}>View all transactions <span aria-hidden="true">→</span></button></div>
      {recent.length ? <div className="f-overview-recent-list">{recent.map(item => { const expense = ['expense', 'donation', 'debt','creditPayment'].includes(item.type) && item.allocationStatus !== 'allocated' || item.type === 'transfer' && item.transferKind === 'external-out'; const income = item.type === 'income' || item.type === 'transfer' && item.transferKind === 'external-in'; const transfer = item.type === 'transfer' && !['external-in', 'external-out'].includes(item.transferKind); const category = data.categories.find(value => value.id === item.categoryId)?.name; return <button type="button" className="f-overview-activity" key={item.id} onClick={()=>openTransactionDetail(item)} aria-label={`View ${item.title||labels[item.type]||item.type}, ${formatMoney(item.amount,currency)}, ${item.date}`}><span className="f-overview-activity-copy"><strong>{item.title || labels[item.type] || item.type}</strong><span>{transfer ? 'Transfer' : category || labels[item.type] || item.type} · {item.date}{item.allocationStatus === 'allocated' ? ' · Reserved' : ''}</span></span><strong className={income ? 'f-positive' : expense ? 'f-negative' : ''}>{income ? '+' : expense ? '−' : ''}<Money amount={item.amount} currency={currency}/></strong></button>; })}</div> : <p className="f-overview-empty">No transactions yet. Add income or an expense to get started.</p>}
    </section>
    {noTransactions && <p className="f-overview-new-user">Your balance summary is ready. Category spending and trends will appear as you record activity.</p>}
    {integrityIssues.length > 0 && <details className="f-overview-integrity"><summary>Finance records to review ({integrityIssues.length})</summary><p className="f-help">Some legacy side records need review. Balances continue to use the transaction ledger once.</p><button className="f-button" onClick={() => setTab('goals')}>Review funds and goals</button></details>}
  </div>;
}
