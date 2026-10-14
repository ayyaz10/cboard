import { orderedTransactions } from './transactionOrder.js';

const FUND_TYPES = new Set(['savings', 'goal', 'investment']);
const RESERVED_TYPES = new Set(['donation', 'debt', 'budget']);
const cancelled = new Set(['cancelled', 'planned']);
const accepted = transactions => orderedTransactions(transactions || [], false)
  .filter(item => (!item.source || item.providerStatus === 'BOOK') && !cancelled.has(item.allocationStatus));
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

function movement(transaction, funds, reserves, owned, cash, stateGoals, stateInvestments) {
  const amount = money(transaction.amount);
  const status = transaction.allocationStatus || '';
  const type = transaction.type;
  if (type === 'income') return { owned: owned + amount, cash: cash + amount };
  if (type === 'transfer') {
    if (transaction.transferKind === 'external-in') return { owned: owned + amount, cash: cash + amount };
    if (transaction.transferKind === 'external-out') return { owned: owned - amount, cash: cash - amount };
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
    const rawFundId = transaction.paidFromFundId || transaction.goalId;
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
      const wasReserved = transaction._settlementPhase || (status === 'paid' && transaction.allocatedOn && (reserves[type] || 0) >= amount);
      if (wasReserved) reserves[type] = Math.max(0, reserves[type] - amount);
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
  const funds = {};
  const reserves = { donation: 0, debt: 0, budget: 0 };
  let owned = money(openingBalance), spendable = money(openingBalance);
  let income = 0, expenses = 0, donationsPaid = 0, debtPaid = 0, movedToFunds = 0;
  const point = (date, transaction) => ({ date, spendable: owned - sum(Object.values(funds)) - sum(Object.values(reserves)), protected: sum(Object.values(funds)) + sum(Object.values(reserves)), totalOwned: owned, funds: { ...funds }, reserves: { ...reserves }, transaction });
  const points = [point(events[0]?.date || '', null)];
  for (const transaction of events) {
    const amount = money(transaction.amount), status = transaction.allocationStatus || '';
    if (!transaction._reservePhase) {
      if (transaction.type === 'income') income += amount;
      if (transaction.type === 'expense') expenses += amount;
      if (transaction.type === 'donation' && status !== 'allocated') donationsPaid += amount;
      if (transaction.type === 'debt' && status !== 'allocated') debtPaid += amount;
      if (FUND_TYPES.has(transaction.type) && transaction.goalMovement !== 'spend') movedToFunds += amount;
    }
    const next = movement(transaction, funds, reserves, owned, spendable, state.goals || [], state.investments || []);
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
  const protectedFunds = sum(Object.values(funds));
  for (const point of points) {
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
    funds, reserves, totalOwned: owned, debtOutstanding,
    activity: { income, expenses, donationsPaid, debtPaid, movedToFunds }, points,
  };
}

export function inspectFinanceIntegrity(state) {
  const issues = [];
  const transactions = state.transactions || [];
  const ids = new Set(transactions.map(item => item.id));
  for (const [name, records, link] of [
    ['goal contribution', state.goalContributions || [], item => item.transactionId],
    ['debt payment', state.debtPayments || [], item => item.transactionId],
  ]) for (const record of records) if (record.transactionId && !ids.has(record.transactionId)) issues.push({ type: 'orphan-link', ledger: name, id: record.id, transactionId: record.transactionId });

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
  const position = deriveFinancePosition(state);
  for (const [fund, amount] of Object.entries(position.funds)) if (amount < 0) issues.push({ type: 'negative-fund-balance', fund, amount });
  return issues;
}
