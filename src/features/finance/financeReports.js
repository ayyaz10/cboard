import { financeSummary, monthKey, shiftMonth } from './financeMath.js';

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
    goalSavings,
    savedTotal: summary.savings + goalSavings,
    achievedGoals,
    goalActivity,
    investmentActivity: transactionActivity('investment'),
    investmentPositions: (state.investments || []).filter((item) => item.date?.slice(0, 7) === month),
    debtActivity: transactionActivity('debt'),
    donationActivity: transactionActivity('donation'),
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

export function markGoalCompletion(goal, date) {
  if (goal.saved >= goal.target) {
    goal.status = 'completed';
    goal.completedAt ||= date;
  } else {
    if (goal.status === 'completed') goal.status = 'active';
  }
  return goal;
}
