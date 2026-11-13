import { id } from './financeData.js';
import { nextTransactionSequence } from './transactionOrder.js';
import { convertMinorUnits } from '../../services/currencyService.js';
import { debtPlanStatus } from './financeDebtPlans.js';

const cents = value => Math.max(0, Math.round(Number(value) || 0));

// The payment ledger is the source of truth for principal. The stored
// debt.remaining field is a cached value and can drift in older workspaces.
export function debtActualPaid(state, debtId) {
  return (state.debtPayments || [])
    .filter(item => item.debtId === debtId && !item.reversedAt)
    .reduce((sum, item) => sum + cents(item.amount), 0);
}

export function debtRemainingAmount(state, debtId) {
  const debt = (state.debts || []).find(item => item.id === debtId);
  if (!debt) return 0;
  const paid = debtActualPaid(state, debtId);
  const original = debt.original == null ? cents(debt.remaining) + paid : cents(debt.original);
  return Math.max(0, original - paid);
}

export function debtRemainingSourceAmount(state, debtId) {
  const debt = (state.debts || []).find(item => item.id === debtId);
  if (!debt) return 0;
  const paid = (state.debtPayments || [])
    .filter(item => item.debtId === debtId && !item.reversedAt)
    .reduce((sum, item) => sum + cents(item.sourceAmount ?? item.amount), 0);
  const sourceOriginal = debt.sourceOriginal ?? (Number.isSafeInteger(debt.sourceRemaining) ? debt.sourceRemaining + paid : debt.original);
  return Math.max(0, cents(sourceOriginal) - paid);
}

export function reconcileDebtBalance(state, debtId) {
  const debt = (state.debts || []).find(item => item.id === debtId);
  if (!debt) return false;
  const remaining = debtRemainingAmount(state, debtId);
  const sourceRemaining = debtRemainingSourceAmount(state, debtId);
  const changed = debt.remaining !== remaining || (Number.isSafeInteger(debt.sourceRemaining) && debt.sourceRemaining !== sourceRemaining);
  debt.remaining = remaining;
  if (Number.isSafeInteger(debt.sourceRemaining)) debt.sourceRemaining = sourceRemaining;
  debt.status = remaining ? 'open' : 'paid';
  if (!remaining) {
    debt.repaymentPlanStatus = 'completed';
    for (const rule of state.allocationRules || []) if (rule.targetType === 'debt' && rule.targetId === debtId) rule.active = false;
  } else if (debt.repaymentPlanStatus === 'completed') {
    debt.repaymentPlanStatus = (state.allocationRules || []).some(rule => rule.targetType === 'debt' && rule.targetId === debtId && rule.active) ? 'active' : 'not_started';
  }
  return changed;
}

export function debtPaymentDue(state, debtId = '') {
  if (!debtId) return (state.debts || []).reduce((sum, debt) => sum + debtPaymentDue(state, debt.id), 0);
  const accrued = (state.debtAccruals || [])
    .filter(item => item.debtId === debtId && item.status !== 'reversed')
    .reduce((sum, item) => sum + Math.max(0, cents(item.accruedAmount ?? item.amount) - cents(item.paidAmount) - cents(item.releasedAmount)), 0);
  // Old workspaces can have both stale principal balances and due entries
  // that exceed the debt after recorded payments. Never offer more due than
  // the amount that remains to repay.
  return Math.min(accrued, debtRemainingAmount(state, debtId));
}

export function debtAccumulationExcess(state, debtId) {
  const reserved = (state.debtAccruals || [])
    .filter(item => item.debtId === debtId && item.status !== 'reversed')
    .reduce((sum, item) => sum + Math.max(0, cents(item.accruedAmount ?? item.amount) - cents(item.paidAmount) - cents(item.releasedAmount)), 0);
  return Math.max(0, reserved - debtRemainingAmount(state, debtId));
}

export function releaseDebtAccumulationExcess(state, debtId, date = new Date().toISOString().slice(0, 10)) {
  let excess = debtAccumulationExcess(state, debtId);
  if (!excess) return 0;
  const accruals = (state.debtAccruals || [])
    .filter(item => item.debtId === debtId && item.status !== 'reversed')
    .sort((left, right) => String(right.effectiveDate || '').localeCompare(String(left.effectiveDate || '')) || String(right.id || '').localeCompare(String(left.id || '')));
  let released = 0;
  for (const accrual of accruals) {
    if (!excess) break;
    const available = Math.max(0, cents(accrual.accruedAmount ?? accrual.amount) - cents(accrual.paidAmount) - cents(accrual.releasedAmount));
    const amount = Math.min(excess, available);
    if (!amount) continue;
    accrual.releasedAmount = cents(accrual.releasedAmount) + amount;
    accrual.releaseDate = date;
    excess -= amount;
    released += amount;
  }
  return released;
}

export function debtPayoffReady(state, debtId) {
  const remaining = debtRemainingAmount(state, debtId);
  return remaining > 0 && debtPaymentDue(state, debtId) >= remaining;
}

export function debtPaymentSummary(state, debtId, month = null) {
  const accruals = (state.debtAccruals || []).filter(item => item.debtId === debtId && item.status !== 'reversed');
  const payments = (state.debtPayments || []).filter(item => item.debtId === debtId && !item.reversedAt);
  return {
    due: debtPaymentDue(state, debtId),
    addedThisMonth: accruals.filter(item => String(item.effectiveDate || '').startsWith(month || '\0')).reduce((sum, item) => sum + cents(item.accruedAmount ?? item.amount), 0),
    paidThisMonth: payments.filter(item => String(item.date || '').startsWith(month || '\0')).reduce((sum, item) => sum + cents(item.amount), 0),
    paidAllTime: payments.reduce((sum, item) => sum + cents(item.amount), 0),
    paymentCount: payments.length,
  };
}

export function getDebtStatus(state, debtId) {
  const debt = (state.debts || []).find(item => item.id === debtId);
  if (!debt) return 'missing';
  if (debt.archivedAt) return 'archived';
  return debtPlanStatus({ ...debt, remaining: debtRemainingAmount(state, debtId) }, state.allocationRules || []);
}

export function filterDebts(state, { status = 'active', query = '' } = {}) {
  const normalizedQuery = String(query).trim().toLocaleLowerCase();
  return (state.debts || []).filter(debt => {
    const debtStatus = getDebtStatus(state, debt.id);
    const matchesStatus = status === 'all'
      || status === 'archived' && debtStatus === 'archived'
      || status === 'paid' && debtStatus === 'completed'
      || status === 'paused' && debtStatus === 'paused'
      || status === 'active' && !['archived', 'completed', 'paused', 'missing'].includes(debtStatus);
    return matchesStatus && (!normalizedQuery || `${debt.name || ''} ${debt.notes || ''}`.toLocaleLowerCase().includes(normalizedQuery));
  }).sort((a, b) => Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt))
    || debtRemainingAmount(state, b.id) - debtRemainingAmount(state, a.id)
    || String(a.name || '').localeCompare(String(b.name || '')));
}

export function canDeleteDebt(state, debtId) {
  const debt = (state.debts || []).find(item => item.id === debtId);
  if (!debt) return false;
  return !(state.debtPayments || []).some(item => item.debtId === debtId)
    && !(state.debtAccruals || []).some(item => item.debtId === debtId)
    && !(state.transactions || []).some(item => item.type === 'debt' && (item.targetId === debtId || item.debtId === debtId));
}

export function deleteDebt(state, debtId) {
  if (!canDeleteDebt(state, debtId)) return false;
  state.debts = (state.debts || []).filter(item => item.id !== debtId);
  state.allocationRules = (state.allocationRules || []).filter(item => !(item.targetType === 'debt' && item.targetId === debtId));
  return true;
}

export function setDebtArchived(state, debtId, archived, date = new Date().toISOString()) {
  const debt = (state.debts || []).find(item => item.id === debtId);
  if (!debt || Boolean(debt.archivedAt) === Boolean(archived)) return false;
  if (archived) {
    debt.archivedAt = date;
    for (const rule of state.allocationRules || []) if (rule.targetType === 'debt' && rule.targetId === debtId) rule.active = false;
    if ((state.allocationRules || []).some(rule => rule.targetType === 'debt' && rule.targetId === debtId)) debt.repaymentPlanStatus = 'paused';
  } else delete debt.archivedAt;
  return true;
}

export function debtAccrualSettlementStatus(accrual) {
  if (!accrual || accrual.status === 'reversed') return 'reversed';
  const total = cents(accrual.accruedAmount ?? accrual.amount);
  const paid = cents(accrual.paidAmount);
  const released = cents(accrual.releasedAmount);
  if (total > 0 && paid + released >= total) return released > 0 && paid === 0 ? 'released' : 'settled';
  return paid > 0 ? 'partially_settled' : 'outstanding';
}

export function accrueDebtPayment(state, { debtId, amount, effectiveDate, sourceType = 'income_rule', linkedIncomeTransactionId = '', sourceIncomeAmount = null, sourceIncomeDescription = '', sourceIncomeDate = '', repaymentRuleId = '', executionKey = '', note = '' }) {
  const debt = (state.debts || []).find(item => item.id === debtId);
  const requested = cents(amount);
  if (!debt || requested <= 0 || !effectiveDate) return false;
  state.debtAccruals ||= [];
  if (executionKey && state.debtAccruals.some(item => item.executionKey === executionKey)) return false;
  const available = Math.max(0, debtRemainingAmount(state, debtId) - debtPaymentDue(state, debtId));
  const accruedAmount = Math.min(requested, available);
  if (!accruedAmount) return false;
  state.debtAccruals.push({
    id: id(), debtId, amount: accruedAmount, accruedAmount, paidAmount: 0, effectiveDate,
    sourceType, linkedIncomeTransactionId, sourceIncomeAmount, sourceIncomeDescription, sourceIncomeDate, repaymentRuleId, executionKey,
    status: 'outstanding', note,
  });
  return true;
}

export function editDebtAccumulation(state, accrualId, { amount, effectiveDate, note = '' }) {
  const accrual = (state.debtAccruals || []).find(item => item.id === accrualId);
  if (!accrual || accrual.status === 'reversed' || cents(accrual.paidAmount) > 0 || cents(accrual.releasedAmount) > 0) throw new Error('Only unreleased, unpaid accumulation entries can be edited.');
  const requested = cents(amount);
  if (!requested || !effectiveDate) throw new Error('Enter a valid amount and date.');
  const othersDue = (state.debtAccruals || []).filter(item => item.debtId === accrual.debtId && item.status !== 'reversed' && item.id !== accrualId)
    .reduce((sum, item) => sum + Math.max(0, cents(item.accruedAmount ?? item.amount) - cents(item.paidAmount) - cents(item.releasedAmount)), 0);
  if (requested > Math.max(0, debtRemainingAmount(state, accrual.debtId) - othersDue)) throw new Error('Accumulated amount cannot exceed the remaining debt.');
  accrual.amount = requested;
  accrual.accruedAmount = requested;
  accrual.effectiveDate = effectiveDate;
  accrual.note = note;
  if (accrual.sourceType === 'income_rule') accrual.manuallyOverriddenAt = new Date().toISOString();
  accrual.status = 'outstanding';
  return accrual;
}

export function removeDebtAccumulation(state, accrualId, date = new Date().toISOString().slice(0, 10)) {
  const accrual = (state.debtAccruals || []).find(item => item.id === accrualId);
  if (!accrual || accrual.status === 'reversed') return false;
  if (cents(accrual.paidAmount) > 0) throw new Error('Undo the linked payment before removing a paid accumulation.');
  accrual.status = 'reversed';
  accrual.reversedAt = new Date().toISOString();
  accrual.reversalDate = date;
  return true;
}

export function migrateLegacyDebtAllocations(state) {
  state.debtAccruals ||= [];
  const automaticReservations = (state.transactions || []).filter(item => item.type === 'debt' && item.allocationStatus === 'allocated' && item.allocationRuleId && item.targetId && !item.reversedAt);
  if (!automaticReservations.length) return 0;
  const migrated = [];
  for (const transaction of automaticReservations) {
    const executionKey = transaction.sourceIncomeId
      ? `${transaction.allocationRuleId}:${transaction.sourceIncomeId}`
      : `${transaction.allocationRuleId}:monthly:${String(transaction.date || '').slice(0, 7)}`;
    const exists = state.debtAccruals.some(item => item.executionKey === executionKey);
    const created = accrueDebtPayment(state, {
      debtId: transaction.targetId, amount: transaction.amount, effectiveDate: transaction.date,
      sourceType: transaction.sourceIncomeId ? 'income_rule' : 'scheduled_rule',
      linkedIncomeTransactionId: transaction.sourceIncomeId || '', sourceIncomeAmount: transaction.sourceIncomeAmount ?? null, sourceIncomeDescription: transaction.sourceIncomeDescription || '', sourceIncomeDate: transaction.sourceIncomeDate || '', repaymentRuleId: transaction.allocationRuleId,
      executionKey, note: transaction.note || 'Migrated from an unpaid automatic allocation',
    });
    if (exists || created) migrated.push(transaction);
  }
  const ids = new Set(migrated.map(item => item.id));
  state.transactions = state.transactions.filter(item => !ids.has(item.id));
  state.debtPayments = (state.debtPayments || []).filter(item => !ids.has(item.transactionId));
  return migrated.length;
}

export function recordDebtPayment(state, { debtId, amount, sourceAmount = amount, sourceCurrency = state.settings?.currency || 'GBP', exchangeRate = 1, rateDate = '', date, paidFromFundId = '', title = '', note = '', preferredAccrualId = '' }) {
  const debt = (state.debts || []).find(item => item.id === debtId);
  const value = cents(amount), sourceValue = cents(sourceAmount);
  if (!debt) throw new Error('Choose a debt to record this payment against.');
  if (!value || !sourceValue) throw new Error('Enter a payment amount greater than zero.');
  if (!date) throw new Error('Choose the payment date.');
  const remainingBeforePayment = debtRemainingAmount(state, debtId);
  if (value > remainingBeforePayment) throw new Error('Payment cannot exceed the remaining debt.');
  const sourceRemainingBeforePayment = debtRemainingSourceAmount(state, debtId);
  if (Number.isSafeInteger(debt.sourceRemaining) && sourceValue > sourceRemainingBeforePayment) throw new Error('Payment cannot exceed the remaining amount in the debt currency.');
  state.debtAccruals ||= [];
  state.debtPayments ||= [];
  state.transactions ||= [];
  const transactionId = id();
  let toAllocate = value;
  const sourceAccruals = [];
  const outstanding = state.debtAccruals
    .filter(item => item.debtId === debtId && item.status !== 'reversed' && cents(item.accruedAmount ?? item.amount) > cents(item.paidAmount) + cents(item.releasedAmount))
    .sort((a, b) => String(a.effectiveDate).localeCompare(String(b.effectiveDate)) || String(a.id).localeCompare(String(b.id)));
  if (preferredAccrualId) outstanding.sort((a, b) => Number(b.id === preferredAccrualId) - Number(a.id === preferredAccrualId));
  for (const accrual of outstanding) {
    if (!toAllocate) break;
    const unpaid = cents(accrual.accruedAmount ?? accrual.amount) - cents(accrual.paidAmount) - cents(accrual.releasedAmount);
    const allocated = Math.min(unpaid, toAllocate);
    accrual.paidAmount = cents(accrual.paidAmount) + allocated;
    accrual.status = accrual.paidAmount >= cents(accrual.accruedAmount ?? accrual.amount) ? 'fully_paid' : 'partially_paid';
    sourceAccruals.push({ accrualId: accrual.id, amount: allocated });
    toAllocate -= allocated;
  }
  const paidRecord = {
    id: id(), debtId, amount: value, sourceAmount: sourceValue, sourceCurrency, exchangeRate,
    rateDate, date, transactionId, paidFromFundId, sourceAccruals,
  };
  const createdAt = new Date().toISOString();
  const transaction = {
    id: transactionId, sequence: nextTransactionSequence(state), title: title.trim() || `Payment to ${debt.name}`,
    amount: value, type: 'debt', targetId: debtId, categoryId: '', date, paymentDate: date,
    sourceType: 'debt_payment', paidFromFundId, note: note || `${sourceCurrency} ${sourceValue} at ${exchangeRate}`,
    createdAt, updatedAt: createdAt,
  };
  debt.remaining = Math.max(0, remainingBeforePayment - value);
  if (Number.isSafeInteger(debt.sourceRemaining)) debt.sourceRemaining = Math.max(0, sourceRemainingBeforePayment - sourceValue);
  debt.status = debt.remaining ? 'open' : 'paid';
  if (!debt.remaining) {
    debt.repaymentPlanStatus = 'completed';
    for (const rule of state.allocationRules || []) if (rule.targetType === 'debt' && rule.targetId === debtId) rule.active = false;
  }
  state.debtPayments.push(paidRecord);
  state.transactions.push(transaction);
  return transaction;
}

// Finance change callbacks must return the complete next state, not the transaction row.
export function recordDebtPaymentState(state, paymentData) {
  recordDebtPayment(state, paymentData);
  return state;
}

export function canEditDebtPayment(state, paymentId) {
  const payment = (state.debtPayments || []).find(item => item.id === paymentId && !item.reversedAt);
  const transaction = payment && (state.transactions || []).find(item => item.id === payment.transactionId);
  return Boolean(payment && transaction && transaction.type === 'debt'
    && transaction.source !== 'bank' && transaction.sourceType !== 'bank_import'
    && !transaction.reversedAt);
}

export function correctDebtPayment(state, paymentId, { amount, date, note = '', correctedAt = new Date().toISOString() } = {}) {
  if (!canEditDebtPayment(state, paymentId)) throw new Error('This payment cannot be edited.');
  const payment = state.debtPayments.find(item => item.id === paymentId && !item.reversedAt);
  const transaction = state.transactions.find(item => item.id === payment.transactionId);
  const debt = (state.debts || []).find(item => item.id === payment.debtId);
  const value = cents(amount);
  if (!debt || !value || !date) throw new Error('Enter a valid payment amount and date.');
  const maxAmount = debtRemainingAmount(state, debt.id) + cents(payment.amount);
  if (value > maxAmount) throw new Error('Payment cannot exceed the remaining debt.');

  const rate = Number(payment.exchangeRate || 1);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('The saved exchange rate is invalid.');
  const maxSourceAmount = debtRemainingSourceAmount(state, debt.id) + cents(payment.sourceAmount ?? payment.amount);
  const sourceAmount = convertMinorUnits(value, 1 / rate);
  if (sourceAmount > maxSourceAmount) throw new Error('Payment cannot exceed the remaining amount in the debt currency.');
  if (!sourceAmount) throw new Error('The corrected amount is too small in the debt currency.');
  const before = { amount: cents(payment.amount), sourceAmount: cents(payment.sourceAmount ?? payment.amount), date: payment.date, note: transaction.note || '' };
  const after = { amount: value, sourceAmount, date, note: String(note).trim() };
  if (before.amount === after.amount && before.sourceAmount === after.sourceAmount && before.date === after.date && before.note === after.note) return false;

  payment.corrections ||= [];
  payment.corrections.push({ correctedAt, before, after });
  Object.assign(payment, { amount: value, sourceAmount, date, paidFromFundId: payment.paidFromFundId || transaction.paidFromFundId || '' });
  Object.assign(transaction, { amount: value, date, paymentDate: date, note: after.note, updatedAt: correctedAt });

  // Reconcile allocation from the authoritative active payment set, preserving
  // oldest-first settlement and each payment's own allocation evidence.
  const accruals = (state.debtAccruals || []).filter(item => item.debtId === debt.id && item.status !== 'reversed');
  for (const accrual of accruals) {
    accrual.paidAmount = 0;
    accrual.status = cents(accrual.accruedAmount ?? accrual.amount) ? 'outstanding' : 'reversed';
  }
  const payments = (state.debtPayments || []).filter(item => item.debtId === debt.id && !item.reversedAt)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.transactionId || '').localeCompare(String(b.transactionId || '')));
  for (const activePayment of payments) {
    let unallocated = cents(activePayment.amount);
    activePayment.sourceAccruals = [];
    for (const accrual of accruals) {
      if (!unallocated) break;
      const available = Math.max(0, cents(accrual.accruedAmount ?? accrual.amount) - cents(accrual.paidAmount) - cents(accrual.releasedAmount));
      const allocated = Math.min(available, unallocated);
      if (!allocated) continue;
      accrual.paidAmount += allocated;
      accrual.status = accrual.paidAmount >= cents(accrual.accruedAmount ?? accrual.amount) ? 'fully_paid' : 'partially_paid';
      activePayment.sourceAccruals.push({ accrualId: accrual.id, amount: allocated });
      unallocated -= allocated;
    }
  }
  reconcileDebtBalance(state, debt.id);
  return true;
}

export function canMarkDebtPaymentUnpaid(state, transaction, allowSendMoney = false) {
  if (!transaction || transaction.type !== 'debt' || transaction.reversedAt || (transaction.sendMoneyId && !allowSendMoney) || transaction.source === 'bank' || transaction.sourceType === 'bank_import') return false;
  const payment = (state.debtPayments || []).find(item => item.transactionId === transaction.id && !item.reversedAt);
  const title = String(transaction.title || '').trim().toLocaleLowerCase();
  const titleDebt = (state.debts || []).find(item => title === `payment to ${String(item.name || '').trim().toLocaleLowerCase()}`);
  const debtId = payment?.debtId || transaction.targetId || titleDebt?.id;
  return Boolean((debtId && (state.debts || []).some(item => item.id === debtId)) || (state.debts || []).some(item => item.remaining > 0));
}

export function markDebtPaymentUnpaid(state, transactionId, date, debtIdOverride = '', allowSendMoney = false) {
  const transaction = (state.transactions || []).find(item => item.id === transactionId);
  if (!canMarkDebtPaymentUnpaid(state, transaction, allowSendMoney)) return false;
  state.debtPayments ||= [];
  let payment = state.debtPayments.find(item => item.transactionId === transactionId && !item.reversedAt);
  const title = String(transaction.title || '').trim().toLocaleLowerCase();
  const titleDebt = state.debts.find(item => title === `payment to ${String(item.name || '').trim().toLocaleLowerCase()}`);
  const debt = state.debts.find(item => item.id === (payment?.debtId || transaction.targetId || titleDebt?.id || debtIdOverride));
  const amount = cents(payment?.amount ?? transaction.amount);
  if (!debt || !amount) return false;
  if (!payment) {
    payment = { id: id(), debtId: debt.id, amount, date: transaction.date, sourceAmount: amount, sourceCurrency: debt.sourceCurrency || state.settings?.currency || 'GBP', transactionId };
    state.debtPayments.push(payment);
  }
  const remainingBeforeUndo = debtRemainingAmount(state, debt.id);
  const sourceRemainingBeforeUndo = debtRemainingSourceAmount(state, debt.id);
  const timestamp = new Date().toISOString();
  transaction.reversedAt = timestamp;
  transaction.reversalReason = 'debt_payment_marked_unpaid';
  payment.reversedAt = timestamp;
  payment.reversalDate = date;
  debt.remaining = debt.original == null ? remainingBeforeUndo + amount : debtRemainingAmount(state, debt.id);
  if (Number.isSafeInteger(debt.sourceRemaining) && Number.isSafeInteger(payment.sourceAmount)) {
    debt.sourceRemaining = Number.isSafeInteger(debt.sourceOriginal) ? debtRemainingSourceAmount(state, debt.id) : sourceRemainingBeforeUndo + payment.sourceAmount;
  }
  debt.status = 'open';
  if (debt.repaymentPlanStatus === 'completed') debt.repaymentPlanStatus = (state.allocationRules || []).some(rule => rule.targetType === 'debt' && rule.targetId === debt.id && rule.active) ? 'active' : 'not_started';
  const restored = new Map((payment.sourceAccruals || []).map(item => [item.accrualId, cents(item.amount)]));
  for (const accrual of state.debtAccruals || []) {
    const restoredAmount = restored.get(accrual.id) || 0;
    if (!restoredAmount) continue;
    accrual.paidAmount = Math.max(0, cents(accrual.paidAmount) - restoredAmount);
    accrual.status = accrual.paidAmount >= cents(accrual.accruedAmount ?? accrual.amount) ? 'fully_paid' : accrual.paidAmount ? 'partially_paid' : 'outstanding';
  }
  if (!restored.size) {
    state.debtAccruals ||= [];
    state.debtAccruals.push({
      id: id(), debtId: debt.id, amount, accruedAmount: amount, paidAmount: 0,
      effectiveDate: date, sourceType: 'legacy_payment_correction', linkedPaymentId: payment.id,
      linkedFinanceTransactionId: transaction.id, status: 'outstanding', note: 'Payment marked unpaid',
    });
  }
  return true;
}

export function markOrphanDebtPaymentUnpaid(state, paymentId, date) {
  const payment = (state.debtPayments || []).find(item => item.id === paymentId && !item.reversedAt);
  if (!payment || (state.transactions || []).some(item => item.id === payment.transactionId)) return false;
  const debt = (state.debts || []).find(item => item.id === payment.debtId);
  const amount = cents(payment.amount);
  if (!debt || !amount) return false;

  const timestamp = new Date().toISOString();
  payment.reversedAt = timestamp;
  payment.reversalDate = date;
  const remaining = debtRemainingAmount(state, debt.id);
  debt.remaining = remaining;
  if (Number.isSafeInteger(debt.sourceRemaining)) debt.sourceRemaining = debtRemainingSourceAmount(state, debt.id);
  debt.status = remaining ? 'open' : 'paid';
  if (debt.repaymentPlanStatus === 'completed') {
    debt.repaymentPlanStatus = (state.allocationRules || []).some(rule => rule.targetType === 'debt' && rule.targetId === debt.id && rule.active) ? 'active' : 'not_started';
  }

  const restored = new Map((payment.sourceAccruals || []).map(item => [item.accrualId, cents(item.amount)]));
  for (const accrual of state.debtAccruals || []) {
    const restoredAmount = restored.get(accrual.id) || 0;
    if (!restoredAmount) continue;
    accrual.paidAmount = Math.max(0, cents(accrual.paidAmount) - restoredAmount);
    accrual.status = accrual.paidAmount >= cents(accrual.accruedAmount ?? accrual.amount) ? 'fully_paid' : accrual.paidAmount ? 'partially_paid' : 'outstanding';
  }
  if (!restored.size) {
    state.debtAccruals ||= [];
    state.debtAccruals.push({
      id: id(), debtId: debt.id, amount, accruedAmount: amount, paidAmount: 0,
      effectiveDate: date, sourceType: 'legacy_payment_correction', linkedPaymentId: payment.id,
      status: 'outstanding', note: 'Unlinked payment marked unpaid',
    });
  }
  return true;
}

export function reconcileDebtIncome(state, income, operation = 'replace') {
  const deleting = operation === 'delete' || operation === true;
  const rules = (state.allocationRules || []).filter(rule => rule.targetType === 'debt');
  const touched = (state.debtAccruals || []).filter(item => item.linkedIncomeTransactionId === income.id && item.status !== 'reversed');
  for (const accrual of touched) {
    const paid = cents(accrual.paidAmount);
    if (accrual.manuallyOverriddenAt) continue;
    if (deleting) {
      accrual.sourceIncomeAmount ??= income.amount; accrual.sourceIncomeDescription ||= income.title || 'Income'; accrual.sourceIncomeDate ||= income.date || accrual.effectiveDate;
      accrual.originalSourceIncomeId ||= income.id;
      if (paid) {
        accrual.accruedAmount = paid;
        accrual.amount = paid;
        accrual.status = 'fully_paid';
        accrual.linkedIncomeTransactionId = '';
      } else accrual.status = 'reversed';
      continue;
    }
    accrual.sourceIncomeAmount = income.amount; accrual.sourceIncomeDescription = income.title || 'Income'; accrual.sourceIncomeDate = income.date || accrual.effectiveDate;
    const rule = rules.find(item => item.id === accrual.repaymentRuleId);
    const debt = state.debts.find(item => item.id === accrual.debtId);
    if (!rule || !debt) continue;
    const requested = rule.mode === 'percent' ? Math.round(cents(income.amount) * Number(rule.value || 0) / 10000) : cents(rule.value);
    const oldTotal = cents(accrual.accruedAmount ?? accrual.amount);
    const released = cents(accrual.releasedAmount);
    const oldDue = Math.max(0, oldTotal - paid - released);
    const otherDue = Math.max(0, debtPaymentDue(state, debt.id) - oldDue);
    const available = Math.max(0, cents(debt.remaining) - otherDue);
    const updated = paid + released + Math.min(Math.max(0, requested - paid - released), available);
    accrual.amount = updated;
    accrual.accruedAmount = updated;
    accrual.status = updated <= paid ? 'fully_paid' : paid ? 'partially_paid' : updated ? 'outstanding' : 'reversed';
  }
}
