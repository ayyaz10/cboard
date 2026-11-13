import { orderedTransactions } from './transactionOrder.js';
import { creditCardLiability } from './creditCards.js';

const FUND_TYPES = new Set(['savings', 'goal', 'investment']);
const RESERVED_TYPES = new Set(['donation', 'familySupport', 'debt', 'budget']);
const cancelled = new Set(['cancelled', 'planned']);
const accepted = transactions => orderedTransactions(transactions || [], false)
  .filter(item => (!item.source || item.providerStatus === 'BOOK') && !cancelled.has(item.allocationStatus) && !item.reversedAt);
const sum = values => values.reduce((total, value) => total + value, 0);
const money = value => Number.isSafeInteger(value) ? value : 0;
const labelKey = value => String(value || '').trim().toLocaleLowerCase();

function debtFor(transaction, debts) {
  if (transaction.targetId) return debts.find(item => item.id === transaction.targetId);
  const title = labelKey(transaction.title);
  return debts.find(item => title.includes(labelKey(item.name)));
}

function goalFor(transaction, goals) {
  if (transaction.targetId || transaction.goalId) return goals.find(item => item.id === (transaction.targetId || transaction.goalId));
  const title = labelKey(transaction.title).replace(/^goal:\s*/, '');
  return goals.find(item => labelKey(item.title) === title);
}

function movement(transaction, funds, reserves, owned, cash, stateGoals, stateInvestments, stateTransactions) {
  const amount = money(transaction.amount);
  const status = transaction.allocationStatus || '';
  const type = transaction.type;
  if (type === 'income' || type === 'borrowedCash' || type === 'reimbursement') return { owned: owned + amount, cash: cash + amount };
  if (type === 'personalRepayment') return { owned: owned - amount, cash: cash - amount };
  if (type === 'creditPurchaseRefund') {
    if ((transaction.refundStatus || 'received') !== 'received' || transaction.refundDestination !== 'user') return { owned, cash };
    return { owned: owned + amount, cash: cash + amount };
  }
  if (type === 'refund') {
    const original = stateTransactions.find(item => item.id === transaction.originalTransactionId);
    if ((transaction.refundStatus || 'received') !== 'received' || !original || original.type !== 'expense' || original.financeGroup || original.donationPaymentId || (original.creditAgreementId && original.creditPaymentKind !== 'deposit') || transaction.refundToPerson || transaction.refundToCard) return { owned, cash };
    if (original.creditCardId) return { owned, cash };
    const destination = transaction.refundDestination || original.paidFromFundId || '';
    if (destination && Object.hasOwn(funds, destination)) funds[destination] += amount;
    else cash += amount;
    return { owned: owned + amount, cash };
  }
  if (type === 'transfer') {
    if (transaction.transferKind === 'card-payment' && transaction.accountingKind === 'card-liability-only') return { owned, cash };
    if (transaction.transferKind === 'external-in') return { owned: owned + amount, cash: cash + amount };
    if (transaction.transferKind === 'external-out') return { owned: owned - amount, cash: cash - amount };
    if (transaction.transferKind === 'card-payment') {
      const from = transaction.fromFundId || '';
      if (from && Object.hasOwn(funds, from)) funds[from] -= amount;
      else cash -= amount;
      return { owned, cash };
    }
    const from = transaction.fromFundId || '';
    const to = transaction.toFundId || '';
    if (from === to) return { owned, cash };
    if (from && Object.hasOwn(funds, from)) funds[from] -= amount;
    else if (!from) cash -= amount;
    if (to) funds[to] = (funds[to] || 0) + amount;
    else cash += amount;
    return { owned, cash };
  }
  if (type === 'expense') {
    if (Array.isArray(transaction.fundingSources)) {
      const ownedAmount = transaction.fundingSources.filter(source => ['owned','bank','cash'].includes(source.kind)).reduce((sum, source) => sum + money(source.amount), 0);
      return { owned: owned - ownedAmount, cash: cash - ownedAmount };
    }
    if (transaction.creditCardId) return { owned, cash };
    const reservation = transaction.linkedReservationId && stateTransactions.find(item => item.id === transaction.linkedReservationId && (item.type === 'donation' && item.allocationStatus === 'allocated' || item.type === 'familySupport' && item.allocationStatus === 'paid' && item.settlementTransactionId === transaction.id));
    if (reservation) {
      if (reservation.type === 'donation') reserves.donation = Math.max(0, (reserves.donation || 0) - amount);
      return { owned: owned - amount, cash };
    }
    const rawFundId = transaction.paidFromFundId || transaction.goalId;
    const fundId = rawFundId && Object.hasOwn(funds, rawFundId) ? rawFundId : rawFundId && Object.hasOwn(funds, `goal:${rawFundId}`) ? `goal:${rawFundId}` : '';
    if (fundId) funds[fundId] -= amount;
    else cash -= amount;
    return { owned: owned - amount, cash };
  }
  if (type === 'creditPayment') {
    const rawFundId = transaction.paidFromFundId || '';
    const fundId = rawFundId && Object.hasOwn(funds, rawFundId) ? rawFundId : rawFundId && Object.hasOwn(funds, `goal:${rawFundId}`) ? `goal:${rawFundId}` : '';
    if (fundId) funds[fundId] -= amount;
    else cash -= amount;
    return { owned: owned - amount, cash };
  }
  if (type === 'investment' && !['allocated', 'cancelled', 'planned'].includes(status) && (transaction.accountingKind === 'tracked-asset-transfer' || stateInvestments.some(item => item.id === transaction.targetId))) return { owned, cash: cash - amount };
  if (FUND_TYPES.has(type)) {
    const fundId = (type === 'goal' ? goalFor(transaction, stateGoals)?.id : '') || transaction.targetId || transaction.goalId || type;
    const key = `${type}:${fundId}`;
    if (transaction.goalMovement === 'release' || transaction.goalMovement === 'withdrawal') {
      funds[key] = (funds[key] || 0) - amount;
      return { owned, cash: cash + amount };
    }
    funds[key] = (funds[key] || 0) + (transaction.goalMovement === 'spend' ? -amount : amount);
    if (transaction.goalMovement === 'spend') return { owned: owned - amount, cash };
    cash -= amount;
    return { owned, cash };
  }
  if (RESERVED_TYPES.has(type)) {
    if (transaction._reservePhase || status === 'allocated' || (status === 'completed' && transaction.accountingKind === 'allocation')) {
      reserves[type] = (reserves[type] || 0) + amount;
      cash -= amount;
      return { owned, cash };
    }
    if (status === 'paid' || status === 'transferred' || !status) {
      if (type === 'debt' && transaction.paidFromFundId && Object.hasOwn(funds, transaction.paidFromFundId)) {
        funds[transaction.paidFromFundId] -= amount;
        return { owned: owned - amount, cash };
      }
      const wasReserved = transaction._settlementPhase || (status === 'paid' && transaction.allocatedOn && (reserves[type] || 0) >= amount);
      if (wasReserved) reserves[type] = Math.max(0, reserves[type] - amount);
      if (type === 'familySupport' && transaction.settlementTransactionId && wasReserved) return { owned, cash };
      return { owned: owned - amount, cash: cash - (wasReserved ? 0 : amount) };
    }
  }
  return { owned, cash };
}

/** One derived view of the existing Finance event ledger. Side ledgers such as goal.saved
 * and debt.remaining are deliberately not added again; integrity checks report drift. */
export function deriveFinancePosition(state, { asOfDate = '9999-12-31', openingBalance = 0 } = {}) {
  const transactions = accepted(state.transactions).filter(item => String(item.date || '').slice(0, 10) <= asOfDate || String(item.allocatedOn || '').slice(0, 10) <= asOfDate);
  const events = transactions.flatMap(item => {
    if (RESERVED_TYPES.has(item.type) && ['paid', 'transferred'].includes(item.allocationStatus) && item.allocatedOn) return [
      { ...item, date: item.allocatedOn, _reservePhase: true },
      { ...item, date: item.paymentDate || item.date, _settlementPhase: true },
    ];
    return [item];
  }).filter(item => String(item.date || '').slice(0, 10) <= asOfDate).sort((left, right) => String(left.date || '').localeCompare(String(right.date || '')) || String(left.sequence || '').localeCompare(String(right.sequence || '')));
  const activeAccruals = (state.debtAccruals || []).filter(item => item.status !== 'reversed' && String(item.effectiveDate || '').slice(0, 10) <= asOfDate);
  for (const accrual of activeAccruals) {
    events.push({ id: `debt-reserve:${accrual.id}`, date: accrual.effectiveDate, sequence: `debt-reserve:${accrual.id}`, _debtReserveAmount: money(accrual.accruedAmount ?? accrual.amount) });
    const released = money(accrual.releasedAmount);
    if (released && String(accrual.releaseDate || '').slice(0, 10) <= asOfDate) events.push({ id: `debt-reserve-release:${accrual.id}`, date: accrual.releaseDate || accrual.effectiveDate, sequence: `debt-reserve-release:${accrual.id}`, _debtReserveAmount: -released });
  }
  const paidByAccrual = new Map();
  const debtReservePaymentEvents = new Map();
  for (const payment of (state.debtPayments || []).filter(item => !item.reversedAt && String(item.date || '').slice(0, 10) <= asOfDate)) {
    for (const allocation of payment.sourceAccruals || []) {
      paidByAccrual.set(allocation.accrualId, (paidByAccrual.get(allocation.accrualId) || 0) + money(allocation.amount));
      debtReservePaymentEvents.set(`${payment.id}:${allocation.accrualId}`, { date: payment.date, accrualId: allocation.accrualId, amount: money(allocation.amount), paymentId: payment.id });
    }
  }
  for (const accrual of activeAccruals) {
    const paid = Math.min(money(accrual.paidAmount), paidByAccrual.get(accrual.id) || 0);
    let remainingPaid = paid;
    const paymentEvents = [...debtReservePaymentEvents.values()].filter(item => item.accrualId === accrual.id).sort((left, right) => String(left.date).localeCompare(String(right.date)));
    for (const payment of paymentEvents) {
      const amount = Math.min(payment.amount, remainingPaid);
      if (amount) events.push({ id: `debt-reserve-payment:${payment.paymentId}:${accrual.id}`, date: payment.date, sequence: `0-debt-reserve-payment:${payment.paymentId}:${accrual.id}`, _debtReserveAmount: -amount });
      remainingPaid -= amount;
      if (!remainingPaid) break;
    }
  }
  events.sort((left, right) => String(left.date || '').localeCompare(String(right.date || '')) || String(left.sequence || '').localeCompare(String(right.sequence || '')));
  const funds = {};
  const reserves = { donation: 0, familySupport: 0, debt: 0, budget: 0 };
  let owned = money(openingBalance), spendable = money(openingBalance);
  let income = 0, expenses = 0, donationsPaid = 0, debtPaid = 0, movedToFunds = 0;
  const donationCategoryIds = new Set((state.categories || []).filter(category => category.type === 'donation').map(category => category.id));
  const point = (date, transaction) => ({ date, spendable: owned - sum(Object.values(funds)) - sum(Object.values(reserves)), protected: sum(Object.values(funds)) + sum(Object.values(reserves)), totalOwned: owned, funds: { ...funds }, reserves: { ...reserves }, transaction });
  const points = [point(events[0]?.date || '', null)];
  for (const transaction of events) {
    if (Number.isSafeInteger(transaction._debtReserveAmount)) {
      reserves.debt = Math.max(0, reserves.debt + transaction._debtReserveAmount);
      points.push(point(transaction.date, transaction));
      continue;
    }
    const amount = money(transaction.amount), status = transaction.allocationStatus || '';
    if (!transaction._reservePhase) {
      if (transaction.type === 'income') income += amount;
      if (transaction.type === 'refund' && (transaction.refundStatus || 'received') === 'received' && transaction.originalTransactionId) {
        const original = transactions.find(item => item.id === transaction.originalTransactionId);
        if (original?.type === 'expense' && !original.financeGroup && !original.donationPaymentId && (!original.creditAgreementId || original.creditPaymentKind === 'deposit') && !donationCategoryIds.has(original.categoryId)) expenses -= amount;
      }
      if (transaction.type === 'expense' && transaction.financeGroup !== 'donation' && !donationCategoryIds.has(transaction.categoryId)) expenses += amount;
      if ((transaction.type === 'donation' && status !== 'allocated') || (transaction.type === 'expense' && (transaction.financeGroup === 'donation' || donationCategoryIds.has(transaction.categoryId)))) donationsPaid += amount;
      if (transaction.type === 'debt' && status !== 'allocated') debtPaid += amount;
      if (FUND_TYPES.has(transaction.type) && transaction.goalMovement !== 'spend') movedToFunds += amount;
    }
    const next = movement(transaction, funds, reserves, owned, spendable, state.goals || [], state.investments || [], state.transactions || []);
    owned = next.owned;
    spendable = next.cash;
    points.push(point(transaction.date, transaction));
  }
  const reservedPayments = sum(Object.values(reserves));
  const assetGain = sum((state.investments || []).filter(item => !item.date || item.date <= asOfDate).map(item => {
    const linked = transactions.some(transaction => transaction.type === 'investment' && transaction.targetId === item.id && transaction.allocationStatus !== 'allocated');
    funds[`asset:${item.id}`] = money(item.currentValue);
    return linked ? money(item.currentValue) - money(item.contributed) : money(item.currentValue);
  }));
  owned += assetGain;
  const cardLiability = (state.creditCards || []).reduce((total, card) => total + Math.max(0, creditCardLiability(state, card, asOfDate)), 0);
  owned -= cardLiability;
  const protectedFunds = sum(Object.values(funds));
  for (const point of points) {
    const pointLiability = (state.creditCards || []).reduce((total, card) => total + Math.max(0, creditCardLiability(state, card, point.date || asOfDate)), 0);
    point.totalOwned -= pointLiability;
    point.spendable -= pointLiability;
    const pointAssets = (state.investments || []).filter(item => (!item.date || item.date <= point.date) && item.date <= asOfDate);
    for (const item of pointAssets) {
      point.funds[`asset:${item.id}`] = money(item.currentValue);
      const linked = transactions.some(transaction => transaction.type === 'investment' && transaction.targetId === item.id && transaction.allocationStatus !== 'allocated' && transaction.date <= point.date);
      const gain = linked ? money(item.currentValue) - money(item.contributed) : money(item.currentValue);
      point.totalOwned += gain;
      point.protected += money(item.currentValue);
      point.spendable += gain - money(item.currentValue);
    }
  }
  // For a complete ledger, spendable plus protected money equals owned money. Clamp only
  // the displayed spendable when historic records imply a negative unallocated balance.
  spendable = owned - protectedFunds - reservedPayments;
  const paidByDebt = new Map();
  for (const transaction of transactions.filter(item => item.type === 'debt' && item.allocationStatus !== 'allocated' && String(item.date || '').slice(0, 10) <= asOfDate)) {
    const debt = debtFor(transaction, state.debts || []);
    if (debt) paidByDebt.set(debt.id, (paidByDebt.get(debt.id) || 0) + money(transaction.amount));
  }
  const debtOutstanding = sum((state.debts || []).map(debt => Math.max(0, money(debt.original) - (paidByDebt.get(debt.id) || 0))));
  return {
    spendable, protected: protectedFunds + reservedPayments, protectedFunds, reservedPayments,
    funds, reserves, totalOwned: owned, debtOutstanding, cardLiability,
    activity: { income, expenses, donationsPaid, debtPaid, movedToFunds }, points,
  };
}

export function inspectFinanceIntegrity(state) {
  const issues = [];
  const transactions = state.transactions || [];
  const ids = new Set(transactions.map(item => item.id));
  const payments = state.donationPayments || [];
  const reversals = state.donationReversals || [];
  const reversalByTransaction = new Map();
  const paymentIds = new Set();
  const activeAllocationTotals = new Map();
  for (const payment of payments) {
    if (paymentIds.has(payment.id)) issues.push({ type: 'duplicate-donation-payment', paymentId: payment.id });
    paymentIds.add(payment.id);
    if (!payment.reversedAt) for (const allocation of payment.sourceAccruals || []) activeAllocationTotals.set(allocation.accrualId, (activeAllocationTotals.get(allocation.accrualId) || 0) + money(allocation.amount));
  }
  for (const reversal of reversals) reversalByTransaction.set(reversal.financeTransactionId, (reversalByTransaction.get(reversal.financeTransactionId) || 0) + 1);
  for (const payment of payments) {
    const transaction = transactions.find(item => item.id === payment.financeTransactionId);
    if (!transaction) issues.push({ type: 'orphan-donation-payment', paymentId: payment.id, transactionId: payment.financeTransactionId });
    if (payment.reversedAt && (reversalByTransaction.get(payment.financeTransactionId) || 0) !== 1) issues.push({ type: 'donation-reversal-count-mismatch', paymentId: payment.id, count: reversalByTransaction.get(payment.financeTransactionId) || 0 });
  }
  for (const [transactionId, count] of reversalByTransaction) {
    const transaction = transactions.find(item => item.id === transactionId);
    if (!transaction) issues.push({ type: 'orphan-donation-reversal', transactionId });
    if (count > 1) issues.push({ type: 'duplicate-donation-reversal', transactionId, count });
    if (transaction?.source === 'bank' || transaction?.sourceType === 'bank_import') issues.push({ type: 'bank-transaction-reversed', transactionId });
    if (transaction && !transaction.reversedAt) issues.push({ type: 'reversal-without-reversed-transaction', transactionId });
  }
  for (const reversal of reversals) {
    if (reversal.paymentId && !payments.some(item => item.id === reversal.paymentId)) issues.push({ type: 'orphan-donation-reversal-payment', reversalId: reversal.id, paymentId: reversal.paymentId });
    const transaction = transactions.find(item => item.id === reversal.financeTransactionId);
    if (transaction && !transaction.donationPaymentId && !transaction.linkedReservationId) issues.push({ type: 'unlinked-donation-reversal', reversalId: reversal.id, transactionId: transaction.id });
  }
  for (const transaction of transactions.filter(item => item.reversedAt && (item.donationPaymentId || item.linkedReservationId))) {
    if ((reversalByTransaction.get(transaction.id) || 0) !== 1) issues.push({ type: 'donation-reversal-count-mismatch', transactionId: transaction.id, count: reversalByTransaction.get(transaction.id) || 0 });
  }
  for (const accrual of state.donationAccruals || []) {
    const allocated = activeAllocationTotals.get(accrual.id) || 0;
    if (allocated !== money(accrual.paidAmount)) issues.push({ type: 'donation-accrual-paid-mismatch', accrualId: accrual.id, storedPaid: money(accrual.paidAmount), paymentAllocations: allocated });
    if (money(accrual.paidAmount) < 0 || money(accrual.paidAmount) > money(accrual.accruedAmount ?? accrual.amount)) issues.push({ type: 'donation-accrual-paid-out-of-range', accrualId: accrual.id, paid: money(accrual.paidAmount), accrued: money(accrual.accruedAmount ?? accrual.amount) });
  }
  for (const [name, records, link] of [
    ['goal contribution', state.goalContributions || [], item => item.transactionId],
    ['debt payment', state.debtPayments || [], item => item.transactionId],
  ]) for (const record of records) if (record.transactionId && !ids.has(record.transactionId)) issues.push({ type: 'orphan-link', ledger: name, id: record.id, transactionId: record.transactionId });

  const agreementIds = new Set((state.creditAgreements || []).map(item => item.id));
  const creditPaymentIds = new Map();
  for (const transaction of transactions) {
    if (transaction.creditAgreementId && !agreementIds.has(transaction.creditAgreementId)) issues.push({ type: 'orphan-credit-agreement-link', transactionId: transaction.id, agreementId: transaction.creditAgreementId });
    if (transaction.type !== 'creditPayment') continue;
    const paymentId = transaction.creditPaymentId;
    if (paymentId) creditPaymentIds.set(paymentId, (creditPaymentIds.get(paymentId) || 0) + 1);
    const principal = money(transaction.creditPrincipalAmount), financeCost = money(transaction.creditFinanceCostAmount);
    if (principal + financeCost !== money(transaction.amount)) issues.push({ type: 'credit-payment-split-mismatch', transactionId: transaction.id, amount: money(transaction.amount), principal, financeCost });
  }
  for (const [paymentId, count] of creditPaymentIds) if (count > 1) issues.push({ type: 'duplicate-credit-payment-id', paymentId, count });
  for (const agreement of state.creditAgreements || []) {
    const repaymentPrincipal = agreement.upfrontCountsAsFirstInstalment ? money(agreement.cashPrice) : money(agreement.financedAmount);
    if (repaymentPrincipal + money(agreement.financeCharge) !== money(agreement.totalRepayable)) issues.push({ type: 'credit-agreement-total-mismatch', agreementId: agreement.id });
    const schedule = agreement.schedule || [];
    if (schedule.some(item => money(item.amount) !== money(item.principalAmount) + money(item.financeCostAmount))) issues.push({ type: 'credit-schedule-split-mismatch', agreementId: agreement.id });
  }

  for (const goal of state.goals || []) {
    const eventTotal = transactions.filter(item => item.type === 'goal' && goalFor(item, state.goals || [])?.id === goal.id)
      .reduce((total, item) => total + (item.goalMovement === 'spend' ? -money(item.amount) : money(item.amount)), 0);
    if (eventTotal !== money(goal.saved)) issues.push({ type: 'goal-balance-mismatch', goalId: goal.id, saved: money(goal.saved), transactionEvents: eventTotal });
    const sideLedgerTotal = (state.goalContributions || []).filter(item => item.goalId === goal.id).reduce((total, item) => total + (['withdrawal', 'release', 'spending'].includes(item.kind) ? -money(item.amount) : money(item.amount)), 0);
    if (sideLedgerTotal !== eventTotal) issues.push({ type: 'goal-contribution-ledger-mismatch', goalId: goal.id, sideLedger: sideLedgerTotal, transactionEvents: eventTotal });
  }

  const contributionGroups = new Map();
  for (const item of state.goalContributions || []) {
    if (!item.sourceIncomeId || !item.allocationRuleId) continue;
    const key = `${item.sourceIncomeId}:${item.allocationRuleId}:${item.goalId}:${item.amount}`;
    contributionGroups.set(key, (contributionGroups.get(key) || 0) + 1);
  }
  for (const [key, count] of contributionGroups) if (count > 1) issues.push({ type: 'duplicate-goal-contribution-projection', key, count });
  const possibleGoalDuplicates = new Map();
  for (const item of state.goalContributions || []) {
    const key = `${item.goalId}:${item.date}:${item.amount}:${item.allocationRuleId || ''}`;
    possibleGoalDuplicates.set(key, (possibleGoalDuplicates.get(key) || 0) + 1);
  }
  for (const [key, count] of possibleGoalDuplicates) if (count > 1) issues.push({ type: 'possible-duplicate-goal-contribution', key, count });

  const paidByDebt = new Map();
  for (const transaction of transactions.filter(item => item.type === 'debt' && item.allocationStatus !== 'allocated')) {
    const debt = debtFor(transaction, state.debts || []);
    if (debt) paidByDebt.set(debt.id, (paidByDebt.get(debt.id) || 0) + money(transaction.amount));
  }
  for (const debt of state.debts || []) {
    const ledgerRemaining = Math.max(0, money(debt.original) - (paidByDebt.get(debt.id) || 0));
    if (ledgerRemaining !== money(debt.remaining)) issues.push({ type: 'debt-balance-mismatch', debtId: debt.id, storedRemaining: money(debt.remaining), transactionEventsRemaining: ledgerRemaining });
  }

  const debtExecutions = new Set();
  for (const accrual of state.debtAccruals || []) {
    const accrued = money(accrual.accruedAmount ?? accrual.amount);
    const paid = money(accrual.paidAmount);
    if (paid < 0 || paid > accrued) issues.push({ type: 'debt-accrual-paid-out-of-range', accrualId: accrual.id, paid, accrued });
    if (accrual.executionKey) {
      if (debtExecutions.has(accrual.executionKey)) issues.push({ type: 'duplicate-debt-accrual-execution', executionKey: accrual.executionKey });
      debtExecutions.add(accrual.executionKey);
    }
  }
  for (const debt of state.debts || []) {
    const due = (state.debtAccruals || []).filter(item => item.debtId === debt.id && item.status !== 'reversed').reduce((sum, item) => sum + Math.max(0, money(item.accruedAmount ?? item.amount) - money(item.paidAmount)), 0);
    const paid = (state.debtPayments || []).filter(item => item.debtId === debt.id && !item.reversedAt).reduce((sum, item) => sum + money(item.amount), 0);
    const original = Number.isSafeInteger(debt.original) ? debt.original : money(debt.remaining) + paid;
    const canonicalRemaining = Math.max(0, original - paid);
    if (due > canonicalRemaining) issues.push({ type: 'debt-payment-due-exceeds-remaining', debtId: debt.id, due, remaining: canonicalRemaining });
    if (paid > original) issues.push({ type: 'debt-paid-exceeds-original', debtId: debt.id, paid, original });
  }

  const paidByAccrual = new Map();
  for (const payment of state.debtPayments || []) {
    const transaction = payment.transactionId ? transactions.find(item => item.id === payment.transactionId) : null;
    if (!payment.reversedAt && !transaction) issues.push({ type: 'debt-payment-without-finance-transaction', paymentId: payment.id, transactionId: payment.transactionId || '' });
    if (transaction && Boolean(transaction.reversedAt) !== Boolean(payment.reversedAt)) issues.push({ type: 'debt-payment-reversal-mismatch', paymentId: payment.id, transactionId: transaction.id });
    if (transaction && (transaction.type !== 'debt' || money(transaction.amount) !== money(payment.amount))) issues.push({ type: 'debt-payment-transaction-mismatch', paymentId: payment.id, transactionId: transaction.id });
    if (payment.reversedAt) continue;
    for (const allocation of payment.sourceAccruals || []) paidByAccrual.set(allocation.accrualId, (paidByAccrual.get(allocation.accrualId) || 0) + money(allocation.amount));
  }
  for (const accrual of state.debtAccruals || []) {
    const allocated = paidByAccrual.get(accrual.id) || 0;
    if (allocated !== money(accrual.paidAmount)) issues.push({ type: 'debt-accrual-payment-allocation-mismatch', accrualId: accrual.id, storedPaid: money(accrual.paidAmount), linkedPayments: allocated });
  }

  const paymentGroups = new Map();
  for (const payment of state.debtPayments || []) {
    const key = `${payment.debtId}:${payment.date}:${payment.amount}`;
    paymentGroups.set(key, (paymentGroups.get(key) || 0) + 1);
  }
  for (const [key, count] of paymentGroups) if (count > 1) issues.push({ type: 'possible-duplicate-debt-payment-projection', key, count });

  const generated = new Map();
  for (const item of transactions.filter(item => item.sourceIncomeId && item.allocationRuleId)) {
    const key = `${item.sourceIncomeId}:${item.allocationRuleId}:${item.targetId || item.type}`;
    generated.set(key, (generated.get(key) || 0) + 1);
  }
  for (const [key, count] of generated) if (count > 1) issues.push({ type: 'duplicate-generated-allocation', key, count });
  for (const transaction of transactions) if (transaction.allocationStatus === 'allocated' && ['goal', 'investment', 'debt'].includes(transaction.type) && !transaction.targetId) issues.push({ type: 'allocation-without-destination', transactionId: transaction.id, typeName: transaction.type });
  const refundsByOriginal = new Map();
  for (const refund of transactions.filter(item => item.type === 'refund')) {
    const original = transactions.find(item => item.id === refund.originalTransactionId);
    if (!original || original.type !== 'expense' || original.financeGroup || original.donationPaymentId || (original.creditAgreementId && original.creditPaymentKind !== 'deposit')) issues.push({ type: 'orphan-refund', transactionId: refund.id, originalTransactionId: refund.originalTransactionId || '' });
    if (!refund.reversedAt && !['pending', 'received'].includes(refund.refundStatus || 'received')) issues.push({ type: 'invalid-refund-status', transactionId: refund.id });
    if (original?.type === 'expense' && !original.financeGroup && !original.donationPaymentId && (!original.creditAgreementId || original.creditPaymentKind === 'deposit') && (refund.refundStatus || 'received') === 'received' && !refund.reversedAt) refundsByOriginal.set(original.id, (refundsByOriginal.get(original.id) || 0) + money(refund.amount));
  }
  for (const [originalId, amount] of refundsByOriginal) { const original = transactions.find(item => item.id === originalId); if (amount > money(original?.amount)) issues.push({ type: 'refunds-exceed-original', transactionId: originalId, refunded: amount, original: money(original?.amount) }); }

  const agreementsById = new Map((state.creditAgreements || []).map(agreement => [agreement.id, agreement]));
  const purchaseRefundTotals = new Map();
  for (const refund of transactions.filter(item => item.type === 'creditPurchaseRefund')) {
    const agreement = agreementsById.get(refund.creditAgreementId);
    if (!agreement) issues.push({ type: 'orphan-credit-purchase-refund', transactionId: refund.id, agreementId: refund.creditAgreementId || '' });
    if (!refund.reversedAt && !['pending', 'received'].includes(refund.refundStatus || 'received')) issues.push({ type: 'invalid-credit-purchase-refund-status', transactionId: refund.id });
    if (!['provider', 'user'].includes(refund.refundDestination)) issues.push({ type: 'invalid-credit-purchase-refund-destination', transactionId: refund.id });
    if (agreement && !refund.reversedAt && ['pending', 'received'].includes(refund.refundStatus || 'received')) purchaseRefundTotals.set(agreement.id, (purchaseRefundTotals.get(agreement.id) || 0) + money(refund.amount));
  }
  for (const [agreementId, amount] of purchaseRefundTotals) { const agreement = agreementsById.get(agreementId); if (amount > money(agreement?.cashPrice)) issues.push({ type: 'credit-purchase-refunds-exceed-price', agreementId, refunded: amount, purchasePrice: money(agreement?.cashPrice) }); }

  const position = deriveFinancePosition(state);
  for (const [fund, amount] of Object.entries(position.funds)) if (amount < 0) issues.push({ type: 'negative-fund-balance', fund, amount });
  return issues;
}
