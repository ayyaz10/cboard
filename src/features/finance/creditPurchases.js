import { id } from './financeData.js';
const validDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};
const cents = value => Number.isSafeInteger(value) && value >= 0;
const creditPaymentTransactions = state => (state.transactions || []).filter(item => item.type === 'creditPayment' && (!item.source || item.providerStatus === 'BOOK'));
const activeTransactions = state => creditPaymentTransactions(state).filter(item => !item.reversedAt);

export function createCreditTransactionIndex(state) {
  const paymentsByAgreement = new Map(), paymentsByInstalment = new Map(), depositsByAgreement = new Map();
  for (const item of state.transactions || []) {
    if (!item || item.reversedAt) continue;
    if (item.creditPaymentKind === 'deposit') depositsByAgreement.set(item.creditAgreementId, item);
    if (item.type !== 'creditPayment' || (item.source && item.providerStatus !== 'BOOK')) continue;
    const agreementPayments = paymentsByAgreement.get(item.creditAgreementId) || [];
    agreementPayments.push(item);
    paymentsByAgreement.set(item.creditAgreementId, agreementPayments);
    if (item.scheduledInstalmentId) {
      const key = `${item.creditAgreementId}:${item.scheduledInstalmentId}`;
      const instalmentPayments = paymentsByInstalment.get(key) || [];
      instalmentPayments.push(item);
      paymentsByInstalment.set(key, instalmentPayments);
    }
  }
  return { paymentsByAgreement, paymentsByInstalment, depositsByAgreement };
}

export function mutateCreditState(state, mutation) {
  mutation(state);
  return state;
}

function cleanProductUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length > 2048) throw new Error('Product links must be 2,048 characters or fewer.');
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('Enter a valid product link starting with https:// or http://.'); }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Product links must use HTTP or HTTPS and cannot contain sign-in credentials.');
  return parsed.href;
}

function addDays(date, days) {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function addMonths(date, count) {
  const [year, month, day] = date.split('-').map(Number);
  const targetMonth = month - 1 + count;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = (targetMonth % 12 + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, normalizedMonth, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

function distribute(total, count) {
  // Keep rows even and let the final row absorb the minor-unit remainder.
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, index) => index === count - 1 ? total - base * (count - 1) : base);
}

export function calculateRemainingBalance(totalRepayable, paidAmount) {
  if (!cents(totalRepayable) || !cents(paidAmount)) throw new Error('Amounts must be valid integer minor units.');
  return Math.max(0, totalRepayable - paidAmount);
}

export function calculateRemainingInstallmentCount(totalCount, paidCount) {
  if (!Number.isInteger(totalCount) || totalCount < 0 || !Number.isInteger(paidCount) || paidCount < 0) throw new Error('Payment counts must be non-negative whole numbers.');
  return Math.max(0, totalCount - paidCount);
}

export function validateCustomSchedule({ principalAmount, financeCharge = 0, rows }) {
  if (!cents(principalAmount) || !cents(financeCharge) || !Array.isArray(rows)) throw new Error('Enter a valid custom schedule.');
  const expected = principalAmount + financeCharge;
  const scheduled = rows.reduce((sum, row) => {
    if (!row || !validDate(row.dueDate) || !Number.isSafeInteger(row.amount) || row.amount <= 0) throw new Error('Every custom payment needs a valid date and positive amount.');
    return sum + row.amount;
  }, 0);
  if (!Number.isSafeInteger(scheduled) || scheduled !== expected) throw new Error(`Custom payments must total ${expected} minor units; currently allocated ${scheduled}.`);
  return { scheduled, remaining: expected - scheduled };
}

export function generateCustomCreditSchedule({ agreementId, principalAmount, financeCharge = 0, rows }) {
  validateCustomSchedule({ principalAmount, financeCharge, rows });
  const sorted = rows.map(row => ({ ...row })).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  let feeRemaining = financeCharge, principalRemaining = principalAmount, openingBalance = principalAmount;
  return sorted.map((row, index) => {
    const fee = Math.min(feeRemaining, row.amount);
    const principal = row.amount - fee;
    feeRemaining -= fee;
    principalRemaining -= principal;
    const result = { id: row.id || `${agreementId}:custom:${index + 1}`, sequence: index + 1, dueDate: row.dueDate, openingBalance, amount: row.amount, principalAmount: principal, financeCostAmount: fee, closingBalance: Math.max(0, principalRemaining) };
    openingBalance = result.closingBalance;
    return result;
  });
}

function activeDepositTransaction(state, agreementId, transactionIndex) {
  if (transactionIndex) return transactionIndex.depositsByAgreement.get(agreementId) || null;
  return (state.transactions || []).find(item => item.creditAgreementId === agreementId && item.creditPaymentKind === 'deposit' && !item.reversedAt);
}

export function generateCreditSchedule({ agreementId, principalAmount, financeCharge = 0, term, frequency = 'monthly', customDays = 30, firstPaymentDate }) {
  if (!agreementId || !cents(principalAmount) || !cents(financeCharge) || (principalAmount <= 0 && financeCharge <= 0) || !Number.isInteger(term) || term < 1 || term > 600 || !validDate(firstPaymentDate)) throw new Error('Enter valid credit agreement terms.');
  if (!['monthly', 'weekly', 'fortnightly', 'custom'].includes(frequency)) throw new Error('Choose a supported payment frequency.');
  if (frequency === 'custom' && (!Number.isInteger(customDays) || customDays < 1 || customDays > 365)) throw new Error('Custom payment intervals must be from 1 to 365 days.');
  const total = principalAmount + financeCharge;
  if (!Number.isSafeInteger(total) || total < principalAmount) throw new Error('The total repayable amount is outside the supported range.');
  const principals = distribute(principalAmount, term), fees = distribute(financeCharge, term);
  let openingBalance = principalAmount;
  return principals.map((principalAmountForRow, index) => {
    const closingBalance = openingBalance - principalAmountForRow;
    const row = {
      id: `${agreementId}:instalment:${index + 1}`, sequence: index + 1,
      dueDate: frequency === 'monthly' ? addMonths(firstPaymentDate, index) : addDays(firstPaymentDate, index * (frequency === 'weekly' ? 7 : frequency === 'fortnightly' ? 14 : customDays)),
      openingBalance, amount: principalAmountForRow + fees[index], principalAmount: principalAmountForRow, financeCostAmount: fees[index], closingBalance,
    };
    openingBalance = closingBalance;
    return row;
  });
}

export function generateAprCreditSchedule({ agreementId, principalAmount, apr, term, frequency = 'monthly', customDays = 30, firstPaymentDate }) {
  if (!agreementId || !cents(principalAmount) || principalAmount <= 0 || !Number.isFinite(apr) || apr < 0 || apr > 1000 || !Number.isInteger(term) || term < 1 || term > 600 || !validDate(firstPaymentDate)) throw new Error('Enter valid APR agreement terms.');
  if (!['monthly', 'weekly', 'fortnightly', 'custom'].includes(frequency)) throw new Error('Choose a supported payment frequency.');
  if (frequency === 'custom' && (!Number.isInteger(customDays) || customDays < 1 || customDays > 365)) throw new Error('Custom payment intervals must be from 1 to 365 days.');
  const periodsPerYear = frequency === 'monthly' ? 12 : frequency === 'weekly' ? 365 / 7 : frequency === 'fortnightly' ? 365 / 14 : 365 / customDays;
  // APR is the nominal annual rate: convert it to the plan's periodic rate
  // using the selected payment frequency before calculating amortization.
  const periodicRate = apr / 100 / periodsPerYear;
  const payment = periodicRate === 0 ? principalAmount / term : principalAmount * periodicRate / (1 - Math.pow(1 + periodicRate, -term));
  const rows = []; let openingBalance = principalAmount, financeCharge = 0;
  for (let index = 0; index < term; index += 1) {
    const interestPortion = Math.min(openingBalance, Math.round(openingBalance * periodicRate));
    const amount = index === term - 1 ? openingBalance + interestPortion : Math.min(openingBalance + interestPortion, Math.max(1, Math.round(payment)));
    const principal = amount - interestPortion, closingBalance = Math.max(0, openingBalance - principal);
    financeCharge += interestPortion;
    rows.push({ id: `${agreementId}:instalment:${index + 1}`, sequence: index + 1, dueDate: frequency === 'monthly' ? addMonths(firstPaymentDate, index) : addDays(firstPaymentDate, index * (frequency === 'weekly' ? 7 : frequency === 'fortnightly' ? 14 : customDays)), openingBalance, amount, principalAmount: principal, financeCostAmount: interestPortion, closingBalance });
    openingBalance = closingBalance;
  }
  return { schedule: rows, financeCharge, totalRepayable: principalAmount + financeCharge };
}
export function getCreditPaymentTransactions(state, agreementId) {
  return creditPaymentTransactions(state).filter(item => item.creditAgreementId === agreementId);
}

export function archiveCreditAgreement(state, agreementId, date = new Date().toISOString().slice(0, 10)) {
  const agreement = (state.creditAgreements || []).find(item => item.id === agreementId);
  if (!agreement || agreement.archivedAt || !validDate(date)) throw new Error('This agreement cannot be archived.');
  agreement.archivedAt = date;
  agreement.history ||= [];
  agreement.history.push({ type: 'agreement_archived', date, createdAt: new Date().toISOString() });
  return agreement;
}

export function restoreCreditAgreement(state, agreementId) {
  const agreement = (state.creditAgreements || []).find(item => item.id === agreementId);
  if (!agreement || !agreement.archivedAt) throw new Error('This agreement is not archived.');
  agreement.history ||= [];
  agreement.history.push({ type: 'agreement_restored', date: new Date().toISOString().slice(0, 10), createdAt: new Date().toISOString() });
  delete agreement.archivedAt;
  return agreement;
}

export function getCreditPurchaseDeleteBlockReason(state, agreementId) {
  const agreement = (state.creditAgreements || []).find(item => item.id === agreementId);
  if (!agreement) return 'This credit purchase could not be found.';
  const linkedTransactions = (state.transactions || []).filter(item => item.creditAgreementId === agreementId);
  if (linkedTransactions.some(item => item.type === 'creditPayment')) return 'This agreement has recorded payment history. Archive it to preserve its financial history.';
  if (linkedTransactions.length || agreement.deposit > 0) return 'This agreement has a linked Finance transaction. Archive it to preserve the financial record.';
  return '';
}

export function canDeleteCreditPurchase(state, agreementId) {
  return !getCreditPurchaseDeleteBlockReason(state, agreementId);
}

export function deleteUnusedCreditAgreement(state, agreementId) {
  const agreement = (state.creditAgreements || []).find(item => item.id === agreementId);
  if (!agreement) throw new Error('This credit agreement could not be found.');
  const blockReason = getCreditPurchaseDeleteBlockReason(state, agreementId);
  if (blockReason) throw new Error(blockReason);
  state.creditAgreements = state.creditAgreements.filter(item => item.id !== agreementId);
  return agreement;
}

export function getCreditAgreementBalances(state, agreement, transactionIndex = createCreditTransactionIndex(state)) {
  if (!agreement) return { principalRemaining: 0, financeCostRemaining: 0, totalRemaining: 0, paidPrincipal: 0, paidFinanceCost: 0, paidTotal: 0 };
  const payments = transactionIndex.paymentsByAgreement.get(agreement.id) || [];
  const upfrontRow = (agreement.schedule || []).find(item => item.upfrontPayment);
  const upfrontTransaction = agreement.upfrontCountsAsFirstInstalment ? activeDepositTransaction(state, agreement.id, transactionIndex) : null;
  const upfrontRowPayments = upfrontRow ? payments.filter(item => item.scheduledInstalmentId === upfrontRow.id) : [];
  const ordinaryPayments = upfrontRow ? payments.filter(item => item.scheduledInstalmentId !== upfrontRow.id) : payments;
  const upfrontPaid = upfrontTransaction?.amount || upfrontRowPayments.reduce((sum, item) => sum + item.amount, 0);
  const paidPrincipal = ordinaryPayments.reduce((sum, item) => sum + (Number.isSafeInteger(item.creditPrincipalAmount) ? item.creditPrincipalAmount : 0), upfrontPaid);
  const paidFinanceCost = payments.reduce((sum, item) => sum + (Number.isSafeInteger(item.creditFinanceCostAmount) ? item.creditFinanceCostAmount : 0), 0);
  const paidTotal = ordinaryPayments.reduce((sum, item) => sum + item.amount, upfrontPaid);
  if (agreement.settledEarlyAt || agreement.status === 'cancelled') return { principalRemaining: 0, financeCostRemaining: 0, totalRemaining: 0, paidPrincipal, paidFinanceCost, paidTotal };
  const principalBase = agreement.financedAmount + (agreement.upfrontCountsAsFirstInstalment ? agreement.deposit || 0 : 0);
  const providerRefunds = (state.transactions || []).filter(item => item.type === 'creditPurchaseRefund' && item.creditAgreementId === agreement.id && item.refundDestination === 'provider' && !item.reversedAt && (item.refundStatus || 'received') === 'received').reduce((sum, item) => sum + item.amount, 0);
  const principalRemaining = Math.max(0, principalBase - paidPrincipal - providerRefunds);
  const financeCostRemaining = Math.max(0, agreement.financeCharge - paidFinanceCost);
  return { principalRemaining, financeCostRemaining, totalRemaining: principalRemaining + financeCostRemaining, paidPrincipal, paidFinanceCost, paidTotal, providerRefunds };
}

export function getCreditInstalmentAmounts(state, agreement, instalment, transactionIndex = createCreditTransactionIndex(state)) {
  const payments = transactionIndex.paymentsByInstalment.get(`${agreement.id}:${instalment.id}`) || [];
  const upfront = instalment.upfrontPayment && agreement.upfrontCountsAsFirstInstalment && activeDepositTransaction(state, agreement.id, transactionIndex);
  const upfrontPaid = upfront && upfront.id === instalment.upfrontTransactionId ? upfront.amount : 0;
  const paid = payments.reduce((sum, item) => sum + (item.scheduledPortionAmount ?? item.amount), upfrontPaid);
  const paidPrincipal = payments.reduce((sum, item) => sum + (item.scheduledPrincipalAmount ?? item.creditPrincipalAmount ?? 0), upfrontPaid);
  const paidFinanceCost = payments.reduce((sum, item) => sum + (item.creditFinanceCostAmount || 0), 0);
  return {
    paid,
    paidPrincipal,
    paidFinanceCost,
    remaining: Math.max(0, instalment.amount - paid),
    principalRemaining: Math.max(0, instalment.principalAmount - paidPrincipal),
    financeCostRemaining: Math.max(0, instalment.financeCostAmount - paidFinanceCost),
  };
}

export function getCreditInstalmentStatus(state, agreement, instalment, asOfDate = new Date().toISOString().slice(0, 10), transactionIndex = createCreditTransactionIndex(state)) {
  if (instalment.supersededAt) return 'superseded';
  const amounts = getCreditInstalmentAmounts(state, agreement, instalment, transactionIndex);
  if (!amounts.remaining) return 'paid';
  if (instalment.dueDate < asOfDate) return amounts.paid ? 'partial_overdue' : 'overdue';
  if (amounts.paid) return 'partial';
  if (instalment.dueDate === asOfDate) return 'due';
  if (instalment.dueDate <= addDays(asOfDate, 7)) return 'due_soon';
  return 'upcoming';
}

export function getCreditAgreementStatus(state, agreement, transactionIndex = createCreditTransactionIndex(state)) {
  if (agreement.settledEarlyAt) return 'settled_early';
  if (agreement.status === 'cancelled') return 'cancelled';
  const balances = getCreditAgreementBalances(state, agreement, transactionIndex);
  return balances.totalRemaining === 0 ? 'paid_off' : 'active';
}

function scheduledRows(state, agreement, transactionIndex = createCreditTransactionIndex(state)) {
  return (agreement.schedule || []).filter(item => !item.supersededAt).map(instalment => ({ agreement, instalment, ...getCreditInstalmentAmounts(state, agreement, instalment, transactionIndex) }));
}

export function getCreditAgreementRepaymentSummary(state, agreement, transactionIndex = createCreditTransactionIndex(state)) {
  if (!agreement) return { totalRepayable: 0, actualPaid: 0, remainingBalance: 0, totalInstallments: 0, completedInstallments: 0, remainingInstallments: 0, futureSchedule: [], nextPayment: null, progressPercent: 0 };
  const balances = getCreditAgreementBalances(state, agreement, transactionIndex);
  const rows = scheduledRows(state, agreement, transactionIndex).sort((left, right) => left.instalment.dueDate.localeCompare(right.instalment.dueDate) || left.instalment.sequence - right.instalment.sequence);
  const completedInstallments = rows.filter(row => row.remaining === 0 && row.paid > 0).length;
  const futureSchedule = rows.filter(row => row.remaining > 0);
  const totalInstallments = Number.isInteger(agreement.term) ? agreement.term : rows.length;
  return {
    totalRepayable: agreement.totalRepayable || 0,
    actualPaid: balances.paidTotal,
    remainingBalance: balances.totalRemaining,
    totalInstallments,
    completedInstallments,
    remainingInstallments: futureSchedule.length,
    futureSchedule,
    nextPayment: futureSchedule[0] || null,
    progressPercent: agreement.totalRepayable ? Math.min(100, Number((balances.paidTotal * 100 / agreement.totalRepayable).toFixed(2))) : 0,
  };
}

export function getNextCreditPayment(state, asOfDate = new Date().toISOString().slice(0, 10), transactionIndex = createCreditTransactionIndex(state)) {
  return (state.creditAgreements || []).filter(item => !item.archivedAt && getCreditAgreementStatus(state, item, transactionIndex) === 'active')
    .flatMap(agreement => scheduledRows(state, agreement, transactionIndex).filter(row => row.remaining > 0).map(row => ({ ...row, status: getCreditInstalmentStatus(state, agreement, row.instalment, asOfDate, transactionIndex) })))
    .sort((left, right) => left.instalment.dueDate.localeCompare(right.instalment.dueDate) || left.instalment.sequence - right.instalment.sequence)[0] || null;
}

export function getOverdueCreditPayments(state, asOfDate = new Date().toISOString().slice(0, 10), transactionIndex = createCreditTransactionIndex(state)) {
  return (state.creditAgreements || []).filter(item => !item.archivedAt && getCreditAgreementStatus(state, item, transactionIndex) === 'active')
    .flatMap(agreement => scheduledRows(state, agreement, transactionIndex).filter(row => row.remaining > 0 && row.instalment.dueDate < asOfDate).map(row => ({ ...row, status: getCreditInstalmentStatus(state, agreement, row.instalment, asOfDate, transactionIndex) })))
    .sort((left, right) => left.instalment.dueDate.localeCompare(right.instalment.dueDate));
}

export function getCreditDueSoon(state, asOfDate = new Date().toISOString().slice(0, 10), transactionIndex = createCreditTransactionIndex(state)) {
  return (state.creditAgreements || []).filter(item => !item.archivedAt && getCreditAgreementStatus(state, item, transactionIndex) === 'active')
    .flatMap(agreement => scheduledRows(state, agreement, transactionIndex).filter(row => row.remaining > 0 && row.instalment.dueDate >= asOfDate && row.instalment.dueDate <= addDays(asOfDate, 7)).map(row => ({ ...row, status: getCreditInstalmentStatus(state, agreement, row.instalment, asOfDate, transactionIndex) })))
    .sort((left, right) => left.instalment.dueDate.localeCompare(right.instalment.dueDate));
}

export function getCreditAgreementMonthlyCommitment(state, agreement, asOfDate = new Date().toISOString().slice(0, 10), transactionIndex = createCreditTransactionIndex(state)) {
  if (!validDate(asOfDate)) throw new Error('Choose a valid date for the Credit summary.');
  if (!agreement || agreement.archivedAt || getCreditAgreementStatus(state, agreement, transactionIndex) !== 'active') return 0;
  const throughDate = addDays(asOfDate, 30);
  return scheduledRows(state, agreement, transactionIndex)
    .filter(row => row.remaining > 0 && row.instalment.dueDate >= asOfDate && row.instalment.dueDate <= throughDate)
    .reduce((sum, row) => sum + row.remaining, 0);
}

export function getMonthlyCreditCommitment(state, asOfDate = new Date().toISOString().slice(0, 10), transactionIndex = createCreditTransactionIndex(state)) {
  return (state.creditAgreements || []).reduce((sum, agreement) => sum + getCreditAgreementMonthlyCommitment(state, agreement, asOfDate, transactionIndex), 0);
}

export function planCreditReminderReconciliation(state, reminders, asOfDate = new Date().toISOString().slice(0, 10)) {
  if (!validDate(asOfDate)) throw new Error('Choose a valid date for Credit reminders.');
  const transactionIndex = createCreditTransactionIndex(state);
  const targets = new Map();
  for (const agreement of state.creditAgreements || []) {
    const preference = agreement.creditReminderPreferences;
    if (!preference?.enabled || agreement.archivedAt || getCreditAgreementStatus(state, agreement, transactionIndex) !== 'active') continue;
    const events = [
      ...(preference.daysBefore > 0 ? [{ event: 'before_due', days: preference.daysBefore }] : []),
      ...(preference.onDueDate ? [{ event: 'due_date', days: 0 }] : []),
    ];
    for (const { instalment, remaining } of scheduledRows(state, agreement, transactionIndex)) {
      if (remaining <= 0 || instalment.dueDate < asOfDate) continue;
      for (const event of events) {
        const eventDate = addDays(instalment.dueDate, -event.days);
        if (eventDate < asOfDate) continue;
        const key = `${agreement.id}:${instalment.id}:${event.event}`;
        const dueAt = new Date(`${eventDate}T09:00:00`).getTime();
        if (Number.isFinite(dueAt)) targets.set(key, {
          key, agreementId: agreement.id, instalmentId: instalment.id, event: event.event,
          dueAt, title: `Credit payment ${event.event === 'due_date' ? 'due' : 'coming up'}: ${agreement.title} (${instalment.dueDate})`,
        });
      }
    }
  }

  const active = (reminders || []).filter(item => ['waiting', 'ringing'].includes(item.status)
    && item.creditAgreementId && item.creditInstalmentId && ['before_due', 'due_date'].includes(item.creditReminderEvent));
  const keep = new Set(), cancelIds = [];
  for (const item of active) {
    const key = `${item.creditAgreementId}:${item.creditInstalmentId}:${item.creditReminderEvent}`;
    const target = targets.get(key);
    if (!target || target.dueAt !== item.dueAt || keep.has(key)) cancelIds.push(item.id);
    else keep.add(key);
  }
  const add = [...targets.entries()].filter(([key]) => !keep.has(key)).map(([, target]) => target);
  return { add, cancelIds };
}

export function getCreditOverview(state, asOfDate = new Date().toISOString().slice(0, 10), transactionIndex = createCreditTransactionIndex(state)) {
  const agreements = state.creditAgreements || [];
  const active = [];
  let settledPlans = 0, cancelledPlans = 0, archivedPlans = 0;
  for (const agreement of agreements) {
    const status = getCreditAgreementStatus(state, agreement, transactionIndex);
    if (status === 'active') active.push(agreement);
    if (status === 'paid_off' || status === 'settled_early') settledPlans += 1;
    if (status === 'cancelled') cancelledPlans += 1;
    if (agreement.archivedAt) archivedPlans += 1;
  }
  const visibleActive = active.filter(item => !item.archivedAt);
  const nextPayment = getNextCreditPayment(state, asOfDate, transactionIndex);
  const dueSoon = getCreditDueSoon(state, asOfDate, transactionIndex), overdue = getOverdueCreditPayments(state, asOfDate, transactionIndex);
  return {
    outstanding: active.reduce((sum, item) => sum + getCreditAgreementBalances(state, item, transactionIndex).totalRemaining, 0),
    principalOutstanding: active.reduce((sum, item) => sum + getCreditAgreementBalances(state, item, transactionIndex).principalRemaining, 0),
    financeCostRemaining: active.reduce((sum, item) => sum + getCreditAgreementBalances(state, item, transactionIndex).financeCostRemaining, 0),
    monthlyCommitment: getMonthlyCreditCommitment(state, asOfDate, transactionIndex),
    activePlans: visibleActive.length,
    completedPlans: settledPlans,
    settledPlans,
    cancelledPlans,
    archivedPlans,
    nextPayment,
    dueSoon,
    dueSoonAmount: dueSoon.reduce((sum, item) => sum + item.remaining, 0),
    overdue,
    overdueAmount: overdue.reduce((sum, item) => sum + item.remaining, 0),
  };
}

export function createCreditAgreement(state, agreement, { transactionId = '', dateCreated = new Date().toISOString().slice(0, 10) } = {}) {
  state.creditAgreements ||= [];
  if (state.creditAgreements.some(item => item.id === agreement.id)) throw new Error('This credit agreement already exists.');
  const cashPrice = agreement.cashPrice, deposit = agreement.deposit || 0, financedAmount = cashPrice - deposit;
  const financeMode = agreement.financeMode || (agreement.financeCharge ? 'fixed' : 'zero');
  const apr = financeMode === 'apr' ? Number(agreement.apr) : null;
  const financeCharge = financeMode === 'apr' ? 0 : agreement.financeCharge || 0;
  const upfrontCounts = agreement.upfrontCountsAsFirstInstalment === true;
  const scheduleMode = agreement.scheduleMode === 'custom' ? 'custom' : 'auto';
  if (!agreement.id || !String(agreement.title || '').trim() || !validDate(agreement.purchaseDate) || !cents(cashPrice) || cashPrice <= 0 || !cents(deposit) || deposit >= cashPrice || !cents(financeCharge) || !Number.isSafeInteger(financedAmount + financeCharge)) throw new Error('Enter a purchase price, a smaller upfront payment, and a valid finance charge.');
  if (upfrontCounts && deposit <= 0) throw new Error('Enter an actual upfront payment before counting it as the first instalment.');
  const futureTerm = agreement.term - (upfrontCounts ? 1 : 0);
  if (!Number.isInteger(agreement.term) || agreement.term < 1 || agreement.term > 600 || futureTerm < 1) throw new Error('Choose enough total payments to cover both the upfront payment and remaining balance.');
  if (!['zero', 'fixed', 'apr'].includes(financeMode)) throw new Error('Choose a supported finance type.');
  if (financeMode === 'apr' && (!Number.isFinite(apr) || apr < 0 || apr > 1000 || scheduleMode === 'custom')) throw new Error('Enter a valid APR and use an automatic repayment schedule.');
  const aprPlan = financeMode === 'apr' ? generateAprCreditSchedule({ agreementId: agreement.id, principalAmount: financedAmount, apr, term: futureTerm, frequency: agreement.frequency, customDays: agreement.customDays, firstPaymentDate: agreement.firstPaymentDate }) : null;
  const futureRows = aprPlan ? aprPlan.schedule : scheduleMode === 'custom'
    ? generateCustomCreditSchedule({ agreementId: agreement.id, principalAmount: financedAmount, financeCharge, rows: agreement.customSchedule || [] })
    : generateCreditSchedule({ agreementId: agreement.id, principalAmount: financedAmount, financeCharge, term: futureTerm, frequency: agreement.frequency, customDays: agreement.customDays, firstPaymentDate: agreement.firstPaymentDate });
  if (futureRows.length !== futureTerm) throw new Error('Custom schedule row count must match the total payment count.');
  const schedule = upfrontCounts ? [{ id: `${agreement.id}:upfront`, sequence: 1, dueDate: agreement.depositDate || agreement.purchaseDate, openingBalance: agreement.cashPrice, amount: deposit, principalAmount: deposit, financeCostAmount: 0, closingBalance: agreement.cashPrice - deposit, upfrontPayment: true, upfrontTransactionId: transactionId }, ...futureRows.map((row, index) => ({ ...row, sequence: index + 2 }))] : futureRows;
  const totalRepayable = (upfrontCounts ? cashPrice : financedAmount) + (aprPlan?.financeCharge ?? financeCharge);
  const result = { ...agreement, title: String(agreement.title).trim(), merchant: String(agreement.merchant || '').trim(), reference: String(agreement.reference || '').trim(), productUrl: cleanProductUrl(agreement.productUrl), notes: String(agreement.notes || '').trim(), cashPrice, deposit, financedAmount, financeCharge: aprPlan?.financeCharge ?? financeCharge, financeMode, ...(financeMode === 'apr' ? { apr } : { apr: null }), upfrontCountsAsFirstInstalment: upfrontCounts, scheduleMode, customSchedule: scheduleMode === 'custom' ? futureRows.map(({ id, dueDate, amount }) => ({ id, dueDate, amount })) : [], totalRepayable, schedule, term: schedule.length, createdAt: agreement.createdAt || new Date().toISOString(), status: 'active' };
  if (deposit > 0) {
    if (!transactionId || !validDate(agreement.depositDate || dateCreated)) throw new Error('A deposit must be recorded as a dated Finance transaction.');
    if ((state.transactions || []).some(item => item.id === transactionId)) throw new Error('This Finance transaction identifier is already in use.');
    state.transactions.push({ id: transactionId, title: `Deposit for ${result.title}`, type: 'expense', amount: deposit, categoryId: agreement.categoryId || '', date: agreement.depositDate || dateCreated, paidFromFundId: agreement.depositPaidFromFundId || '', note: 'Credit purchase deposit', creditAgreementId: agreement.id, creditPaymentKind: 'deposit', vehicleMetadata: agreement.vehicleMetadata || {}, customFields: agreement.customFields || [] });
  }
  state.creditAgreements.push(result);
  return result;
}

function applyExtraPrincipalToSchedule(state, agreement, amount, date, transactionId, excludedInstalmentId = '') {
  const futurePrincipalRows = (agreement.schedule || []).filter(item => !item.supersededAt && item.id !== excludedInstalmentId
    && item.dueDate > date && getCreditInstalmentAmounts(state, agreement, item).paid === 0)
    .sort((left, right) => right.dueDate.localeCompare(left.dueDate) || right.sequence - left.sequence);
  const eligiblePrincipal = futurePrincipalRows.reduce((sum, item) => sum + item.principalAmount, 0);
  if (amount > eligiblePrincipal) throw new Error('This extra payment is larger than the principal in future instalments. Use Settle early for a payoff quote.');
  let principalToReschedule = amount;
  for (const instalment of futurePrincipalRows) {
    const reduction = Math.min(principalToReschedule, instalment.principalAmount);
    instalment.principalAmount -= reduction;
    instalment.amount -= reduction;
    principalToReschedule -= reduction;
    instalment.extraPaymentIds ||= [];
    instalment.extraPaymentIds.push(transactionId);
    if (!instalment.amount) instalment.supersededAt = date;
    if (!principalToReschedule) break;
  }
}

export function recordCreditPayment(state, { agreementId, amount, date, paidFromFundId = '', accountId = '', note = '', instalmentId = '', paymentId, transactionId }) {
  state.creditAgreements ||= [];
  if (!paymentId || !transactionId || !Number.isSafeInteger(amount) || amount <= 0 || !validDate(date)) throw new Error('Enter a valid payment amount and date.'); if (accountId && !(state.accounts || []).some(item => item.id === accountId && !item.archivedAt)) throw new Error('Choose an active Finance account.'); if (accountId && paidFromFundId) throw new Error('Choose one payment source.');
  const existing = (state.transactions || []).find(item => item.type === 'creditPayment' && item.creditPaymentId === paymentId);
  if (existing) {
    if (existing.creditAgreementId !== agreementId) throw new Error('This payment identifier is already linked to another agreement.');
    return existing;
  }
  if ((state.transactions || []).some(item => item.id === transactionId)) throw new Error('This Finance transaction identifier is already in use.');
  const agreement = state.creditAgreements.find(item => item.id === agreementId);
  if (!agreement || getCreditAgreementStatus(state, agreement) !== 'active') throw new Error('This credit agreement is no longer active.');
  const balances = getCreditAgreementBalances(state, agreement);
  let principalAmount = 0, financeCostAmount = 0, scheduledInstalmentId = '', scheduledPortionAmount = 0, scheduledPrincipalAmount = 0, extraPrincipalAmount = 0;
  if (instalmentId) {
    const instalment = (agreement.schedule || []).find(item => item.id === instalmentId && !item.supersededAt);
    if (!instalment) throw new Error('Choose an active scheduled instalment.');
    const due = getCreditInstalmentAmounts(state, agreement, instalment);
    scheduledPortionAmount = Math.min(amount, due.remaining);
    financeCostAmount = scheduledPortionAmount === due.remaining ? due.financeCostRemaining : Math.min(due.financeCostRemaining, Math.floor(scheduledPortionAmount * due.financeCostRemaining / due.remaining));
    scheduledPrincipalAmount = scheduledPortionAmount - financeCostAmount;
    extraPrincipalAmount = amount - scheduledPortionAmount;
    if (scheduledPrincipalAmount > balances.principalRemaining || financeCostAmount > balances.financeCostRemaining) throw new Error('This payment exceeds the remaining agreement balance.');
    if (extraPrincipalAmount > balances.principalRemaining - scheduledPrincipalAmount) throw new Error('This payment exceeds the remaining principal. Use Settle early for the remaining balance.');
    if (extraPrincipalAmount > 0) applyExtraPrincipalToSchedule(state, agreement, extraPrincipalAmount, date, transactionId, instalment.id);
    principalAmount = scheduledPrincipalAmount + extraPrincipalAmount;
    scheduledInstalmentId = instalment.id;
  } else {
    if (amount > balances.principalRemaining) throw new Error('An extra payment can only reduce the remaining principal. Use Settle early to clear the agreement.');
    applyExtraPrincipalToSchedule(state, agreement, amount, date, transactionId);
    principalAmount = amount;
    extraPrincipalAmount = amount;
  }
  const paymentKind = !scheduledInstalmentId ? 'extra' : extraPrincipalAmount ? 'scheduled_extra' : scheduledPortionAmount < getCreditInstalmentAmounts(state, agreement, (agreement.schedule || []).find(item => item.id === instalmentId)).remaining ? 'partial' : 'scheduled';
  const transaction = { id: transactionId, sequence: Math.max(0, ...(state.transactions || []).map((item, index) => item.sequence ?? index + 1)) + 1, title: `${agreement.title} credit payment`, type: 'creditPayment', creditAgreementTitle: agreement.title, creditAgreementMerchant: agreement.merchant || '', amount, date, paidFromFundId, ...(accountId ? { accountId } : {}), note: String(note || '').trim(), creditAgreementId: agreement.id, creditPaymentId: paymentId, creditPaymentKind: paymentKind, scheduledInstalmentId, ...(scheduledInstalmentId ? { scheduledPortionAmount, scheduledPrincipalAmount } : {}), ...(extraPrincipalAmount ? { extraPrincipalAmount } : {}), creditPrincipalAmount: principalAmount, creditFinanceCostAmount: financeCostAmount };
  state.transactions.push(transaction);
  return transaction;
}

export function recordImportedCreditPayment(state, { agreementId, amount, date, accountId, instalmentId = '', record, paymentId, transactionId }) {
  if (!record || record.direction !== 'expense' || !record.description) throw new Error('Choose a valid imported bank payment.');
  const transaction = recordCreditPayment(state, { agreementId, amount, date, accountId, note: record.description, instalmentId, paymentId, transactionId });
  Object.assign(transaction, { sourceType: 'file_import', importSource: record.sourceType || 'statement', importDirection: 'expense', sourceRow: record.sourceRow, reference: record.reference || '' });
  return transaction;
}
export function settleCreditAgreement(state, { agreementId, settlementAmount, settlementFee = 0, date, paidFromFundId = '', accountId = '', note = '', paymentId, transactionId }) {
  const existing = (state.transactions || []).find(item => item.type === 'creditPayment' && item.creditPaymentId === paymentId);
  if (existing && paymentId) {
    if (existing.creditAgreementId !== agreementId) throw new Error('This payment identifier is already linked to another agreement.');
    return existing;
  }
  const agreement = (state.creditAgreements || []).find(item => item.id === agreementId);
  if (!agreement || getCreditAgreementStatus(state, agreement) !== 'active') throw new Error('This credit agreement is no longer active.');
  const balances = getCreditAgreementBalances(state, agreement);
  if (!Number.isSafeInteger(settlementAmount) || settlementAmount <= 0 || !Number.isSafeInteger(settlementFee) || settlementFee < 0 || !validDate(date) || !paymentId || !transactionId) throw new Error('Enter a valid settlement amount, fee, and date.');
  if (!Number.isSafeInteger(settlementAmount + settlementFee)) throw new Error('The settlement amount is outside the supported range.'); if (accountId && !(state.accounts || []).some(item => item.id === accountId && !item.archivedAt)) throw new Error('Choose an active Finance account.'); if (accountId && paidFromFundId) throw new Error('Choose one payment source.');
  if ((state.transactions || []).some(item => item.id === transactionId)) throw new Error('This Finance transaction identifier is already in use.');
  const principalAmount = Math.min(balances.principalRemaining, Math.max(0, settlementAmount - balances.financeCostRemaining));
  const financeCostAmount = settlementAmount + settlementFee - principalAmount;
  const amount = settlementAmount + settlementFee;
  const transaction = { id: transactionId, sequence: Math.max(0, ...(state.transactions || []).map((item, index) => item.sequence ?? index + 1)) + 1, title: `${agreement.title} early settlement`, type: 'creditPayment', creditAgreementTitle: agreement.title, creditAgreementMerchant: agreement.merchant || '', amount, date, paidFromFundId, ...(accountId ? { accountId } : {}), note: String(note || '').trim(), creditAgreementId: agreement.id, creditPaymentId: paymentId, creditPaymentKind: 'settlement', creditPrincipalAmount: principalAmount, creditFinanceCostAmount: financeCostAmount };
  state.transactions.push(transaction);
  agreement.settledEarlyAt = date;
  agreement.settlement = { date, settlementAmount, settlementFee, financeTransactionId: transactionId, note: String(note || '').trim() };
  transaction.supersededInstalmentIds = [];
  for (const instalment of agreement.schedule || []) {
    const amounts = getCreditInstalmentAmounts(state, agreement, instalment);
    if (amounts.remaining > 0) { instalment.supersededAt = date; transaction.supersededInstalmentIds.push(instalment.id); }
  }
  return transaction;
}

export function reverseCreditPayment(state, transactionId, date = new Date().toISOString().slice(0, 10)) {
  const transaction = (state.transactions || []).find(item => item.id === transactionId && item.type === 'creditPayment');
  if (!transaction) throw new Error('The linked credit payment could not be found.');
  if (transaction.source === 'bank' || transaction.sourceType === 'bank_import' || transaction.providerStatus === 'BOOK') throw new Error('Bank-booked payments cannot be reversed here. Correct or unlink the bank record while keeping its provenance.');
  if (transaction.reversedAt) throw new Error('This payment has already been reversed.');
  if (!validDate(date)) throw new Error('Choose a valid reversal date.');
  const agreement = (state.creditAgreements || []).find(item => item.id === transaction.creditAgreementId);
  if (!agreement) throw new Error('The linked agreement could not be found.');
  if (transaction.creditPaymentKind === 'settlement' && agreement.settlement?.financeTransactionId !== transaction.id) throw new Error('The settlement linkage is inconsistent; it was not changed.');
  transaction.reversedAt = new Date().toISOString();
  transaction.reversalDate = date;
  transaction.reversalReason = 'credit_payment_marked_unpaid';
  transaction.reversalAmount = transaction.amount;
  transaction.reversalPaymentId = transaction.creditPaymentId;
  if (transaction.creditPaymentKind === 'settlement') {
    for (const id of transaction.supersededInstalmentIds || []) {
      const instalment = (agreement.schedule || []).find(item => item.id === id);
      if (instalment?.supersededAt === transaction.date) delete instalment.supersededAt;
    }
    delete agreement.settledEarlyAt;
    delete agreement.settlement;
  } else if (['extra', 'scheduled_extra'].includes(transaction.creditPaymentKind)) {
    const preserved = (agreement.schedule || []).filter(item => !item.supersededAt && (item.dueDate <= date || getCreditInstalmentAmounts(state, agreement, item).paid > 0));
    const preservedDue = preserved.map(item => ({ ...getCreditInstalmentAmounts(state, agreement, item) }));
    const preservedPrincipal = preservedDue.reduce((sum, item) => sum + item.principalRemaining, 0);
    const preservedCost = preservedDue.reduce((sum, item) => sum + item.financeCostRemaining, 0);
    const balances = getCreditAgreementBalances(state, agreement);
    const futurePrincipal = balances.principalRemaining - preservedPrincipal;
    const futureCost = balances.financeCostRemaining - preservedCost;
    if (futurePrincipal < 0 || futureCost < 0) {
      delete transaction.reversedAt;
      delete transaction.reversalDate;
      delete transaction.reversalReason;
      delete transaction.reversalAmount;
      delete transaction.reversalPaymentId;
      throw new Error('The saved payment history does not reconcile; this payment was not reversed.');
    }
    const futureRows = (agreement.schedule || []).filter(item => !preserved.includes(item) && !item.supersededAt && getCreditInstalmentAmounts(state, agreement, item).remaining > 0);
    const nextDate = futureRows.sort((left, right) => left.dueDate.localeCompare(right.dueDate))[0]?.dueDate || (agreement.frequency === 'monthly' ? addMonths(date, 1) : addDays(date, agreement.frequency === 'weekly' ? 7 : agreement.frequency === 'fortnightly' ? 14 : agreement.customDays || 30));
    const futureTerm = Math.max(1, futureRows.length);
    for (const item of agreement.schedule || []) if (!preserved.includes(item) && !item.supersededAt) item.supersededAt = date;
    const regenerated = futurePrincipal || futureCost ? generateCreditSchedule({ agreementId: agreement.id, principalAmount: futurePrincipal, financeCharge: futureCost, term: futureTerm, frequency: agreement.frequency, customDays: agreement.customDays, firstPaymentDate: nextDate }).map((item, index) => ({ ...item, id: `${agreement.id}:reversal:${transaction.id}:${index + 1}`, sequence: preserved.length + index + 1 })) : [];
    agreement.schedule = [...preserved, ...regenerated];
    agreement.term = agreement.schedule.filter(item => !item.supersededAt).length;
  }
  agreement.history ||= [];
  agreement.history.push({ type: 'payment_reversed', paymentId: transaction.creditPaymentId, transactionId: transaction.id, amount: transaction.amount, date, createdAt: transaction.reversedAt });
  return transaction;
}

export function updateCreditPayment(state, transactionId, changes) {
  const transaction = (state.transactions || []).find(item => item.id === transactionId && item.type === 'creditPayment');
  if (!transaction || transaction.reversedAt) throw new Error('Only an active credit payment can be corrected.');
  if (transaction.source === 'bank' || transaction.sourceType === 'bank_import' || transaction.providerStatus === 'BOOK') throw new Error('Bank-booked payments cannot be edited here. Correct or unlink the bank record while keeping its provenance.');
  const agreement = (state.creditAgreements || []).find(item => item.id === transaction.creditAgreementId);
  if (!agreement) throw new Error('The linked agreement could not be found.');
  const amount = changes.amount ?? transaction.amount;
  const date = changes.date ?? transaction.date;
  if (!Number.isSafeInteger(amount) || amount <= 0 || !validDate(date)) throw new Error('Enter a valid payment amount and date.');
  if (amount !== transaction.amount && ['extra', 'scheduled_extra', 'settlement'].includes(transaction.creditPaymentKind)) throw new Error('To change an extra payment or settlement amount, mark it unpaid and record the corrected payment.');
  if (transaction.scheduledInstalmentId && amount !== transaction.amount) {
    const instalment = (agreement.schedule || []).find(item => item.id === transaction.scheduledInstalmentId && !item.supersededAt);
    if (!instalment) throw new Error('This payment is linked to a superseded instalment; reverse and re-record it instead.');
    const others = activeTransactions(state).filter(item => item.id !== transaction.id && item.creditAgreementId === agreement.id && item.scheduledInstalmentId === instalment.id);
    const due = instalment.amount - others.reduce((sum, item) => sum + (item.scheduledPortionAmount ?? item.amount), 0);
    const scheduledAmount = Math.min(amount, due);
    const feeAvailable = Math.max(0, instalment.financeCostAmount - others.reduce((sum, item) => sum + (item.creditFinanceCostAmount || 0), 0));
    const principalAvailable = Math.max(0, instalment.principalAmount - others.reduce((sum, item) => sum + (item.scheduledPrincipalAmount ?? item.creditPrincipalAmount ?? 0), 0));
    const fee = scheduledAmount === due ? feeAvailable : due > 0 ? Math.min(feeAvailable, Math.floor(scheduledAmount * feeAvailable / due)) : 0;
    const scheduledPrincipal = scheduledAmount - fee;
    const extraPrincipal = amount - scheduledAmount;
    if (scheduledPrincipal > principalAvailable) throw new Error('The corrected amount does not reconcile with this instalment’s principal and finance cost.');
    if (extraPrincipal > 0) {
      const balances = getCreditAgreementBalances(state, agreement);
      if (extraPrincipal > balances.principalRemaining - scheduledPrincipal) throw new Error('The corrected amount exceeds the remaining principal.');
      applyExtraPrincipalToSchedule(state, agreement, extraPrincipal, date, transaction.id, instalment.id);
    }
    const principal = scheduledPrincipal + extraPrincipal;
    transaction.creditPrincipalAmount = principal;
    transaction.creditFinanceCostAmount = fee;
    transaction.scheduledPortionAmount = scheduledAmount;
    transaction.scheduledPrincipalAmount = scheduledPrincipal;
    if (extraPrincipal) { transaction.extraPrincipalAmount = extraPrincipal; transaction.creditPaymentKind = 'scheduled_extra'; }
    else { delete transaction.extraPrincipalAmount; transaction.creditPaymentKind = scheduledAmount < due ? 'partial' : 'scheduled'; }
  }
  const before = { amount: transaction.amount, date: transaction.date, paidFromFundId: transaction.paidFromFundId || '', accountId: transaction.accountId || '', note: transaction.note || '' };
  transaction.amount = amount;
  transaction.date = date;
  transaction.paidFromFundId = String(changes.paidFromFundId ?? transaction.paidFromFundId ?? ''); if (Object.hasOwn(changes, 'accountId')) { if (changes.accountId) transaction.accountId = String(changes.accountId); else delete transaction.accountId; }
  transaction.note = String(changes.note ?? transaction.note ?? '').trim();
  transaction.corrections ||= [];
  transaction.corrections.push({ ...before, updatedAt: new Date().toISOString() });
  agreement.history ||= [];
  agreement.history.push({ type: 'payment_corrected', paymentId: transaction.creditPaymentId, transactionId: transaction.id, before, after: { amount, date, paidFromFundId: transaction.paidFromFundId, accountId: transaction.accountId || '', note: transaction.note }, createdAt: new Date().toISOString() });
  return transaction;
}

export function cancelCreditAgreement(state, agreementId, date = new Date().toISOString().slice(0, 10)) {
  const agreement = (state.creditAgreements || []).find(item => item.id === agreementId);
  if (!agreement || getCreditAgreementStatus(state, agreement) !== 'active') throw new Error('Only an active credit agreement can be cancelled.');
  if (activeTransactions(state).some(item => item.creditAgreementId === agreementId)) throw new Error('An agreement with recorded payments cannot be cancelled. Keep it active or settle it with the lender.');
  if (!validDate(date)) throw new Error('Enter a valid cancellation date.');
  agreement.status = 'cancelled';
  agreement.cancelledAt = date;
  for (const instalment of agreement.schedule || []) if (!instalment.supersededAt) instalment.supersededAt = date;
  agreement.history ||= [];
  agreement.history.push({ type: 'agreement_cancelled', date, createdAt: new Date().toISOString() });
  return agreement;
}


function providerRefundablePrincipalNow(state, agreement, date) {
  const balances = getCreditAgreementBalances(state, agreement);
  const overduePrincipal = (agreement.schedule || []).filter(item => !item.supersededAt && item.dueDate <= date).reduce((sum, item) => sum + getCreditInstalmentAmounts(state, agreement, item).principalRemaining, 0);
  return Math.max(0, balances.principalRemaining - overduePrincipal);
}

export function remainingCreditPurchaseRefund(state, agreement) {
  if (!agreement) return 0;
  const committed = (state.transactions || []).filter(item => item.type === 'creditPurchaseRefund' && item.creditAgreementId === agreement.id && !item.reversedAt && ['received', 'pending'].includes(item.refundStatus || 'received')).reduce((sum, item) => sum + (Number.isSafeInteger(item.amount) && item.amount > 0 ? item.amount : 0), 0);
  return Math.max(0, (agreement.cashPrice || 0) - committed);
}

export function createCreditPurchaseRefundState(state, { agreementId, amount, destination, date = new Date().toISOString().slice(0, 10), status = 'received', note = '', transactionId = id() }) {
  const agreement = (state.creditAgreements || []).find(item => item.id === agreementId && !item.archivedAt);
  if (!agreement || !['active', 'paid_off', 'settled_early'].includes(getCreditAgreementStatus(state, agreement))) throw new Error('Choose a Credit Purchase agreement that can accept a refund.');
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > remainingCreditPurchaseRefund(state, agreement)) throw new Error('Refund amount exceeds the remaining refundable purchase amount.');
  if (!['provider', 'user'].includes(destination)) throw new Error('Choose whether the refund went to the finance provider or directly to you.');
  if (!['received', 'pending'].includes(status) || !validDate(date)) throw new Error('Choose a valid refund status and date.');
  if (destination === 'provider' && amount > getCreditAgreementBalances(state, agreement).principalRemaining) throw new Error('The provider refund cannot exceed the outstanding financed principal.');
  if (destination === 'provider' && status === 'received' && amount > providerRefundablePrincipalNow(state, agreement, date)) throw new Error('This amount would change an overdue instalment. Apply a smaller provider refund or update the lender?s revised schedule first.');
  if ((state.transactions || []).some(item => item.id === transactionId)) throw new Error('This refund identifier is already in use.');
  const refund = { id: transactionId, sequence: Math.max(0, ...(state.transactions || []).map((item, index) => item.sequence ?? index + 1)) + 1, title: 'Refund for ' + agreement.title, type: 'creditPurchaseRefund', amount, date, categoryId: agreement.categoryId || '', creditAgreementId: agreement.id, refundDestination: destination, refundStatus: status, note: String(note || '').trim(), createdAt: new Date().toISOString() };
  state.transactions.push(refund);
  if (destination === 'provider' && status === 'received') {
    let customSchedule;
    if (agreement.scheduleMode === 'custom') {
      const hasPayments = activeTransactions(state).some(item => item.creditAgreementId === agreementId);
      const preserved = (agreement.schedule || []).filter(item => !item.supersededAt && (!item.upfrontPayment || agreement.upfrontCountsAsFirstInstalment) && (getCreditInstalmentAmounts(state, agreement, item).paid > 0 || item.dueDate <= date));
      const preservedAmount = preserved.reduce((sum, item) => { const amounts = getCreditInstalmentAmounts(state, agreement, item); return sum + amounts.remaining; }, 0);
      const target = Math.max(0, getCreditAgreementBalances(state, agreement).totalRemaining - preservedAmount);
      const future = (agreement.schedule || []).filter(item => !item.supersededAt && !item.upfrontPayment && item.dueDate > date && getCreditInstalmentAmounts(state, agreement, item).paid === 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      if (target > 0 && !future.length) throw new Error('There are no future custom payment dates available for the provider refund adjustment.');
      const weights = future.map(item => getCreditInstalmentAmounts(state, agreement, item).remaining);
      const weightTotal = weights.reduce((sum, value) => sum + value, 0);
      let allocated = 0;
      customSchedule = future.map((item, index) => { const amount = index === future.length - 1 ? target - allocated : weightTotal ? Math.floor(target * weights[index] / weightTotal) : 0; allocated += amount; return { id: item.id, dueDate: item.dueDate, amount }; });
    }
    try { updateCreditAgreement(state, agreement.id, { recalculateFutureSchedule: true, preservePastUnpaidSchedule: true, ...(customSchedule ? { customSchedule } : {}) }, date); }
    catch (error) { state.transactions = state.transactions.filter(item => item.id !== refund.id); throw error; }
  }
  return refund;
}

export function receiveCreditPurchaseRefundState(state, transactionId, date = new Date().toISOString().slice(0, 10)) {
  const refund = (state.transactions || []).find(item => item.id === transactionId && item.type === 'creditPurchaseRefund' && !item.reversedAt && (item.refundStatus || 'received') === 'pending');
  const agreement = (state.creditAgreements || []).find(item => item.id === refund?.creditAgreementId);
  if (!refund || !agreement || !validDate(date)) throw new Error('This pending Credit Purchase refund cannot be received.');
  if (refund.refundDestination === 'provider') {
    if (refund.amount > getCreditAgreementBalances(state, agreement).principalRemaining) throw new Error('The provider refund exceeds the outstanding financed principal.');
    if (refund.amount > providerRefundablePrincipalNow(state, agreement, date)) throw new Error('This amount would change an overdue instalment. Apply a smaller provider refund or update the lender?s revised schedule first.');
  }
  const previous = { refundStatus: refund.refundStatus, date: refund.date, pendingDate: refund.pendingDate, receivedDate: refund.receivedDate };
  refund.refundStatus = 'received'; refund.pendingDate = refund.date; refund.date = date; refund.receivedDate = date;
  if (refund.refundDestination === 'provider') {
    try { updateCreditAgreement(state, agreement.id, { recalculateFutureSchedule: true, preservePastUnpaidSchedule: true }, date); }
    catch (error) { Object.assign(refund, previous); throw error; }
  }
  return refund;
}

export function reverseCreditPurchaseRefundState(state, transactionId, date = new Date().toISOString().slice(0, 10)) {
  const refund = (state.transactions || []).find(item => item.id === transactionId && item.type === 'creditPurchaseRefund' && !item.reversedAt);
  const agreement = (state.creditAgreements || []).find(item => item.id === refund?.creditAgreementId);
  if (!refund || !agreement || !validDate(date)) throw new Error('This Credit Purchase refund cannot be reversed.');
  refund.reversedAt = date; refund.refundReversalReason = 'credit_purchase_refund_reversed';
  if (refund.refundDestination === 'provider') {
    try { updateCreditAgreement(state, agreement.id, { recalculateFutureSchedule: true, preservePastUnpaidSchedule: true }, date); }
    catch (error) { delete refund.reversedAt; delete refund.refundReversalReason; throw error; }
  }
  return refund;
}

export function updateCreditAgreement(state, agreementId, changes, asOfDate = new Date().toISOString().slice(0, 10)) {
  const agreement = (state.creditAgreements || []).find(item => item.id === agreementId);
  if (!agreement || getCreditAgreementStatus(state, agreement) !== 'active') throw new Error('Only an active credit agreement can be updated.');
  if (Object.hasOwn(changes, 'vehicleMetadata')) agreement.vehicleMetadata = changes.vehicleMetadata;
  if (Object.hasOwn(changes, 'customFields')) agreement.customFields = changes.customFields;
  for (const transaction of (state.transactions || []).filter(item => item.creditAgreementId === agreementId && item.creditPaymentKind === 'deposit' && !item.reversedAt)) {
    if (Object.hasOwn(changes, 'vehicleMetadata')) transaction.vehicleMetadata = changes.vehicleMetadata;
    if (Object.hasOwn(changes, 'customFields')) transaction.customFields = changes.customFields;
  }
  const hasPayments = activeTransactions(state).some(item => item.creditAgreementId === agreementId);
  const hasPaymentHistory = (state.transactions || []).some(item => item.type === 'creditPayment' && item.creditAgreementId === agreementId);
  const nextCashPrice = changes.cashPrice ?? agreement.cashPrice;
  const nextDeposit = changes.deposit ?? agreement.deposit;
  const purchaseTermsChanged = nextCashPrice !== agreement.cashPrice || nextDeposit !== agreement.deposit;
  const depositDetailsChanged = (changes.depositDate ?? agreement.depositDate ?? agreement.purchaseDate) !== (agreement.depositDate ?? agreement.purchaseDate) || (changes.depositPaidFromFundId ?? agreement.depositPaidFromFundId ?? '') !== (agreement.depositPaidFromFundId || '') || (changes.categoryId ?? agreement.categoryId ?? '') !== (agreement.categoryId || '');
  if (!cents(nextCashPrice) || nextCashPrice <= 0 || !cents(nextDeposit) || nextDeposit >= nextCashPrice) throw new Error('Enter a purchase price and a smaller valid deposit.');
  if (purchaseTermsChanged && hasPaymentHistory) throw new Error('Purchase price and deposit cannot be changed after payment history exists. Correct the linked deposit transaction and future agreement terms separately.');
  const nextPurchaseDate = changes.purchaseDate ?? agreement.purchaseDate;
  const nextDepositDate = changes.depositDate ?? agreement.depositDate ?? nextPurchaseDate;
  if (!validDate(nextPurchaseDate) || !validDate(nextDepositDate)) throw new Error('Choose valid purchase and deposit dates.');
  const nextDepositFundId = String(changes.depositPaidFromFundId ?? agreement.depositPaidFromFundId ?? '');
  const nextCategoryId = String(changes.categoryId ?? agreement.categoryId ?? '');
  const nextUpfrontCounts = changes.upfrontCountsAsFirstInstalment ?? agreement.upfrontCountsAsFirstInstalment ?? false;
  const nextScheduleMode = changes.scheduleMode === 'custom' || changes.scheduleMode === 'auto' ? changes.scheduleMode : agreement.scheduleMode || 'auto';
  const nextReminderPreferences = changes.creditReminderPreferences ?? agreement.creditReminderPreferences ?? { enabled: false, daysBefore: 1, onDueDate: true };
  if (!nextReminderPreferences || typeof nextReminderPreferences.enabled !== 'boolean' || !Number.isInteger(nextReminderPreferences.daysBefore) || nextReminderPreferences.daysBefore < 0 || nextReminderPreferences.daysBefore > 30 || typeof nextReminderPreferences.onDueDate !== 'boolean') throw new Error('Choose valid Credit reminder preferences.');
  const existingDeposit = (state.transactions || []).find(item => item.creditAgreementId === agreementId && item.creditPaymentKind === 'deposit' && !item.reversedAt);
  if ((purchaseTermsChanged || depositDetailsChanged) && existingDeposit && (existingDeposit.source === 'bank' || existingDeposit.sourceType === 'bank_import')) throw new Error('Bank-imported deposits cannot be edited here. Correct or unlink the bank record while keeping its provenance.');
  if (purchaseTermsChanged && nextDeposit > 0 && !existingDeposit && !changes.depositTransactionId) throw new Error('A transaction ID is required to add the corrected deposit to Finance.');
  const previousTerms = { cashPrice: agreement.cashPrice, deposit: agreement.deposit, financedAmount: agreement.financedAmount, depositDate: agreement.depositDate || agreement.purchaseDate, depositPaidFromFundId: agreement.depositPaidFromFundId || '', categoryId: agreement.categoryId || '', financeCharge: agreement.financeCharge, term: agreement.term, frequency: agreement.frequency, customDays: agreement.customDays, firstPaymentDate: agreement.firstPaymentDate };
  if (purchaseTermsChanged || depositDetailsChanged) {
    if (existingDeposit && nextDeposit > 0) {
      existingDeposit.corrections ||= [];
      existingDeposit.corrections.push({ amount: existingDeposit.amount, date: existingDeposit.date, paidFromFundId: existingDeposit.paidFromFundId || '', categoryId: existingDeposit.categoryId || '', updatedAt: new Date().toISOString() });
      existingDeposit.amount = nextDeposit;
      existingDeposit.date = nextDepositDate;
      existingDeposit.paidFromFundId = nextDepositFundId;
      existingDeposit.categoryId = nextCategoryId;
      existingDeposit.title = `Deposit for ${String(changes.title ?? agreement.title).trim()}`;
    } else if (purchaseTermsChanged && existingDeposit && nextDeposit === 0) {
      existingDeposit.reversedAt = new Date().toISOString();
      existingDeposit.reversalDate = asOfDate;
      existingDeposit.reversalReason = 'credit_deposit_corrected';
      existingDeposit.reversalAmount = existingDeposit.amount;
    } else if (purchaseTermsChanged && nextDeposit > 0) {
      const sequence = Math.max(0, ...(state.transactions || []).map((item, index) => item.sequence ?? index + 1)) + 1;
      state.transactions.push({ id: changes.depositTransactionId, sequence, title: `Deposit for ${String(changes.title ?? agreement.title).trim()}`, type: 'expense', amount: nextDeposit, categoryId: nextCategoryId, date: nextDepositDate, paidFromFundId: nextDepositFundId, note: 'Credit purchase deposit', creditAgreementId: agreement.id, creditPaymentKind: 'deposit' });
    }
    if (purchaseTermsChanged) {
      agreement.cashPrice = nextCashPrice;
      agreement.deposit = nextDeposit;
      agreement.financedAmount = nextCashPrice - nextDeposit;
    }
    agreement.depositDate = nextDepositDate;
    agreement.depositPaidFromFundId = nextDepositFundId;
    agreement.categoryId = nextCategoryId;
    agreement.history ||= [];
    agreement.history.push({ type: 'deposit_corrected', transactionId: existingDeposit?.id || changes.depositTransactionId || '', before: { cashPrice: previousTerms.cashPrice, deposit: previousTerms.deposit, depositDate: previousTerms.depositDate, paidFromFundId: previousTerms.depositPaidFromFundId, categoryId: previousTerms.categoryId }, after: { cashPrice: nextCashPrice, deposit: nextDeposit, depositDate: nextDepositDate, paidFromFundId: nextDepositFundId, categoryId: nextCategoryId }, date: asOfDate, createdAt: new Date().toISOString() });
  }
  agreement.purchaseDate = nextPurchaseDate;
  const frequency = changes.frequency || agreement.frequency;
  const customDays = changes.customDays ?? agreement.customDays;
  const activeFuture = (agreement.schedule || []).filter(item => !item.supersededAt && item.dueDate > asOfDate && getCreditInstalmentAmounts(state, agreement, item).remaining > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const firstPaymentDate = changes.firstPaymentDate || activeFuture[0]?.dueDate || agreement.firstPaymentDate;
  const totalTerm = changes.term ?? (agreement.schedule || []).filter(item => !item.supersededAt).length;
  const priorBalances = getCreditAgreementBalances(state, agreement);
  const nextFinanceMode = changes.financeMode || agreement.financeMode || (agreement.financeCharge ? 'fixed' : 'zero');
  const nextApr = nextFinanceMode === 'apr' ? Number(changes.apr ?? agreement.apr) : null;
  const nextFinanceCharge = nextFinanceMode === 'apr' ? agreement.financeCharge || 0 : changes.financeCharge ?? agreement.financeCharge;
  const nextProductUrl = cleanProductUrl(changes.productUrl ?? agreement.productUrl);
  const nextTitle = String(changes.title ?? agreement.title).trim();
  if (!nextTitle) throw new Error('Enter a name for this purchase.');
  const currentScheduleCount = (agreement.schedule || []).filter(item => !item.supersededAt).length;
  const currentEditableCustomRows = (agreement.schedule || [])
    .filter(item => !item.supersededAt && item.dueDate > asOfDate && getCreditInstalmentAmounts(state, agreement, item).paid === 0)
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate))
    .map(({ id, dueDate, amount }) => ({ id, dueDate, amount }));
  const nextEditableCustomRows = (changes.customSchedule || [])
    .map(({ id, dueDate, amount }) => ({ id: id || '', dueDate, amount }))
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate));
  const customScheduleChanged = nextScheduleMode === 'custom' && JSON.stringify(currentEditableCustomRows) !== JSON.stringify(nextEditableCustomRows);
  if (!['zero', 'fixed', 'apr'].includes(nextFinanceMode) || nextFinanceMode === 'apr' && (!Number.isFinite(nextApr) || nextApr < 0 || nextApr > 1000 || nextScheduleMode === 'custom')) throw new Error('Enter a valid finance mode and APR. APR plans use an automatic schedule.');
  const scheduleChanged = Boolean(changes.recalculateFutureSchedule) || purchaseTermsChanged || nextFinanceMode !== (agreement.financeMode || (agreement.financeCharge ? 'fixed' : 'zero')) || nextFinanceMode === 'apr' && nextApr !== agreement.apr || nextFinanceCharge !== agreement.financeCharge || totalTerm !== currentScheduleCount || frequency !== agreement.frequency || customDays !== agreement.customDays || firstPaymentDate !== (activeFuture[0]?.dueDate || agreement.firstPaymentDate) || nextUpfrontCounts !== Boolean(agreement.upfrontCountsAsFirstInstalment) || nextScheduleMode !== (agreement.scheduleMode || 'auto') || customScheduleChanged;
  if (!scheduleChanged) {
    agreement.title = nextTitle;
    agreement.merchant = String(changes.merchant ?? agreement.merchant).trim();
    agreement.reference = String(changes.reference ?? agreement.reference).trim();
    agreement.productUrl = nextProductUrl;
    agreement.notes = String(changes.notes ?? agreement.notes).trim();
    agreement.creditReminderPreferences = { ...nextReminderPreferences };
    for (const transaction of (state.transactions || []).filter(item => item.creditAgreementId === agreementId && item.creditPaymentKind === 'deposit' && !item.reversedAt)) transaction.title = `Deposit for ${nextTitle}`;
    agreement.updatedAt = new Date().toISOString();
    return agreement;
  }
  if (nextUpfrontCounts && (!nextDeposit || !(existingDeposit || activeDepositTransaction(state, agreementId)))) throw new Error('An actual upfront payment is required before it can count as payment one.');
  const preserved = (agreement.schedule || []).filter(item => !item.supersededAt && (!item.upfrontPayment || nextUpfrontCounts) && (getCreditInstalmentAmounts(state, agreement, item).paid > 0 || ((hasPayments || changes.preservePastUnpaidSchedule) && !item.upfrontPayment && item.dueDate <= asOfDate)));
  const currentUpfrontRow = preserved.find(item => item.upfrontPayment);
  const upfrontRow = nextUpfrontCounts && !currentUpfrontRow
    ? { id: `${agreement.id}:upfront`, sequence: 1, dueDate: nextDepositDate, amount: nextDeposit, principalAmount: nextDeposit, financeCostAmount: 0, upfrontPayment: true, upfrontTransactionId: (existingDeposit || activeDepositTransaction(state, agreementId))?.id }
    : currentUpfrontRow;
  if (currentUpfrontRow) {
    currentUpfrontRow.dueDate = nextDepositDate;
    currentUpfrontRow.amount = nextDeposit;
    currentUpfrontRow.principalAmount = nextDeposit;
    currentUpfrontRow.financeCostAmount = 0;
    currentUpfrontRow.upfrontTransactionId = (existingDeposit || activeDepositTransaction(state, agreementId))?.id || '';
  }
  if (upfrontRow && !currentUpfrontRow) preserved.unshift(upfrontRow);
  const preservedDue = preserved.map(item => ({ item, ...getCreditInstalmentAmounts(state, agreement, item) }));
  const preservedPrincipal = preservedDue.reduce((sum, item) => sum + (item.item.upfrontPayment ? 0 : item.principalRemaining), 0);
  const preservedCost = preservedDue.reduce((sum, item) => sum + (item.item.upfrontPayment ? 0 : item.financeCostRemaining), 0);
  const futurePrincipal = priorBalances.principalRemaining - preservedPrincipal;
  const futureTerm = totalTerm - preserved.length;
  if (futurePrincipal < 0) throw new Error('The saved payment history does not reconcile with this agreement; future terms were not changed.');
  const futureAprPlan = nextFinanceMode === 'apr' && futurePrincipal > 0 && futureTerm > 0 ? generateAprCreditSchedule({ agreementId: agreement.id, principalAmount: futurePrincipal, apr: nextApr, term: futureTerm, frequency, customDays, firstPaymentDate }) : null;
  const effectiveFinanceCharge = nextFinanceMode === 'apr' ? priorBalances.paidFinanceCost + preservedCost + (futureAprPlan?.financeCharge || 0) : nextFinanceCharge;
  const futureCost = nextFinanceMode === 'apr' ? (futureAprPlan?.financeCharge || 0) : nextFinanceCharge - priorBalances.paidFinanceCost - preservedCost;
  if (!cents(effectiveFinanceCharge) || futureCost < 0) throw new Error('The updated finance cost does not reconcile with payment history.');
  if (!nextTitle || !Number.isInteger(totalTerm) || totalTerm < 1 || totalTerm > 600 || futureTerm < 0 || (futureTerm === 0 && (futurePrincipal > 0 || futureCost > 0)) || !validDate(firstPaymentDate) || (futureTerm > 0 && firstPaymentDate < asOfDate)) throw new Error('Enter a total payment count that covers all recorded payments and the remaining balance.');
  const customRows = changes.customSchedule || [];
  const newSchedule = futureAprPlan ? futureAprPlan.schedule.map((item, index) => ({ ...item, id: `${agreement.id}:apr-revised:${Date.now()}:${index + 1}`, sequence: preserved.length + index + 1 })) : futurePrincipal > 0 || futureCost > 0
    ? nextScheduleMode === 'custom'
      ? generateCustomCreditSchedule({ agreementId: agreement.id, principalAmount: futurePrincipal, financeCharge: futureCost, rows: customRows }).map((item, index) => ({ ...item, id: item.id || `${agreement.id}:custom:${Date.now()}:${index + 1}`, sequence: preserved.length + index + 1 }))
      : generateCreditSchedule({ agreementId: agreement.id, principalAmount: futurePrincipal, financeCharge: futureCost, term: futureTerm, frequency, customDays, firstPaymentDate }).map((item, index) => ({ ...item, id: `${agreement.id}:revised:${Date.now()}:${index + 1}`, sequence: preserved.length + index + 1 }))
    : [];
  if (newSchedule.length !== futureTerm) throw new Error('The total payment count does not match the future schedule.');
  for (const item of agreement.schedule || []) if (!preserved.includes(item) && !item.supersededAt) item.supersededAt = asOfDate;
  agreement.schedule = [...preserved, ...newSchedule];
  agreement.title = nextTitle;
  agreement.merchant = String(changes.merchant ?? agreement.merchant).trim();
  agreement.reference = String(changes.reference ?? agreement.reference).trim();
  agreement.productUrl = nextProductUrl;
  agreement.notes = String(changes.notes ?? agreement.notes).trim();
  agreement.creditReminderPreferences = { ...nextReminderPreferences };
  for (const transaction of (state.transactions || []).filter(item => item.creditAgreementId === agreementId && item.creditPaymentKind === 'deposit' && !item.reversedAt)) transaction.title = `Deposit for ${nextTitle}`;
  agreement.frequency = frequency;
  agreement.customDays = customDays;
  agreement.upfrontCountsAsFirstInstalment = Boolean(nextUpfrontCounts);
  agreement.scheduleMode = nextScheduleMode;
  agreement.customSchedule = nextScheduleMode === 'custom' ? newSchedule.map(({ id, dueDate, amount }) => ({ id, dueDate, amount })) : [];
  agreement.firstPaymentDate = firstPaymentDate;
  agreement.financeCharge = effectiveFinanceCharge;
  agreement.financeMode = nextFinanceMode;
  agreement.apr = nextFinanceMode === 'apr' ? nextApr : null;
  agreement.interestMode = nextFinanceMode === 'apr' ? 'apr' : nextFinanceMode === 'fixed' ? 'fixed_fee' : 'zero';
  agreement.totalRepayable = (agreement.upfrontCountsAsFirstInstalment ? agreement.cashPrice : agreement.financedAmount) + effectiveFinanceCharge;
  agreement.term = preserved.length + newSchedule.length;
  agreement.termsUpdatedAt = new Date().toISOString();
  agreement.history ||= [];
  agreement.history.push({ type: 'schedule_updated', date: asOfDate, previous: previousTerms, next: { cashPrice: agreement.cashPrice, deposit: agreement.deposit, financedAmount: agreement.financedAmount, financeCharge: effectiveFinanceCharge, financeMode: nextFinanceMode, apr: nextApr, term: agreement.term, frequency, customDays, firstPaymentDate }, historicalPaymentsUnchanged: true, createdAt: agreement.termsUpdatedAt });
  return agreement;
}

export function updateCreditInstalment(state, agreementId, instalmentId, changes, asOfDate = new Date().toISOString().slice(0, 10)) {
  const agreement = (state.creditAgreements || []).find(item => item.id === agreementId);
  const instalment = agreement?.schedule?.find(item => item.id === instalmentId && !item.supersededAt);
  if (!agreement || !instalment || getCreditAgreementStatus(state, agreement) !== 'active') throw new Error('This future instalment is no longer editable.');
  const current = getCreditInstalmentAmounts(state, agreement, instalment);
  const before = { dueDate: instalment.dueDate, amount: instalment.amount };
  if (instalment.dueDate <= asOfDate || current.paid > 0 || current.remaining !== instalment.amount) throw new Error('Only a fully unpaid future instalment can be edited.');
  const dueDate = changes.dueDate ?? instalment.dueDate;
  if (!validDate(dueDate) || dueDate <= asOfDate) throw new Error('Choose a future payment date.');
  const future = (agreement.schedule || []).filter(item => !item.supersededAt && item.dueDate > asOfDate && getCreditInstalmentAmounts(state, agreement, item).paid === 0);
  const targetAmount = changes.amount ?? instalment.amount;
  const principalTotal = future.reduce((sum, item) => sum + item.principalAmount, 0);
  const feeTotal = future.reduce((sum, item) => sum + item.financeCostAmount, 0);
  const total = principalTotal + feeTotal;
  if (!Number.isSafeInteger(targetAmount) || targetAmount <= 0 || targetAmount > total) throw new Error('The edited amount must be positive and cannot exceed the remaining future schedule.');
  const remainingRows = future.filter(item => item.id !== instalment.id);
  if (!remainingRows.length && targetAmount !== total) throw new Error('This is the only future instalment; change the agreement terms to keep the total repayable amount reconciled.');
  const minPrincipal = Math.max(0, targetAmount - feeTotal);
  const maxPrincipal = Math.min(principalTotal, targetAmount);
  const principal = Math.max(minPrincipal, Math.min(maxPrincipal, instalment.principalAmount));
  const fee = targetAmount - principal;
  const otherPrincipals = distribute(principalTotal - principal, remainingRows.length);
  const otherFees = distribute(feeTotal - fee, remainingRows.length);
  instalment.dueDate = dueDate;
  instalment.principalAmount = principal;
  instalment.financeCostAmount = fee;
  instalment.amount = targetAmount;
  remainingRows.forEach((item, index) => { item.principalAmount = otherPrincipals[index]; item.financeCostAmount = otherFees[index]; item.amount = item.principalAmount + item.financeCostAmount; });
  agreement.scheduleMode = 'custom';
  agreement.customSchedule = future.filter(item => !item.upfrontPayment).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(item => ({ id: item.id, dueDate: item.dueDate, amount: item.amount }));
  agreement.history ||= [];
  agreement.history.push({ type: 'instalment_updated', instalmentId, before, after: { dueDate, amount: targetAmount }, createdAt: new Date().toISOString() });
  return instalment;
}
