import { useMemo, useState } from 'react';
import { formatMoney, monthKey, shiftMonth } from './financeMath.js';
import { expenseCategoryReport, monthlyFinanceReports } from './financeReports.js';

const monthLabel = month => new Date(`${month}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

function ReportMoney({ amount, currency }) {
  return <>{formatMoney(amount, currency)}</>;
}

function ActivityList({ items, currency, empty, amountKey = 'amount', meta }) {
  return items.length ? <div className="f-report-activity">{items.map((item, index) => <div className="f-between" key={item.id || `${item.title || item.name}-${index}`}>
    <div><strong>{item.title || item.name}</strong><p className="f-meta">{meta ? meta(item) : item.note || item.date}</p></div>
    <strong className={item[amountKey] < 0 ? 'f-negative' : ''}><ReportMoney amount={item[amountKey]} currency={currency}/></strong>
  </div>)}</div> : <p className="f-help">{empty}</p>;
}

export function MonthlyReports({ data, month, setMonth, setTab, openTransaction, deleteTransaction }) {
  const currency = data.settings.currency;
  const reports = useMemo(() => monthlyFinanceReports(data), [data]);
  const years = [...new Set(reports.map((report) => report.month.slice(0, 4)))];
  const [year, setYear] = useState(() => years.includes(month.slice(0, 4)) ? month.slice(0, 4) : years[0]);
  const [spendingPeriod, setSpendingPeriod] = useState('month');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const visible = reports.filter((report) => report.month.startsWith(year));
  const selected = visible.find((report) => report.month === month) || visible[0];
  const categoryReport = useMemo(() => expenseCategoryReport(data, {
    mode: spendingPeriod,
    month,
    year: spendingPeriod === 'year' ? year : month.slice(0, 4),
  }), [data, spendingPeriod, month, year]);
  const selectedCategory = categoryReport.categories.find(item => item.id === selectedCategoryId);
  const spendingPeriodLabel = spendingPeriod === 'month'
    ? monthLabel(month)
    : spendingPeriod === 'year' ? year : 'All time';
  const openMonth = (report, destination = 'overview') => {
    setMonth(report.month);
    setYear(report.month.slice(0, 4));
    setTab(destination);
  };

  return <section className="f-reports">
    <div className="f-between">
      <div><span className="pill">Month by month</span><h2 className="text-3xl font-bold mt-4">Monthly Reports</h2><p className="f-help mt-2">A permanent view of what came in, went out, and moved your future forward.</p></div>
      <label className="f-report-year">Report year<select value={year} onChange={(event) => setYear(event.target.value)}>{years.map((value) => <option key={value}>{value}</option>)}</select></label>
    </div>

    {selected && <article className="f-card f-report-feature mt-5">
      <div className="f-between"><div><p className="f-meta">Selected month</p><h3>{monthLabel(selected.month)}</h3></div><button className="f-button" onClick={() => openMonth(selected)}>Open month</button></div>
      <div className="f-grid f-report-kpis mt-4">
        <div><span>Income</span><strong><ReportMoney amount={selected.income} currency={currency}/></strong></div>
        <div><span>Spent</span><strong><ReportMoney amount={selected.expenses} currency={currency}/></strong></div>
        <div><span>Saved</span><strong><ReportMoney amount={selected.savings} currency={currency}/></strong></div>
        <div><span>Invested</span><strong><ReportMoney amount={selected.investments} currency={currency}/></strong></div>
        <div><span>Credit payments</span><strong><ReportMoney amount={selected.creditPayments} currency={currency}/></strong></div>
        <div><span>Remaining</span><strong className={selected.remaining < 0 ? 'f-negative' : 'f-positive'}><ReportMoney amount={selected.remaining} currency={currency}/></strong></div>
      </div>
      <div className="f-report-goals mt-4"><strong>Goals achieved</strong>{selected.achievedGoals.length ? selected.achievedGoals.map((goal) => <span className="f-tag" key={goal.id}>✓ {goal.title}</span>) : <span className="f-help">No goals completed in this month.</span>}</div>
    </article>}

    <section className="f-card f-expense-category-report mt-5" aria-labelledby="expense-category-heading">
      <div className="f-between f-expense-category-header">
        <div><p className="f-meta">Actual money out</p><h3 id="expense-category-heading">Expenses by Category</h3><p className="f-help">Only active, booked expense and donation payments from your Finance ledger.</p></div>
        <label className="f-report-year">Period<select aria-label="Expense report period" value={spendingPeriod} onChange={event => { setSpendingPeriod(event.target.value); setSelectedCategoryId(''); if (event.target.value === 'year') { const currentMonth = monthKey(); setMonth(currentMonth); setYear(currentMonth.slice(0, 4)); } }}><option value="month">Month</option><option value="year">This Year</option><option value="all">All Time</option></select></label>
      </div>
      <div className="f-actions f-expense-period-controls">
        {spendingPeriod === 'month' && <><button type="button" className="f-button" aria-label="Previous month" onClick={() => { const nextMonth = shiftMonth(month, -1); setMonth(nextMonth); setYear(nextMonth.slice(0, 4)); setSelectedCategoryId(''); }}>‹</button><label className="f-report-year"><span className="sr-only">Expense report month</span><input aria-label="Expense report month" type="month" value={month} onChange={event => { if (event.target.value) { setMonth(event.target.value); setYear(event.target.value.slice(0, 4)); setSelectedCategoryId(''); } }} /></label><button type="button" className="f-button" aria-label="Next month" onClick={() => { const nextMonth = shiftMonth(month, 1); setMonth(nextMonth); setYear(nextMonth.slice(0, 4)); setSelectedCategoryId(''); }}>›</button><button type="button" className="f-button" onClick={() => { setMonth(monthKey()); setYear(monthKey().slice(0, 4)); setSelectedCategoryId(''); }}>This month</button></>}
        {spendingPeriod === 'year' && <label className="f-report-year">Report year<select aria-label="Expense report year" value={year} onChange={event => { setYear(event.target.value); setSelectedCategoryId(''); }}>{years.map(value => <option key={value} value={value}>{value}</option>)}</select></label>}
        <strong className="f-expense-period-label">{spendingPeriodLabel}</strong>
      </div>
      <div className="f-expense-total"><span>Total spent</span><strong><ReportMoney amount={categoryReport.total} currency={currency}/></strong><p className="f-help">Donations count when paid. Debt repayments remain in the separate Repaid total above; due and allocated amounts are not spending.</p></div>
      {selectedCategory ? <div className="f-expense-category-detail mt-4">
        <div className="f-between"><div><button type="button" className="f-button" onClick={() => setSelectedCategoryId('')}>← Expense categories</button><h4 className="mt-3">{selectedCategory.name}{selectedCategory.archived ? ' · archived' : ''}</h4><p className="f-meta">{spendingPeriodLabel} · {selectedCategory.transactions.length} transaction{selectedCategory.transactions.length === 1 ? '' : 's'}</p></div><strong className="f-report-section-total"><ReportMoney amount={selectedCategory.amount} currency={currency}/></strong></div>
        <div className="f-list mt-3">{selectedCategory.transactions.map(item => <article className="f-item f-between" key={item.id}><div><strong>{item.title || selectedCategory.name}</strong><p className="f-meta">{item.date}{item.note ? ` · ${item.note}` : ''}</p></div><div className="f-actions"><strong><ReportMoney amount={item.amount} currency={currency}/></strong><button type="button" className="f-button" onClick={() => openTransaction(item)}>Edit</button><button type="button" className="f-button danger-action" onClick={() => deleteTransaction(item)}>Delete</button></div></article>)}</div>
      </div> : categoryReport.categories.length ? <div className="f-expense-category-list mt-4">{categoryReport.categories.map(item => <button type="button" className="f-expense-category-row" key={item.id} onClick={() => setSelectedCategoryId(item.id)} aria-label={`${item.name}, ${formatMoney(item.amount, currency)}, ${item.percentage.toFixed(1)} percent, view transactions`}><span className="f-expense-category-name">{item.name}{item.archived ? ' · archived' : ''}</span><span className="f-expense-category-amount"><ReportMoney amount={item.amount} currency={currency}/></span><span className="f-expense-category-percent">{item.percentage.toFixed(1)}%</span><span className="f-progress f-expense-category-bar" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, item.percentage))}%` }}/></span><span className="f-expense-category-open" aria-hidden="true">›</span></button>)}</div> : <p className="f-empty mt-4">No expenses recorded in {spendingPeriodLabel}.</p>}
    </section>

    {selected && <div className="f-grid f-report-sections mt-5">
      <article className="f-card">
        <div className="f-between"><div><p className="f-meta">Savings goals</p><h3>Goals</h3></div><strong className="f-report-section-total"><ReportMoney amount={selected.goalSavings} currency={currency}/></strong></div>
        <ActivityList items={selected.goalActivity} currency={currency} empty="No goal contributions or withdrawals this month."/>
        {selected.achievedGoals.length > 0 && <div className="f-report-achievements"><strong>Achieved</strong>{selected.achievedGoals.map((goal) => <span className="f-tag" key={goal.id}>✓ {goal.title}</span>)}</div>}
      </article>
      <article className="f-card">
        <div className="f-between"><div><p className="f-meta">Growth</p><h3>Investments</h3></div><strong className="f-report-section-total"><ReportMoney amount={selected.investments} currency={currency}/></strong></div>
        <ActivityList items={selected.investmentActivity} currency={currency} empty="No investment transactions this month."/>
        {selected.investmentPositions.length > 0 && <details className="f-report-positions"><summary>Positions updated this month</summary><ActivityList items={selected.investmentPositions} currency={currency} amountKey="currentValue" empty="" meta={(item) => `${formatMoney(item.contributed, currency)} contributed · as of ${item.date}`}/></details>}
      </article>
      <article className="f-card">
        <div className="f-between"><div><p className="f-meta">Money to pay back</p><h3>Repayments</h3></div><strong className="f-report-section-total"><ReportMoney amount={selected.debtPayments} currency={currency}/></strong></div>
        <ActivityList items={selected.debtActivity} currency={currency} empty="No repayments recorded this month."/>
      </article>
      <article className="f-card">
        <div className="f-between"><div><p className="f-meta">Purchase finance</p><h3>Credit payments</h3></div><strong className="f-report-section-total"><ReportMoney amount={selected.creditPayments} currency={currency}/></strong></div>
        <p className="f-help">Actual cash payments only. Principal is not included in purchase-category spending.</p>
        {selected.creditFinanceCosts > 0 && <p className="f-help">Finance costs paid this month: <strong><ReportMoney amount={selected.creditFinanceCosts} currency={currency}/></strong></p>}
        <ActivityList items={selected.creditPaymentActivity} currency={currency} empty="No credit payments recorded this month." meta={item => `${item.date} · ${item.creditPaymentKind === 'extra' ? 'Extra principal' : item.creditPaymentKind === 'settlement' ? 'Early settlement' : item.creditPaymentKind === 'scheduled' ? 'Instalment' : 'Payment'}${item.creditFinanceCostAmount ? ` · finance cost ${formatMoney(item.creditFinanceCostAmount, currency)}` : ''}`}/>
      </article>
      <article className="f-card">
        <div className="f-between"><div><p className="f-meta">Giving</p><h3>Donations</h3></div><strong className="f-report-section-total"><ReportMoney amount={selected.donations} currency={currency}/></strong></div>
        <ActivityList items={selected.donationActivity} currency={currency} empty="No donations recorded this month."/>
      </article>
    </div>}

    <div className="f-report-table-wrap mt-5" role="region" aria-label="Monthly finance report table" tabIndex="0">
      <table className="f-table f-report-table">
        <thead><tr><th>Month</th><th>Income</th><th>Spent</th><th>Saved</th><th>Goals funded</th><th>Invested</th><th>Debt repaid</th><th>Credit paid</th><th>Donated</th><th>Remaining</th><th>Goals achieved</th><th></th></tr></thead>
        <tbody>{visible.map((report) => <tr key={report.month} data-current={report.month === monthKey()}>
          <td data-label="Month"><div className="f-report-month-cell"><strong>{monthLabel(report.month)}</strong>{report.month === monthKey() && <span className="f-tag">Current</span>}</div></td>
          <td data-label="Income"><ReportMoney amount={report.income} currency={currency}/></td>
          <td data-label="Spent"><ReportMoney amount={report.expenses} currency={currency}/></td>
          <td data-label="Saved"><ReportMoney amount={report.savings} currency={currency}/></td>
          <td data-label="Goals funded"><ReportMoney amount={report.goalSavings} currency={currency}/></td>
          <td data-label="Invested"><ReportMoney amount={report.investments} currency={currency}/></td>
          <td data-label="Repaid"><ReportMoney amount={report.debtPayments} currency={currency}/></td>
          <td data-label="Credit paid"><ReportMoney amount={report.creditPayments} currency={currency}/></td>
          <td data-label="Donated"><ReportMoney amount={report.donations} currency={currency}/></td>
          <td data-label="Remaining" className={report.remaining < 0 ? 'f-negative' : ''}><ReportMoney amount={report.remaining} currency={currency}/></td>
          <td data-label="Goals achieved">{report.achievedGoals.length ? report.achievedGoals.map((goal) => goal.title).join(', ') : '—'}</td>
          <td data-label="Action"><button className="f-button" onClick={() => openMonth(report)}>View</button></td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
