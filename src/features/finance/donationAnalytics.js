import { inMonth } from './financeMath.js';
import { deriveFinancePosition } from './financeLedger.js';

export function isActualDonation(transaction, categoriesById) {
  if (!transaction || ['allocated', 'planned', 'cancelled'].includes(transaction.allocationStatus)) return false;
  if (transaction.type === 'donation') return true;
  return transaction.type === 'expense'
    && (transaction.financeGroup === 'donation' || categoriesById.get(transaction.categoryId)?.type === 'donation');
}

export function donationTransactions(state) {
  const categoriesById = new Map((state.categories || []).map(category => [category.id, category]));
  return (state.transactions || []).filter(transaction => isActualDonation(transaction, categoriesById) && (!transaction.source || transaction.providerStatus === 'BOOK'));
}

export function refreshDonationTargetStatus(state, date = new Date().toISOString().slice(0, 10)) {
  const settledReservations=new Set((state.transactions||[]).filter(item=>item.type==='expense'&&item.linkedReservationId).map(item=>item.linkedReservationId));
  for (const target of state.donationTargets || []) {
    const attributed = (state.transactions || []).filter(item => item.linkedDonationTargetId === target.id && (!item.source || item.providerStatus === 'BOOK') && !['cancelled', 'planned'].includes(item.allocationStatus) && !(item.type==='donation'&&settledReservations.has(item.id))).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    if (attributed >= Number(target.targetAmount || 0) && Number(target.targetAmount) > 0) {
      target.status = 'completed';
      target.active = false;
      target.completedAt ||= date;
      for (const rule of state.allocationRules || []) if (rule.donationTargetId === target.id) { rule.active = false; rule.pausedByTarget = true; }
    } else if (target.status === 'completed') {
      target.status = 'active';
      target.active = true;
      target.completedAt = '';
      for (const rule of state.allocationRules || []) if (rule.donationTargetId === target.id && rule.pausedByTarget) { rule.active = true; rule.pausedByTarget = false; }
    }
  }
  return state;
}

export function targetMonthlyAllocation(targetAmount, paidAmount = 0, { months = 0, percent = 0 } = {}) {
  const target = Math.max(0, Number(targetAmount) || 0);
  const remaining = Math.max(0, target - (Number(paidAmount) || 0));
  if (!remaining) return 0;
  if (Number(months) > 0) return Math.ceil(remaining / Number(months));
  if (Number(percent) > 0) return Math.min(remaining, Math.round(target * Number(percent) / 100));
  return 0;
}

function donationCategoryId(transaction, donationCategories) {
  if (transaction.donationCategoryId) return transaction.donationCategoryId;
  return donationCategories[0]?.id || '';
}

function breakdown(transactions, categories) {
  const categoryMap = new Map(categories.map(category => [category.id, { id: category.id, name: category.name, archived: Boolean(category.archived), amount: 0, count: 0 }]));
  for (const transaction of transactions) {
    const id = donationCategoryId(transaction, categories);
    const row = categoryMap.get(id);
    if (row) { row.amount += transaction.amount; row.count += 1; }
    else {
      const unknown = categoryMap.get('legacy-uncategorized') || { id: 'legacy-uncategorized', name: 'Uncategorised', archived: false, amount: 0, count: 0 };
      unknown.amount += transaction.amount; unknown.count += 1; categoryMap.set(unknown.id, unknown);
    }
  }
  return [...categoryMap.values()].filter(row => row.amount > 0).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}

export function donationSummary(state, month, incomeMonth = month) {
  const all = donationTransactions(state).filter(item => !item.source || item.providerStatus === 'BOOK');
  const selected = month ? all.filter(item => inMonth(item.date, month)) : all;
  const incomeTransactions = (state.transactions || []).filter(item => item.type === 'income' && !['allocated', 'planned', 'cancelled'].includes(item.allocationStatus) && (!item.source || item.providerStatus === 'BOOK'));
  const categories = state.donationCategories || [];
  const lifetime = all.reduce((sum, item) => sum + item.amount, 0);
  const donated = selected.reduce((sum, item) => sum + item.amount, 0);
  const incomeLifetime = incomeTransactions.reduce((sum, item) => sum + item.amount, 0);
  const income = (month ? incomeTransactions.filter(item => inMonth(item.date, month)) : incomeTransactions).reduce((sum, item) => sum + item.amount, 0);
  const monthlyIncome = (incomeMonth ? incomeTransactions.filter(item => inMonth(item.date, incomeMonth)) : incomeTransactions).reduce((sum, item) => sum + item.amount, 0);
  const position = deriveFinancePosition(state);
  const reserved = Number(position.reserves?.donation || 0);
  const targets = (state.donationTargets || []).filter(target => target.active !== false);
  return {
    month,
    donated,
    lifetime,
    income,
    monthlyIncome,
    incomeLifetime,
    transactionCount: selected.length,
    transactions: [...selected].sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
    categories: breakdown(selected, categories),
    lifetimeCategories: breakdown(all, categories),
    reserved,
    targets,
    activeRules: (state.allocationRules || []).filter(rule => rule.targetType === 'donation' && rule.active),
  };
}

