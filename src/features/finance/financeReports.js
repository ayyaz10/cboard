import { financeSummary, monthKey, shiftMonth } from './financeMath.js';
import { donationTransactions } from './donationAnalytics.js';

function goalCompletionDate(goal, contributions = []) {
  if (goal.completedAt) return String(goal.completedAt).slice(0, 10);
  if (goal.status !== 'completed') return '';

  const history = contributions
    .filter((item) => item.goalId === goal.id && item.date)
    .sort((left, right) => left.date.localeCompare(right.date));
  const recordedChange = history.reduce((total, item) => (
    total + (item.kind === 'withdrawal' ? -item.amount : item.amount)
  ), 0);
  let balance = Math.max(0, Number(goal.saved || 0) - recordedChange);
  if (balance >= goal.target) return String(goal.createdAt || '').slice(0, 10);
  for (const item of history) {
    balance += item.kind === 'withdrawal' ? -item.amount : item.amount;
    if (balance >= goal.target) return item.date;
  }
  return '';
}

export function monthlyFinanceReport(state, month) {
  const summary = financeSummary(state, month);
  const monthlyGoalEntries = state.goalContributions.filter((item) => item.date?.slice(0, 7) === month);
  const recordedAllocationIds = new Set(monthlyGoalEntries.map((item) => item.allocationRuleId).filter(Boolean));
  const directGoalTransactions = summary.transactions.filter((item) => (
    item.type === 'goal' && (!item.allocationRuleId || !recordedAllocationIds.has(item.allocationRuleId))
  ));
  const goalSavings = monthlyGoalEntries.reduce((total, item) => (
    total + (item.kind === 'withdrawal' ? -item.amount : item.amount)
  ), 0) + directGoalTransactions.reduce((total, item) => total + item.amount, 0);
  const achievedGoals = state.goals.filter((goal) => (
    goalCompletionDate(goal, state.goalContributions)?.slice(0, 7) === month
  ));
  const goalActivity = [
    ...monthlyGoalEntries.map((item) => ({
      id: item.id,
      title: state.goals.find((goal) => goal.id === item.goalId)?.title || 'Deleted goal',
      amount: item.kind === 'withdrawal' ? -item.amount : item.amount,
      date: item.date,
      note: item.kind === 'withdrawal' ? 'Withdrawal' : 'Contribution',
    })),
    ...directGoalTransactions.map((item) => ({ id: item.id, title: item.title, amount: item.amount, date: item.date, note: 'Goal funding' })),
  ].sort((left, right) => right.date.localeCompare(left.date));
  const transactionActivity = (type) => summary.transactions
    .filter((item) => item.type === type)
    .sort((left, right) => right.date.localeCompare(left.date));
  return {
    month,
    ...summary,
    creditPaymentActivity: transactionActivity('creditPayment'),
    creditFinanceCostActivity: transactionActivity('creditPayment').filter(item => item.creditFinanceCostAmount > 0),
    goalSavings,
    savedTotal: summary.savings + goalSavings,
    achievedGoals,
    goalActivity,
    investmentActivity: transactionActivity('investment'),
    investmentPositions: (state.investments || []).filter((item) => item.date?.slice(0, 7) === month),
    debtActivity: transactionActivity('debt'),
    donationActivity: donationTransactions(state).filter(item => item.date?.slice(0, 7) === month && (!item.source || item.providerStatus === 'BOOK')),
  };
}

export function monthlyFinanceReports(state, currentMonth = monthKey()) {
  const datedMonths = [
    ...state.transactions.map((item) => item.date?.slice(0, 7)),
    ...state.goalContributions.map((item) => item.date?.slice(0, 7)),
    ...state.goals.map((goal) => goalCompletionDate(goal, state.goalContributions)?.slice(0, 7)),
    ...Object.keys(state.budgets || {}),
    currentMonth,
  ].filter((value) => /^\d{4}-\d{2}$/.test(value || ''));
  const first = datedMonths.sort()[0] || currentMonth;
  const last = datedMonths.sort().at(-1) || currentMonth;
  const months = [];
  for (let cursor = first; cursor <= last; cursor = shiftMonth(cursor, 1)) months.push(cursor);
  return months.reverse().map((month) => monthlyFinanceReport(state, month));
}

/**
 * Derive category spending from the active Finance transaction ledger.
 * Finance's summary is the source of truth for booked, non-reversed records;
 * this selector only narrows that accepted set to actual expense payments.
 * Debt repayments remain in the existing separate "Repaid" report total.
 */
export function expenseCategoryReport(state, { mode = 'month', month = monthKey(), year = month.slice(0, 4) } = {}) {
  const accepted = financeSummary(state, null).transactions;
  const categoriesById = new Map((state.categories || [])
    .filter(category => category.type === 'expense' || category.type === 'donation')
    .map(category => [category.id, category]));
  const withinPeriod = date => {
    const value = String(date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    if (mode === 'month') return value.slice(0, 7) === month;
    if (mode === 'year') return value.slice(0, 4) === year;
    return true;
  };
  const transactions = accepted.filter(item => (item.type === 'expense' || item.type === 'donation') && withinPeriod(item.date));
  const refunds = accepted.filter(item => item.type === 'refund' && (item.refundStatus || 'received') === 'received' && withinPeriod(item.date));
  const categories = new Map();
  let total = 0;
  const rowFor = transaction => {
    const category = categoriesById.get(transaction.categoryId);
    const id = category?.id || 'uncategorized';
    const row = categories.get(id) || { id, name: category?.name || 'Uncategorised', archived: Boolean(category?.archived), amount: 0, transactions: [] };
    categories.set(id, row);
    return row;
  };
  for (const transaction of transactions) {
    const row = rowFor(transaction);
    row.amount += transaction.amount;
    row.transactions.push(transaction);
    total += transaction.amount;
  }
  for (const refund of refunds) {
    const original = accepted.find(item => item.id === refund.originalTransactionId);
    if (!original || original.type !== 'expense' || original.financeGroup || original.donationPaymentId || original.creditAgreementId) continue;
    const row = rowFor(original);
    row.amount -= refund.amount;
    row.transactions.push(refund);
    total -= refund.amount;
  }
  total = Math.max(0, total);
  const breakdown = [...categories.values()].filter(row => row.amount > 0)
    .map(row => ({ ...row, percentage: total ? (row.amount / total) * 100 : 0 }))
    .sort((left, right) => right.amount - left.amount || left.name.localeCompare(right.name));
  return { mode, month, year, total, categories: breakdown, transactions: [...transactions, ...refunds] };
}

export function markGoalCompletion(goal, date) {
  if (goal.saved >= goal.target) {
    goal.status = 'completed';
    goal.completedAt ||= date;
  } else {
    if (goal.status === 'completed') goal.status = 'active';
  }
  return goal;
}
