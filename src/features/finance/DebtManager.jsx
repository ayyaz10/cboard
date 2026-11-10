import { useEffect, useRef, useState } from 'react';
import { Badge } from '../../components/ui/Badge.jsx';
import { convertMinorUnits, financeCurrencies, getCurrencyQuote } from '../../services/currencyService.js';
import { id, today } from './financeData.js';
import { formatMoney, moneyInput, parseMoney } from './financeMath.js';
import { debtPlanStatus } from './financeDebtPlans.js';
import {
  accrueDebtPayment, canDeleteDebt, canEditDebtPayment, canMarkDebtPaymentUnpaid,
  correctDebtPayment, debtAccrualSettlementStatus, debtPaymentDue, debtPaymentSummary,
  debtRemainingAmount, debtRemainingSourceAmount, deleteDebt, editDebtAccumulation,
  filterDebts, markDebtPaymentUnpaid, reconcileDebtBalance, recordDebtPaymentState,
  removeDebtAccumulation, setDebtArchived,
} from './debtAccounting.js';
import { deriveFinancePosition } from './financeLedger.js';
import { DebtDetail } from './DebtDetail.jsx';
import { autoAllocationEvents } from './autoAllocationHistory.js';

const Button = ({ primary = false, className = '', ...props }) => <button type="button" className={`${primary ? 'f-primary' : 'f-button'} ${className}`} {...props}/>;
const Money = ({ amount, currency }) => <>{formatMoney(amount, currency)}</>;

function Dialog({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="f-dialog" aria-labelledby="f-debt-dialog-title" onCancel={onClose} onClose={onClose}>
    <div className="f-between"><h2 id="f-debt-dialog-title">{title}</h2><Button aria-label="Close dialog" onClick={onClose}>Close</Button></div>{children}
  </dialog>;
}

function moneyDraft(settings) {
  return { name: '', amount: '', currency: settings.currency || 'GBP', date: today(), note: '', dueDate: '', priority: 'medium' };
}

export function DebtManager({ data, month, setMonth, change, requestMoney, confirmAction, openDeduction, openTransactionDetail, userId, debtId, openDebt, backToDebtList }) {
  const base = data.settings.currency;
  const storageKey = `finance-debt-list:${userId || 'session'}`;
  const [listState, setListState] = useState(() => {
    try { return { filter: 'active', query: '', ...JSON.parse(sessionStorage.getItem(storageKey) || '{}') }; }
    catch { return { filter: 'active', query: '' }; }
  });
  const [form, setForm] = useState(() => moneyDraft(data.settings));
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState('');
  const [confirmOriginalChange, setConfirmOriginalChange] = useState(false);
  const [error, setError] = useState('');
  const [accumulation, setAccumulation] = useState(null);
  const [paymentEdit, setPaymentEdit] = useState(null);
  const [starting, setStarting] = useState(null);
  const [plan, setPlan] = useState({ mode: 'amount', amount: '', frequency: 'monthly', date: today(), automatic: false });
  const [saving, setSaving] = useState(false);
  const monthLabel = new Date(`${month}-15T12:00:00`).toLocaleDateString([], { month: 'long', year: 'numeric' });
  const visibleDebts = filterDebts(data, { status: listState.filter, query: listState.query });
  const activeDebts = data.debts.filter(item => !item.archivedAt && debtRemainingAmount(data, item.id) > 0);
  const totalRemaining = activeDebts.reduce((sum, item) => sum + debtRemainingAmount(data, item.id), 0);
  const totalAccumulated = debtPaymentDue(data);
  const actuallyPaid = (data.debtPayments || []).filter(item => !item.reversedAt).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const currentDebt = debtId ? data.debts.find(item => item.id === debtId) : null;
  const preview = useCurrencyPreview(form.amount, form.currency, base);

  useEffect(() => { try { sessionStorage.setItem(storageKey, JSON.stringify(listState)); } catch { /* private session state is optional */ } }, [storageKey, listState]);

  function begin(item) {
    setEditing(item.id); setConfirmOriginalChange(false); setError('');
    setForm({ ...moneyDraft(data.settings), name: item.name || '', amount: moneyInput(item.sourceOriginal ?? item.original), currency: item.sourceCurrency || base, note: item.notes || '', dueDate: item.dueDate || '', priority: item.priority || 'medium' });
  }

  async function saveDebt(event) {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      const sourceOriginal = parseMoney(form.amount), quote = await getCurrencyQuote(form.currency, base), original = convertMinorUnits(sourceOriginal, quote.rate);
      const old = data.debts.find(item => item.id === editing);
      const paidBase = (data.debtPayments || []).filter(item => item.debtId === editing && !item.reversedAt).reduce((sum, item) => sum + Number(item.amount || 0), 0);
      if (original < paidBase) throw new Error('Original debt cannot be lower than payments already recorded.');
      const originalChanged = Boolean(old && original !== old.original);
      if (originalChanged && paidBase && !confirmOriginalChange) throw new Error('Review and confirm the updated debt remaining before saving.');
      const saved = await change(state => {
        const existing = editing ? state.debts.find(item => item.id === editing) : null;
        const record = { name: form.name.trim(), original, remaining: Math.max(0, original - paidBase), sourceCurrency: form.currency, sourceOriginal, sourceRemaining: Math.max(0, sourceOriginal - (state.debtPayments || []).filter(item => item.debtId === editing && !item.reversedAt).reduce((sum, item) => sum + Number(item.sourceAmount ?? item.amount ?? 0), 0)), exchangeRate: quote.rate, rateDate: quote.date, startedOn: existing?.startedOn || form.date || today(), createdAt: existing?.createdAt || new Date().toISOString(), dueDate: form.dueDate, priority: form.priority, notes: form.note.trim(), status: original > paidBase ? 'open' : 'paid', repaymentPlanStatus: existing?.repaymentPlanStatus || (original > paidBase ? 'not_started' : 'completed') };
        if (existing) Object.assign(existing, record);
        else state.debts.push({ id: id(), ...record });
        return state;
      }, editing ? 'Debt updated' : 'Debt added');
      if (saved) { setEditing(''); setForm(moneyDraft(data.settings)); setConfirmOriginalChange(false); if (!editing) setShowCreate(false); }
    } catch (cause) { setError(cause.message); }
    finally { setSaving(false); }
  }

  function startAccumulation(debt, entry = null) {
    setAccumulation({ debtId: debt.id, entryId: entry?.id || '', amount: entry ? moneyInput(entry.accruedAmount ?? entry.amount) : '', date: entry?.effectiveDate || today(), note: entry?.note || '' });
  }

  async function saveAccumulation(event) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const amount = parseMoney(accumulation.amount);
      const saved = await change(state => {
        if (accumulation.entryId) editDebtAccumulation(state, accumulation.entryId, { amount, effectiveDate: accumulation.date, note: accumulation.note });
        else if (!accrueDebtPayment(state, { debtId: accumulation.debtId, amount, effectiveDate: accumulation.date, sourceType: 'manual', note: accumulation.note })) throw new Error('This amount cannot be added to the remaining debt.');
        return state;
      }, accumulation.entryId ? 'Accumulation updated' : 'Amount added to accumulated');
      if (saved) setAccumulation(null);
    } catch (cause) { setError(cause.message); }
    finally { setSaving(false); }
  }

  async function removeAccumulation(entry) {
    if (!await confirmAction({ title: 'Remove accumulated amount?', message: 'This changes Accumulated to pay only. Debt remaining and Finance balances stay the same.', confirmLabel: 'Remove amount' })) return;
    try { await change(state => { if (!removeDebtAccumulation(state, entry.id, today())) throw new Error('This accumulation is already removed.'); return state; }, 'Accumulated amount removed'); }
    catch (cause) { setError(cause.message); }
  }

  async function recordPayment(debt) {
    const source = debt.sourceCurrency || base;
    const remaining = debtRemainingAmount(data, debt.id), due = debtPaymentDue(data, debt.id), sourceRemaining = debtRemainingSourceAmount(data, debt.id);
    const fundOptions = Object.entries(deriveFinancePosition(data).funds).filter(([key, value]) => value > 0 && !key.startsWith('asset:')).map(([fundId, amount]) => ({ id: fundId, label: fundId, amount }));
    let initialAmount = Math.min(due || remaining, sourceRemaining);
    if (source !== base) initialAmount = Math.min(sourceRemaining, convertMinorUnits(Math.min(due || remaining, remaining), (await getCurrencyQuote(base, source)).rate));
    requestMoney({ title: `Record payment to ${debt.name}`, description: `${formatMoney(due, base)} is accumulated. You may record more than that, up to the ${formatMoney(remaining, base)} debt remaining. Record this after the real payment has happened.`, currency: source, convertTo: base, initialAmount, dateField: true, initialDate: today(), label: `Amount in ${source}`, submitLabel: 'Record payment', fundOptions, onSubmit: async (sourceAmount, date, paidFromFundId) => {
      const quote = await getCurrencyQuote(source, base), amount = convertMinorUnits(sourceAmount, quote.rate);
      if (amount > remaining) throw new Error(`Payment cannot exceed the remaining debt of ${formatMoney(remaining, base)}.`);
      return change(state => recordDebtPaymentState(state, { debtId: debt.id, amount, sourceAmount, sourceCurrency: source, exchangeRate: quote.rate, rateDate: quote.date, date, paidFromFundId }), 'Debt payment recorded');
    } });
  }

  function beginPaymentCorrection(payment) {
    const transaction = data.transactions.find(item => item.id === payment.transactionId);
    setPaymentEdit({ id: payment.id, amount: moneyInput(payment.amount), date: payment.date || today(), note: transaction?.note || '' });
  }

  async function savePaymentCorrection(event) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const amount = parseMoney(paymentEdit.amount);
      const saved = await change(state => { if (!correctDebtPayment(state, paymentEdit.id, { amount, date: paymentEdit.date, note: paymentEdit.note })) throw new Error('No payment changes to save.'); return state; }, 'Debt payment corrected');
      if (saved) setPaymentEdit(null);
    } catch (cause) { setError(cause.message); }
    finally { setSaving(false); }
  }

  async function reversePayment(payment) {
    const transaction = data.transactions.find(item => item.id === payment.transactionId);
    if (!transaction || !canMarkDebtPaymentUnpaid(data, transaction)) return;
    const message = `Reverse ${formatMoney(payment.amount, base)}? This restores the amount to ${payment.paidFromFundId || 'Spendable'}, increases Debt Remaining, reopens accumulated amounts that this payment settled, and removes the payment from active Paid totals. The historical transaction will remain marked as reversed.`;
    if (!await confirmAction({ title: 'Reverse payment?', message, confirmLabel: 'Reverse payment' })) return;
    try { await change(state => { if (!markDebtPaymentUnpaid(state, transaction.id, today())) throw new Error('This payment could not be reversed.'); return state; }, 'Debt payment reversed'); }
    catch (cause) { setError(cause.message); }
  }

  function startPlan(debt) {
    const activeRule = (data.allocationRules || []).find(item => item.targetType === 'debt' && item.targetId === debt.id && item.active);
    const mode = debt.plannedPaymentMode || 'amount';
    setStarting(debt);
    setPlan({ mode, amount: mode === 'percentage' ? String(Number(debt.plannedPaymentPercent || 0) / 100) : mode === 'income_percentage' ? String(Number(debt.plannedIncomePercent || 0) / 100) : debt.plannedAmount ? moneyInput(debt.plannedAmount) : '', frequency: debt.frequency || 'monthly', date: debt.repaymentStartDate || today(), automatic: mode === 'income_percentage' || Boolean(activeRule) });
  }

  async function savePlan(event) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const isPercent = ['percentage', 'income_percentage'].includes(plan.mode), percent = isPercent ? Number(plan.amount) : 0;
      if (isPercent && (!Number.isFinite(percent) || percent <= 0 || percent > 100)) throw new Error('Enter a percentage greater than 0 and no more than 100.');
      const percentageUnits = isPercent ? Math.round(percent * 100) : 0;
      const amount = plan.mode === 'percentage' ? Math.round(starting.original * percentageUnits / 10_000) : plan.mode === 'income_percentage' ? 0 : parseMoney(plan.amount);
      if (plan.mode !== 'income_percentage' && amount <= 0) throw new Error('Enter a plan amount greater than zero.');
      const automatic = plan.mode === 'income_percentage' || plan.automatic;
      if (automatic && plan.mode !== 'income_percentage' && plan.frequency !== 'monthly') throw new Error('Automatic fixed accumulation currently supports monthly plans.');
      await change(state => {
        const debt = state.debts.find(item => item.id === starting.id);
        Object.assign(debt, { plannedPaymentMode: plan.mode, plannedPaymentPercent: plan.mode === 'percentage' ? percentageUnits : 0, plannedIncomePercent: plan.mode === 'income_percentage' ? percentageUnits : 0, plannedAmount: amount, frequency: plan.frequency, repaymentStartDate: plan.date, repaymentPlanStatus: plan.date > today() ? 'scheduled' : 'active' });
        let rule = state.allocationRules.find(item => item.targetType === 'debt' && item.targetId === debt.id);
        if (automatic) {
          const record = { name: `${debt.name} accumulation`, targetType: 'debt', targetId: debt.id, mode: plan.mode === 'income_percentage' ? 'percent' : 'amount', value: plan.mode === 'income_percentage' ? percentageUnits : amount, timing: plan.mode === 'income_percentage' ? 'income' : 'monthly', day: Number(plan.date.slice(8, 10)) || 1, startedOn: plan.date, active: true };
          if (rule) Object.assign(rule, record); else state.allocationRules.push({ id: id(), ...record });
        } else if (rule) rule.active = false;
        return state;
      }, plan.date > today() ? 'Automatic accumulation scheduled' : 'Automatic accumulation started');
      setStarting(null);
    } catch (cause) { setError(cause.message); }
    finally { setSaving(false); }
  }

  async function changePlanStatus(debt, paused) {
    try {
      await change(state => {
        const item = state.debts.find(value => value.id === debt.id);
        if (!item) throw new Error('This debt no longer exists.');
        item.repaymentPlanStatus = paused ? 'paused' : item.repaymentStartDate > today() ? 'scheduled' : 'active';
        const rules = (state.allocationRules || []).filter(rule => rule.targetType === 'debt' && rule.targetId === item.id);
        for (const rule of rules) rule.active = !paused;
        return state;
      }, paused ? 'Automatic accumulation paused' : 'Automatic accumulation resumed');
    } catch (cause) { setError(cause.message); }
  }

  async function archive(debt) {
    const archiving = !debt.archivedAt;
    await change(state => { if (!setDebtArchived(state, debt.id, archiving)) throw new Error('Debt status has changed. Refresh and try again.'); return state; }, archiving ? 'Debt archived' : 'Debt restored');
    if (archiving) backToDebtList();
  }

  async function remove(debt) {
    if (!canDeleteDebt(data, debt.id)) { setError('This debt has history. Archive it to preserve the records.'); return; }
    if (!await confirmAction({ title: 'Delete debt?', message: `Delete ${debt.name}? This debt has no payments or accumulated history.`, confirmLabel: 'Delete debt' })) return;
    try { await change(state => { if (!deleteDebt(state, debt.id)) throw new Error('This debt now has history and cannot be deleted.'); return state; }, 'Debt deleted'); backToDebtList(); }
    catch (cause) { setError(cause.message); }
  }

  const allDue = totalAccumulated;
  const addedThisMonth = (data.debtAccruals || []).filter(item => item.status !== 'reversed' && String(item.effectiveDate || '').startsWith(month)).reduce((sum, item) => sum + Number(item.accruedAmount ?? item.amount ?? 0), 0);
  const paidThisMonth = (data.debtPayments || []).filter(item => !item.reversedAt && String(item.date || '').startsWith(month)).reduce((sum, item) => sum + Number(item.amount || 0), 0);

  return <div className="f-debt-hub">
    {debtId && currentDebt ? (() => {
      const debt = currentDebt, remaining = debtRemainingAmount(data, debt.id), sourceCurrency = debt.sourceCurrency || base, sourceRemaining = debtRemainingSourceAmount(data, debt.id), metrics = debtPaymentSummary(data, debt.id, month), status = debt.archivedAt ? 'archived' : debtPlanStatus({ ...debt, remaining }, data.allocationRules), progress = debt.original ? Math.min(10_000, Math.round((debt.original - remaining) * 10_000 / debt.original)) : 0;
      const activeRule = (data.allocationRules || []).find(item => item.targetType === 'debt' && item.targetId === debt.id && item.active);
      const planLabel = debt.plannedPaymentMode === 'income_percentage' ? `${(Number(debt.plannedIncomePercent || 0) / 100).toFixed(2)}% of eligible income` : activeRule ? activeRule.mode === 'percent' ? `${(Number(activeRule.value || 0) / 100).toFixed(2)}% of eligible income` : `${formatMoney(activeRule.value, base)} monthly` : debt.plannedAmount ? `${formatMoney(debt.plannedAmount, base)} ${debt.frequency || 'per month'}` : 'No automatic accumulation plan';
      const accumulations = (data.debtAccruals || []).filter(item => item.debtId === debt.id && item.status !== 'reversed').slice().sort((a, b) => String(b.effectiveDate).localeCompare(String(a.effectiveDate)));
      const payments = (data.debtPayments || []).filter(item => item.debtId === debt.id).slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map(payment => ({ ...payment, note: data.transactions.find(item => item.id === payment.transactionId)?.note || '' }));
      const canDelete = canDeleteDebt(data, debt.id);
      return <DebtDetail debt={debt} currency={base} sourceCurrency={sourceCurrency} sourceRemaining={sourceRemaining} remaining={remaining} status={status} metrics={metrics} progress={progress} planLabel={planLabel} accumulations={accumulations} incomeAllocations={autoAllocationEvents(data).filter(event=>event.allocationType==='debt'&&event.targetId===debt.id)} payments={payments} getSettlementStatus={debtAccrualSettlementStatus} getPaymentSource={fundId => fundId || 'Spendable'} canEditPayment={payment => canEditDebtPayment(data, payment.id)} canReversePayment={payment => { const transaction = data.transactions.find(item => item.id === payment.transactionId); return canMarkDebtPaymentUnpaid(data, transaction); }} openTransactionDetail={transactionId=>{const transaction=data.transactions.find(item=>item.id===transactionId);if(transaction)openTransactionDetail?.(transaction)}} onBack={backToDebtList} onRecordPayment={() => recordPayment(debt)} onAddAccumulation={() => startAccumulation(debt)} onEditAccumulation={entry => startAccumulation(debt, entry)} onRemoveAccumulation={removeAccumulation} onEditPayment={beginPaymentCorrection} onReversePayment={reversePayment} onEditDebt={() => begin(debt)} onEditPlan={() => startPlan(debt)} onPause={() => changePlanStatus(debt, true)} onResume={() => changePlanStatus(debt, false)} onArchive={() => archive(debt)} onDelete={() => remove(debt)} canDelete={canDelete}>
        {editing === debt.id && <form className="f-form f-debt-edit-form" onSubmit={saveDebt}><h3>Edit debt</h3><label>Name<input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })}/></label><label>Note<textarea value={form.note} onChange={event => setForm({ ...form, note: event.target.value })}/></label><label>Original debt currency<select value={form.currency} onChange={event => setForm({ ...form, currency: event.target.value })}>{financeCurrencies.map(([code, name]) => <option key={code} value={code}>{code} — {name}</option>)}</select></label><label>Original amount<input required inputMode="decimal" value={form.amount} onChange={event => { setConfirmOriginalChange(false); setForm({ ...form, amount: event.target.value }); }}/></label>{preview.converted != null && preview.converted !== debt.original && metrics.paidAllTime > 0 && <div className="f-debt-impact"><strong>Review change before saving</strong><p>Original debt: {formatMoney(debt.original, base)} → {formatMoney(preview.converted, base)}</p><p>Debt remaining: {formatMoney(remaining, base)} → {formatMoney(Math.max(0, preview.converted - metrics.paidAllTime), base)}</p><label className="f-checkbox-row"><input type="checkbox" checked={confirmOriginalChange} onChange={event => setConfirmOriginalChange(event.target.checked)}/><span>I understand this changes the remaining amount owed.</span></label></div>}<label>Due date<input type="date" value={form.dueDate} onChange={event => setForm({ ...form, dueDate: event.target.value })}/></label><label>Priority<select value={form.priority} onChange={event => setForm({ ...form, priority: event.target.value })}>{['low', 'medium', 'high'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>{error&&<p className="f-alert" role="alert">{error}</p>}<div className="f-actions"><button className="f-primary" disabled={saving||Boolean(metrics.paidAllTime>0&&preview.converted!=null&&preview.converted!==debt.original&&!confirmOriginalChange)}>{saving?'Saving…':'Save debt'}</button><Button onClick={() => setEditing('')}>Cancel</Button></div></form>}
      </DebtDetail>;
    })() : debtId ? <section className="f-debt-empty-state"><h2>Debt not found</h2><p>This debt may have been removed. Your other debts are still available in the list.</p><Button onClick={backToDebtList}>Back to debts</Button></section> : <>
      <header className="f-debt-list-heading"><div><p className="f-debt-eyebrow">Finance</p><h2>Money to Pay Back</h2><p className="f-help">See what remains, what you have set aside, and what you have actually paid.</p></div><Button primary onClick={() => { setEditing(''); setForm(moneyDraft(data.settings)); setShowCreate(true); requestAnimationFrame(() => document.getElementById('debt-create-name')?.focus()); }}>＋ Add debt</Button></header>
      <section className="f-debt-overview" aria-label="Debt overview"><div className="f-debt-overview-primary"><span>Total debt remaining</span><strong>{formatMoney(totalRemaining, base)}</strong></div><div><span>Accumulated to pay</span><strong>{formatMoney(allDue, base)}</strong></div><div><span>Actually paid</span><strong>{formatMoney(actuallyPaid, base)}</strong></div><div><span>Active debts</span><strong>{activeDebts.length}</strong></div></section>
      <section className="f-debt-monthly"><div><strong>{monthLabel}</strong><p className="f-help">Monthly flow</p></div><span>Added to accumulated <strong>{formatMoney(addedThisMonth, base)}</strong></span><span>Actually paid <strong>{formatMoney(paidThisMonth, base)}</strong></span><div className="f-actions"><Button aria-label="Previous month" onClick={() => setMonth(value => shiftMonth(value, -1))}>‹</Button><Button aria-label="Next month" onClick={() => setMonth(value => shiftMonth(value, 1))}>›</Button></div></section>
      <div className="f-debt-list-controls"><label><span className="sr-only">Search debts by name or note</span><input className="f-input" type="search" placeholder="Search name or note" value={listState.query} onChange={event => setListState(current => ({ ...current, query: event.target.value }))}/></label><label><span className="sr-only">Filter debts</span><select className="f-input" value={listState.filter} onChange={event => setListState(current => ({ ...current, filter: event.target.value }))}><option value="active">Active</option><option value="paused">Paused</option><option value="paid">Paid off</option><option value="archived">Archived</option><option value="all">All debts</option></select></label></div>
      {error&&<p className="f-alert" role="alert">{error}</p>}
      {visibleDebts.length ? <div className="f-debt-list">{visibleDebts.map(debt => {
        const remaining = debtRemainingAmount(data, debt.id), metrics = debtPaymentSummary(data, debt.id, month), status = debt.archivedAt ? 'archived' : debtPlanStatus({ ...debt, remaining }, data.allocationRules), rule = (data.allocationRules || []).find(item => item.targetType === 'debt' && item.targetId === debt.id && item.active), planLabel = debt.plannedPaymentMode === 'income_percentage' ? `${(Number(debt.plannedIncomePercent || 0) / 100).toFixed(2)}% of income` : rule?.mode === 'percent' ? `${(Number(rule.value || 0) / 100).toFixed(2)}% of income` : rule ? `${formatMoney(rule.value, base)} / month` : 'No automatic plan';
        return <article className="f-debt-list-row" key={debt.id}><button type="button" className="f-debt-open" onClick={() => openDebt(debt.id)} aria-label={`Open ${debt.name}, ${formatMoney(remaining, base)} remaining`}><span className="f-debt-open-top"><strong>{debt.name}</strong><strong>{formatMoney(remaining, base)} <small>left</small></strong></span><span className="f-debt-open-metrics"><span>Accumulated <strong>{formatMoney(metrics.due, base)}</strong></span><span>Paid <strong>{formatMoney(metrics.paidAllTime, base)}</strong></span></span><span className="f-debt-open-footer"><span>{planLabel}</span><Badge variant={status === 'completed' ? 'success' : status === 'paused' ? 'warning' : 'neutral'}>{debt.archivedAt ? 'Archived' : status === 'completed' ? 'Paid off' : status === 'paused' ? 'Paused' : 'Active'}</Badge><span aria-hidden="true">›</span></span></button></article>;
      })}</div> : <section className="f-debt-empty-state"><h3>{listState.filter === 'active' ? 'No active debts' : 'No debts match this view'}</h3><p>Track money you need to pay back while keeping planned amounts separate from actual payments.</p>{listState.filter === 'active'&&<Button primary onClick={() => { setShowCreate(true); requestAnimationFrame(() => document.getElementById('debt-create-name')?.focus()); }}>＋ Add debt</Button>}</section>}
      {showCreate&&<form id="debt-create-form" className="f-form f-debt-create-form" onSubmit={saveDebt}><h3>Add a debt</h3><label>Name<input id="debt-create-name" required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })}/></label><label>Original amount<input required inputMode="decimal" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })}/></label><label>Currency<select value={form.currency} onChange={event => setForm({ ...form, currency: event.target.value })}>{financeCurrencies.map(([code, name]) => <option key={code} value={code}>{code} — {name}</option>)}</select></label><label>Start date<input type="date" value={form.date} onChange={event => setForm({ ...form, date: event.target.value })}/></label><label>Note (optional)<textarea value={form.note} onChange={event => setForm({ ...form, note: event.target.value })}/></label><label>Due date (optional)<input type="date" value={form.dueDate} onChange={event => setForm({ ...form, dueDate: event.target.value })}/></label><label>Priority<select value={form.priority} onChange={event => setForm({ ...form, priority: event.target.value })}>{['low', 'medium', 'high'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>{error&&<p className="f-alert" role="alert">{error}</p>}<div className="f-actions"><Button primary disabled={saving||preview.loading}>{saving?'Saving…':'Add debt'}</Button><Button onClick={() => setShowCreate(false)}>Cancel</Button></div></form>}
    </>}

    {accumulation&&<Dialog title={accumulation.entryId?'Edit accumulated amount':'Add to accumulated'} onClose={() => setAccumulation(null)}><form className="f-form" onSubmit={saveAccumulation}><p className="f-help">This changes Accumulated to pay only. It does not move money or reduce Debt Remaining.</p><label>Amount<input required inputMode="decimal" value={accumulation.amount} onChange={event => setAccumulation({ ...accumulation, amount: event.target.value })}/></label><label>Date<input required type="date" value={accumulation.date} onChange={event => setAccumulation({ ...accumulation, date: event.target.value })}/></label><label>Note (optional)<input value={accumulation.note} onChange={event => setAccumulation({ ...accumulation, note: event.target.value })}/></label>{error&&<p className="f-alert" role="alert">{error}</p>}<div className="f-actions"><button className="f-primary" disabled={saving}>{saving?'Saving…':'Save accumulation'}</button><Button onClick={() => setAccumulation(null)}>Cancel</Button></div></form></Dialog>}
    {paymentEdit&&<Dialog title="Correct payment" onClose={() => setPaymentEdit(null)}><form className="f-form" onSubmit={savePaymentCorrection}><p className="f-help">This updates the existing Finance transaction and reallocates accumulated amounts oldest first.</p><label>Correct amount<input required inputMode="decimal" value={paymentEdit.amount} onChange={event => setPaymentEdit({ ...paymentEdit, amount: event.target.value })}/></label><label>Payment date<input required type="date" value={paymentEdit.date} onChange={event => setPaymentEdit({ ...paymentEdit, date: event.target.value })}/></label><label>Note (optional)<input value={paymentEdit.note} onChange={event => setPaymentEdit({ ...paymentEdit, note: event.target.value })}/></label>{error&&<p className="f-alert" role="alert">{error}</p>}<div className="f-actions"><button className="f-primary" disabled={saving}>{saving?'Saving…':'Save correction'}</button><Button onClick={() => setPaymentEdit(null)}>Cancel</Button></div></form></Dialog>}
    {starting&&<Dialog title={`Automatic accumulation: ${starting.name}`} onClose={() => setStarting(null)}><form className="f-form" onSubmit={savePlan}><p className="f-help">Eligible income will add to Accumulated to pay. No money leaves Finance until you record an actual payment.</p><label>Plan type<select value={plan.mode} onChange={event => setPlan({ ...plan, mode: event.target.value, amount: '' })}><option value="amount">Fixed amount</option><option value="percentage">Percentage of original debt</option><option value="income_percentage">Percentage of eligible income</option></select></label><label>{plan.mode === 'income_percentage' ? 'Percent of eligible income' : plan.mode === 'percentage' ? 'Percent of original debt' : `Amount per period (${base})`}<input required inputMode="decimal" value={plan.amount} onChange={event => setPlan({ ...plan, amount: event.target.value })}/></label>{plan.mode !== 'income_percentage'&&<label>Frequency<select value={plan.frequency} onChange={event => setPlan({ ...plan, frequency: event.target.value })}><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>}<label>Starts<input required type="date" value={plan.date} onChange={event => setPlan({ ...plan, date: event.target.value })}/></label>{plan.mode !== 'income_percentage'&&<label className="f-checkbox-row"><input type="checkbox" checked={plan.automatic} onChange={event => setPlan({ ...plan, automatic: event.target.checked })}/><span>Automatically add to accumulated monthly</span></label>}{error&&<p className="f-alert" role="alert">{error}</p>}<div className="f-actions"><button className="f-primary" disabled={saving}>{saving?'Saving…':'Save plan'}</button><Button onClick={() => setStarting(null)}>Cancel</Button></div></form></Dialog>}
  </div>;
}

function useCurrencyPreview(amount, from, to) {
  const [quote, setQuote] = useState(null);
  useEffect(() => { let active = true; if (!amount || Number(amount) <= 0) { setQuote(null); return undefined; } getCurrencyQuote(from, to).then(value => { if (active) setQuote(value); }).catch(() => { if (active) setQuote(null); }); return () => { active = false; }; }, [amount, from, to]);
  if (!quote || !amount || from === to) return { converted: from === to && amount ? parseMoney(amount) : null, loading: Boolean(amount && from !== to && !quote) };
  try { return { converted: convertMinorUnits(parseMoney(amount), quote.rate), loading: false }; } catch { return { converted: null, loading: false }; }
}
