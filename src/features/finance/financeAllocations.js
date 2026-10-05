import { nextTransactionSequence } from './transactionOrder.js';
import { id } from './financeData.js';
import { inMonth, monthKey } from './financeMath.js';
import { markGoalCompletion } from './financeReports.js';

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
  const previousTime = Math.max(0, ...state.transactions.map(item => Date.parse(item.createdAt) || 0));
  const now = new Date(Math.max(Date.now(), previousTime + 1)).toISOString();
  const transaction = { id: id(), sequence: nextTransactionSequence(state), title: allocationTitle(rule, state), amount, type: rule.targetType, targetId: rule.targetId || '', categoryId: rule.categoryId || '', date, note: rule.note || 'Automatic income allocation', paymentMethod: '', createdAt: now, updatedAt: now, allocationRuleId: rule.id, sourceIncomeId, allocationStatus: ['debt','donation'].includes(rule.targetType) ? 'allocated' : 'completed' };
  if (rule.targetType === 'goal') {
    const goal = state.goals.find(x => x.id === rule.targetId);
    if (!goal) return false;
    const applied = Math.min(amount, Math.max(0, goal.target - goal.saved));
    if (!applied) return false;
    transaction.amount = applied;
    goal.saved += applied;
    markGoalCompletion(goal, date);
    state.goalContributions.push({ id: id(), goalId: goal.id, amount: applied, kind: 'contribution', date, allocationRuleId: rule.id, sourceIncomeId, transactionId: transaction.id });
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
  }
  if (rule.targetType === 'donation') transaction.allocationStatus = 'allocated';
  state.transactions.push(transaction);
  return true;
}

// Reconcile only the generated records owned by this income. Stable IDs keep
// manually-created transactions and unrelated allocations untouched.
export function reconcileIncomeAllocations(state, income, deleting = false) {
  const linked = state.transactions.filter(x => x.sourceIncomeId === income.id && x.allocationRuleId);
  const protectedRecords = linked.filter(x => ['paid','completed'].includes(x.allocationStatus) && ['debt','donation'].includes(x.type));
  if (deleting && protectedRecords.length) return { protectedCount: protectedRecords.length };
  const ids = new Set(linked.map(x => x.id));
  const goalContribIds = new Set((state.goalContributions || []).filter(x => ids.has(x.transactionId)).map(x => x.id));
  for (const tx of linked) {
    if (tx.type === 'goal') { const goal=state.goals.find(x=>x.id===tx.targetId); if(goal) goal.saved=Math.max(0,goal.saved-tx.amount); }
    if (tx.type === 'investment') { const inv=state.investments.find(x=>x.id===tx.targetId); if(inv){inv.contributed=Math.max(0,inv.contributed-tx.amount);inv.currentValue=Math.max(0,inv.currentValue-tx.amount);} }
  }
  state.goalContributions=(state.goalContributions||[]).filter(x=>!ids.has(x.transactionId));
  state.debtPayments=(state.debtPayments||[]).filter(x=>!ids.has(x.transactionId));
  state.transactions=state.transactions.filter(x=>!ids.has(x.id));
  if (!deleting) applyIncomeAllocations(state, income);
  return { protectedCount: 0 };
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
