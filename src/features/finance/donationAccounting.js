import { id } from './financeData.js';
import { nextTransactionSequence } from './transactionOrder.js';

const amountFor = (rule, income) => rule.mode === 'percent'
  ? Math.round(income * Number(rule.value || 0) / 10000)
  : Number(rule.value || 0);

function nextCreatedAt(state) {
  const previous = Math.max(0, ...(state.donationAccruals || []).map(item => Date.parse(item.createdAt) || 0));
  return new Date(Math.max(Date.now(), previous + 1)).toISOString();
}

export function donationDue(state, categoryId = '') {
  return (state.donationAccruals || []).filter(item => (!categoryId || item.categoryId === categoryId) && item.status !== 'reversed')
    .reduce((sum, item) => sum + Math.max(0, Number(item.accruedAmount ?? item.amount ?? 0) - Number(item.paidAmount || 0)), 0);
}

export function accrueDonation(state, { categoryId = '', amount, currency = state.settings?.currency || 'GBP', effectiveDate, sourceType = 'manual', linkedIncomeTransactionId = '', automationRuleId = '', linkedDonationTargetId = '', note = '', executionKey = '' }) {
  const value = Number(amount);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Donation due must be a positive amount.');
  if (executionKey && (state.donationAccruals || []).some(item => item.executionKey === executionKey)) return false;
  state.donationAccruals ||= [];
  state.donationAccruals.push({ id: id(), categoryId, amount: value, accruedAmount: value, paidAmount: 0, currency, effectiveDate, sourceType, linkedIncomeTransactionId, automationRuleId, linkedDonationTargetId, executionKey, note, status: 'outstanding', createdAt: nextCreatedAt(state) });
  return true;
}

export function reconcileDonationIncome(state, income, operation = 'replace') {
  const deleting = operation === 'delete' || operation === true;
  const linked = (state.donationAccruals || []).filter(item => item.linkedIncomeTransactionId === income.id && item.automationRuleId);
  for (const accrual of linked) {
    const rule = (state.allocationRules || []).find(item => item.id === accrual.automationRuleId);
    const desired = deleting || !rule ? 0 : amountFor(rule, income.amount);
    const paid = Number(accrual.paidAmount || 0);
    if (paid > 0 && desired < paid) {
      accrual.accruedAmount = paid;
      accrual.amount = paid;
      accrual.reconciliationRequired = true;
      accrual.reconciliationNote = deleting ? 'Source income was deleted after payment.' : 'Source income changed below the amount already paid.';
      accrual.status = 'fully_paid';
    } else if (desired <= 0) {
      accrual.status = 'reversed';
      accrual.accruedAmount = paid;
      accrual.amount = paid;
    } else {
      accrual.amount = desired;
      accrual.accruedAmount = desired;
      accrual.effectiveDate = income.date;
      accrual.status = paid >= desired ? 'fully_paid' : paid ? 'partially_paid' : 'outstanding';
      accrual.reconciliationRequired = false;
      delete accrual.reconciliationNote;
    }
  }
  if (!deleting) {
    for (const rule of (state.allocationRules || []).filter(item => item.targetType === 'donation' && item.active && item.timing === 'income' && (!item.startedOn || item.startedOn <= income.date))) {
      const executionKey = `${rule.id}:${income.id}`;
      const amount = amountFor(rule, income.amount);
      if (!(state.donationAccruals || []).some(item => item.executionKey === executionKey) && amount > 0) {
        accrueDonation(state, { categoryId: rule.donationCategoryId || '', amount, effectiveDate: income.date, sourceType: 'income_percentage', linkedIncomeTransactionId: income.id, automationRuleId: rule.id, linkedDonationTargetId: rule.donationTargetId || '', note: rule.name || '', executionKey });
      }
    }
  }
  return { reconciliationRequired: linked.some(item => item.reconciliationRequired) };
}

export function payDonationDue(state, { categoryId, amount, date, paidFromFundId = '', note = '', title = '' }) {
  const due = donationDue(state, categoryId);
  if (!categoryId) throw new Error('Choose a donation category.');
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Enter a payment amount greater than zero.');
  if (amount > due) throw new Error('Payment cannot be greater than the amount due.');
  const category = (state.categories || []).find(item => item.type === 'donation' && !item.archived);
  if (!category) throw new Error('Add an active Donation category in Finance categories first.');
  state.donationAccruals ||= [];
  state.donationPayments ||= [];
  const accruals = state.donationAccruals.filter(item => item.categoryId === categoryId && item.status !== 'reversed' && Number(item.accruedAmount ?? item.amount ?? 0) > Number(item.paidAmount || 0))
    .sort((a, b) => String(a.effectiveDate).localeCompare(String(b.effectiveDate)) || String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));
  let remaining = amount;
  const allocations = [];
  for (const accrual of accruals) {
    if (!remaining) break;
    const outstanding = Number(accrual.accruedAmount ?? accrual.amount) - Number(accrual.paidAmount || 0);
    const allocated = Math.min(remaining, outstanding);
    accrual.paidAmount = Number(accrual.paidAmount || 0) + allocated;
    accrual.status = accrual.paidAmount >= Number(accrual.accruedAmount ?? accrual.amount) ? 'fully_paid' : 'partially_paid';
    allocations.push({ accrualId: accrual.id, amount: allocated });
    remaining -= allocated;
  }
  const paymentId = id();
  const transaction = { id: id(), sequence: nextTransactionSequence(state), title: title || `Donation: ${(state.donationCategories || []).find(item => item.id === categoryId)?.name || 'Donation'}`, amount, type: 'expense', categoryId: category.id, financeGroup: 'donation', donationCategoryId: categoryId, date, paymentDate: date, paymentMethod: paidFromFundId, paidFromFundId, note, sourceType: 'donation_payment', donationPaymentId: paymentId, createdAt: new Date().toISOString() };
  state.transactions.push(transaction);
  state.donationPayments.push({ id: paymentId, categoryId, amount, financeTransactionId: transaction.id, date, sourceAccruals: allocations, paidFromFundId, note, createdAt: transaction.createdAt });
  return transaction;
}

export function removeDonationPayment(state, financeTransactionId) {
  const index = (state.donationPayments || []).findIndex(item => item.financeTransactionId === financeTransactionId);
  if (index < 0) return false;
  const [payment] = state.donationPayments.splice(index, 1);
  for (const allocation of payment.sourceAccruals || []) {
    const accrual = (state.donationAccruals || []).find(item => item.id === allocation.accrualId);
    if (!accrual) continue;
    accrual.paidAmount = Math.max(0, Number(accrual.paidAmount || 0) - Number(allocation.amount || 0));
    if (accrual.status !== 'reversed') accrual.status = accrual.paidAmount === 0 ? 'outstanding' : accrual.paidAmount >= Number(accrual.accruedAmount ?? accrual.amount) ? 'fully_paid' : 'partially_paid';
  }
  return true;
}

export function donationPaymentForTransaction(state, transaction) {
  if (!transaction) return null;
  return (state.donationPayments || []).find(item => item.id === transaction.donationPaymentId || item.financeTransactionId === transaction.id) || null;
}

export function canUndoDonationPayment(state, transaction) {
  if (!transaction || transaction.source === 'bank' || transaction.sourceType === 'bank_import' || transaction.reversedAt) return false;
  const payment = donationPaymentForTransaction(state, transaction);
  if (payment) return !payment.reversedAt;
  return Boolean(transaction.linkedReservationId && (state.transactions || []).some(item => item.id === transaction.linkedReservationId && item.type === 'donation' && item.allocationStatus === 'allocated'));
}

function isDonationFinanceTransaction(state, transaction) {
  if (!transaction || !['expense', 'donation'].includes(transaction.type)) return false;
  const financeCategory = (state.categories || []).find(item => item.id === transaction.categoryId);
  return transaction.type === 'donation'
    || transaction.financeGroup === 'donation'
    || financeCategory?.type === 'donation'
    || Boolean(transaction.donationCategoryId);
}

/** Existing CBoard Donation expenses can be corrected even if they predate DonationPayment links. */
export function canMarkDonationPaymentUnpaid(state, transaction) {
  if (!transaction || transaction.reversedAt || transaction.source === 'bank' || transaction.source || transaction.sourceType === 'bank_import' || transaction.sourceType === 'receipt' || transaction.receipt) return false;
  if (['allocated', 'planned', 'cancelled'].includes(transaction.allocationStatus)) return false;
  const linkedPayment = canUndoDonationPayment(state, transaction);
  if (!linkedPayment && transaction.sourceType && !['manual', 'donation_payment', 'legacy_manual'].includes(transaction.sourceType)) return false;
  return linkedPayment || isDonationFinanceTransaction(state, transaction);
}

/** Reverse a CBoard recorded donation payment without deleting its finance or due history. */
export function undoDonationPayment(state, paymentOrTransactionId, reversedOn = new Date().toISOString().slice(0, 10)) {
  const payment = (state.donationPayments || []).find(item => item.id === paymentOrTransactionId || item.financeTransactionId === paymentOrTransactionId);
  const transaction = (state.transactions || []).find(item => item.id === (payment?.financeTransactionId || paymentOrTransactionId) || item.donationPaymentId === paymentOrTransactionId);
  if (!transaction) throw new Error('The linked Finance payment could not be found.');
  if (transaction.source === 'bank' || transaction.sourceType === 'bank_import') throw new Error('Bank transactions cannot be undone here. Unlink the donation while keeping the bank transaction.');
  state.donationReversals ||= [];
  const existing = state.donationReversals.find(item => item.financeTransactionId === transaction.id);
  if (transaction.reversedAt || payment?.reversedAt || existing) return { alreadyReversed: true, transaction, payment, reversal: existing || null, amount: transaction.amount, restoredTo: transaction.linkedReservationId ? 'reserve' : 'due' };
  if (!payment && !transaction.linkedReservationId) throw new Error('This transaction is not linked to an undoable Donation payment.');
  const reservation = transaction.linkedReservationId && (state.transactions || []).find(item => item.id === transaction.linkedReservationId && item.type === 'donation' && item.allocationStatus === 'allocated');
  if (!payment && !reservation) throw new Error('The linked Donation reserve could not be found.');
  const sourceAccruals = (payment?.sourceAccruals || []).map(item => ({ accrualId: item.accrualId, amount: Number(item.amount || 0) }));
  for (const allocation of sourceAccruals) {
    const accrual = (state.donationAccruals || []).find(item => item.id === allocation.accrualId);
    if (!accrual) throw new Error('A Donation due allocation linked to this payment is missing.');
    const paidAmount = Number(accrual.paidAmount || 0);
    if (allocation.amount < 0 || allocation.amount > paidAmount) throw new Error('The linked Donation due allocation is inconsistent; payment was not changed.');
  }
  for (const allocation of sourceAccruals) {
    const accrual = state.donationAccruals.find(item => item.id === allocation.accrualId);
    accrual.paidAmount = Number(accrual.paidAmount || 0) - allocation.amount;
    if (accrual.status !== 'reversed') accrual.status = accrual.paidAmount === 0 ? 'outstanding' : accrual.paidAmount >= Number(accrual.accruedAmount ?? accrual.amount) ? 'fully_paid' : 'partially_paid';
  }
  const reversal = { id: id(), paymentId: payment?.id || '', financeTransactionId: transaction.id, categoryId: payment?.categoryId || transaction.donationCategoryId || reservation?.donationCategoryId || '', amount: transaction.amount, date: reversedOn, originalPaymentDate: payment?.date || transaction.paymentDate || transaction.date, sourceType: 'manual_undo', sourceAccruals, linkedReservationId: transaction.linkedReservationId || '', createdAt: new Date().toISOString() };
  state.donationReversals.push(reversal);
  transaction.reversedAt = reversedOn;
  transaction.donationReversalId = reversal.id;
  if (payment) { payment.reversedAt = reversedOn; payment.reversalId = reversal.id; }
  if (reservation?.settlementTransactionId === transaction.id) delete reservation.settlementTransactionId;
  return { alreadyReversed: false, transaction, payment, reversal, amount: transaction.amount, restoredTo: sourceAccruals.length ? 'due' : reservation ? 'reserve' : 'due' };
}

/** Reverses a linked payment, or safely constructs Donation due/payment links for a legacy Finance entry. */
export function markDonationPaymentUnpaid(state, transactionId, categoryId = '', reversedOn = new Date().toISOString().slice(0, 10)) {
  const transaction = (state.transactions || []).find(item => item.id === transactionId);
  if (!transaction) throw new Error('The Finance donation transaction could not be found.');
  if (transaction.reversedAt || (state.donationReversals || []).some(item => item.financeTransactionId === transaction.id)) {
    return undoDonationPayment(state, transaction.id, reversedOn);
  }
  if (!canMarkDonationPaymentUnpaid(state, transaction)) {
    if (transaction.source === 'bank' || transaction.sourceType === 'bank_import') throw new Error('Imported bank transactions cannot be marked unpaid. Reclassify the transaction while keeping the bank record.');
    if (transaction.sourceType === 'receipt' || transaction.receipt) throw new Error('Receipt transactions cannot be corrected as Donation payments.');
    if (transaction.source) throw new Error('Imported transactions cannot be marked unpaid here. Reclassify the transaction while keeping its source record.');
    throw new Error('This is not an eligible active Donation payment.');
  }
  if (canUndoDonationPayment(state, transaction)) return undoDonationPayment(state, transaction.id, reversedOn);

  const storedCategory = (state.donationCategories || []).find(item => item.id === transaction.donationCategoryId);
  const selectedCategory = (state.donationCategories || []).find(item => item.id === categoryId);
  if (storedCategory && categoryId && storedCategory.id !== categoryId) throw new Error('This transaction already has a Donation category. Keep that category for its Due record.');
  const resolvedCategoryId = storedCategory?.id || selectedCategory?.id;
  if (!resolvedCategoryId) throw new Error('Choose the Donation category this payment belongs to.');
  const amount = Number(transaction.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('The Finance transaction amount is invalid.');

  state.donationAccruals ||= [];
  state.donationPayments ||= [];
  const accrualId = id();
  const paymentId = id();
  const stamp = transaction.createdAt || new Date().toISOString();
  state.donationAccruals.push({
    id: accrualId, categoryId: resolvedCategoryId, amount, accruedAmount: amount, paidAmount: amount,
    currency: state.settings?.currency || 'GBP', effectiveDate: transaction.date, sourceType: 'legacy_payment_correction',
    linkedFinanceTransactionId: transaction.id, note: 'Reopened from a previously recorded Finance Donation payment',
    status: 'fully_paid', createdAt: stamp,
  });
  state.donationPayments.push({
    id: paymentId, categoryId: resolvedCategoryId, amount, financeTransactionId: transaction.id,
    date: transaction.paymentDate || transaction.date, sourceAccruals: [{ accrualId, amount }],
    paidFromFundId: transaction.paidFromFundId || '', note: transaction.note || '', sourceType: 'legacy_conversion', createdAt: stamp,
  });
  transaction.donationCategoryId = resolvedCategoryId;
  transaction.financeGroup = 'donation';
  transaction.donationPaymentId = paymentId;
  transaction.sourceType ||= 'manual';
  transaction.legacyDonationPayment = true;
  return { ...undoDonationPayment(state, transaction.id, reversedOn), legacyConverted: true };
}
