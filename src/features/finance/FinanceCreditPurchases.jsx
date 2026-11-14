import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { deriveFinancePosition } from './financeLedger.js';
import { formatMoney, moneyInput, parseMoney } from './financeMath.js';
import { id, today } from './financeData.js';
import { useReminders } from '../focusTimer/ReminderProvider.jsx';
import { RecordMetadataFields, RecordMetadataView } from './RecordMetadataFields.jsx';
import { Dialog } from '../../components/ui/Dialog.jsx';
import { validateRecordMetadata } from './recordMetadata.js';
import { archiveCreditAgreement, calculateRemainingBalance, calculateRemainingInstallmentCount, canDeleteCreditPurchase, cancelCreditAgreement, createCreditAgreement, createCreditPurchaseRefundState, createCreditTransactionIndex, deleteUnusedCreditAgreement, generateCreditSchedule, generateAprCreditSchedule, getCreditAgreementBalances, getCreditAgreementMonthlyCommitment, getCreditAgreementRepaymentSummary, getCreditAgreementStatus, getCreditDueSoon, getCreditInstalmentAmounts, getCreditInstalmentStatus, getCreditOverview, getCreditPaymentTransactions, getCreditPurchaseDeleteBlockReason, getOverdueCreditPayments, remainingCreditPurchaseRefund, receiveCreditPurchaseRefundState, reverseCreditPurchaseRefundState, mutateCreditState, planCreditReminderReconciliation, buildCreditScheduleRevision, getCreditAgreementRevisionFingerprint, getCreditScheduleRevisionCounts, recordCreditPayment, restoreCreditAgreement, reverseCreditPayment, settleCreditAgreement, updateCreditAgreement, updateCreditInstalment, updateCreditPayment } from './creditPurchases.js';

const moneyDate = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date not set';
const statusLabels = { active: 'Active', cancelled: 'Cancelled', paid_off: 'Paid off', settled_early: 'Settled early', due: 'Due today', due_soon: 'Due soon', overdue: 'Overdue', partial: 'Partially paid', partial_overdue: 'Part-paid · overdue', paid: 'Paid', upcoming: 'Upcoming', superseded: 'Superseded' };
const firstPaymentDefault = () => {
  const [year, month, day] = today().split('-').map(Number);
  const monthIndex = month;
  const nextYear = year + Math.floor(monthIndex / 12), nextMonth = monthIndex % 12;
  const lastDay = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(nextYear, nextMonth, Math.min(day, lastDay))).toISOString().slice(0, 10);
};
const blankDraft = categoryId => ({ title: '', merchant: '', reference: '', productUrl: '', purchaseDate: today(), depositDate: today(), deposit: '', upfrontCountsAsFirstInstalment: false, categoryId, financeMode: 'zero', financeCharge: '', apr: '', term: '12', scheduleMode: 'auto', customSchedule: [], frequency: 'monthly', customDays: '30', firstPaymentDate: firstPaymentDefault(), depositPaidFromFundId: '', notes: '', vehicleMetadata: {}, customFields: [] });
const monthName = value => new Date(`${value}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

function Money({ amount, currency }) { return <>{formatMoney(amount, currency)}</>; }

export function FinanceCreditPurchasesLoading() {
  return <section className="f-credit-loading" role="status" aria-live="polite" aria-label="Loading Credit Purchases">
    <div className="f-credit-loading-label"><span className="f-credit-spinner" aria-hidden="true"/>Loading Credit Purchases…</div>
    <div className="f-credit-loading-metrics" aria-hidden="true">{Array.from({ length: 3 }, (_, index) => <span key={index}/>)}</div>
    <div className="f-credit-loading-cards" aria-hidden="true">{Array.from({ length: 3 }, (_, index) => <span key={index}/>)}</div>
  </section>;
}

function creditHistoryLabel(entry, currency) {
  const date = moneyDate(entry.date || entry.createdAt?.slice(0, 10));
  if (entry.type === 'payment_reversed') return `Payment marked unpaid · ${formatMoney(entry.amount, currency)} · ${date}`;
  if (entry.type === 'payment_corrected') return `Payment corrected · ${formatMoney(entry.before.amount, currency)} to ${formatMoney(entry.after.amount, currency)} · ${date}`;
  if (entry.type === 'deposit_corrected') return `Purchase price or deposit corrected · ${date}`;
  if (entry.type === 'instalment_updated') return `Future instalment changed from ${moneyDate(entry.before.dueDate)} / ${formatMoney(entry.before.amount, currency)} to ${moneyDate(entry.after.dueDate)} / ${formatMoney(entry.after.amount, currency)} · ${date}`;
  if (entry.type === 'schedule_updated') return `Future repayment schedule updated · ${date}`;
  if (entry.type === 'agreement_cancelled') return `Agreement cancelled · ${date}`;
  if (entry.type === 'agreement_archived') return `Agreement archived · ${date}`;
  if (entry.type === 'agreement_restored') return `Agreement restored · ${date}`;
  return `Agreement updated · ${date}`;
}

function CreditMetric({ label, amount, currency, hint, action, value }) {
  const content = <><span>{label}</span><strong>{value ?? <Money amount={amount} currency={currency}/>}</strong>{hint && <small>{hint}</small>}</>;
  return action ? <button type="button" className="f-credit-metric" onClick={action}>{content}</button> : <div className="f-credit-metric">{content}</div>;
}

function agreementNextPayment(state, agreement, transactionIndex) {
  return getCreditAgreementRepaymentSummary(state, agreement, transactionIndex).nextPayment?.instalment || null;
}

function editableCustomRows(state, agreement, transactionIndex) {
  return (agreement.schedule || []).filter(item => !item.supersededAt && !item.upfrontPayment && item.dueDate > today() && getCreditInstalmentAmounts(state, agreement, item, transactionIndex).paid === 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map(item => ({ id: item.id, dueDate: item.dueDate, amount: moneyInput(item.amount) }));
}

function SelectPaidFrom({ data, value, onChange, label = 'Paid from', includeAccounts = false }) {
  const funds = Object.entries(deriveFinancePosition(data).funds).filter(([, amount]) => amount > 0);
  if (value && !value.startsWith('account:') && !funds.some(([key]) => key === value)) funds.unshift([value, 0]); const accounts = includeAccounts ? (data.accounts || []).filter(account => !account.archivedAt) : [];
  return <label>{label}<select value={value} onChange={event => onChange(event.target.value)}><option value="">Spendable</option>{accounts.map(account => <option key={'account:'+account.id} value={'account:'+account.id}>{account.name} ({account.type})</option>)}{funds.map(([key]) => <option key={key} value={key}>{key.startsWith('goal:') ? `${data.goals.find(goal => goal.id === key.slice(5))?.title || 'Goal'} fund` : key.startsWith('savings:') ? 'Savings fund' : key}</option>)}</select></label>;
}

export function FinanceCreditPurchases({ data, change, busy, confirmAction, setTab, selectedAgreementId = '', openTransactionDetail }) {
  const currency = data.settings.currency;
  const transactionIndex = useMemo(() => createCreditTransactionIndex(data), [data.transactions]);
  const summary = useMemo(() => getCreditOverview(data, undefined, transactionIndex), [data, transactionIndex]);
  const [view, setView] = useState('active'), [query, setQuery] = useState(''), [selectedId, setSelectedId] = useState('');
  const [openPlanMenuId, setOpenPlanMenuId] = useState('');
  const [planMenuPosition, setPlanMenuPosition] = useState(null);
  const planMenuTriggerRef = useRef(null), planMenuRef = useRef(null);
  const [creating, setCreating] = useState(false), [draft, setDraft] = useState(() => blankDraft(data.categories.find(item => item.type === 'expense' && !item.archived)?.id || ''));
  const [createError, setCreateError] = useState(''), [actionError, setActionError] = useState(''), [pendingAction, setPendingAction] = useState('');
  const paymentSubmitLock = useRef(false);
  const { reminders, addReminder, cancel: cancelReminder } = useReminders();
  useEffect(()=>{if(selectedAgreementId&&data.creditAgreements.some(item=>item.id===selectedAgreementId)){setSelectedId(selectedAgreementId);setView('active');setActionError('');setShowPaymentForm(false);setShowSettlementForm(false)}},[selectedAgreementId,data.creditAgreements]);
  const [paymentMode, setPaymentMode] = useState('scheduled'), [paymentDraft, setPaymentDraft] = useState({ instalmentId: '', amount: '', date: today(), paidFromFundId: '', note: '' });
  const [settlementDraft, setSettlementDraft] = useState({ amount: '', fee: '', date: today(), paidFromFundId: '', note: '' });
  const [refundDraft, setRefundDraft] = useState(null), [revisionDraft, setRevisionDraft] = useState(null);
  const revisionSubmitLock = useRef(false);
  const [editDraft, setEditDraft] = useState(null), [paymentEditDraft, setPaymentEditDraft] = useState(null), [scheduleEditDraft, setScheduleEditDraft] = useState(null), [showPaymentForm, setShowPaymentForm] = useState(false), [showSettlementForm, setShowSettlementForm] = useState(false), [showAllSchedule, setShowAllSchedule] = useState(false);

  useLayoutEffect(() => {
    if (!openPlanMenuId) return undefined;
    let frame = 0;
    const positionMenu = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const trigger = planMenuTriggerRef.current?.getBoundingClientRect();
        const menu = planMenuRef.current?.getBoundingClientRect();
        if (!trigger || !menu) return;
        const gutter = 8;
        const left = Math.max(gutter, Math.min(trigger.right - menu.width, window.innerWidth - menu.width - gutter));
        const roomBelow = window.innerHeight - trigger.bottom - gutter;
        const roomAbove = trigger.top - gutter;
        const opensAbove = roomBelow < menu.height && roomAbove > roomBelow;
        const top = opensAbove
          ? Math.max(gutter, trigger.top - menu.height - gutter)
          : Math.min(trigger.bottom + gutter, window.innerHeight - menu.height - gutter);
        setPlanMenuPosition({ left, top, maxHeight: Math.max(120, window.innerHeight - gutter * 2) });
      });
    };
    positionMenu();
    const closeOnOutside = (event) => {
      if (planMenuRef.current?.contains(event.target) || planMenuTriggerRef.current?.contains(event.target)) return;
      setOpenPlanMenuId('');
      setPlanMenuPosition(null);
    };
    const onMenuKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpenPlanMenuId('');
        setPlanMenuPosition(null);
        planMenuTriggerRef.current?.focus();
        return;
      }
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', onMenuKeyDown);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', onMenuKeyDown);
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [openPlanMenuId]);



  const selected = data.creditAgreements.find(item => item.id === selectedId) || null;
  const selectedBalances = selected ? getCreditAgreementBalances(data, selected, transactionIndex) : null;
  const selectedRepayment = selected ? getCreditAgreementRepaymentSummary(data, selected, transactionIndex) : null;
  const selectedNext = selected ? agreementNextPayment(data, selected, transactionIndex) : null;
  const selectedDisplayStatus = selected ? (selectedNext ? getCreditInstalmentStatus(data, selected, selectedNext, undefined, transactionIndex) : getCreditAgreementStatus(data, selected, transactionIndex)) : '';
  const payments = selected ? getCreditPaymentTransactions(data, selected.id).sort((a, b) => b.date.localeCompare(a.date) || (b.sequence || 0) - (a.sequence || 0)) : [];
  const selectedHasPayments = payments.some(item => !item.reversedAt);
  const selectedHasPaymentHistory = payments.length > 0;

  useEffect(() => {
    const plan = planCreditReminderReconciliation(data, reminders);
    plan.cancelIds.forEach(cancelReminder);
    plan.add.forEach(target => addReminder(target.title, Math.max(60_000, target.dueAt - Date.now()), false, {
      creditAgreementId: target.agreementId,
      creditInstalmentId: target.instalmentId,
      creditReminderEvent: target.event,
      dueAt: target.dueAt,
    }));
  }, [data.creditAgreements, reminders, addReminder, cancelReminder]);

  const categoryOptions = data.categories.filter(item => item.type === 'expense' && (!item.archived || item.id === draft.categoryId || item.id === editDraft?.categoryId));
  const preview = (() => {
    try {
      if (!draft.cashPrice) return null;
      const cashPrice = parseMoney(draft.cashPrice), deposit = draft.deposit ? parseMoney(draft.deposit, { allowZero: true }) : 0;
      if (deposit >= cashPrice) return null;
      const financed = cashPrice - deposit, fee = draft.financeMode === 'fixed' && draft.financeCharge ? parseMoney(draft.financeCharge, { allowZero: true }) : 0;
      const countsUpfront = Boolean(draft.upfrontCountsAsFirstInstalment && deposit > 0);
      const total = (countsUpfront ? cashPrice : financed) + fee;
      const futureAmount = calculateRemainingBalance(total, countsUpfront ? deposit : 0);
      const totalCount = Number(draft.term), futureCount = calculateRemainingInstallmentCount(totalCount, countsUpfront ? 1 : 0);
      if (draft.scheduleMode === 'custom' && draft.financeMode !== 'apr') {
        const rows = (draft.customSchedule || []).map(row => ({ ...row, amount: row.amount ? parseMoney(row.amount, { allowZero: true }) : 0 }));
        const allocated = rows.reduce((sum, row) => sum + row.amount, 0);
        return { cashPrice, deposit, financed, fee, total, remaining: futureAmount, count: totalCount, futureCount, allocated, unallocated: futureAmount - allocated, rows: rows.filter(row => row.amount > 0), valid: allocated === futureAmount && rows.length === futureCount && rows.every(row => row.amount > 0 && row.dueDate) };
      }
      if (futureCount < 1) return { cashPrice, deposit, financed, fee, total, remaining: futureAmount, count: totalCount, futureCount, rows: [], valid: false };
      const aprPlan = draft.financeMode === 'apr' ? generateAprCreditSchedule({ agreementId: 'preview', principalAmount: financed, apr: Number(draft.apr), term: futureCount, frequency: draft.frequency, customDays: Number(draft.customDays), firstPaymentDate: draft.firstPaymentDate }) : null;
      const schedule = aprPlan?.schedule || generateCreditSchedule({ agreementId: 'preview', principalAmount: financed, financeCharge: fee, term: futureCount, frequency: draft.frequency, customDays: Number(draft.customDays), firstPaymentDate: draft.firstPaymentDate });
      const actualFee = aprPlan?.financeCharge ?? fee, actualTotal = (countsUpfront ? cashPrice : financed) + actualFee;
      return { cashPrice, deposit, financed, fee: actualFee, total: actualTotal, remaining: actualTotal - (countsUpfront ? deposit : 0), first: schedule[0]?.amount, last: schedule.at(-1)?.amount, count: totalCount, futureCount, rows: schedule, valid: true };
    } catch { return null; }
  })();

  const plans = useMemo(() => {
    const dueSoonIds = new Set(getCreditDueSoon(data, undefined, transactionIndex).map(item => item.agreement.id));
    const overdueIds = new Set(getOverdueCreditPayments(data, undefined, transactionIndex).map(item => item.agreement.id));
    const search = query.trim().toLocaleLowerCase();
    return (data.creditAgreements || []).map(agreement => {
      const status = getCreditAgreementStatus(data, agreement, transactionIndex);
      const balances = getCreditAgreementBalances(data, agreement, transactionIndex);
      const next = getCreditAgreementRepaymentSummary(data, agreement, transactionIndex).nextPayment;
      return { agreement, status, balances, next: next?.instalment || null, nextBalance: next, isActive: status === 'active' };
    }).filter(({ agreement, status, isActive }) => {
      const text = `${agreement.title} ${agreement.merchant || ''} ${agreement.notes || ''} ${agreement.reference || ''}`.toLocaleLowerCase();
      if (!text.includes(search)) return false;
      if (view === 'archived') return Boolean(agreement.archivedAt);
      if (agreement.archivedAt) return false;
      if (view === 'settled') return ['paid_off', 'settled_early'].includes(status);
      if (view === 'cancelled') return status === 'cancelled';
      if (view === 'completed') return !isActive && status !== 'cancelled';
      if (!isActive) return false;
      if (view === 'due-soon') return dueSoonIds.has(agreement.id);
      if (view === 'overdue') return overdueIds.has(agreement.id);
      if (view === 'zero') return agreement.financeCharge === 0;
      if (view === 'interest') return agreement.financeCharge > 0;
      return true;
    }).sort((left, right) => (left.next?.dueDate || '9999-12-31').localeCompare(right.next?.dueDate || '9999-12-31') || right.balances.totalRemaining - left.balances.totalRemaining);
  }, [data, query, view, transactionIndex]);

  function openAgreement(agreement) {
    setSelectedId(agreement.id); setActionError(''); setShowPaymentForm(false); setShowSettlementForm(false); setEditDraft(null); setShowAllSchedule(false);
  }

  async function createAgreement(event) {
    event.preventDefault(); setCreateError('');
    try {
      const metadata = validateRecordMetadata(draft.vehicleMetadata, draft.customFields);
      const cashPrice = parseMoney(draft.cashPrice), deposit = draft.deposit ? parseMoney(draft.deposit, { allowZero: true }) : 0;
      const financeCharge = draft.financeMode === 'fixed' ? parseMoney(draft.financeCharge, { allowZero: true }) : 0;
      const term = Number(draft.term), customDays = Number(draft.customDays);
      const customSchedule = (draft.customSchedule || []).map(row => ({ ...row, amount: row.amount ? parseMoney(row.amount, { allowZero: true }) : 0 }));
      if (!draft.title.trim()) throw new Error('Enter a name for the purchase.');
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(draft.purchaseDate)) throw new Error('Choose the purchase date.');
      if (!Number.isInteger(term) || term < 1 || term > 600) throw new Error('Choose 1 to 600 instalments.');
      const agreementId = id(), created = new Date().toISOString();
      const saved = await change(state => mutateCreditState(state, next => createCreditAgreement(next, { ...metadata, id: agreementId, title: draft.title, merchant: draft.merchant, reference: draft.reference, productUrl: draft.productUrl, notes: draft.notes, purchaseDate: draft.purchaseDate, depositDate: draft.depositDate || draft.purchaseDate, cashPrice, deposit, upfrontCountsAsFirstInstalment: draft.upfrontCountsAsFirstInstalment, categoryId: draft.categoryId, depositPaidFromFundId: draft.depositPaidFromFundId, financedAmount: cashPrice - deposit, financeCharge, interestMode: financeCharge ? 'fixed_fee' : draft.financeMode === 'apr' ? 'apr' : 'zero', financeMode: draft.financeMode, apr: draft.financeMode === 'apr' ? Number(draft.apr) : null, term, scheduleMode: draft.scheduleMode, customSchedule, frequency: draft.frequency, customDays, firstPaymentDate: draft.firstPaymentDate, createdAt: created }, { transactionId: deposit ? id() : '', dateCreated: draft.depositDate || draft.purchaseDate })), 'Credit purchase added');
      if (saved) { setCreating(false); setDraft(blankDraft(data.categories.find(item => item.type === 'expense' && !item.archived)?.id || '')); setView('active'); setSelectedId(agreementId); }
    } catch (error) { setCreateError(error.message || 'The credit purchase could not be saved.'); }
  }

  function beginPayment(agreement, mode = 'scheduled', instalmentId = '') {
    const next = mode === 'scheduled' ? (instalmentId ? (agreement.schedule || []).find(item => item.id === instalmentId && !item.supersededAt && getCreditInstalmentAmounts(data, agreement, item, transactionIndex).remaining > 0) : agreementNextPayment(data, agreement, transactionIndex)) : null;
    const remaining = next ? getCreditInstalmentAmounts(data, agreement, next, transactionIndex).remaining : '';
    setPaymentMode(mode); const defaultAccount = (data.accounts || []).find(account => account.type === 'bank' && !account.archivedAt); setPaymentDraft({ instalmentId: next?.id || '', amount: remaining ? moneyInput(remaining) : '', date: today(), paidFromFundId: defaultAccount ? 'account:'+defaultAccount.id : '', note: '' });
    setShowPaymentForm(true); setShowSettlementForm(false); setActionError('');
  }

  async function savePayment(event) {
    event.preventDefault(); if (paymentSubmitLock.current || busy) return; paymentSubmitLock.current = true; setActionError('');
    setPendingAction('Recording payment');
    try {
      const amount = parseMoney(paymentDraft.amount), paymentId = id(), transactionId = id();
      const saved = await change(state => mutateCreditState(state, next => recordCreditPayment(next, { agreementId: selected.id, amount, date: paymentDraft.date, paidFromFundId: paymentDraft.paidFromFundId.startsWith('account:') ? '' : paymentDraft.paidFromFundId, accountId: paymentDraft.paidFromFundId.startsWith('account:') ? paymentDraft.paidFromFundId.slice(8) : '', note: paymentDraft.note, instalmentId: paymentMode === 'scheduled' ? paymentDraft.instalmentId : '', paymentId, transactionId })), 'Credit payment recorded');
      if (saved) { setShowPaymentForm(false); setPaymentDraft({ instalmentId: '', amount: '', date: today(), paidFromFundId: '', note: '' }); }
    } catch (error) { setActionError(error.message || 'The payment could not be recorded.'); }
    finally { paymentSubmitLock.current = false; setPendingAction(''); }
  }

  async function saveAgreementRefund(event) {
    event.preventDefault(); setActionError('');
    try {
      const amount = parseMoney(refundDraft.amount);
      const saved = await change(state => { createCreditPurchaseRefundState(state, { agreementId: selected.id, amount, destination: refundDraft.destination, status: refundDraft.status, date: refundDraft.date, note: refundDraft.note }); return state; }, 'Credit purchase refund recorded');
      if (saved) setRefundDraft(null);
    } catch (error) { setActionError(error.message || 'The refund could not be recorded.'); }
  }

  async function receiveAgreementRefund(refund) {
    try { await change(state => { receiveCreditPurchaseRefundState(state, refund.id); return state; }, 'Credit purchase refund received'); }
    catch (error) { setActionError(error.message || 'The refund could not be received.'); }
  }

  async function reverseAgreementRefund(refund) {
    try { await change(state => { reverseCreditPurchaseRefundState(state, refund.id); return state; }, 'Credit purchase refund reversed'); }
    catch (error) { setActionError(error.message || 'The refund could not be reversed.'); }
  }

  async function saveCreditReminderPreferences(agreement, patch) {
    const current = agreement.creditReminderPreferences || { enabled: false, daysBefore: 1, onDueDate: true };
    const next = { ...current, ...patch };
    setActionError(''); setPendingAction('Saving reminder preferences');
    try {
      if (next.enabled && !next.daysBefore && !next.onDueDate) throw new Error('Choose at least one reminder time.');
      await change(state => mutateCreditState(state, value => updateCreditAgreement(value, agreement.id, { creditReminderPreferences: next })), 'Credit reminder preferences saved');
    } catch (error) {
      setActionError(error.message || 'Reminder preferences could not be saved.');
    } finally { setPendingAction(''); }
  }

  function beginSettlement(agreement) {
    const balances = getCreditAgreementBalances(data, agreement, transactionIndex);
    setSettlementDraft({ amount: moneyInput(balances.totalRemaining), fee: '', date: today(), paidFromFundId: '', note: '' });
    setShowSettlementForm(true); setShowPaymentForm(false); setActionError('');
  }

  async function saveSettlement(event) {
    event.preventDefault(); setActionError('');
    try {
      const settlementAmount = parseMoney(settlementDraft.amount), settlementFee = settlementDraft.fee ? parseMoney(settlementDraft.fee, { allowZero: true }) : 0;
      const ok = await confirmAction({ title: 'Settle this credit agreement early?', message: 'This records one real Finance payment. Remaining scheduled instalments will be marked superseded and their history will stay available.', confirmLabel: 'Record settlement' });
      if (!ok) return;
      const paymentId = id(), transactionId = id();
      const saved = await change(state => mutateCreditState(state, next => settleCreditAgreement(next, { agreementId: selected.id, settlementAmount, settlementFee, date: settlementDraft.date, paidFromFundId: settlementDraft.paidFromFundId.startsWith('account:') ? '' : settlementDraft.paidFromFundId, accountId: settlementDraft.paidFromFundId.startsWith('account:') ? settlementDraft.paidFromFundId.slice(8) : '', note: settlementDraft.note, paymentId, transactionId })), 'Credit agreement settled early');
      if (saved) { setShowSettlementForm(false); setSettlementDraft({ amount: '', fee: '', date: today(), paidFromFundId: '', note: '' }); }
    } catch (error) { setActionError(error.message || 'The settlement could not be recorded.'); }
  }

  function beginScheduleRevision(agreement) {
    const counts = getCreditScheduleRevisionCounts(data, agreement, today());
    const first = counts.eligibleRows[0]?.instalment?.dueDate || firstPaymentDefault();
    const revisionId = id();
    setActionError(''); setShowPaymentForm(false); setShowSettlementForm(false); setEditDraft(null);
    setRevisionDraft({ revisionId, sourceFingerprint: getCreditAgreementRevisionFingerprint(data, agreement.id), countMode: 'remaining', count: String(Math.max(1, counts.eligibleCount)), scheduleMode: 'auto', firstPaymentDate: first > today() ? first : firstPaymentDefault(), frequency: agreement.frequency || 'monthly', customDays: String(agreement.customDays || 30), customSchedule: [], useConfirmedFixedCharge: false, fixedCharge: moneyInput(agreement.financeCharge || 0), confirmedFutureTotal: '' });
  }

  const revisionPreview = (() => {
    if (!selected || !revisionDraft) return null;
    try {
      const counts = getCreditScheduleRevisionCounts(data, selected, today());
      let futureCount = Number(revisionDraft.count);
      if (revisionDraft.countMode === 'total') futureCount -= counts.completedCount + counts.protectedCount;
      const customSchedule = (revisionDraft.customSchedule || []).map(row => ({ ...row, amount: row.amount ? parseMoney(row.amount, { allowZero: true }) : 0 }));
      const confirmedFutureFinanceCost = revisionDraft.confirmedFutureTotal ? parseMoney(revisionDraft.confirmedFutureTotal, { allowZero: true }) - counts.eligibleRows.reduce((sum, row) => sum + row.principalRemaining, 0) : undefined;
      const result = buildCreditScheduleRevision(data, selected.id, { ...revisionDraft, futureCount, customSchedule, ...(revisionDraft.useConfirmedFixedCharge ? { confirmedFinanceCharge: parseMoney(revisionDraft.fixedCharge, { allowZero: true }) } : {}), ...(confirmedFutureFinanceCost !== undefined ? { confirmedFutureFinanceCost } : {}) }, today());
      return { ...result, futureCount, valid: result.futureRows.length === futureCount && (!revisionDraft.useConfirmedFixedCharge || Number.isSafeInteger(parseMoney(revisionDraft.fixedCharge, { allowZero: true }))) };
    } catch (error) { return { error: error.message }; }
  })();

  async function saveScheduleRevision(event) {
    event.preventDefault();
    if (!revisionDraft || !revisionPreview || revisionPreview.error || !revisionPreview.valid || revisionSubmitLock.current) return;
    revisionSubmitLock.current = true; setActionError(''); setPendingAction('Saving revised schedule');
    try {
      if (revisionDraft.sourceFingerprint !== revisionPreview.fingerprint) { setRevisionDraft(current => ({ ...current, sourceFingerprint: revisionPreview.fingerprint })); throw new Error('A payment, refund, or reversal changed the balance. The preview has been refreshed; review it before saving.'); }
      await change(state => mutateCreditState(state, next => { if (getCreditAgreementRevisionFingerprint(next, selected.id) !== revisionPreview.fingerprint) throw new Error('A payment, refund, or reversal changed the balance. The preview must be refreshed before saving.'); return updateCreditAgreement(next, selected.id, { ...revisionPreview.changes, scheduleRevisionId: revisionDraft.revisionId, preservePastUnpaidSchedule: true, recalculateFutureSchedule: true }, today()); }), 'Credit Purchase schedule revised');
      setRevisionDraft(null);
    } catch (error) { setActionError(error.message || 'The schedule revision could not be saved.'); }
    finally { revisionSubmitLock.current = false; setPendingAction(''); }
  }

  function beginEdit(agreement) {
    const totalCount = (agreement.schedule || []).filter(item => !item.supersededAt).length || agreement.term || 1;
    setEditDraft({ vehicleMetadata: agreement.vehicleMetadata || {}, customFields: agreement.customFields || [], title: agreement.title, merchant: agreement.merchant || '', reference: agreement.reference || '', productUrl: agreement.productUrl || '', notes: agreement.notes || '', purchaseDate: agreement.purchaseDate, cashPrice: moneyInput(agreement.cashPrice), deposit: moneyInput(agreement.deposit || 0), depositDate: agreement.depositDate || agreement.purchaseDate, upfrontCountsAsFirstInstalment: Boolean(agreement.upfrontCountsAsFirstInstalment), categoryId: agreement.categoryId || '', depositPaidFromFundId: agreement.depositPaidFromFundId || '', financeCharge: moneyInput(agreement.financeCharge || 0), financeMode: agreement.financeMode || (agreement.financeCharge ? 'fixed' : 'zero'), apr: String(agreement.apr ?? ''), term: String(Math.max(1, totalCount)), scheduleMode: agreement.scheduleMode || 'auto', customSchedule: editableCustomRows(data, agreement, transactionIndex), frequency: agreement.frequency, customDays: String(agreement.customDays || 30), firstPaymentDate: agreementNextPayment(data, agreement, transactionIndex)?.dueDate || agreement.firstPaymentDate });
    setShowPaymentForm(false); setShowSettlementForm(false); setPaymentEditDraft(null); setActionError('');
  }

  async function saveAgreementEdit(event) {
    event.preventDefault(); setActionError('');
    setPendingAction('Saving agreement and recalculating schedule');
    try {
      const metadata = validateRecordMetadata(editDraft.vehicleMetadata, editDraft.customFields);
      const changes = { ...editDraft, ...metadata, cashPrice: parseMoney(editDraft.cashPrice), deposit: editDraft.deposit ? parseMoney(editDraft.deposit, { allowZero: true }) : 0, term: Number(editDraft.term), customDays: Number(editDraft.customDays), financeCharge: editDraft.financeMode === 'fixed' && editDraft.financeCharge ? parseMoney(editDraft.financeCharge, { allowZero: true }) : 0, financeMode: editDraft.financeMode, apr: editDraft.financeMode === 'apr' ? Number(editDraft.apr) : null, customSchedule: (editDraft.customSchedule || []).map(row => ({ ...row, amount: row.amount ? parseMoney(row.amount, { allowZero: true }) : 0 })) };
      const currentTotalTerm = selectedSchedule.length;
      const financialChange = changes.cashPrice !== selected.cashPrice || changes.deposit !== selected.deposit || changes.depositDate !== (selected.depositDate || selected.purchaseDate) || changes.depositPaidFromFundId !== (selected.depositPaidFromFundId || '') || changes.categoryId !== (selected.categoryId || '') || changes.financeMode !== (selected.financeMode || (selected.financeCharge ? 'fixed' : 'zero')) || changes.apr !== selected.apr || changes.financeCharge !== selected.financeCharge || changes.term !== currentTotalTerm || changes.frequency !== selected.frequency || changes.customDays !== selected.customDays || changes.firstPaymentDate !== (agreementNextPayment(data, selected, transactionIndex)?.dueDate || selected.firstPaymentDate) || changes.upfrontCountsAsFirstInstalment !== Boolean(selected.upfrontCountsAsFirstInstalment) || changes.scheduleMode !== (selected.scheduleMode || 'auto') || JSON.stringify(changes.customSchedule) !== JSON.stringify(editableCustomRows(data, selected, transactionIndex).map(row => ({ ...row, amount: parseMoney(row.amount, { allowZero: true }) })));
      const purchaseChange = changes.cashPrice !== selected.cashPrice || changes.deposit !== selected.deposit;
      const hasActiveDeposit = (data.transactions || []).some(item => item.creditAgreementId === selected.id && item.creditPaymentKind === 'deposit' && !item.reversedAt);
      if (purchaseChange && !hasActiveDeposit && changes.deposit > 0) changes.depositTransactionId = id();
      if (financialChange) {
        const updatedPrincipal = selectedHasPayments ? selectedBalances.principalRemaining : changes.cashPrice - changes.deposit;
        const updatedFee = selectedHasPayments ? Math.max(0, changes.financeCharge - selectedBalances.paidFinanceCost) : changes.financeCharge;
        const updatedRemaining = changes.financeMode === 'apr' ? (editPreview?.remaining ?? updatedPrincipal + updatedFee) : updatedPrincipal + updatedFee;
        const currentFutureTotal = selectedUpcoming.filter(item => item.dueDate > today()).reduce((sum, item) => sum + getCreditInstalmentAmounts(data, selected, item, transactionIndex).remaining, 0);
        const modeWarning = changes.scheduleMode === 'auto' && selected.scheduleMode === 'custom' ? ' Auto Split will replace future unpaid custom rows.' : '';
        const ok = await confirmAction({ title: 'Update payment plan?', message: `Current total remaining: ${formatMoney(selectedBalances.totalRemaining, currency)}. Future unpaid payments: ${selectedUpcoming.length} (${formatMoney(currentFutureTotal, currency)}). Updated remaining estimate: ${formatMoney(updatedRemaining, currency)} across ${Math.max(0, changes.term - (changes.upfrontCountsAsFirstInstalment ? 1 : 0))} future payments. Recorded payments and Finance transaction IDs remain unchanged.${modeWarning}`, confirmLabel: 'Update payment plan' });
        if (!ok) return;
      }
      const oldNext = agreementNextPayment(data, selected, transactionIndex), oldNextDate = oldNext?.dueDate || '', oldNextAmount = oldNext ? getCreditInstalmentAmounts(data, selected, oldNext, transactionIndex).remaining : 0;
      let updatedState, updatedAgreement;
      const saved = await change(state => { updatedState = state; updatedAgreement = updateCreditAgreement(state, selected.id, changes); return state; }, 'Credit agreement updated');
      if (saved) {
        setEditDraft(null);
        const nextRow = agreementNextPayment(updatedState, updatedAgreement);
        if (oldNextDate && nextRow) updateCreditReminder(selected, oldNextDate, nextRow.dueDate, oldNextAmount, getCreditInstalmentAmounts(updatedState, updatedAgreement, nextRow).remaining);
      }
    } catch (error) { setActionError(error.message || 'The agreement could not be updated.'); }
    finally { setPendingAction(''); }
  }

  async function cancelAgreement(agreement) {
    const ok = await confirmAction({ title: 'Cancel this agreement?', message: 'This keeps the agreement and schedule history. Any deposit already paid remains in Finance, and an agreement with actual repayments cannot be cancelled.', confirmLabel: 'Cancel agreement' });
    if (!ok) return;
    try {
      const saved = await change(state => mutateCreditState(state, next => cancelCreditAgreement(next, agreement.id)), 'Credit agreement cancelled');
      if (saved) cancelAgreementReminders(agreement);
    }
    catch (error) { setActionError(error.message || 'The agreement could not be cancelled.'); }
  }

  async function archiveAgreement(agreement) {
    if (busy) return;
    if (!await confirmAction({ title: 'Archive this agreement?', message: 'It will leave the normal Credit Purchases list. Its balance, payment history, and reporting will remain unchanged.', confirmLabel: 'Archive agreement' })) return;
    setPendingAction('Archiving credit purchase');
    try {
      const saved = await change(state => mutateCreditState(state, next => archiveCreditAgreement(next, agreement.id)), 'Credit purchase archived');
      if (saved) { setSelectedId(''); setView('archived'); }
    } finally { setPendingAction(''); }
  }

  async function restoreAgreement(agreement) {
    if (busy) return;
    setPendingAction('Restoring credit purchase');
    try {
      const saved = await change(state => mutateCreditState(state, next => restoreCreditAgreement(next, agreement.id)), 'Credit purchase restored');
      if (saved) { setSelectedId(''); setView('active'); }
    } finally { setPendingAction(''); }
  }

  async function deleteAgreement(agreement) {
    if (busy) return;
    const blockReason = getCreditPurchaseDeleteBlockReason(data, agreement.id);
    if (blockReason) { setActionError(blockReason); return; }
    if (!await confirmAction({ title: 'Delete credit purchase?', message: 'This permanently removes the agreement and its unpaid future schedule. Its linked reminders will be cancelled. Payment history and linked Finance transactions prevent deletion.', confirmLabel: 'Delete' })) return;
    setPendingAction('Deleting credit purchase');
    try {
      const saved = await change(state => mutateCreditState(state, next => deleteUnusedCreditAgreement(next, agreement.id)), 'Credit purchase deleted');
      if (saved) {
        cancelAgreementReminders(agreement);
        setSelectedId(''); setView(agreement.archivedAt ? 'archived' : 'active');
      }
    } finally { setPendingAction(''); }
  }

  function beginPaymentEdit(payment) {
    setPaymentEditDraft({ id: payment.id, amount: moneyInput(payment.amount), date: payment.date, paidFromFundId: payment.accountId ? 'account:'+payment.accountId : payment.paidFromFundId || '', note: payment.note || '', kind: payment.creditPaymentKind });
    setActionError('');
  }

  async function savePaymentEdit(event) {
    event.preventDefault(); setActionError('');
    try {
      const payment = payments.find(item => item.id === paymentEditDraft.id);
      if (!payment) throw new Error('This payment could not be found.');
      const changes = { ...paymentEditDraft, amount: payment.scheduledInstalmentId ? parseMoney(paymentEditDraft.amount) : payment.amount, paidFromFundId: paymentEditDraft.paidFromFundId.startsWith('account:') ? '' : paymentEditDraft.paidFromFundId, accountId: paymentEditDraft.paidFromFundId.startsWith('account:') ? paymentEditDraft.paidFromFundId.slice(8) : '' };
      const saved = await change(state => mutateCreditState(state, next => updateCreditPayment(next, payment.id, changes)), 'Credit payment corrected');
      if (saved) setPaymentEditDraft(null);
    } catch (error) { setActionError(error.message || 'The payment could not be corrected.'); }
  }

  async function reversePayment(payment) {
    if (!await confirmAction({ title: 'Mark this payment as unpaid?', message: `${formatMoney(payment.amount, currency)} will be restored to its payment source. The linked Finance transaction stays in history and will be excluded from active balances and reports.`, confirmLabel: 'Mark as unpaid' })) return;
    try {
      const saved = await change(state => mutateCreditState(state, next => reverseCreditPayment(next, payment.id)), 'Credit payment reversed');
      if (saved) setPaymentEditDraft(null);
    } catch (error) { setActionError(error.message || 'The payment could not be reversed.'); }
  }

  function beginScheduleEdit(instalment) {
    setScheduleEditDraft({ id: instalment.id, dueDate: instalment.dueDate, amount: moneyInput(instalment.amount) });
    setActionError('');
  }

  async function saveScheduleEdit(event) {
    event.preventDefault(); setActionError('');
    setPendingAction('Updating payment schedule');
    try {
      const instalment = selectedSchedule.find(item => item.id === scheduleEditDraft.id);
      if (!instalment) throw new Error('This instalment could not be found.');
      const amount = parseMoney(scheduleEditDraft.amount);
      const ok = await confirmAction({ title: 'Update this instalment?', message: `This changes the selected future payment to ${formatMoney(amount, currency)} on ${moneyDate(scheduleEditDraft.dueDate)}. Other future payments will adjust to keep the balance reconciled, and the plan will become Custom Schedule.`, confirmLabel: 'Update instalment' });
      if (!ok) return;
      const oldNext = agreementNextPayment(data, selected, transactionIndex), oldNextDate = oldNext?.dueDate || '', oldNextAmount = oldNext ? getCreditInstalmentAmounts(data, selected, oldNext, transactionIndex).remaining : 0;
      let updatedState;
      const saved = await change(state => { updatedState = state; updateCreditInstalment(state, selected.id, instalment.id, { dueDate: scheduleEditDraft.dueDate, amount }); return state; }, 'Future instalment updated');
      if (saved) { setScheduleEditDraft(null); const updatedAgreement = updatedState.creditAgreements.find(item => item.id === selected.id), newNext = agreementNextPayment(updatedState, updatedAgreement); if (oldNextDate && newNext) updateCreditReminder(selected, oldNextDate, newNext.dueDate, oldNextAmount, getCreditInstalmentAmounts(updatedState, updatedAgreement, newNext).remaining); }
    } catch (error) { setActionError(error.message || 'The instalment could not be updated.'); }
    finally { setPendingAction(''); }
  }
  function remindForNextPayment(agreement) {
    const next = agreementNextPayment(data, agreement, transactionIndex);
    if (!next) return;
    const dueAmount = getCreditInstalmentAmounts(data, agreement, next, transactionIndex).remaining;
    const title = `Credit payment due: ${agreement.title} · ${formatMoney(dueAmount, currency)} (${next.dueDate})`;
    if (reminders.some(item => (item.creditAgreementId === agreement.id || (!item.creditAgreementId && item.title.startsWith(`Credit payment due: ${agreement.title}`))) && item.title.includes(next.dueDate) && ['waiting', 'ringing'].includes(item.status))) {
      setActionError('A reminder is already active for this payment.');
      return;
    }
    const todayAtNine = new Date(`${next.dueDate}T09:00:00`).getTime();
    if (!Number.isFinite(todayAtNine) || next.dueDate < today()) {
      setActionError('This payment date has passed. Choose a future instalment to set a reminder.');
      return;
    }
    addReminder(title, Math.max(60_000, todayAtNine - Date.now()), false, { creditAgreementId: agreement.id, creditInstalmentId: next.id, creditReminderEvent: 'manual' });
    setActionError('Reminder added to CBoard Reminders for 9:00 on the payment date.');
  }

  function cancelAgreementReminders(agreement) {
    const prefix = `Credit payment due: ${agreement.title}`;
    reminders.filter(item => (item.creditAgreementId === agreement.id || (!item.creditAgreementId && item.title.startsWith(prefix))) && ['waiting', 'ringing'].includes(item.status)).forEach(item => cancelReminder(item.id));
  }

  function updateCreditReminder(agreement, oldDate, newDate, oldAmount, newAmount) {
    const prefix = `Credit payment due: ${agreement.title}`;
    const active = reminders.filter(item => item.title.startsWith(prefix) && item.title.includes(oldDate) && ['waiting', 'ringing'].includes(item.status));
    if (!active.length || !newDate || !newAmount || (oldDate === newDate && oldAmount === newAmount)) return;
    active.forEach(item => cancelReminder(item.id));
    const dueAt = new Date(`${newDate}T09:00:00`).getTime();
    if (Number.isFinite(dueAt) && newDate >= today()) addReminder(`Credit payment due: ${agreement.title} · ${formatMoney(newAmount, currency)} (${newDate})`, Math.max(60_000, dueAt - Date.now()), false, { creditAgreementId: agreement.id });
  }
  function beginCreate() {
    setSelectedId(''); setCreateError(''); setDraft(blankDraft(data.categories.find(item => item.type === 'expense' && !item.archived)?.id || '')); setCreating(true);
  }

  function generateCreateRows() {
    try { setCreateError(''); setDraft(current => ({ ...current, customSchedule: generateDraftRows(current) })); }
    catch (error) { setCreateError(error.message || 'Enter the purchase amount and payment terms first.'); }
  }

  function generateDraftRows(current) {
    const cash = parseMoney(current.cashPrice), deposit = current.deposit ? parseMoney(current.deposit, { allowZero: true }) : 0;
    const fee = (current.financeMode ? current.financeMode === 'fixed' : true) && current.financeCharge ? parseMoney(current.financeCharge, { allowZero: true }) : 0;
    const principal = cash - deposit, count = calculateRemainingInstallmentCount(Number(current.term), current.upfrontCountsAsFirstInstalment ? 1 : 0);
    if (count < 1) throw new Error('Add at least one future payment after the upfront payment.');
    return generateCreditSchedule({ agreementId: 'custom-draft', principalAmount: principal, financeCharge: fee, term: count, frequency: current.frequency, customDays: Number(current.customDays), firstPaymentDate: current.firstPaymentDate }).map(item => ({ id: id(), dueDate: item.dueDate, amount: moneyInput(item.amount) }));
  }

  function generateEditDraftRows() {
    if (!editPreview || editPreview.futureCount < 1) throw new Error('Add at least one future payment to cover the remaining balance.');
    return generateCreditSchedule({ agreementId: `${selected.id}:custom-draft`, principalAmount: editPreview.schedulePrincipal, financeCharge: editPreview.scheduleFee, term: editPreview.futureCount, frequency: editDraft.frequency, customDays: Number(editDraft.customDays), firstPaymentDate: editDraft.firstPaymentDate }).map(item => ({ id: id(), dueDate: item.dueDate, amount: moneyInput(item.amount) }));
  }

  function splitCustomRemaining(current, setter, currentPreview) {
    if (!currentPreview || currentPreview.unallocated < 0) return;
    let rows = [...(current.customSchedule || [])];
    const targetCount = Number.isInteger(currentPreview.futureCount) ? currentPreview.futureCount : calculateRemainingInstallmentCount(Number(current.term), current.upfrontCountsAsFirstInstalment ? 1 : 0);
    while (rows.length < targetCount) rows.push({ id: id(), dueDate: current.firstPaymentDate, amount: '' });
    let nextTerm = Number(current.term);
    const empty = rows.map((row, index) => row.amount ? -1 : index).filter(index => index >= 0);
    if (!empty.length && currentPreview.unallocated > 0) {
      rows.push({ id: id(), dueDate: current.firstPaymentDate, amount: '' });
      empty.push(rows.length - 1);
      nextTerm += 1;
    }
    if (!empty.length || !currentPreview.unallocated) return;
    const base = Math.floor(currentPreview.unallocated / empty.length), remainder = currentPreview.unallocated % empty.length;
    empty.forEach((rowIndex, index) => { rows[rowIndex] = { ...rows[rowIndex], amount: moneyInput(base + (index === empty.length - 1 ? remainder : 0)) }; });
    setter({ ...current, term: String(nextTerm), customSchedule: rows });
  }

  async function changeEditScheduleMode(mode) {
    if (!editDraft || mode === editDraft.scheduleMode) return;
    if (mode === 'auto' && editDraft.scheduleMode === 'custom') {
      const ok = await confirmAction({ title: 'Use Auto Split?', message: 'Auto Split will replace future unpaid custom rows. Recorded payments and historical rows will remain unchanged.', confirmLabel: 'Use Auto Split' });
      if (!ok) return;
    }
    setEditDraft({ ...editDraft, scheduleMode: mode });
  }

  const selectedSchedule = selected ? (selected.schedule || []).filter(item => !item.supersededAt).sort((a, b) => a.dueDate.localeCompare(b.dueDate)) : [];
  const selectedUpcoming = selectedSchedule.filter(item => getCreditInstalmentAmounts(data, selected, item, transactionIndex).remaining > 0);
  const selectedPast = selectedSchedule.filter(item => getCreditInstalmentAmounts(data, selected, item, transactionIndex).paid > 0);
  const visibleSchedule = showAllSchedule ? selectedSchedule : [...selectedPast.slice(-2), ...selectedUpcoming.slice(0, 3)].filter((item, index, all) => all.findIndex(value => value.id === item.id) === index);
  const paidPercent = selectedRepayment?.progressPercent || 0;
  const editPreview = (() => {
    if (!editDraft || !selected) return null;
    try {
      const principal = parseMoney(editDraft.cashPrice) - (editDraft.deposit ? parseMoney(editDraft.deposit, { allowZero: true }) : 0);
      if (editDraft.financeMode === 'apr') {
        const preservedRows = selectedSchedule.filter(item => getCreditInstalmentAmounts(data, selected, item, transactionIndex).paid > 0 || (selectedHasPayments && !item.upfrontPayment && item.dueDate <= today()));
        const upfrontCount = editDraft.upfrontCountsAsFirstInstalment && !selectedSchedule.some(item => item.upfrontPayment) ? 1 : 0;
        const futureCount = Number(editDraft.term) - preservedRows.length - upfrontCount;
        const principalAmount = selectedHasPayments ? selectedBalances.principalRemaining : principal;
        if (futureCount < 1 || principalAmount <= 0) return { remaining: principalAmount, scheduleRemaining: principalAmount, schedulePrincipal: principalAmount, scheduleFee: 0, count: Number(editDraft.term), futureCount, rows: [], valid: principalAmount === 0 && futureCount === 0 };
        const aprPlan = generateAprCreditSchedule({ agreementId: selected.id, principalAmount, apr: Number(editDraft.apr), term: futureCount, frequency: editDraft.frequency, customDays: Number(editDraft.customDays), firstPaymentDate: editDraft.firstPaymentDate });
        return { remaining: principalAmount + aprPlan.financeCharge, scheduleRemaining: principalAmount + aprPlan.financeCharge, schedulePrincipal: principalAmount, scheduleFee: aprPlan.financeCharge, count: Number(editDraft.term), futureCount, rows: aprPlan.schedule, first: aprPlan.schedule[0]?.amount, last: aprPlan.schedule.at(-1)?.amount, valid: true };
      }
      const fee = editDraft.financeCharge ? parseMoney(editDraft.financeCharge, { allowZero: true }) : 0;
      const remaining = selectedHasPayments ? selectedBalances.principalRemaining + Math.max(0, fee - selectedBalances.paidFinanceCost) : principal + fee;
      const remainingFee = selectedHasPayments ? Math.max(0, fee - selectedBalances.paidFinanceCost) : fee;
      const preservedRows = selectedSchedule.filter(item => getCreditInstalmentAmounts(data, selected, item, transactionIndex).paid > 0 || (selectedHasPayments && !item.upfrontPayment && item.dueDate <= today()));
      const preservedAmounts = preservedRows.reduce((totals, item) => { const amounts = getCreditInstalmentAmounts(data, selected, item, transactionIndex); totals.amount += amounts.remaining; totals.principal += amounts.principalRemaining; totals.fee += amounts.financeCostRemaining; return totals; }, { amount: 0, principal: 0, fee: 0 });
      const remainingPrincipal = remaining - remainingFee;
      const preservedCount = preservedRows.length + (editDraft.upfrontCountsAsFirstInstalment && !selectedSchedule.some(item => item.upfrontPayment) ? 1 : 0);
      const futureCount = Number(editDraft.term) - preservedCount;
      const scheduleRemaining = Math.max(0, remaining - preservedAmounts.amount);
      const schedulePrincipal = Math.max(0, remainingPrincipal - preservedAmounts.principal);
      const scheduleFee = Math.max(0, remainingFee - preservedAmounts.fee);
      if (editDraft.scheduleMode === 'custom') {
        const rows = (editDraft.customSchedule || []).map(row => ({ ...row, amount: row.amount ? parseMoney(row.amount, { allowZero: true }) : 0 }));
        const allocated = rows.reduce((sum, row) => sum + row.amount, 0);
        return { remaining, scheduleRemaining, schedulePrincipal, scheduleFee, count: Number(editDraft.term), futureCount, allocated, unallocated: scheduleRemaining - allocated, rows, valid: futureCount >= 0 && rows.length === futureCount && rows.every(row => row.amount > 0 && row.dueDate) && allocated === scheduleRemaining };
      }
      if (futureCount < 1 || scheduleRemaining <= 0) return { remaining, scheduleRemaining, schedulePrincipal, scheduleFee, count: Number(editDraft.term), futureCount, rows: [], valid: scheduleRemaining === 0 && futureCount === 0 };
      const schedule = generateCreditSchedule({ agreementId: selected.id, principalAmount: schedulePrincipal, financeCharge: scheduleFee, term: futureCount, frequency: editDraft.frequency, customDays: Number(editDraft.customDays), firstPaymentDate: editDraft.firstPaymentDate });
      return { remaining, scheduleRemaining, schedulePrincipal, scheduleFee, count: Number(editDraft.term), futureCount, rows: schedule, first: schedule[0]?.amount, last: schedule.at(-1)?.amount, valid: true };
    } catch { return null; }
  })();

  return <section className="f-credit-page" aria-labelledby="credit-purchases-heading" aria-busy={busy}>
    {busy && <div className="f-credit-loading-banner" role="status" aria-live="polite"><span className="f-credit-spinner" aria-hidden="true"/>{pendingAction || 'Refreshing Finance data'}…</div>}
    {!selected && <>
      <header className="f-credit-header"><div><span className="f-overview-eyebrow">Purchase finance</span><h2 id="credit-purchases-heading">Credit Purchases</h2><p className="f-help">Track instalments and Pay Later plans separately from personal debt.</p></div><button type="button" className="f-primary" onClick={beginCreate}>＋ Credit Purchase</button></header>
      <div className="f-credit-metrics">
        <div className="f-credit-primary-metric">
        <CreditMetric label="Credit outstanding" amount={summary.outstanding} currency={currency} hint={`${summary.activePlans} active plan${summary.activePlans === 1 ? '' : 's'}`}/>
        </div>
        <div className="f-credit-supporting-metrics">
        <CreditMetric label="Monthly commitment" amount={summary.monthlyCommitment} currency={currency} hint="Scheduled over the next 30 days"/>
        <CreditMetric label="Next payment" amount={summary.nextPayment?.remaining || 0} currency={currency} hint={summary.nextPayment ? `${summary.nextPayment.agreement.title} · ${moneyDate(summary.nextPayment.instalment.dueDate)}` : 'No upcoming payments'} action={summary.nextPayment ? () => openAgreement(summary.nextPayment.agreement) : undefined}/>
        <CreditMetric label="Overdue amount" amount={summary.overdueAmount} currency={currency} hint={`${summary.overdue.length} overdue payment${summary.overdue.length === 1 ? '' : 's'}`} action={summary.overdue.length ? () => setView('overdue') : undefined}/>
        <CreditMetric label="Active agreements" value={summary.activePlans} hint={`${summary.settledPlans} settled · ${summary.cancelledPlans} cancelled`}/>
        <CreditMetric label="Finance cost remaining" amount={summary.financeCostRemaining} currency={currency} hint="Fixed fees not yet paid"/>
        </div>
      </div>
      {(summary.overdue.length > 0 || summary.dueSoon.length > 0) && <section className="f-credit-attention" aria-labelledby="credit-attention-heading"><div className="f-credit-section-head"><div><span className="f-overview-eyebrow">Actionable</span><h3 id="credit-attention-heading">Needs attention</h3></div><span className="f-credit-attention-total">{summary.overdue.length + summary.dueSoon.length} payment{summary.overdue.length + summary.dueSoon.length === 1 ? '' : 's'}</span></div>
        {[...summary.overdue, ...summary.dueSoon].map(row => <button type="button" className="f-credit-attention-row" key={row.instalment.id} onClick={() => openAgreement(row.agreement)}><span><strong>{row.agreement.title}</strong><small>{statusLabels[row.status]} · due {moneyDate(row.instalment.dueDate)}</small></span><strong><Money amount={row.remaining} currency={currency}/></strong><span aria-hidden="true">›</span></button>)}
      </section>}
      <div className="f-credit-tools"><label className="f-credit-search">Search<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Purchase, provider, notes or reference" aria-label="Search credit purchases"/></label><label className="f-credit-filter">Filter<select value={view} onChange={event => setView(event.target.value)}><option value="active">Active</option><option value="overdue">Overdue</option><option value="settled">Settled</option><option value="cancelled">Cancelled</option><option value="archived">Archived</option><option value="due-soon">Due soon</option><option value="zero">0% finance</option><option value="interest">Interest-bearing</option></select></label></div>
      <div className="f-credit-section-head"><div><span className="f-overview-eyebrow">{['settled', 'cancelled', 'archived'].includes(view) ? 'History' : 'Next payment first'}</span><h3>{view === 'settled' ? 'Settled agreements' : view === 'cancelled' ? 'Cancelled agreements' : view === 'archived' ? 'Archived agreements' : view === 'overdue' ? 'Overdue agreements' : view === 'due-soon' ? 'Due soon' : 'Active plans'}</h3></div><span className="f-credit-count">{plans.length}</span></div>
      {plans.length ? <div className="f-credit-list">{plans.map(({ agreement, balances, next, nextBalance, status }) => {
        const planMenuOpen = openPlanMenuId === agreement.id;
        const closePlanMenu = () => { setOpenPlanMenuId(''); setPlanMenuPosition(null); };
        const itemProps = { role: 'menuitem', tabIndex: 0, disabled: busy, className: 'f-button' };
        return <article className={`f-credit-card-entry${planMenuOpen ? ' is-menu-open' : ''}`} key={agreement.id}>
          <button type="button" className="f-credit-plan" onClick={() => openAgreement(agreement)}>
            <span className="f-credit-plan-main"><span className="f-credit-plan-name">{agreement.title}</span><span className="f-credit-plan-meta">{agreement.merchant || 'Credit purchase'}{' \u00b7 '}{agreement.archivedAt ? 'Archived' : statusLabels[status] || statusLabels[getCreditAgreementStatus(data, agreement, transactionIndex)]}</span></span>
            <strong className="f-credit-plan-balance"><Money amount={balances.totalRemaining} currency={currency}/> <small>left</small></strong>
            <span className="f-credit-plan-next">{next ? <>Next payment <strong><Money amount={nextBalance.remaining} currency={currency}/></strong>{' \u00b7 '}{moneyDate(next.dueDate)}</> : statusLabels[getCreditAgreementStatus(data, agreement, transactionIndex)]}</span>
            <span className="f-credit-plan-progress">{agreement.totalRepayable ? `${Math.min(100, Number((balances.paidTotal * 100 / agreement.totalRepayable).toFixed(2)))}% repaid` : 'No payment history'}{' \u00b7 '}{agreement.term} total payments{' \u00b7 '}{agreement.financeMode === 'apr' ? `${agreement.apr}% APR` : agreement.financeCharge ? 'Fixed finance fee' : '0% finance'}</span>
          </button>
          <div className="f-credit-list-more">
            <button ref={planMenuOpen ? planMenuTriggerRef : null} type="button" className="f-button f-credit-menu-trigger" aria-label={`More actions for ${agreement.title}`} aria-haspopup="menu" aria-expanded={planMenuOpen} onClick={() => { setPlanMenuPosition(null); setOpenPlanMenuId(planMenuOpen ? '' : agreement.id); }} onKeyDown={event => { if (event.key === 'ArrowDown' && !planMenuOpen) { event.preventDefault(); setOpenPlanMenuId(agreement.id); } }}><span aria-hidden="true">{'\u22ef'}</span></button>
            {planMenuOpen && <div ref={planMenuRef} role="menu" aria-label={`${agreement.title} actions`} className="f-credit-more-menu f-credit-plan-menu" style={{ left: planMenuPosition?.left ?? 0, top: planMenuPosition?.top ?? 0, maxHeight: planMenuPosition?.maxHeight ?? 'calc(100dvh - 1rem)', visibility: planMenuPosition ? 'visible' : 'hidden' }} onKeyDown={event => {
              const items = [...(planMenuRef.current?.querySelectorAll('[role="menuitem"]') || [])].filter(item => !item.disabled);
              const index = items.indexOf(event.target);
              let next = null;
              if (event.key === 'ArrowDown') next = items[(index + 1 + items.length) % items.length];
              if (event.key === 'ArrowUp') next = items[(index - 1 + items.length) % items.length];
              if (event.key === 'Home') next = items[0];
              if (event.key === 'End') next = items.at(-1);
              if (next) { event.preventDefault(); next.focus(); }
            }} onClick={event => { if (event.target.closest('[role="menuitem"]')) closePlanMenu(); }}>
              <button {...itemProps} onClick={() => openAgreement(agreement)}>Open details</button>
              <button {...itemProps} onClick={() => { openAgreement(agreement); beginEdit(agreement); }}>Edit agreement</button>
              {agreement.archivedAt ? <button {...itemProps} onClick={() => restoreAgreement(agreement)}>{pendingAction === 'Restoring credit purchase' ? 'Restoring\u2026' : 'Restore'}</button> : <button {...itemProps} onClick={() => archiveAgreement(agreement)}>{pendingAction === 'Archiving credit purchase' ? 'Archiving\u2026' : 'Archive'}</button>}
              {canDeleteCreditPurchase(data, agreement.id) ? <button {...itemProps} className="f-button danger-action" onClick={() => deleteAgreement(agreement)}>{pendingAction === 'Deleting credit purchase' ? 'Deleting\u2026' : agreement.archivedAt ? 'Delete permanently' : 'Delete agreement'}</button> : <small className="f-credit-delete-note">Cannot delete: {getCreditPurchaseDeleteBlockReason(data, agreement.id)}</small>}
            </div>}
          </div>
        </article>;
      })}</div> : <div className="f-credit-empty"><strong>{view === 'completed' ? 'No completed agreements yet.' : view === 'archived' ? 'No archived agreements yet.' : (data.creditAgreements || []).some(item => !item.archivedAt) ? 'No agreements match this filter.' : (data.creditAgreements || []).length ? 'No active credit purchases.' : 'No credit purchases yet.'}</strong><p>{view === 'completed' ? 'Paid-off and settled plans will be kept here.' : view === 'archived' ? 'Archived agreements stay available here.' : (data.creditAgreements || []).some(item => item.archivedAt) ? 'Archived agreements remain available in Archived.' : 'Track instalments, Pay Later purchases and financed items here.'}</p>{view === 'active' && <button type="button" className="f-primary" onClick={beginCreate}>＋ Add Credit Purchase</button>}</div>}
    </>}

    {selected && <>
      <div className="f-credit-backline"><button type="button" className="f-button" onClick={() => { setSelectedId(''); setActionError(''); }}>‹ Credit Purchases</button><span className={`f-credit-status f-credit-status-${selectedDisplayStatus}`}>{statusLabels[selectedDisplayStatus]}</span></div>
      <header className="f-credit-detail-header"><div><span className="f-overview-eyebrow">{selected.merchant || 'Credit agreement'}{selected.reference ? ` · ${selected.reference}` : ''}</span><h2 id="credit-purchases-heading">{selected.title}</h2><strong className="f-credit-detail-total"><Money amount={selectedBalances.totalRemaining} currency={currency}/><small> remaining</small></strong></div><div className="f-credit-detail-actions"><button type="button" className="f-primary" disabled={getCreditAgreementStatus(data, selected, transactionIndex) !== 'active' || busy} onClick={() => beginPayment(selected)}>{pendingAction === 'Recording payment' ? 'Recording payment…' : 'Record Payment'}</button>{getCreditAgreementStatus(data, selected, transactionIndex) === 'active' && <button type="button" className="f-button" disabled={busy} onClick={() => beginScheduleRevision(selected)}>Revise remaining schedule</button>}<details className="f-credit-more"><summary className="f-button" aria-label="More agreement actions">More</summary><div className="f-credit-more-menu" onClick={event => { if (event.target.closest('button')) event.currentTarget.closest('details').open = false; }}><button type="button" className="f-button" disabled={busy} onClick={() => beginEdit(selected)}>Edit agreement</button>{getCreditAgreementStatus(data, selected, transactionIndex) === 'active' && <><button type="button" className="f-button" disabled={busy} onClick={() => beginPayment(selected, 'extra')}>Extra payment</button><button type="button" className="f-button" disabled={busy} onClick={() => beginSettlement(selected)}>Settle early</button></>}{selected.archivedAt ? <button type="button" className="f-button" disabled={busy} onClick={() => restoreAgreement(selected)}>{pendingAction === 'Restoring credit purchase' ? 'Restoring…' : 'Restore agreement'}</button> : <button type="button" className="f-button" disabled={busy} onClick={() => archiveAgreement(selected)}>{pendingAction === 'Archiving credit purchase' ? 'Archiving…' : 'Archive agreement'}</button>}{getCreditAgreementStatus(data, selected, transactionIndex) === 'active' && selectedBalances.paidTotal === 0 && <button type="button" className="f-button" disabled={busy} onClick={() => cancelAgreement(selected)}>Cancel agreement</button>}{canDeleteCreditPurchase(data, selected.id) ? <button type="button" className="f-button danger-action" disabled={busy} onClick={() => deleteAgreement(selected)}>{pendingAction === 'Deleting credit purchase' ? 'Deleting…' : selected.archivedAt ? 'Delete permanently' : 'Delete agreement'}</button> : <small className="f-credit-delete-note">Cannot delete: {getCreditPurchaseDeleteBlockReason(data, selected.id)}</small>}</div></details></div></header>
      <section className="f-credit-progress" aria-label="Credit repayment progress"><div className="f-credit-progress-values"><span>Paid <strong><Money amount={selectedBalances.paidTotal} currency={currency}/></strong></span><span>Remaining <strong><Money amount={selectedBalances.totalRemaining} currency={currency}/></strong></span><span>{paidPercent}% repaid</span></div><div className="f-credit-progress-bar" role="progressbar" aria-label={`${paidPercent}% of credit agreement repaid`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={paidPercent}><span style={{ width: `${paidPercent}%` }}/></div></section>
      <div className="f-credit-detail-metrics"><div><span>Paid</span><strong><Money amount={selectedBalances.paidTotal} currency={currency}/></strong><small>of {formatMoney(selected.totalRepayable, currency)} total repayable</small></div><div><span>Monthly commitment</span><strong><Money amount={getCreditAgreementMonthlyCommitment(data, selected, undefined, transactionIndex)} currency={currency}/></strong><small>Scheduled over the next 30 days</small></div><div><span>Principal remaining</span><strong><Money amount={selectedBalances.principalRemaining} currency={currency}/></strong></div><div><span>Finance cost remaining</span><strong><Money amount={selectedBalances.financeCostRemaining} currency={currency}/></strong></div><div><span>Next payment</span><strong>{agreementNextPayment(data, selected, transactionIndex) ? <Money amount={getCreditInstalmentAmounts(data, selected, agreementNextPayment(data, selected, transactionIndex)).remaining} currency={currency}/> : '—'}</strong><small>{agreementNextPayment(data, selected, transactionIndex) ? moneyDate(agreementNextPayment(data, selected, transactionIndex).dueDate) : 'No payment due'}</small>{agreementNextPayment(data, selected, transactionIndex) && <div className="f-actions"><button type="button" className="f-primary" disabled={busy} onClick={() => beginPayment(selected, 'scheduled', agreementNextPayment(data, selected, transactionIndex).id)}>Record payment</button><button type="button" className="f-button f-credit-reminder-button" disabled={busy} onClick={() => remindForNextPayment(selected)}>Set one-off reminder</button></div>}</div></div>

      {(() => { const preferences = selected.creditReminderPreferences || { enabled: false, daysBefore: 1, onDueDate: true }; const canConfigure = getCreditAgreementStatus(data, selected, transactionIndex) === 'active' && !selected.archivedAt; return <section className="f-credit-section f-credit-reminder-settings" aria-labelledby="credit-reminder-heading"><div className="f-credit-section-head"><div><span className="f-overview-eyebrow">Existing CBoard Reminders</span><h3 id="credit-reminder-heading">Payment reminders</h3></div><span className="f-credit-count">{preferences.enabled ? 'Enabled' : 'Off'}</span></div><p className="f-help">Reminders use this browser’s CBoard reminder list and alert while CBoard is open. Preferences are saved with this agreement.</p><div className="f-credit-reminder-options"><label className="f-credit-check"><input type="checkbox" checked={preferences.enabled} disabled={!canConfigure || busy} onChange={event => saveCreditReminderPreferences(selected, { enabled: event.target.checked })}/>Enable reminders for unpaid instalments</label><label>Days before due date<select value={preferences.daysBefore} disabled={!canConfigure || !preferences.enabled || busy} onChange={event => saveCreditReminderPreferences(selected, { daysBefore: Number(event.target.value) })}><option value={0}>No earlier reminder</option><option value={1}>1 day before</option><option value={3}>3 days before</option><option value={7}>7 days before</option></select></label><label className="f-credit-check"><input type="checkbox" checked={preferences.onDueDate} disabled={!canConfigure || !preferences.enabled || busy} onChange={event => saveCreditReminderPreferences(selected, { onDueDate: event.target.checked })}/>Remind me on the due date</label></div>{preferences.enabled && !preferences.daysBefore && !preferences.onDueDate && <p className="f-alert" role="status">Choose at least one reminder time.</p>}</section>; })()}
      {actionError && <p className="f-alert" role="alert">{actionError}</p>}
      {selected && ['active', 'paid_off', 'settled_early'].includes(getCreditAgreementStatus(data, selected, transactionIndex)) && remainingCreditPurchaseRefund(data, selected) > 0 && <section className="f-credit-refund-panel"><div className="f-between"><div><h3>Product refunds</h3><p className="f-help">Net purchase cost: {formatMoney(Math.max(0, selected.cashPrice - (data.transactions || []).filter(item => item.type === 'creditPurchaseRefund' && item.creditAgreementId === selected.id && !item.reversedAt && (item.refundStatus || 'received') === 'received').reduce((sum, item) => sum + item.amount, 0)), currency)} &middot; Remaining refundable: {formatMoney(remainingCreditPurchaseRefund(data, selected), currency)}.</p></div><button type="button" className="f-button" onClick={() => setRefundDraft({ amount: moneyInput(remainingCreditPurchaseRefund(data, selected)), destination: 'provider', status: 'received', date: today(), note: '' })}>Record product refund</button></div>{(data.transactions || []).filter(item => item.type === 'creditPurchaseRefund' && item.creditAgreementId === selected.id).length > 0 && <ul>{(data.transactions || []).filter(item => item.type === 'creditPurchaseRefund' && item.creditAgreementId === selected.id).map(item => <li key={item.id}>{moneyDate(item.date)} &middot; {formatMoney(item.amount, currency)} &middot; {item.refundDestination === 'provider' ? 'Paid to provider' : 'Paid to you'} &middot; {item.reversedAt ? 'Reversed' : item.refundStatus || 'Received'} {!item.reversedAt && item.refundStatus === 'pending' && <button type="button" className="f-link-button" disabled={busy} onClick={() => receiveAgreementRefund(item)}>Mark received</button>} {!item.reversedAt && <button type="button" className="f-link-button" disabled={busy} onClick={() => reverseAgreementRefund(item)}>Reverse</button>}</li>)}</ul>}</section>}
      {refundDraft && selected && <form className="f-credit-form" onSubmit={saveAgreementRefund}><h3>Refund for {selected.title}</h3><label>Refund amount<input required inputMode="decimal" value={refundDraft.amount} onChange={event => setRefundDraft({ ...refundDraft, amount: event.target.value })}/></label><label>Refund went to<select value={refundDraft.destination} onChange={event => setRefundDraft({ ...refundDraft, destination: event.target.value })}><option value="provider">Finance provider &middot; reduce principal and recalculate future schedule</option><option value="user">Me directly &middot; increase owned cash, keep finance balance unchanged</option></select></label><label>Date<input required type="date" value={refundDraft.date} onChange={event => setRefundDraft({ ...refundDraft, date: event.target.value })}/></label><label>Status<select value={refundDraft.status} onChange={event => setRefundDraft({ ...refundDraft, status: event.target.value })}><option value="received">Received</option><option value="pending">Pending</option></select></label><label>Note<input maxLength="300" value={refundDraft.note} onChange={event => setRefundDraft({ ...refundDraft, note: event.target.value })}/></label><div className="f-actions"><button className="f-primary" disabled={busy}>Save refund</button><button type="button" className="f-button" onClick={() => setRefundDraft(null)}>Cancel</button></div></form>}
      {showPaymentForm && <form className="f-credit-form" onSubmit={savePayment}><h3>{paymentMode === 'extra' ? 'Extra principal payment' : 'Record a payment'}</h3>{paymentMode === 'extra' ? <p className="f-help">This payment reduces principal only. Fixed finance fees are not reduced or recalculated.</p> : <label>Instalment<select value={paymentDraft.instalmentId} onChange={event => { const instalment = selectedSchedule.find(item => item.id === event.target.value); setPaymentDraft(current => ({ ...current, instalmentId: event.target.value, amount: instalment ? moneyInput(getCreditInstalmentAmounts(data, selected, instalment, transactionIndex).remaining) : '' })); }}><option value="">Choose an instalment</option>{selectedUpcoming.map(item => { const row = getCreditInstalmentAmounts(data, selected, item, transactionIndex); return <option key={item.id} value={item.id}>{moneyDate(item.dueDate)} · {formatMoney(row.remaining, currency)} remaining · {statusLabels[getCreditInstalmentStatus(data, selected, item, undefined, transactionIndex)]}</option>; })}</select></label>}
        <div className="f-credit-form-grid"><label>Amount<input required inputMode="decimal" value={paymentDraft.amount} onChange={event => setPaymentDraft({ ...paymentDraft, amount: event.target.value })}/></label><label>Payment date<input required type="date" value={paymentDraft.date} onChange={event => setPaymentDraft({ ...paymentDraft, date: event.target.value })}/></label><SelectPaidFrom data={data} value={paymentDraft.paidFromFundId} includeAccounts onChange={value => setPaymentDraft({ ...paymentDraft, paidFromFundId: value })}/><label>Note (optional)<input maxLength="300" value={paymentDraft.note} onChange={event => setPaymentDraft({ ...paymentDraft, note: event.target.value })}/></label></div><p className="f-help">Only the amount actually recorded creates a Finance transaction and changes the selected payment source. If it exceeds the selected instalment, the excess reduces future principal in the same transaction.</p><div className="f-actions"><button className="f-primary" disabled={busy}>{busy ? 'Saving…' : 'Record real payment'}</button><button type="button" className="f-button" onClick={() => setShowPaymentForm(false)}>Cancel</button></div></form>}

      {showSettlementForm && <form className="f-credit-form" onSubmit={saveSettlement}><h3>Settle early</h3><p className="f-help">Enter the lender’s settlement quote. The full scheduled balance will be closed, and remaining instalments will be superseded.</p><div className="f-credit-form-grid"><label>Settlement amount<input required inputMode="decimal" value={settlementDraft.amount} onChange={event => setSettlementDraft({ ...settlementDraft, amount: event.target.value })}/></label><label>Settlement fee (optional)<input inputMode="decimal" value={settlementDraft.fee} onChange={event => setSettlementDraft({ ...settlementDraft, fee: event.target.value })}/></label><label>Payment date<input required type="date" value={settlementDraft.date} onChange={event => setSettlementDraft({ ...settlementDraft, date: event.target.value })}/></label><SelectPaidFrom data={data} value={settlementDraft.paidFromFundId} includeAccounts onChange={value => setSettlementDraft({ ...settlementDraft, paidFromFundId: value })}/><label>Note (optional)<input maxLength="300" value={settlementDraft.note} onChange={event => setSettlementDraft({ ...settlementDraft, note: event.target.value })}/></label></div><div className="f-actions"><button className="f-primary" disabled={busy}>Record settlement</button><button type="button" className="f-button" onClick={() => setShowSettlementForm(false)}>Cancel</button></div></form>}

      {editDraft && <section className="f-credit-form"><h3>Purchase details</h3><p className="f-help">Correct the purchase and upfront payment before changing repayment terms. Purchase price and upfront amount are locked after payment history exists.</p><div className="f-credit-form-grid"><label>Purchase date<input type="date" value={editDraft.purchaseDate} onChange={event => setEditDraft({ ...editDraft, purchaseDate: event.target.value })}/></label><label>Cash price<input inputMode="decimal" value={editDraft.cashPrice} disabled={selectedHasPaymentHistory} onChange={event => setEditDraft({ ...editDraft, cashPrice: event.target.value })}/></label><label>Upfront payment<input inputMode="decimal" value={editDraft.deposit} disabled={selectedHasPaymentHistory} onChange={event => setEditDraft({ ...editDraft, deposit: event.target.value })}/></label><label>Upfront payment date<input type="date" value={editDraft.depositDate} onChange={event => setEditDraft({ ...editDraft, depositDate: event.target.value })}/></label><label>Expense category<select value={editDraft.categoryId} onChange={event => setEditDraft({ ...editDraft, categoryId: event.target.value })}><option value="">Uncategorised</option>{categoryOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><SelectPaidFrom data={data} value={editDraft.depositPaidFromFundId} onChange={value => setEditDraft({ ...editDraft, depositPaidFromFundId: value })} label="Upfront payment from"/>{Number(editDraft.deposit) > 0 && <label className="f-credit-check"><input type="checkbox" checked={editDraft.upfrontCountsAsFirstInstalment} onChange={event => setEditDraft({ ...editDraft, upfrontCountsAsFirstInstalment: event.target.checked })}/>Counts as payment 1 of the plan</label>}</div><RecordMetadataFields category={data.categories.find(category => category.id === editDraft.categoryId)} vehicleMetadata={editDraft.vehicleMetadata} customFields={editDraft.customFields} onVehicleChange={vehicleMetadata => setEditDraft({ ...editDraft, vehicleMetadata })} onCustomFieldsChange={customFields => setEditDraft({ ...editDraft, customFields })}/>{selectedHasPaymentHistory && <p className="f-help">Purchase price and upfront amount stay locked after payment history exists. Existing Finance transactions and repayment history are preserved.</p>}</section>}
      {editDraft && <form className="f-credit-form" onSubmit={saveAgreementEdit}><h3>Edit agreement</h3><p className="f-help">Updating this agreement recalculates future unpaid instalments. Existing payments and historical Finance transactions remain unchanged.</p><div className="f-credit-form-grid"><label>Purchase name<input required maxLength="100" value={editDraft.title} onChange={event => setEditDraft({ ...editDraft, title: event.target.value })}/></label><label>Provider / lender<input maxLength="100" value={editDraft.merchant} onChange={event => setEditDraft({ ...editDraft, merchant: event.target.value })}/></label><label>Reference<input maxLength="120" value={editDraft.reference} onChange={event => setEditDraft({ ...editDraft, reference: event.target.value })}/></label><label>Product page URL (optional)<input type="url" inputMode="url" maxLength="2048" value={editDraft.productUrl} onChange={event => setEditDraft({ ...editDraft, productUrl: event.target.value })} placeholder="https://shop.example/product"/></label><label>Finance type<select value={editDraft.financeMode} onChange={event => setEditDraft({ ...editDraft, financeMode: event.target.value, ...(event.target.value === 'apr' ? { scheduleMode: 'auto', customSchedule: [] } : {}) })}><option value="zero">0% interest</option><option value="apr">APR / percentage</option><option value="fixed">Fixed finance charge</option></select></label>{editDraft.financeMode === 'fixed' && <label>Fixed finance charge<input required inputMode="decimal" value={editDraft.financeCharge} onChange={event => setEditDraft({ ...editDraft, financeCharge: event.target.value })}/></label>}{editDraft.financeMode === 'apr' && <label>Interest rate / APR<input required type="number" min="0" max="1000" step="0.01" value={editDraft.apr} onChange={event => setEditDraft({ ...editDraft, apr: event.target.value })}/> %</label>}<label>Total payments in plan<input required type="number" min="1" max="600" value={editDraft.term} onChange={event => setEditDraft({ ...editDraft, term: event.target.value })}/></label>{editDraft.financeMode !== 'apr' && <label>Schedule mode<select value={editDraft.scheduleMode} onChange={event => changeEditScheduleMode(event.target.value)}><option value="auto">Auto Split</option><option value="custom">Custom Schedule</option></select></label>}{editDraft.scheduleMode === 'auto' && <><label>Next payment date<input required type="date" value={editDraft.firstPaymentDate} onChange={event => setEditDraft({ ...editDraft, firstPaymentDate: event.target.value })}/></label><label>Frequency<select value={editDraft.frequency} onChange={event => setEditDraft({ ...editDraft, frequency: event.target.value })}><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="custom">Custom interval</option></select></label>{editDraft.frequency === 'custom' && <label>Interval in days<input required type="number" min="1" max="365" value={editDraft.customDays} onChange={event => setEditDraft({ ...editDraft, customDays: event.target.value })}/></label>}</>}<label className="f-credit-notes">Notes<textarea maxLength="1000" value={editDraft.notes} onChange={event => setEditDraft({ ...editDraft, notes: event.target.value })}/></label></div>
      {editDraft.scheduleMode === 'custom' && <section className="f-credit-custom-schedule" aria-labelledby="credit-custom-schedule-heading"><div className="f-between"><div><h4 id="credit-custom-schedule-heading">Future custom payments</h4><p className="f-help">Paid and historical rows remain locked. Add, remove, or reorder unpaid future payments; the total must reconcile before saving.</p></div><div className="f-actions"><button type="button" className="f-button" onClick={() => { try { setEditDraft({ ...editDraft, customSchedule: generateEditDraftRows() }); } catch (error) { setActionError(error.message); } }}>Generate rows</button><button type="button" className="f-button" onClick={() => setEditDraft(current => ({ ...current, term: String(Number(current.term) + 1), customSchedule: [...current.customSchedule, { id: id(), dueDate: current.customSchedule.at(-1)?.dueDate || current.firstPaymentDate, amount: '' }] }))}>+ Add payment</button></div></div>{editPreview && <p className="f-credit-reconcile" aria-live="polite">Total remaining to schedule: <strong><Money amount={editPreview.scheduleRemaining} currency={currency}/></strong> · Scheduled: <strong><Money amount={editPreview.allocated} currency={currency}/></strong> · {editPreview.unallocated < 0 ? <>Overallocated: <strong><Money amount={Math.abs(editPreview.unallocated)} currency={currency}/></strong></> : <>Still to allocate: <strong><Money amount={editPreview.unallocated} currency={currency}/></strong></>}</p>}{editDraft.customSchedule.map((row, index) => <div className="f-credit-custom-row" key={row.id || index}><span>Future {index + 1}</span><label>Due date<input type="date" value={row.dueDate} onChange={event => setEditDraft({ ...editDraft, customSchedule: editDraft.customSchedule.map((item, rowIndex) => rowIndex === index ? { ...item, dueDate: event.target.value } : item) })}/></label><label>Amount<input inputMode="decimal" value={row.amount} onChange={event => setEditDraft({ ...editDraft, customSchedule: editDraft.customSchedule.map((item, rowIndex) => rowIndex === index ? { ...item, amount: event.target.value } : item) })}/></label><button type="button" className="f-button danger-action" aria-label={`Remove future payment ${index + 1}`} onClick={() => setEditDraft(current => ({ ...current, term: String(Math.max(1, Number(current.term) - 1)), customSchedule: current.customSchedule.filter((_, rowIndex) => rowIndex !== index) }))}>Remove</button></div>)}<button type="button" className="f-button" disabled={!editPreview || editPreview.unallocated <= 0} onClick={() => splitCustomRemaining(editDraft, setEditDraft, editPreview)}>Split remaining into schedule</button></section>}
      {editPreview && <div className="f-credit-preview"><h3>Change preview</h3><div><span>Current remaining</span><strong><Money amount={selectedBalances.totalRemaining} currency={currency}/></strong></div><div><span>Updated remaining</span><strong><Money amount={editPreview.remaining} currency={currency}/></strong></div><div><span>Total payments</span><strong>{editPreview.count}</strong></div><div><span>Payments remaining</span><strong>{editPreview.futureCount}</strong></div>{editDraft.scheduleMode === 'custom' && <><div><span>Scheduled</span><strong><Money amount={editPreview.allocated} currency={currency}/></strong></div><div><span>{editPreview.unallocated < 0 ? 'Over-allocated' : 'Still to allocate'}</span><strong><Money amount={Math.abs(editPreview.unallocated)} currency={currency}/></strong></div></>}<p>Existing payments and linked Finance transactions stay unchanged.</p>{!editPreview.valid && <p className="f-alert" role="status">The future schedule must exactly match the remaining balance and payment count.</p>}</div>}
      <div className="f-actions"><button className="f-primary" disabled={busy || Boolean(editPreview && !editPreview.valid)}>{pendingAction === 'Saving agreement and recalculating schedule' ? 'Saving…' : 'Save agreement'}</button><button type="button" className="f-button" onClick={() => setEditDraft(null)}>Cancel</button></div></form>}

      <div className="f-credit-detail-grid"><section className="f-credit-section"><div className="f-credit-section-head"><div><span className="f-overview-eyebrow">Agreement</span><h3>Purchase &amp; finance terms</h3></div></div><dl className="f-credit-terms"><div><dt>Cash price</dt><dd><Money amount={selected.cashPrice} currency={currency}/></dd></div><div><dt>Upfront payment</dt><dd><Money amount={selected.deposit} currency={currency}/>{selected.upfrontCountsAsFirstInstalment && <small> Counts as payment 1</small>}</dd></div><div><dt>Amount financed</dt><dd><Money amount={selected.financedAmount} currency={currency}/></dd></div><div><dt>Finance cost</dt><dd><Money amount={selected.financeCharge} currency={currency}/></dd></div><div><dt>Total repayable</dt><dd><Money amount={selected.totalRepayable} currency={currency}/></dd></div><div><dt>Rate / fee model</dt><dd>{selected.financeMode === 'apr' ? `${selected.apr}% APR` : selected.financeCharge ? 'Fixed finance fee' : '0% interest'}</dd></div><div><dt>Purchase date</dt><dd>{moneyDate(selected.purchaseDate)}</dd></div><div><dt>Payment plan</dt><dd>{selected.term} total · {selected.scheduleMode === 'custom' ? 'Custom Schedule' : 'Auto Split'}</dd></div>{selected.productUrl && <div><dt>Product page</dt><dd><a href={selected.productUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open product page for ${selected.title} in a new tab`}>Open product page ↗</a></dd></div>}{selected.notes && <div><dt>Notes</dt><dd>{selected.notes}</dd></div>}</dl>{selected.settlement && <p className="f-help">Settled {moneyDate(selected.settlement.date)} for {formatMoney(selected.settlement.settlementAmount + selected.settlement.settlementFee, currency)}.</p>}{selected.history?.length > 0 && <details className="f-credit-audit"><summary>Agreement activity ({selected.history.length})</summary><ol>{[...selected.history].reverse().map((entry, index) => <li key={`${entry.type}-${entry.createdAt || entry.date}-${index}`}>{creditHistoryLabel(entry, currency)}</li>)}</ol></details>}</section>

        <section className="f-credit-section"><div className="f-credit-section-head"><div><span className="f-overview-eyebrow">Expected amounts</span><h3>Payment schedule</h3></div><span className="f-credit-count">{selectedRepayment.completedInstallments} / {selectedRepayment.totalInstallments} paid · {selectedRepayment.remainingInstallments} payments remaining</span></div>{visibleSchedule.length ? <div className="f-credit-schedule">{visibleSchedule.map(item => { const row = getCreditInstalmentAmounts(data, selected, item, transactionIndex), status = getCreditInstalmentStatus(data, selected, item, undefined, transactionIndex); return <div className="f-credit-schedule-row" key={item.id}><span>{moneyDate(item.dueDate)}</span><strong><Money amount={item.amount} currency={currency}/></strong>{Number.isSafeInteger(item.openingBalance)&&Number.isSafeInteger(item.closingBalance)&&<small>Opening {formatMoney(item.openingBalance,currency)} ? Principal {formatMoney(item.principalAmount||0,currency)} ? Interest {formatMoney(item.financeCostAmount||0,currency)} ? Closing {formatMoney(item.closingBalance,currency)}</small>}<span className={`f-credit-status f-credit-status-${status}`}>{statusLabels[status]}</span>{row.paid > 0 && <small>{formatMoney(row.paid, currency)} paid · {formatMoney(row.remaining, currency)} left</small>}{row.remaining > 0 && getCreditAgreementStatus(data, selected, transactionIndex) === 'active' && <button type="button" className="f-primary f-credit-row-action" disabled={busy} onClick={() => beginPayment(selected, 'scheduled', item.id)}>{row.paid > 0 ? 'Record remaining' : 'Record payment'}</button>}{selected.financeMode !== 'apr' && item.dueDate > today() && row.paid === 0 && getCreditAgreementStatus(data, selected, transactionIndex) === 'active' && <button type="button" className="f-button f-credit-row-action" onClick={() => beginScheduleEdit(item)}>Edit</button>}</div>; })}</div> : <p className="f-credit-empty-note">No scheduled payments remain.</p>}{scheduleEditDraft && <form className="f-credit-form f-credit-inline-edit" onSubmit={saveScheduleEdit}><h4>Edit future instalment</h4><div className="f-credit-form-grid"><label>Due date<input required type="date" value={scheduleEditDraft.dueDate} onChange={event => setScheduleEditDraft({ ...scheduleEditDraft, dueDate: event.target.value })}/></label><label>Payment amount<input required inputMode="decimal" value={scheduleEditDraft.amount} onChange={event => setScheduleEditDraft({ ...scheduleEditDraft, amount: event.target.value })}/></label></div><p className="f-help">Other future amounts adjust to keep the full balance reconciled. This switches the plan to Custom Schedule.</p><div className="f-actions"><button className="f-primary" disabled={busy}>Update instalment</button><button type="button" className="f-button" onClick={() => setScheduleEditDraft(null)}>Cancel</button></div></form>}{selectedSchedule.length > visibleSchedule.length && <button className="f-button" type="button" onClick={() => setShowAllSchedule(!showAllSchedule)}>{showAllSchedule ? 'Show compact schedule' : 'Show full schedule'}</button>}</section>

        <RecordMetadataView vehicleMetadata={selected.vehicleMetadata} customFields={selected.customFields}/>
      <section className="f-credit-section f-credit-history"><div className="f-credit-section-head"><div><span className="f-overview-eyebrow">Recorded and reversed</span><h3>Payment history</h3></div><span className="f-credit-count">{payments.length}</span></div>{payments.length ? <div className="f-credit-payment-history">{payments.map(payment => <article className="f-credit-history-row" key={payment.id}><span><strong>{moneyDate(payment.date)}</strong><small>{payment.reversedAt ? `Reversed ${moneyDate(payment.reversalDate)} · ` : ''}{payment.creditPaymentKind === 'extra' ? 'Extra principal' : payment.creditPaymentKind === 'scheduled_extra' ? 'Instalment + extra principal' : payment.creditPaymentKind === 'settlement' ? 'Early settlement' : payment.creditPaymentKind === 'partial' ? 'Partial instalment' : 'Instalment'} · {payment.accountId ? data.accounts?.find(account => account.id === payment.accountId)?.name || 'Account' : payment.paidFromFundId || 'Spendable'}{payment.note ? ` · ${payment.note}` : ''}</small></span><strong><Money amount={payment.amount} currency={currency}/></strong><small>Principal {formatMoney(payment.creditPrincipalAmount || 0, currency)} · Fee {formatMoney(payment.creditFinanceCostAmount || 0, currency)}</small>{openTransactionDetail&&<button type="button" className="f-button" onClick={()=>openTransactionDetail(payment)}>View transaction</button>}{!payment.reversedAt && payment.source !== 'bank' && payment.sourceType !== 'bank_import' && payment.providerStatus !== 'BOOK' && <div className="f-credit-history-actions"><button type="button" className="f-button" onClick={() => beginPaymentEdit(payment)}>Edit</button><button type="button" className="f-button danger-action" onClick={() => reversePayment(payment)}>Mark unpaid</button></div>}</article>)}</div> : <p className="f-credit-empty-note">No real payments recorded yet.</p>}{paymentEditDraft && <form className="f-credit-form f-credit-inline-edit" onSubmit={savePaymentEdit}><h4>Correct payment</h4><p className="f-help">The Finance transaction and linked Credit Payment update together. To change an extra payment or settlement amount, mark it unpaid and record the corrected payment.</p><div className="f-credit-form-grid">{!['extra', 'scheduled_extra', 'settlement'].includes(paymentEditDraft.kind) && <label>Amount<input required inputMode="decimal" value={paymentEditDraft.amount} onChange={event => setPaymentEditDraft({ ...paymentEditDraft, amount: event.target.value })}/></label>}<label>Payment date<input required type="date" value={paymentEditDraft.date} onChange={event => setPaymentEditDraft({ ...paymentEditDraft, date: event.target.value })}/></label><SelectPaidFrom data={data} value={paymentEditDraft.paidFromFundId} includeAccounts onChange={value => setPaymentEditDraft({ ...paymentEditDraft, paidFromFundId: value })}/><label>Note<input maxLength="300" value={paymentEditDraft.note} onChange={event => setPaymentEditDraft({ ...paymentEditDraft, note: event.target.value })}/></label></div><div className="f-actions"><button className="f-primary" disabled={busy}>Save correction</button><button type="button" className="f-button" onClick={() => setPaymentEditDraft(null)}>Cancel</button></div></form>}</section>
      </div>
    </>}

    {creating && <dialog className="f-dialog f-credit-dialog" open aria-labelledby="credit-create-heading"><form className="f-form" onSubmit={createAgreement}><div className="f-between"><div><span className="f-overview-eyebrow">New liability</span><h2 id="credit-create-heading">Credit Purchase</h2></div><button type="button" className="f-button" onClick={() => setCreating(false)} aria-label="Close">Close</button></div>
      <h3>Purchase</h3><div className="f-credit-form-grid"><label>Purchase name<input required maxLength="100" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="e.g. Laptop"/></label><label>Provider / lender<input maxLength="100" value={draft.merchant} onChange={event => setDraft({ ...draft, merchant: event.target.value })} placeholder="e.g. Store Finance"/></label><label>Purchase date<input required type="date" value={draft.purchaseDate} onChange={event => setDraft({ ...draft, purchaseDate: event.target.value, depositDate: draft.depositDate === draft.purchaseDate ? event.target.value : draft.depositDate })}/></label><label>Cash purchase price<input required inputMode="decimal" value={draft.cashPrice} onChange={event => setDraft({ ...draft, cashPrice: event.target.value })}/></label><label>Upfront payment paid now<input inputMode="decimal" value={draft.deposit} onChange={event => setDraft({ ...draft, deposit: event.target.value })} placeholder="0.00"/></label>{Number(draft.deposit) > 0 && <label>Upfront payment date<input type="date" value={draft.depositDate} onChange={event => setDraft({ ...draft, depositDate: event.target.value })}/></label>}<label>Expense category<select value={draft.categoryId} onChange={event => setDraft({ ...draft, categoryId: event.target.value })}><option value="">Uncategorised</option>{categoryOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{Number(draft.deposit) > 0 && <SelectPaidFrom data={data} value={draft.depositPaidFromFundId} onChange={value => setDraft({ ...draft, depositPaidFromFundId: value })} label="Upfront payment from"/>}{Number(draft.deposit) > 0 && <label className="f-credit-check"><input type="checkbox" checked={draft.upfrontCountsAsFirstInstalment} onChange={event => setDraft({ ...draft, upfrontCountsAsFirstInstalment: event.target.checked })}/>Counts as payment 1 of the plan</label>}</div>
      <RecordMetadataFields category={data.categories.find(category => category.id === draft.categoryId)} vehicleMetadata={draft.vehicleMetadata} customFields={draft.customFields} onVehicleChange={vehicleMetadata => setDraft({ ...draft, vehicleMetadata })} onCustomFieldsChange={customFields => setDraft({ ...draft, customFields })}/>
      <h3>Repayment plan</h3><div className="f-credit-form-grid"><label>Finance type<select value={draft.financeMode} onChange={event => setDraft({ ...draft, financeMode: event.target.value, ...(event.target.value === 'apr' ? { scheduleMode: 'auto', customSchedule: [] } : {}) })}><option value="zero">0% interest</option><option value="apr">APR / percentage</option><option value="fixed">Fixed finance charge</option></select></label>{draft.financeMode === 'fixed' && <label>Total finance charge<input required inputMode="decimal" value={draft.financeCharge} onChange={event => setDraft({ ...draft, financeCharge: event.target.value })}/></label>}{draft.financeMode === 'apr' && <label>Interest rate / APR<input required type="number" min="0" max="1000" step="0.01" value={draft.apr} onChange={event => setDraft({ ...draft, apr: event.target.value })}/> %</label>}<label>Total payments in plan<input required type="number" min="1" max="600" value={draft.term} onChange={event => setDraft({ ...draft, term: event.target.value })}/></label>{draft.financeMode !== 'apr' && <label>Schedule mode<select value={draft.scheduleMode} onChange={event => setDraft({ ...draft, scheduleMode: event.target.value, customSchedule: [] })}><option value="auto">Auto Split</option><option value="custom">Custom Schedule</option></select></label>}{draft.scheduleMode === 'auto' && <><label>Payment frequency<select value={draft.frequency} onChange={event => setDraft({ ...draft, frequency: event.target.value })}><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="custom">Custom interval</option></select></label>{draft.frequency === 'custom' && <label>Interval in days<input required type="number" min="1" max="365" value={draft.customDays} onChange={event => setDraft({ ...draft, customDays: event.target.value })}/></label>}<label>First future payment date<input required type="date" value={draft.firstPaymentDate} onChange={event => setDraft({ ...draft, firstPaymentDate: event.target.value })}/></label></>}</div>
      {draft.scheduleMode === 'custom' && <section className="f-credit-custom-schedule"><div className="f-between"><div><h4>Custom payments</h4><p className="f-help">Future rows are planned payments only. Finance cash changes when you record a payment.</p></div><div className="f-actions"><button type="button" className="f-button" disabled={!preview || preview.futureCount < 1} onClick={generateCreateRows}>Generate rows</button><button type="button" className="f-button" onClick={() => setDraft(current => ({ ...current, term: String(Number(current.term) + 1), customSchedule: [...current.customSchedule, { id: id(), dueDate: current.customSchedule.at(-1)?.dueDate || current.firstPaymentDate, amount: '' }] }))}>+ Add payment</button></div></div>{draft.customSchedule.map((row, index) => <div className="f-credit-custom-row" key={row.id || index}><span>Payment {index + (draft.upfrontCountsAsFirstInstalment ? 2 : 1)}</span><label>Due date<input type="date" value={row.dueDate} onChange={event => setDraft({ ...draft, customSchedule: draft.customSchedule.map((item, rowIndex) => rowIndex === index ? { ...item, dueDate: event.target.value } : item) })}/></label><label>Amount<input inputMode="decimal" value={row.amount} onChange={event => setDraft({ ...draft, customSchedule: draft.customSchedule.map((item, rowIndex) => rowIndex === index ? { ...item, amount: event.target.value } : item) })}/></label><button type="button" className="f-button danger-action" aria-label={`Remove payment ${index + 1}`} onClick={() => setDraft(current => ({ ...current, term: String(Math.max(1, Number(current.term) - 1)), customSchedule: current.customSchedule.filter((_, rowIndex) => rowIndex !== index) }))}>Remove</button></div>)}<button type="button" className="f-button" disabled={!preview || preview.unallocated <= 0} onClick={() => splitCustomRemaining(draft, setDraft, preview)}>Split remaining into schedule</button></section>}
      <div className="f-credit-form-grid"><label>Agreement / order reference<input maxLength="120" value={draft.reference} onChange={event => setDraft({ ...draft, reference: event.target.value })}/></label><label>Product page URL (optional)<input type="url" inputMode="url" maxLength="2048" value={draft.productUrl} onChange={event => setDraft({ ...draft, productUrl: event.target.value })} placeholder="https://shop.example/product"/></label><label className="f-credit-notes">Notes<textarea maxLength="1000" value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })}/></label></div>
      {preview && <section className="f-credit-preview" aria-live="polite"><h3>Agreement summary</h3><div><span>Purchase price</span><strong><Money amount={preview.cashPrice} currency={currency}/></strong></div><div><span>Paid upfront</span><strong><Money amount={preview.deposit} currency={currency}/></strong></div><div><span>Amount financed</span><strong><Money amount={preview.financed} currency={currency}/></strong></div><div><span>Estimated finance cost</span><strong><Money amount={preview.fee} currency={currency}/></strong></div><div><span>Estimated payment</span><strong>{formatMoney(preview.rows?.[0]?.amount || 0, currency)} &times; {preview.futureCount}{preview.rows?.length > 1 && preview.rows[0].amount !== preview.rows.at(-1).amount ? ` (final ${formatMoney(preview.rows.at(-1).amount, currency)})` : ''}</strong></div><div><span>Total repayable in plan</span><strong><Money amount={preview.total} currency={currency}/></strong></div><div><span>Paid</span><strong><Money amount={draft.upfrontCountsAsFirstInstalment ? preview.deposit : 0} currency={currency}/></strong></div><div><span>Remaining balance</span><strong><Money amount={preview.remaining} currency={currency}/></strong></div><div><span>Total payments</span><strong>{preview.count}</strong></div><div><span>Payments remaining</span><strong>{preview.futureCount}</strong></div>{draft.scheduleMode === 'custom' ? <><div><span>Scheduled</span><strong><Money amount={preview.allocated} currency={currency}/></strong></div><div><span>{preview.unallocated < 0 ? 'Over-allocated' : 'Still to allocate'}</span><strong><Money amount={Math.abs(preview.unallocated)} currency={currency}/></strong></div>{draft.upfrontCountsAsFirstInstalment && <p>{moneyDate(draft.depositDate || draft.purchaseDate)} — {formatMoney(preview.deposit, currency)} · Paid upfront</p>}{preview.rows.map((row, index) => <p key={row.id || index}>{moneyDate(row.dueDate)} — {formatMoney(row.amount, currency)}</p>)}</> : <>{draft.upfrontCountsAsFirstInstalment && <p>{moneyDate(draft.depositDate || draft.purchaseDate)} — {formatMoney(preview.deposit, currency)} · Paid upfront</p>}{preview.rows.map((row, index) => <p key={row.id || index}>{moneyDate(row.dueDate)} — {formatMoney(row.amount, currency)}</p>)}</>}{!preview.valid && <p className="f-alert" role="status">{draft.scheduleMode === 'custom' ? 'Custom payments must match the remaining balance and payment count.' : 'Choose a valid total payment count and future payment date.'}</p>}</section>}
      <p className="f-help">The upfront payment creates one actual Finance expense. Future schedule rows do not affect cash until you record those payments. {draft.financeMode === 'apr' ? `APR ${draft.apr || '0'}% uses an estimated reducing-balance schedule at the selected frequency.` : 'Interest is calculated from the selected 0% or fixed-charge mode.'}</p>{createError && <p className="f-alert" role="alert">{createError}</p>}<div className="f-actions"><button className="f-primary" disabled={busy || Boolean(preview && !preview.valid)}>{busy ? 'Saving…' : 'Create credit agreement'}</button><button type="button" className="f-button" onClick={() => setCreating(false)}>Cancel</button></div></form></dialog>}
    <Dialog open={Boolean(revisionDraft)} onClose={() => setRevisionDraft(null)} labelledBy="credit-revision-title" className="f-credit-revision-dialog">
      {revisionDraft && <form className="f-credit-revision-form" onSubmit={saveScheduleRevision}>
        <header><div><span className="f-overview-eyebrow">Schedule change</span><h2 id="credit-revision-title">Revise remaining schedule</h2></div><p>Booked payments and account movements stay unchanged. Saving updates future instalments and their reminders only.</p></header>
        {revisionPreview?.error ? <p className="f-alert" role="alert">{revisionPreview.error}</p> : revisionPreview && <>
          <section className="f-credit-revision-counts" aria-label="Payment counts"><div><strong>{revisionPreview.counts.completedCount}</strong><span>Completed instalments</span></div><div><strong>{revisionPreview.counts.protectedCount}</strong><span>Overdue or part-paid, protected</span></div><div><strong>{revisionPreview.counts.eligibleCount}</strong><span>Future instalments eligible</span></div></section>
          <p className="f-help">Completed means an instalment is fully paid from linked scheduled payments. Partial payments and extra principal do not count as completed. Protected overdue or part-paid rows remain at their current terms and count toward the revised total.</p>
        </>}
        <div className="f-credit-form-grid"><label>Count input mode<select value={revisionDraft.countMode} onChange={event => setRevisionDraft({ ...revisionDraft, countMode: event.target.value })}><option value="remaining">Remaining payments</option><option value="total">Set total payments</option></select></label><label>{revisionDraft.countMode === 'remaining' ? 'Future instalments to recalculate' : 'Set total payments'}<input required type="number" min="1" max="600" value={revisionDraft.count} onChange={event => setRevisionDraft({ ...revisionDraft, count: event.target.value })}/></label><label>Total payments in revised plan<input readOnly aria-readonly="true" value={revisionPreview ? revisionPreview.counts.completedCount + revisionPreview.counts.protectedCount + revisionPreview.futureCount : ''}/></label><label>First future payment date<input required type="date" min={today()} value={revisionDraft.firstPaymentDate} onChange={event => setRevisionDraft({ ...revisionDraft, firstPaymentDate: event.target.value })}/></label><label>Frequency<select value={revisionDraft.frequency} onChange={event => setRevisionDraft({ ...revisionDraft, frequency: event.target.value })}><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="custom">Custom interval</option></select></label>{revisionDraft.frequency === 'custom' && <label>Interval in days<input type="number" min="1" max="365" value={revisionDraft.customDays} onChange={event => setRevisionDraft({ ...revisionDraft, customDays: event.target.value })}/></label>}
          <label>Revised future schedule<select value={revisionDraft.scheduleMode} onChange={event => setRevisionDraft({ ...revisionDraft, scheduleMode: event.target.value, customSchedule: [] })}><option value="auto">Calculate from remaining balance</option><option value="custom">Lender-provided schedule</option></select></label>
          {selected.financeMode === 'fixed' && <><label className="f-credit-check"><input type="checkbox" checked={revisionDraft.useConfirmedFixedCharge} onChange={event => setRevisionDraft({ ...revisionDraft, useConfirmedFixedCharge: event.target.checked })}/>Use lender-confirmed revised total finance charge</label>{revisionDraft.useConfirmedFixedCharge && <label>Confirmed total finance charge<input required inputMode="decimal" value={revisionDraft.fixedCharge} onChange={event => setRevisionDraft({ ...revisionDraft, fixedCharge: event.target.value })}/></label>}</>}
          {selected.financeMode === 'apr' && <p className="f-help">APR {selected.apr}% uses the existing reducing-balance calculation. Future interest and total are estimates until lender figures are confirmed.</p>}
          {revisionDraft.scheduleMode === 'custom' && <div className="f-credit-revision-custom"><p>Enter one future date and amount per recalculated instalment. Amounts must reconcile exactly to the outstanding terms.</p>{Array.from({ length: Math.max(0, Math.min(600, revisionPreview?.futureCount || Number(revisionDraft.count))) }, (_, index) => { const row = revisionDraft.customSchedule[index] || { dueDate: '', amount: '' }; return <div className="f-credit-custom-row" key={index}><strong>Payment {index + 1}</strong><label>Date<input type="date" value={row.dueDate} onChange={event => { const rows = [...revisionDraft.customSchedule]; rows[index] = { ...row, dueDate: event.target.value }; setRevisionDraft({ ...revisionDraft, customSchedule: rows }); }}/></label><label>Amount<input inputMode="decimal" value={row.amount} onChange={event => { const rows = [...revisionDraft.customSchedule]; rows[index] = { ...row, amount: event.target.value }; setRevisionDraft({ ...revisionDraft, customSchedule: rows }); }}/></label></div>; })}{selected.financeMode === 'apr' && <label>Lender-confirmed future total repayable<input required inputMode="decimal" value={revisionDraft.confirmedFutureTotal} onChange={event => setRevisionDraft({ ...revisionDraft, confirmedFutureTotal: event.target.value })}/></label>}</div>}
        </div>
        {revisionPreview && !revisionPreview.error && <div className="f-credit-revision-impact"><section><h3>Current schedule</h3><p>Remaining principal <strong>{formatMoney(selectedBalances.principalRemaining, currency)}</strong></p><p>Remaining instalments <strong>{selectedRepayment.remainingInstallments}</strong></p><p>Next payment <strong>{selectedNext ? `${moneyDate(selectedNext.dueDate)} ? ${formatMoney(getCreditInstalmentAmounts(data, selected, selectedNext).remaining, currency)}` : 'None'}</strong></p><p>Remaining finance cost <strong>{formatMoney(selectedBalances.financeCostRemaining, currency)}</strong></p><p>Total still to pay <strong>{formatMoney(selectedBalances.totalRemaining, currency)}</strong></p><p>Expected final payment <strong>{moneyDate(selectedSchedule.filter(row => !row.supersededAt && getCreditInstalmentAmounts(data, selected, row).remaining > 0).at(-1)?.dueDate)}</strong></p></section><section><h3>Revised schedule</h3><p>Remaining principal <strong>{formatMoney(getCreditAgreementBalances(revisionPreview.candidate, revisionPreview.revised).principalRemaining, currency)}</strong></p><p>Remaining instalments <strong>{revisionPreview.revisedCounts.eligibleCount + revisionPreview.revisedCounts.protectedCount}</strong></p><p>Next recalculated payment <strong>{revisionPreview.futureRows[0] ? `${moneyDate(revisionPreview.futureRows[0].dueDate)} ? ${formatMoney(revisionPreview.futureRows[0].amount, currency)}` : 'None'}</strong></p><p>{selected.financeMode === 'apr' ? 'Estimated remaining finance cost' : 'Remaining finance cost'} <strong>{formatMoney(getCreditAgreementBalances(revisionPreview.candidate, revisionPreview.revised).financeCostRemaining, currency)}</strong></p><p>Total still to pay <strong>{formatMoney(getCreditAgreementBalances(revisionPreview.candidate, revisionPreview.revised).totalRemaining, currency)}</strong></p><p>Expected final payment <strong>{moneyDate([...revisionPreview.futureRows, ...revisionPreview.counts.protectedRows.map(row => row.instalment)].sort((left, right) => left.dueDate.localeCompare(right.dueDate)).at(-1)?.dueDate)}</strong></p>{revisionPreview.protectedNext && <p className="f-help">Protected next payment: {moneyDate(revisionPreview.protectedNext.instalment.dueDate)} ? {formatMoney(revisionPreview.protectedNext.remaining, currency)}</p>}</section></div>}
        {revisionPreview?.futureRows?.length > 0 && <details className="f-credit-revision-schedule"><summary>Review proposed instalments ({revisionPreview.futureRows.length})</summary><ol>{revisionPreview.futureRows.map(row => <li key={row.id}>{moneyDate(row.dueDate)} ? {formatMoney(row.amount, currency)} <small>(principal {formatMoney(row.principalAmount, currency)} ? finance {formatMoney(row.financeCostAmount, currency)})</small></li>)}</ol></details>}
        {revisionDraft.sourceFingerprint !== revisionPreview?.fingerprint && <p className="f-alert" role="status">A payment, refund, or reversal changed the balance. Review the refreshed preview before saving.</p>}{actionError && <p className="f-alert" role="alert">{actionError}</p>}<footer className="f-actions"><button className="f-primary" disabled={busy || !revisionPreview || Boolean(revisionPreview.error) || !revisionPreview.valid || revisionPreview.futureRows.length !== revisionPreview.futureCount}>{pendingAction === 'Saving revised schedule' ? 'Saving?' : 'Save revised schedule'}</button><button type="button" className="f-button" onClick={() => setRevisionDraft(null)}>Cancel</button></footer>
      </form>}
    </Dialog>
  </section>;
}
