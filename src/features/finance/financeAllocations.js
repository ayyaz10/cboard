import { nextTransactionSequence } from './transactionOrder.js';
import { id } from './financeData.js';
import { inMonth, monthKey } from './financeMath.js';
import { markGoalCompletion } from './financeReports.js';
import { debtPlanStatus } from './financeDebtPlans.js';
import { refreshDonationTargetStatus } from './donationAnalytics.js';
import { accrueDonation, reconcileDonationIncome } from './donationAccounting.js';

export const allocationTargets = ['savings', 'budget', 'goal', 'investment', 'debt', 'donation'];

export function eligibleBookedBankIncome(state) {
  return state.transactions.filter(item => item.source === 'bank' && item.type === 'income' && item.providerStatus === 'BOOK' && !item.bankIncomeAllocationsApplied);
}

function amountFor(rule, income) {
  return rule.mode === 'percent' ? Math.round(income * Number(rule.value || 0) / 10000) : Number(rule.value || 0);
}

function allocationTitle(rule, state) {
  if (rule.targetType === 'donation' && rule.donationTargetId) return `Donation target: ${state.donationTargets?.find(x => x.id === rule.donationTargetId)?.name || rule.name}`;
  if (rule.targetType === 'goal') return `Goal: ${state.goals.find(x => x.id === rule.targetId)?.title || rule.name}`;
  if (rule.targetType === 'investment') return `Investment: ${state.investments.find(x => x.id === rule.targetId)?.name || rule.name}`;
  if (rule.targetType === 'debt') return `Payment to ${state.debts.find(x => x.id === rule.targetId)?.name || rule.name}`;
  return rule.name || `${rule.targetType[0].toUpperCase()}${rule.targetType.slice(1)} allocation`;
}

export function applyAllocation(state, rule, income, date, sourceIncomeId = '') {
  let amount = amountFor(rule, income);
  if (!amount || amount < 0) return false;
  if (rule.targetType === 'donation') {
    const executionKey = sourceIncomeId ? `${rule.id}:${sourceIncomeId}` : `${rule.id}:monthly:${monthKey(date)}`;
    if ((state.donationAccruals || []).some(item => item.executionKey === executionKey)) return false;
    const target = rule.donationTargetId ? (state.donationTargets || []).find(item => item.id === rule.donationTargetId) : null;
    if (target) {
      const linkedPaid = state.transactions.filter(item => item.type === 'expense' && item.donationCategoryId === target.categoryId && item.linkedDonationTargetId === target.id).reduce((sum, item) => sum + item.amount, 0);
      const linkedDue = (state.donationAccruals || []).filter(item => item.linkedDonationTargetId === target.id && item.status !== 'reversed').reduce((sum, item) => sum + Math.max(0, item.accruedAmount - item.paidAmount), 0);
      amount = Math.min(amount, Math.max(0, target.targetAmount - linkedPaid - linkedDue));
      if (!amount) { rule.active = false; target.status = 'completed'; target.completedAt ||= date; return false; }
    }
    const created = accrueDonation(state, { categoryId: rule.donationCategoryId || target?.categoryId || '', amount, effectiveDate: date, sourceType: sourceIncomeId ? 'income_percentage' : 'adjustment', linkedIncomeTransactionId: sourceIncomeId, automationRuleId: rule.id, linkedDonationTargetId: target?.id || '', note: rule.note || rule.name || '', executionKey });
    if (target && linkedDueForTarget(state, target.id) >= target.targetAmount) { target.status = 'completed'; target.completedAt ||= date; rule.active = false; }
    return created;
  }
  const donationTarget = rule.targetType === 'donation' && rule.donationTargetId ? (state.donationTargets || []).find(item => item.id === rule.donationTargetId) : null;
  if (donationTarget) {
    const settledReservations=new Set(state.transactions.filter(item=>!item.reversedAt&&item.type==='expense'&&item.linkedReservationId).map(item=>item.linkedReservationId));
    const attributed = state.transactions.filter(item => item.linkedDonationTargetId === donationTarget.id && (!item.source || item.providerStatus === 'BOOK') && !['cancelled','planned'].includes(item.allocationStatus) && !(item.type==='donation'&&settledReservations.has(item.id))).reduce((sum, item) => sum + item.amount, 0);
    amount = Math.min(amount, Math.max(0, donationTarget.targetAmount - attributed));
    if (!amount) { rule.active = false; donationTarget.status = 'completed'; donationTarget.completedAt ||= date; return false; }
  }
  const previousTime = Math.max(0, ...state.transactions.map(item => Date.parse(item.createdAt) || 0));
  const now = new Date(Math.max(Date.now(), previousTime + 1)).toISOString();
  const merchant=state.merchantProfiles?.find(item=>item.id===rule.merchantId);
  const transaction = { id: id(), sequence: nextTransactionSequence(state), title: allocationTitle(rule, state), amount, type: rule.targetType, targetId: rule.targetId || '', categoryId: rule.categoryId || '', donationCategoryId: donationTarget?.categoryId || rule.donationCategoryId || '', linkedDonationTargetId: donationTarget?.id || '', merchantId:merchant?.id||null, resolvedMerchantName:merchant?.displayName||'', date, note: rule.note || 'Automatic income allocation', paymentMethod: '', createdAt: now, updatedAt: now, allocationRuleId: rule.id, sourceIncomeId, allocationStatus: 'allocated', accountingKind: 'allocation', allocatedOn: date };
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
  }
  if (rule.targetType === 'debt') {
    const debt = state.debts.find(x => x.id === rule.targetId);
    if (!debt || !debt.remaining || debtPlanStatus(debt, state.allocationRules, date) !== 'active') return false;
    const applied = Math.min(amount, debt.remaining);
    transaction.amount = applied;
  }
  state.transactions.push(transaction);
  if (donationTarget) {
    const settledReservations=new Set(state.transactions.filter(item=>!item.reversedAt&&item.type==='expense'&&item.linkedReservationId).map(item=>item.linkedReservationId));
    const newTotal = state.transactions.filter(item => item.linkedDonationTargetId === donationTarget.id && (!item.source || item.providerStatus === 'BOOK') && !['cancelled','planned'].includes(item.allocationStatus) && !(item.type==='donation'&&settledReservations.has(item.id))).reduce((sum, item) => sum + item.amount, 0);
    if (newTotal >= donationTarget.targetAmount) { donationTarget.status = 'completed'; donationTarget.completedAt ||= date; rule.active = false; }
  }
  return true;
}

function linkedDueForTarget(state, targetId) {
  return (state.donationAccruals || []).filter(item => item.linkedDonationTargetId === targetId && item.status !== 'reversed').reduce((sum, item) => sum + Math.max(0, item.accruedAmount - item.paidAmount), 0);
}

// Reconcile only the generated records owned by this income. Stable IDs keep
// manually-created transactions and unrelated allocations untouched.
export function reconcileIncomeAllocations(state, income, operation = 'replace') {
  const deleting = operation === 'delete' || operation === true;
  reconcileDonationIncome(state, income, deleting ? 'delete' : 'replace');
  const linked = state.transactions.filter(x => x.sourceIncomeId === income.id && x.allocationRuleId);
  const protectedRecords = linked.filter(x => ['paid','completed','transferred'].includes(x.allocationStatus) && !['allocated','cancelled'].includes(x.allocationStatus));
  const protectedIds = new Set(protectedRecords.map(x => x.id));
  const removable = linked.filter(x => !protectedIds.has(x.id));
  const ids = new Set(removable.map(x => x.id));
  for (const tx of removable) {
    if (tx.type === 'goal') { const goal=state.goals.find(x=>x.id===tx.targetId); if(goal) goal.saved=Math.max(0,goal.saved-tx.amount); }
    if (tx.type === 'investment' && ['paid','completed','transferred'].includes(tx.allocationStatus)) { const inv=state.investments.find(x=>x.id===tx.targetId); if(inv){inv.contributed=Math.max(0,inv.contributed-tx.amount);inv.currentValue=Math.max(0,inv.currentValue-tx.amount);} }
  }
  state.goalContributions=(state.goalContributions||[]).filter(x=>!ids.has(x.transactionId));
  state.debtPayments=(state.debtPayments||[]).filter(x=>!ids.has(x.transactionId));
  state.transactions=state.transactions.filter(x=>!ids.has(x.id));
  if (deleting) for (const record of protectedRecords) {
    record.originalSourceIncomeId ||= income.id;
    record.sourceIncomeId = '';
  }
  if (!deleting) applyIncomeAllocations(state, income);
  refreshDonationTargetStatus(state, income.date);
  return { protectedCount: protectedRecords.length };
}

export function applyIncomeAllocations(state, incomeTransaction) {
  for (const rule of (state.allocationRules || []).filter(x => x.active && x.timing === 'income' && (!x.startedOn || x.startedOn <= incomeTransaction.date))) {
    if (rule.targetType === 'donation') {
      const executionKey = `${rule.id}:${incomeTransaction.id}`;
      if (!(state.donationAccruals || []).some(item => item.executionKey === executionKey)) applyAllocation(state, rule, incomeTransaction.amount, incomeTransaction.date, incomeTransaction.id);
      continue;
    }
    if (!state.transactions.some(x => x.allocationRuleId === rule.id && x.sourceIncomeId === incomeTransaction.id)) applyAllocation(state, rule, incomeTransaction.amount, incomeTransaction.date, incomeTransaction.id);
  }
  return state;
}

export function applyDueMonthlyAllocations(state, date) {
  const month = monthKey(date);
  const day = Number(date.slice(8, 10));
  const income = state.transactions.filter(x => x.type === 'income' && inMonth(x.date, month) && (!x.source || x.providerStatus === 'BOOK')).reduce((sum, x) => sum + x.amount, 0) || state.settings.monthlyIncome;
  for (const rule of (state.allocationRules || []).filter(x => x.active && x.timing === 'monthly' && (!x.startedOn || x.startedOn <= date) && day >= Number(x.day || 1))) {
    if (rule.targetType === 'donation') {
      const executionKey = `${rule.id}:monthly:${month}`;
      if (!(state.donationAccruals || []).some(item => item.executionKey === executionKey)) applyAllocation(state, rule, income, date);
      continue;
    }
    if (!state.transactions.some(x => x.allocationRuleId === rule.id && inMonth(x.date, month))) applyAllocation(state, rule, income, date);
  }
  return state;
}

export function settleAllocation(state, transactionId, date) {
  const transaction = state.transactions.find(item => item.id === transactionId);
  if (!transaction || transaction.allocationStatus !== 'allocated') return false;
  if (transaction.type === 'donation') {
    if (transaction.settlementTransactionId && state.transactions.some(item => item.id === transaction.settlementTransactionId)) return false;
    const financeCategory = (state.categories || []).find(category => category.type === 'donation' && !category.archived);
    const payment = { id: id(), sequence: nextTransactionSequence(state), title: transaction.title || 'Donation', amount: transaction.amount, type: 'expense', categoryId: financeCategory?.id || '', financeGroup: 'donation', donationCategoryId: transaction.donationCategoryId || '', linkedDonationTargetId: transaction.linkedDonationTargetId || '', linkedReservationId: transaction.id, sourceType: 'donation_payment', date, paymentDate: date, note: transaction.note || 'Paid from Donation Reserve', paymentMethod: transaction.paymentMethod || '', createdAt: new Date().toISOString() };
    transaction.paymentDate = date;
    transaction.settlementTransactionId = payment.id;
    transaction.updatedAt = payment.createdAt;
    state.transactions.push(payment);
    refreshDonationTargetStatus(state, date);
    return true;
  }
  transaction.allocatedOn ||= transaction.date;
  transaction.paymentDate = date;
  transaction.date = date;
  transaction.updatedAt = new Date().toISOString();
  transaction.allocationStatus = transaction.type === 'savings' ? 'transferred' : 'paid';
  if (transaction.type === 'goal') {
    const goal = state.goals.find(item => item.id === transaction.targetId);
    if (goal) {
      goal.saved = Math.max(0, goal.saved - transaction.amount);
      markGoalCompletion(goal, date);
    }
  }
  if (transaction.type === 'investment') {
    const investment = state.investments.find(item => item.id === transaction.targetId);
    if (investment) {
      investment.contributed = Number(investment.contributed || 0) + transaction.amount;
      investment.currentValue = Number(investment.currentValue || 0) + transaction.amount;
      investment.date = date;
      transaction.allocationStatus = 'transferred';
      transaction.accountingKind = 'tracked-asset-transfer';
    }
  }
  if (transaction.type === 'debt') {
    const debt = state.debts.find(item => item.id === transaction.targetId);
    if (debt) {
      const paid = Math.min(transaction.amount, debt.remaining);
      debt.remaining -= paid;
      if (!debt.remaining) {
        debt.status = 'paid';
        debt.repaymentPlanStatus = 'completed';
        for (const rule of state.allocationRules || []) if (rule.targetType === 'debt' && rule.targetId === debt.id) rule.active = false;
      }
      transaction.amount = paid;
      if (!(state.debtPayments || []).some(item => item.transactionId === transaction.id)) {
        state.debtPayments.push({ id: id(), debtId: debt.id, amount: paid, date, allocationRuleId: transaction.allocationRuleId, sourceIncomeId: transaction.sourceIncomeId, transactionId: transaction.id });
      }
    }
  }
  return true;
}
