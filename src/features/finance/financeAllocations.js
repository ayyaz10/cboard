import { id } from './financeData.js';
import { inMonth, monthKey } from './financeMath.js';

export const allocationTargets = ['savings', 'budget', 'goal', 'investment', 'debt', 'donation'];

function amountFor(rule, income) {
  return rule.mode === 'percent' ? Math.round(income * Number(rule.value || 0) / 10000) : Number(rule.value || 0);
}

function allocationTitle(rule, state) {
  if (rule.targetType === 'goal') return `Goal: ${state.goals.find(x => x.id === rule.targetId)?.title || rule.name}`;
  if (rule.targetType === 'investment') return `Investment: ${state.investments.find(x => x.id === rule.targetId)?.name || rule.name}`;
  if (rule.targetType === 'debt') return `Payment to ${state.debts.find(x => x.id === rule.targetId)?.name || rule.name}`;
  return rule.name || `${rule.targetType[0].toUpperCase()}${rule.targetType.slice(1)} allocation`;
}

export function applyAllocation(state, rule, income, date, sourceIncomeId = '') {
  const amount = amountFor(rule, income);
  if (!amount || amount < 0) return false;
  const now = new Date().toISOString();
  const transaction = { id: id(), title: allocationTitle(rule, state), amount, type: rule.targetType, categoryId: rule.categoryId || '', date, note: rule.note || 'Automatic income allocation', paymentMethod: '', createdAt: now, updatedAt: now, allocationRuleId: rule.id, sourceIncomeId };
  if (rule.targetType === 'goal') {
    const goal = state.goals.find(x => x.id === rule.targetId);
    if (!goal) return false;
    const applied = Math.min(amount, Math.max(0, goal.target - goal.saved));
    if (!applied) return false;
    transaction.amount = applied;
    goal.saved += applied;
    if (goal.saved >= goal.target) goal.status = 'completed';
    state.goalContributions.push({ id: id(), goalId: goal.id, amount: applied, kind: 'contribution', date, allocationRuleId: rule.id });
  }
  if (rule.targetType === 'investment') {
    const investment = state.investments.find(x => x.id === rule.targetId);
    if (!investment) return false;
    investment.contributed += amount;
    investment.currentValue += amount;
    investment.date = date;
  }
  if (rule.targetType === 'debt') {
    const debt = state.debts.find(x => x.id === rule.targetId);
    if (!debt || !debt.remaining) return false;
    const applied = Math.min(amount, debt.remaining);
    transaction.amount = applied;
    debt.remaining -= applied;
    if (!debt.remaining) debt.status = 'paid';
    state.debtPayments.push({ id: id(), debtId: debt.id, amount: applied, date, allocationRuleId: rule.id });
  }
  state.transactions.push(transaction);
  return true;
}

export function applyIncomeAllocations(state, incomeTransaction) {
  for (const rule of (state.allocationRules || []).filter(x => x.active && x.timing === 'income')) {
    if (!state.transactions.some(x => x.allocationRuleId === rule.id && x.sourceIncomeId === incomeTransaction.id)) applyAllocation(state, rule, incomeTransaction.amount, incomeTransaction.date, incomeTransaction.id);
  }
  return state;
}

export function applyDueMonthlyAllocations(state, date) {
  const month = monthKey(date);
  const day = Number(date.slice(8, 10));
  const income = state.transactions.filter(x => x.type === 'income' && inMonth(x.date, month)).reduce((sum, x) => sum + x.amount, 0) || state.settings.monthlyIncome;
  for (const rule of (state.allocationRules || []).filter(x => x.active && x.timing === 'monthly' && day >= Number(x.day || 1))) {
    if (!state.transactions.some(x => x.allocationRuleId === rule.id && inMonth(x.date, month))) applyAllocation(state, rule, income, date);
  }
  return state;
}
