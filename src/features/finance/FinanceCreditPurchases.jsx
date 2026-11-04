import { useMemo, useState } from 'react';
import { deriveFinancePosition } from './financeLedger.js';
import { formatMoney, moneyInput, parseMoney } from './financeMath.js';
import { id, today } from './financeData.js';
import { useReminders } from '../focusTimer/ReminderProvider.jsx';
import { cancelCreditAgreement, createCreditAgreement, generateCreditSchedule, getCreditAgreementBalances, getCreditAgreementStatus, getCreditDueSoon, getCreditInstalmentAmounts, getCreditInstalmentStatus, getCreditOverview, getCreditPaymentTransactions, getOverdueCreditPayments, recordCreditPayment, settleCreditAgreement, updateCreditAgreement } from './creditPurchases.js';

const moneyDate = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date not set';
const statusLabels = { active: 'Active', cancelled: 'Cancelled', paid_off: 'Paid off', settled_early: 'Settled early', due: 'Due today', due_soon: 'Due soon', overdue: 'Overdue', partial: 'Partially paid', partial_overdue: 'Part-paid · overdue', paid: 'Paid', upcoming: 'Upcoming', superseded: 'Superseded' };
const firstPaymentDefault = () => {
  const [year, month, day] = today().split('-').map(Number);
  const monthIndex = month;
  const nextYear = year + Math.floor(monthIndex / 12), nextMonth = monthIndex % 12;
  const lastDay = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(nextYear, nextMonth, Math.min(day, lastDay))).toISOString().slice(0, 10);
};
const blankDraft = categoryId => ({ title: '', merchant: '', reference: '', purchaseDate: today(), cashPrice: '', deposit: '', categoryId, financeMode: 'zero', financeCharge: '', term: '12', frequency: 'monthly', customDays: '30', firstPaymentDate: firstPaymentDefault(), depositPaidFromFundId: '', notes: '' });
const monthName = value => new Date(`${value}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

function Money({ amount, currency }) { return <>{formatMoney(amount, currency)}</>; }

function CreditMetric({ label, amount, currency, hint, action, value }) {
  const content = <><span>{label}</span><strong>{value ?? <Money amount={amount} currency={currency}/>}</strong>{hint && <small>{hint}</small>}</>;
  return action ? <button type="button" className="f-credit-metric" onClick={action}>{content}</button> : <div className="f-credit-metric">{content}</div>;
}

function agreementNextPayment(state, agreement) {
  return (agreement.schedule || []).filter(item => !item.supersededAt && getCreditInstalmentAmounts(state, agreement, item).remaining > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] || null;
}

function SelectPaidFrom({ data, value, onChange, label = 'Paid from' }) {
  const funds = Object.entries(deriveFinancePosition(data).funds).filter(([, amount]) => amount > 0);
  return <label>{label}<select value={value} onChange={event => onChange(event.target.value)}><option value="">Spendable</option>{funds.map(([key]) => <option key={key} value={key}>{key.startsWith('goal:') ? `${data.goals.find(goal => goal.id === key.slice(5))?.title || 'Goal'} fund` : key.startsWith('savings:') ? 'Savings' : key}</option>)}</select></label>;
}

export function FinanceCreditPurchases({ data, change, busy, confirmAction, setTab }) {
  const currency = data.settings.currency;
  const summary = useMemo(() => getCreditOverview(data), [data]);
  const [view, setView] = useState('active'), [query, setQuery] = useState(''), [selectedId, setSelectedId] = useState('');
  const [creating, setCreating] = useState(false), [draft, setDraft] = useState(() => blankDraft(data.categories.find(item => item.type === 'expense' && !item.archived)?.id || ''));
  const [createError, setCreateError] = useState(''), [actionError, setActionError] = useState('');
  const { reminders, addReminder } = useReminders();
  const [paymentMode, setPaymentMode] = useState('scheduled'), [paymentDraft, setPaymentDraft] = useState({ instalmentId: '', amount: '', date: today(), paidFromFundId: '', note: '' });
  const [settlementDraft, setSettlementDraft] = useState({ amount: '', fee: '', date: today(), paidFromFundId: '', note: '' });
  const [editDraft, setEditDraft] = useState(null), [showPaymentForm, setShowPaymentForm] = useState(false), [showSettlementForm, setShowSettlementForm] = useState(false), [showAllSchedule, setShowAllSchedule] = useState(false);
  const selected = data.creditAgreements.find(item => item.id === selectedId) || null;
  const selectedBalances = selected ? getCreditAgreementBalances(data, selected) : null;
  const selectedNext = selected ? agreementNextPayment(data, selected) : null;
  const selectedDisplayStatus = selected ? (selectedNext ? getCreditInstalmentStatus(data, selected, selectedNext) : getCreditAgreementStatus(data, selected)) : '';
  const payments = selected ? getCreditPaymentTransactions(data, selected.id).sort((a, b) => b.date.localeCompare(a.date) || (b.sequence || 0) - (a.sequence || 0)) : [];
  const categoryOptions = data.categories.filter(item => item.type === 'expense' && (!item.archived || item.id === draft.categoryId));
  const preview = (() => {
    try {
      if (!draft.cashPrice) return null;
      const cashPrice = parseMoney(draft.cashPrice), deposit = draft.deposit ? parseMoney(draft.deposit) : 0;
      if (deposit >= cashPrice) return null;
      const financed = cashPrice - deposit, fee = draft.financeMode === 'fixed' && draft.financeCharge ? parseMoney(draft.financeCharge) : 0;
      const schedule = generateCreditSchedule({ agreementId: 'preview', principalAmount: financed, financeCharge: fee, term: Number(draft.term), frequency: draft.frequency, customDays: Number(draft.customDays), firstPaymentDate: draft.firstPaymentDate });
      return { cashPrice, deposit, financed, fee, total: financed + fee, first: schedule[0]?.amount, last: schedule.at(-1)?.amount, count: schedule.length };
    } catch { return null; }
  })();

  const plans = useMemo(() => (data.creditAgreements || []).filter(agreement => {
    const status = getCreditAgreementStatus(data, agreement);
    const isActive = status === 'active';
    const text = `${agreement.title} ${agreement.merchant} ${agreement.reference}`.toLocaleLowerCase();
    if (!text.includes(query.trim().toLocaleLowerCase())) return false;
    if (view === 'completed') return !isActive;
    if (!isActive) return false;
    if (view === 'due-soon') return getCreditDueSoon(data).some(item => item.agreement.id === agreement.id);
    if (view === 'overdue') return getOverdueCreditPayments(data).some(item => item.agreement.id === agreement.id);
    if (view === 'zero') return agreement.financeCharge === 0;
    if (view === 'interest') return agreement.financeCharge > 0;
    return true;
  }).sort((left, right) => (agreementNextPayment(data, left)?.dueDate || '9999-12-31').localeCompare(agreementNextPayment(data, right)?.dueDate || '9999-12-31') || getCreditAgreementBalances(data, right).totalRemaining - getCreditAgreementBalances(data, left).totalRemaining), [data, query, view]);

  function openAgreement(agreement) {
    setSelectedId(agreement.id); setActionError(''); setShowPaymentForm(false); setShowSettlementForm(false); setEditDraft(null); setShowAllSchedule(false);
  }

  async function createAgreement(event) {
    event.preventDefault(); setCreateError('');
    try {
      const cashPrice = parseMoney(draft.cashPrice), deposit = draft.deposit ? parseMoney(draft.deposit) : 0;
      const financeCharge = draft.financeMode === 'fixed' ? parseMoney(draft.financeCharge) : 0;
      const term = Number(draft.term), customDays = Number(draft.customDays);
      if (!draft.title.trim()) throw new Error('Enter a name for the purchase.');
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(draft.purchaseDate)) throw new Error('Choose the purchase date.');
      if (!Number.isInteger(term) || term < 1 || term > 600) throw new Error('Choose 1 to 600 instalments.');
      const agreementId = id(), created = new Date().toISOString();
      const saved = await change(state => createCreditAgreement(state, { id: agreementId, title: draft.title, merchant: draft.merchant, reference: draft.reference, notes: draft.notes, purchaseDate: draft.purchaseDate, depositDate: today(), cashPrice, deposit, categoryId: draft.categoryId, depositPaidFromFundId: draft.depositPaidFromFundId, financedAmount: cashPrice - deposit, financeCharge, interestMode: financeCharge ? 'fixed_fee' : 'zero', term, frequency: draft.frequency, customDays, firstPaymentDate: draft.firstPaymentDate, createdAt: created }, { transactionId: deposit ? id() : '', dateCreated: today() }), 'Credit purchase added');
      if (saved) { setCreating(false); setDraft(blankDraft(data.categories.find(item => item.type === 'expense' && !item.archived)?.id || '')); setView('active'); setSelectedId(agreementId); }
    } catch (error) { setCreateError(error.message || 'The credit purchase could not be saved.'); }
  }

  function beginPayment(agreement, mode = 'scheduled') {
    const next = mode === 'scheduled' ? agreementNextPayment(data, agreement) : null;
    const remaining = next ? getCreditInstalmentAmounts(data, agreement, next).remaining : '';
    setPaymentMode(mode); setPaymentDraft({ instalmentId: next?.id || '', amount: remaining ? moneyInput(remaining) : '', date: today(), paidFromFundId: '', note: '' });
    setShowPaymentForm(true); setShowSettlementForm(false); setActionError('');
  }

  async function savePayment(event) {
    event.preventDefault(); setActionError('');
    try {
      const amount = parseMoney(paymentDraft.amount), paymentId = id(), transactionId = id();
      const saved = await change(state => recordCreditPayment(state, { agreementId: selected.id, amount, date: paymentDraft.date, paidFromFundId: paymentDraft.paidFromFundId, note: paymentDraft.note, instalmentId: paymentMode === 'scheduled' ? paymentDraft.instalmentId : '', paymentId, transactionId }), 'Credit payment recorded');
      if (saved) { setShowPaymentForm(false); setPaymentDraft({ instalmentId: '', amount: '', date: today(), paidFromFundId: '', note: '' }); }
    } catch (error) { setActionError(error.message || 'The payment could not be recorded.'); }
  }

  function beginSettlement(agreement) {
    const balances = getCreditAgreementBalances(data, agreement);
    setSettlementDraft({ amount: moneyInput(balances.totalRemaining), fee: '', date: today(), paidFromFundId: '', note: '' });
    setShowSettlementForm(true); setShowPaymentForm(false); setActionError('');
  }

  async function saveSettlement(event) {
    event.preventDefault(); setActionError('');
    try {
      const settlementAmount = parseMoney(settlementDraft.amount), settlementFee = settlementDraft.fee ? parseMoney(settlementDraft.fee) : 0;
      const ok = await confirmAction({ title: 'Settle this credit agreement early?', message: 'This records one real Finance payment. Remaining scheduled instalments will be marked superseded and their history will stay available.', confirmLabel: 'Record settlement' });
      if (!ok) return;
      const paymentId = id(), transactionId = id();
      const saved = await change(state => settleCreditAgreement(state, { agreementId: selected.id, settlementAmount, settlementFee, date: settlementDraft.date, paidFromFundId: settlementDraft.paidFromFundId, note: settlementDraft.note, paymentId, transactionId }), 'Credit agreement settled early');
      if (saved) { setShowSettlementForm(false); setSettlementDraft({ amount: '', fee: '', date: today(), paidFromFundId: '', note: '' }); }
    } catch (error) { setActionError(error.message || 'The settlement could not be recorded.'); }
  }

  function beginEdit(agreement) {
    const futureCount = (agreement.schedule || []).filter(item => !item.supersededAt && item.dueDate > today() && getCreditInstalmentAmounts(data, agreement, item).remaining > 0).length;
    setEditDraft({ title: agreement.title, merchant: agreement.merchant || '', reference: agreement.reference || '', notes: agreement.notes || '', financeCharge: moneyInput(agreement.financeCharge || 0), term: String(Math.max(1, futureCount)), frequency: agreement.frequency, customDays: String(agreement.customDays || 30), firstPaymentDate: agreementNextPayment(data, agreement)?.dueDate || agreement.firstPaymentDate });
    setShowPaymentForm(false); setShowSettlementForm(false); setActionError('');
  }

  async function saveAgreementEdit(event) {
    event.preventDefault(); setActionError('');
    try {
      const changes = { ...editDraft, term: Number(editDraft.term), customDays: Number(editDraft.customDays), financeCharge: editDraft.financeCharge ? parseMoney(editDraft.financeCharge) : 0 };
      const ok = await confirmAction({ title: 'Update this agreement?', message: 'Future unpaid instalments will be recalculated. Past due dates and actual payments will remain unchanged.', confirmLabel: 'Update future schedule' });
      if (!ok) return;
      const saved = await change(state => updateCreditAgreement(state, selected.id, changes), 'Credit agreement updated');
      if (saved) setEditDraft(null);
    } catch (error) { setActionError(error.message || 'The agreement could not be updated.'); }
  }

  async function cancelAgreement(agreement) {
    const ok = await confirmAction({ title: 'Cancel this agreement?', message: 'This keeps the agreement and schedule history. Any deposit already paid remains in Finance, and an agreement with actual repayments cannot be cancelled.', confirmLabel: 'Cancel agreement' });
    if (!ok) return;
    try { await change(state => cancelCreditAgreement(state, agreement.id), 'Credit agreement cancelled'); }
    catch (error) { setActionError(error.message || 'The agreement could not be cancelled.'); }
  }
  function remindForNextPayment(agreement) {
    const next = agreementNextPayment(data, agreement);
    if (!next) return;
    const title = `Credit payment due: ${agreement.title} (${next.dueDate})`;
    if (reminders.some(item => item.title === title && ['waiting', 'ringing'].includes(item.status))) {
      setActionError('A reminder is already active for this payment.');
      return;
    }
    const todayAtNine = new Date(`${next.dueDate}T09:00:00`).getTime();
    if (!Number.isFinite(todayAtNine) || next.dueDate < today()) {
      setActionError('This payment date has passed. Choose a future instalment to set a reminder.');
      return;
    }
    addReminder(title, Math.max(60_000, todayAtNine - Date.now()));
    setActionError('Reminder added to CBoard Reminders for 9:00 on the payment date.');
  }
  function beginCreate() {
    setSelectedId(''); setCreateError(''); setDraft(blankDraft(data.categories.find(item => item.type === 'expense' && !item.archived)?.id || '')); setCreating(true);
  }

  const selectedSchedule = selected ? (selected.schedule || []).filter(item => !item.supersededAt).sort((a, b) => a.dueDate.localeCompare(b.dueDate)) : [];
  const selectedUpcoming = selectedSchedule.filter(item => getCreditInstalmentAmounts(data, selected, item).remaining > 0);
  const selectedPast = selectedSchedule.filter(item => getCreditInstalmentAmounts(data, selected, item).paid > 0);
  const visibleSchedule = showAllSchedule ? selectedSchedule : [...selectedPast.slice(-2), ...selectedUpcoming.slice(0, 3)].filter((item, index, all) => all.findIndex(value => value.id === item.id) === index);
  const paidPercent = selected && selected.totalRepayable ? Math.min(100, Math.round(selectedBalances.paidTotal * 100 / selected.totalRepayable)) : 0;

  return <section className="f-credit-page" aria-labelledby="credit-purchases-heading">
    {!selected && <>
      <header className="f-credit-header"><div><span className="f-overview-eyebrow">Purchase finance</span><h2 id="credit-purchases-heading">Credit Purchases</h2><p className="f-help">Track instalments and Pay Later plans separately from personal debt.</p></div><button type="button" className="f-primary" onClick={beginCreate}>＋ Credit Purchase</button></header>
      <div className="f-credit-metrics">
        <CreditMetric label="Credit outstanding" amount={summary.outstanding} currency={currency} hint={`${summary.activePlans} active plan${summary.activePlans === 1 ? '' : 's'}`}/>
        <CreditMetric label="Monthly commitment" amount={summary.monthlyCommitment} currency={currency} hint="Scheduled payment estimate"/>
        <CreditMetric label="Next payment" amount={summary.nextPayment?.remaining || 0} currency={currency} hint={summary.nextPayment ? `${summary.nextPayment.agreement.title} · ${moneyDate(summary.nextPayment.instalment.dueDate)}` : 'No upcoming payments'}/>
        <CreditMetric label="Due soon" amount={summary.dueSoonAmount} currency={currency} hint={`${summary.dueSoon.length} payment${summary.dueSoon.length === 1 ? '' : 's'} in the next 7 days`}/>
        <CreditMetric label="Plans" value={summary.activePlans} hint={`${summary.completedPlans} completed`}/>
        <CreditMetric label="Finance cost remaining" amount={summary.financeCostRemaining} currency={currency} hint="Fixed fees not yet paid"/>
      </div>
      {(summary.overdue.length > 0 || summary.dueSoon.length > 0) && <section className="f-credit-attention" aria-labelledby="credit-attention-heading"><div className="f-credit-section-head"><div><span className="f-overview-eyebrow">Actionable</span><h3 id="credit-attention-heading">Needs attention</h3></div><span className="f-credit-attention-total">{summary.overdue.length + summary.dueSoon.length} payment{summary.overdue.length + summary.dueSoon.length === 1 ? '' : 's'}</span></div>
        {[...summary.overdue, ...summary.dueSoon].map(row => <button type="button" className="f-credit-attention-row" key={row.instalment.id} onClick={() => openAgreement(row.agreement)}><span><strong>{row.agreement.title}</strong><small>{statusLabels[row.status]} · due {moneyDate(row.instalment.dueDate)}</small></span><strong><Money amount={row.remaining} currency={currency}/></strong><span aria-hidden="true">›</span></button>)}
      </section>}
      <div className="f-credit-tools"><label className="f-credit-search">Search<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Purchase, provider or reference" aria-label="Search credit purchases"/></label><label className="f-credit-filter">Filter<select value={view} onChange={event => setView(event.target.value)}><option value="active">Active</option><option value="due-soon">Due soon</option><option value="overdue">Overdue</option><option value="zero">0% finance</option><option value="interest">Interest-bearing</option><option value="completed">Completed</option></select></label></div>
      <div className="f-credit-section-head"><div><span className="f-overview-eyebrow">{view === 'completed' ? 'History' : 'Next payment first'}</span><h3>{view === 'completed' ? 'Completed agreements' : 'Active plans'}</h3></div><span className="f-credit-count">{plans.length}</span></div>
      {plans.length ? <div className="f-credit-list">{plans.map(agreement => { const balances = getCreditAgreementBalances(data, agreement), next = agreementNextPayment(data, agreement), nextBalance = next && getCreditInstalmentAmounts(data, agreement, next), status = next ? getCreditInstalmentStatus(data, agreement, next) : getCreditAgreementStatus(data, agreement), paidCount = (agreement.schedule || []).filter(item => !item.supersededAt && getCreditInstalmentAmounts(data, agreement, item).remaining === 0).length; return <button type="button" className="f-credit-plan" key={agreement.id} onClick={() => openAgreement(agreement)}><span className="f-credit-plan-main"><span className="f-credit-plan-name">{agreement.title}</span><span className="f-credit-plan-meta">{agreement.merchant || 'Credit purchase'} · {statusLabels[status] || statusLabels[getCreditAgreementStatus(data, agreement)]}</span></span><strong className="f-credit-plan-balance"><Money amount={balances.totalRemaining} currency={currency} /> <small>left</small></strong><span className="f-credit-plan-next">{next ? <>Next payment <strong><Money amount={nextBalance.remaining} currency={currency}/></strong> · {moneyDate(next.dueDate)}</> : statusLabels[getCreditAgreementStatus(data, agreement)]}</span><span className="f-credit-plan-progress">{agreement.totalRepayable ? `${Math.min(100, Math.round(balances.paidTotal * 100 / agreement.totalRepayable))}% repaid` : 'No payment history'} · {agreement.term} instalments · {agreement.financeCharge ? 'Fixed finance fee' : '0% finance'}</span><span className="f-credit-plan-open" aria-hidden="true">›</span></button>; })}</div> : <div className="f-credit-empty"><strong>{view === 'completed' ? 'No completed agreements yet.' : (data.creditAgreements || []).length ? 'No agreements match this filter.' : 'No credit purchases yet.'}</strong><p>{view === 'completed' ? 'Paid-off and settled plans will be kept here.' : 'Track instalments, Pay Later purchases and financed items here.'}</p>{view === 'active' && <button type="button" className="f-primary" onClick={beginCreate}>＋ Add Credit Purchase</button>}</div>}
    </>}

    {selected && <>
      <div className="f-credit-backline"><button type="button" className="f-button" onClick={() => { setSelectedId(''); setActionError(''); }}>‹ Credit Purchases</button><span className={`f-credit-status f-credit-status-${selectedDisplayStatus}`}>{statusLabels[selectedDisplayStatus]}</span></div>
      <header className="f-credit-detail-header"><div><span className="f-overview-eyebrow">{selected.merchant || 'Credit agreement'}{selected.reference ? ` · ${selected.reference}` : ''}</span><h2 id="credit-purchases-heading">{selected.title}</h2><strong className="f-credit-detail-total"><Money amount={selectedBalances.totalRemaining} currency={currency}/><small> remaining</small></strong></div><div className="f-credit-detail-actions"><button type="button" className="f-primary" disabled={getCreditAgreementStatus(data, selected) !== 'active' || busy} onClick={() => beginPayment(selected)}>Record Payment</button><button type="button" className="f-button" disabled={getCreditAgreementStatus(data, selected) !== 'active' || busy} onClick={() => beginPayment(selected, 'extra')}>Extra payment</button><button type="button" className="f-button" disabled={getCreditAgreementStatus(data, selected) !== 'active' || busy} onClick={() => beginSettlement(selected)}>Settle early</button><button type="button" className="f-button" disabled={getCreditAgreementStatus(data, selected) !== 'active' || busy} onClick={() => beginEdit(selected)}>Edit agreement</button>{getCreditAgreementStatus(data, selected) === 'active' && selectedBalances.paidTotal === 0 && <button type="button" className="f-button" disabled={busy} onClick={() => cancelAgreement(selected)}>Cancel agreement</button>}</div></header>
      <section className="f-credit-progress" aria-label="Credit repayment progress"><div className="f-credit-progress-values"><span>Paid <strong><Money amount={selectedBalances.paidTotal} currency={currency}/></strong></span><span>Remaining <strong><Money amount={selectedBalances.totalRemaining} currency={currency}/></strong></span><span>{paidPercent}% repaid</span></div><div className="f-credit-progress-bar" role="progressbar" aria-label={`${paidPercent}% of credit agreement repaid`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={paidPercent}><span style={{ width: `${paidPercent}%` }}/></div></section>
      <div className="f-credit-detail-metrics"><div><span>Principal remaining</span><strong><Money amount={selectedBalances.principalRemaining} currency={currency}/></strong></div><div><span>Finance cost remaining</span><strong><Money amount={selectedBalances.financeCostRemaining} currency={currency}/></strong></div><div><span>Next payment</span><strong>{agreementNextPayment(data, selected) ? <Money amount={getCreditInstalmentAmounts(data, selected, agreementNextPayment(data, selected)).remaining} currency={currency}/> : '—'}</strong><small>{agreementNextPayment(data, selected) ? moneyDate(agreementNextPayment(data, selected).dueDate) : 'No payment due'}</small>{agreementNextPayment(data, selected) && <button type="button" className="f-button f-credit-reminder-button" onClick={() => remindForNextPayment(selected)}>Set reminder</button>}</div></div>

      {actionError && <p className="f-alert" role="alert">{actionError}</p>}
      {showPaymentForm && <form className="f-credit-form" onSubmit={savePayment}><h3>{paymentMode === 'extra' ? 'Extra principal payment' : 'Record a payment'}</h3>{paymentMode === 'extra' ? <p className="f-help">This payment reduces principal only. Fixed finance fees are not reduced or recalculated.</p> : <label>Instalment<select value={paymentDraft.instalmentId} onChange={event => { const instalment = selectedSchedule.find(item => item.id === event.target.value); setPaymentDraft(current => ({ ...current, instalmentId: event.target.value, amount: instalment ? moneyInput(getCreditInstalmentAmounts(data, selected, instalment).remaining) : '' })); }}><option value="">Choose an instalment</option>{selectedUpcoming.map(item => { const row = getCreditInstalmentAmounts(data, selected, item); return <option key={item.id} value={item.id}>{moneyDate(item.dueDate)} · {formatMoney(row.remaining, currency)} remaining · {statusLabels[getCreditInstalmentStatus(data, selected, item)]}</option>; })}</select></label>}
        <div className="f-credit-form-grid"><label>Amount<input required inputMode="decimal" value={paymentDraft.amount} onChange={event => setPaymentDraft({ ...paymentDraft, amount: event.target.value })}/></label><label>Payment date<input required type="date" value={paymentDraft.date} onChange={event => setPaymentDraft({ ...paymentDraft, date: event.target.value })}/></label><SelectPaidFrom data={data} value={paymentDraft.paidFromFundId} onChange={value => setPaymentDraft({ ...paymentDraft, paidFromFundId: value })}/><label>Note (optional)<input maxLength="300" value={paymentDraft.note} onChange={event => setPaymentDraft({ ...paymentDraft, note: event.target.value })}/></label></div><p className="f-help">Only the amount actually recorded creates a Finance transaction and changes the selected payment source.</p><div className="f-actions"><button className="f-primary" disabled={busy}>{busy ? 'Saving…' : 'Record real payment'}</button><button type="button" className="f-button" onClick={() => setShowPaymentForm(false)}>Cancel</button></div></form>}

      {showSettlementForm && <form className="f-credit-form" onSubmit={saveSettlement}><h3>Settle early</h3><p className="f-help">Enter the lender’s settlement quote. The full scheduled balance will be closed, and remaining instalments will be superseded.</p><div className="f-credit-form-grid"><label>Settlement amount<input required inputMode="decimal" value={settlementDraft.amount} onChange={event => setSettlementDraft({ ...settlementDraft, amount: event.target.value })}/></label><label>Settlement fee (optional)<input inputMode="decimal" value={settlementDraft.fee} onChange={event => setSettlementDraft({ ...settlementDraft, fee: event.target.value })}/></label><label>Payment date<input required type="date" value={settlementDraft.date} onChange={event => setSettlementDraft({ ...settlementDraft, date: event.target.value })}/></label><SelectPaidFrom data={data} value={settlementDraft.paidFromFundId} onChange={value => setSettlementDraft({ ...settlementDraft, paidFromFundId: value })}/><label>Note (optional)<input maxLength="300" value={settlementDraft.note} onChange={event => setSettlementDraft({ ...settlementDraft, note: event.target.value })}/></label></div><div className="f-actions"><button className="f-primary" disabled={busy}>Record settlement</button><button type="button" className="f-button" onClick={() => setShowSettlementForm(false)}>Cancel</button></div></form>}

      {editDraft && <form className="f-credit-form" onSubmit={saveAgreementEdit}><h3>Edit agreement</h3><p className="f-help">Changes recalculate future unpaid instalments. Actual payments and past due dates are preserved.</p><div className="f-credit-form-grid"><label>Purchase name<input required maxLength="100" value={editDraft.title} onChange={event => setEditDraft({ ...editDraft, title: event.target.value })}/></label><label>Provider / lender<input maxLength="100" value={editDraft.merchant} onChange={event => setEditDraft({ ...editDraft, merchant: event.target.value })}/></label><label>Reference<input maxLength="120" value={editDraft.reference} onChange={event => setEditDraft({ ...editDraft, reference: event.target.value })}/></label><label>Fixed finance charge<input required inputMode="decimal" value={editDraft.financeCharge} onChange={event => setEditDraft({ ...editDraft, financeCharge: event.target.value })}/></label><label>Future instalments<input required type="number" min="1" max="600" value={editDraft.term} onChange={event => setEditDraft({ ...editDraft, term: event.target.value })}/></label><label>Next payment date<input required type="date" value={editDraft.firstPaymentDate} onChange={event => setEditDraft({ ...editDraft, firstPaymentDate: event.target.value })}/></label><label>Frequency<select value={editDraft.frequency} onChange={event => setEditDraft({ ...editDraft, frequency: event.target.value })}><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="custom">Custom interval</option></select></label>{editDraft.frequency === 'custom' && <label>Interval in days<input required type="number" min="1" max="365" value={editDraft.customDays} onChange={event => setEditDraft({ ...editDraft, customDays: event.target.value })}/></label>}<label className="f-credit-notes">Notes<textarea maxLength="1000" value={editDraft.notes} onChange={event => setEditDraft({ ...editDraft, notes: event.target.value })}/></label></div><div className="f-actions"><button className="f-primary" disabled={busy}>Update future schedule</button><button type="button" className="f-button" onClick={() => setEditDraft(null)}>Cancel</button></div></form>}

      <div className="f-credit-detail-grid"><section className="f-credit-section"><div className="f-credit-section-head"><div><span className="f-overview-eyebrow">Agreement</span><h3>Purchase &amp; finance terms</h3></div></div><dl className="f-credit-terms"><div><dt>Cash price</dt><dd><Money amount={selected.cashPrice} currency={currency}/></dd></div><div><dt>Deposit paid</dt><dd><Money amount={selected.deposit} currency={currency}/></dd></div><div><dt>Amount financed</dt><dd><Money amount={selected.financedAmount} currency={currency}/></dd></div><div><dt>Finance cost</dt><dd><Money amount={selected.financeCharge} currency={currency}/></dd></div><div><dt>Total repayable</dt><dd><Money amount={selected.totalRepayable} currency={currency}/></dd></div><div><dt>Rate / fee model</dt><dd>{selected.financeCharge ? 'Fixed finance fee' : '0% interest'}</dd></div><div><dt>Purchase date</dt><dd>{moneyDate(selected.purchaseDate)}</dd></div><div><dt>Term</dt><dd>{selected.term} instalments · {selected.frequency === 'custom' ? `every ${selected.customDays} days` : selected.frequency}</dd></div>{selected.notes && <div><dt>Notes</dt><dd>{selected.notes}</dd></div>}</dl>{selected.settlement && <p className="f-help">Settled {moneyDate(selected.settlement.date)} for {formatMoney(selected.settlement.settlementAmount + selected.settlement.settlementFee, currency)}.</p>}</section>

        <section className="f-credit-section"><div className="f-credit-section-head"><div><span className="f-overview-eyebrow">Expected amounts</span><h3>Payment schedule</h3></div><span className="f-credit-count">{selectedSchedule.filter(item => getCreditInstalmentAmounts(data, selected, item).paid >= item.amount).length} / {selected.term} paid</span></div>{visibleSchedule.length ? <div className="f-credit-schedule">{visibleSchedule.map(item => { const row = getCreditInstalmentAmounts(data, selected, item), status = getCreditInstalmentStatus(data, selected, item); return <div className="f-credit-schedule-row" key={item.id}><span>{moneyDate(item.dueDate)}</span><strong><Money amount={item.amount} currency={currency}/></strong><span className={`f-credit-status f-credit-status-${status}`}>{statusLabels[status]}</span>{row.paid > 0 && <small>{formatMoney(row.paid, currency)} paid · {formatMoney(row.remaining, currency)} left</small>}</div>; })}</div> : <p className="f-credit-empty-note">No scheduled payments remain.</p>}{selectedSchedule.length > visibleSchedule.length && <button className="f-button" type="button" onClick={() => setShowAllSchedule(!showAllSchedule)}>{showAllSchedule ? 'Show compact schedule' : 'Show full schedule'}</button>}</section>

        <section className="f-credit-section f-credit-history"><div className="f-credit-section-head"><div><span className="f-overview-eyebrow">Actual payments only</span><h3>Payment history</h3></div><span className="f-credit-count">{payments.length}</span></div>{payments.length ? <div className="f-credit-payment-history">{payments.map(payment => <article className="f-credit-history-row" key={payment.id}><span><strong>{moneyDate(payment.date)}</strong><small>{payment.reversedAt ? 'Reversed · ' : ''}{payment.creditPaymentKind === 'extra' ? 'Extra principal' : payment.creditPaymentKind === 'settlement' ? 'Early settlement' : payment.creditPaymentKind === 'partial' ? 'Partial instalment' : 'Instalment'} · {payment.paidFromFundId || 'Spendable'}{payment.note ? ` · ${payment.note}` : ''}</small></span><strong><Money amount={payment.amount} currency={currency}/></strong><small>Principal {formatMoney(payment.creditPrincipalAmount || 0, currency)} · Fee {formatMoney(payment.creditFinanceCostAmount || 0, currency)}</small></article>)}</div> : <p className="f-credit-empty-note">No real payments recorded yet.</p>}</section>
      </div>
    </>}

    {creating && <dialog className="f-dialog f-credit-dialog" open aria-labelledby="credit-create-heading"><form className="f-form" onSubmit={createAgreement}><div className="f-between"><div><span className="f-overview-eyebrow">New liability</span><h2 id="credit-create-heading">Credit Purchase</h2></div><button type="button" className="f-button" onClick={() => setCreating(false)} aria-label="Close">Close</button></div><div className="f-credit-form-grid"><label>Purchase name<input required maxLength="100" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="e.g. Laptop"/></label><label>Provider / lender<input maxLength="100" value={draft.merchant} onChange={event => setDraft({ ...draft, merchant: event.target.value })} placeholder="e.g. Store Finance"/></label><label>Purchase date<input required type="date" value={draft.purchaseDate} onChange={event => setDraft({ ...draft, purchaseDate: event.target.value })}/></label><label>Cash purchase price<input required inputMode="decimal" value={draft.cashPrice} onChange={event => setDraft({ ...draft, cashPrice: event.target.value })}/></label><label>Deposit paid now<input inputMode="decimal" value={draft.deposit} onChange={event => setDraft({ ...draft, deposit: event.target.value })} placeholder="0.00"/></label><label>Deposit category<select value={draft.categoryId} onChange={event => setDraft({ ...draft, categoryId: event.target.value })}><option value="">Uncategorised</option>{categoryOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{Number(draft.deposit) > 0 && <SelectPaidFrom data={data} value={draft.depositPaidFromFundId} onChange={value => setDraft({ ...draft, depositPaidFromFundId: value })} label="Deposit paid from"/>}<label>Finance cost<select value={draft.financeMode} onChange={event => setDraft({ ...draft, financeMode: event.target.value })}><option value="zero">0% interest</option><option value="fixed">Fixed total finance charge</option></select></label>{draft.financeMode === 'fixed' && <label>Fixed finance charge<input required inputMode="decimal" value={draft.financeCharge} onChange={event => setDraft({ ...draft, financeCharge: event.target.value })}/></label>}<label>Number of instalments<input required type="number" min="1" max="600" value={draft.term} onChange={event => setDraft({ ...draft, term: event.target.value })}/></label><label>Payment frequency<select value={draft.frequency} onChange={event => setDraft({ ...draft, frequency: event.target.value })}><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="custom">Custom interval</option></select></label>{draft.frequency === 'custom' && <label>Interval in days<input required type="number" min="1" max="365" value={draft.customDays} onChange={event => setDraft({ ...draft, customDays: event.target.value })}/></label>}<label>First payment date<input required type="date" value={draft.firstPaymentDate} onChange={event => setDraft({ ...draft, firstPaymentDate: event.target.value })}/></label><label>Agreement / order reference<input maxLength="120" value={draft.reference} onChange={event => setDraft({ ...draft, reference: event.target.value })}/></label><label className="f-credit-notes">Notes<textarea maxLength="1000" value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })}/></label></div>
      {preview && <section className="f-credit-preview" aria-live="polite"><h3>Agreement summary</h3><div><span>Cash price</span><strong><Money amount={preview.cashPrice} currency={currency}/></strong></div><div><span>Deposit paid now</span><strong><Money amount={preview.deposit} currency={currency}/></strong></div><div><span>Amount financed</span><strong><Money amount={preview.financed} currency={currency}/></strong></div><div><span>Finance cost</span><strong><Money amount={preview.fee} currency={currency}/></strong></div><div><span>Total repayable</span><strong><Money amount={preview.total} currency={currency}/></strong></div><p>{preview.count} payments · first {formatMoney(preview.first, currency)}{preview.last !== preview.first ? `, final ${formatMoney(preview.last, currency)}` : ''} · starts {moneyDate(draft.firstPaymentDate)}</p></section>}
      <p className="f-help">Only a deposit paid now changes Finance cash. Financed principal creates a liability; instalments affect balances only when you record them. APR is not estimated here.</p>{createError && <p className="f-alert" role="alert">{createError}</p>}<div className="f-actions"><button className="f-primary" disabled={busy}>{busy ? 'Saving…' : 'Create credit agreement'}</button><button type="button" className="f-button" onClick={() => setCreating(false)}>Cancel</button></div></form></dialog>}
  </section>;
}
