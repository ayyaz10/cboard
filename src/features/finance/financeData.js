import { transactionTypes } from './financeMath.js';

export const defaultCategories = [
  ['Salary', 'income', '#c5ff6f'], ['Freelance', 'income', '#9fe3ff'], ['Other income', 'income', '#ffd166'],
  ['Housing', 'expense', '#ff90e8'], ['Groceries', 'expense', '#c5ff6f'], ['Eating out', 'expense', '#ffd166'],
  ['Transport', 'expense', '#9fe3ff'], ['Utilities', 'expense', '#ffd166'], ['Internet & phone', 'expense', '#9fe3ff'],
  ['Subscriptions', 'expense', '#ff90e8'], ['Shopping', 'expense', '#ff90e8'], ['Healthcare', 'expense', '#c5ff6f'],
  ['Education', 'expense', '#9fe3ff'], ['Family', 'expense', '#ffd166'], ['Entertainment', 'expense', '#ff90e8'],
  ['Travel', 'expense', '#9fe3ff'], ['Personal care', 'expense', '#ff90e8'], ['Insurance', 'expense', '#ffd166'],
  ['Taxes', 'expense', '#ffd166'], ['Other', 'expense', '#d9d9d0'], ['Charity', 'donation', '#c5ff6f'],
  ['Portfolio', 'investment', '#9fe3ff'], ['Repayment', 'debt', '#ffd166'], ['Transfer', 'transfer', '#d9d9d0'],
].map(([name, type, color], index) => ({ id: `default-${index}`, name, type, color, icon: '', archived: false, order: index }));

export function defaultCurrency() {
  const region = (navigator.language || 'en-GB').split('-')[1];
  return ({ GB: 'GBP', US: 'USD', CA: 'CAD', AU: 'AUD', EU: 'EUR', IN: 'INR', PK: 'PKR' })[region] || 'GBP';
}

export function initialFinanceState() {
  return {
    version: 1,
    settings: { configured: false, currency: defaultCurrency(), monthlyIncome: 0, budgetStartDay: 1 },
    categories: structuredClone(defaultCategories), transactions: [], budgets: {}, budgetPresets: [],
    goals: [], goalContributions: [], investments: [], debts: [], debtPayments: [], recurring: [], transactionPresets: [],
  };
}

export function normalizeFinanceState(value) {
  const fallback = initialFinanceState();
  if (!value || typeof value !== 'object') return fallback;
  const state = { ...fallback, ...structuredClone(value), settings: { ...fallback.settings, ...(value.settings || {}) } };
  for (const key of ['categories', 'transactions', 'budgetPresets', 'goals', 'goalContributions', 'investments', 'debts', 'debtPayments', 'recurring', 'transactionPresets']) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  if (!state.budgets || typeof state.budgets !== 'object' || Array.isArray(state.budgets)) state.budgets = {};
  state.transactions = state.transactions.filter((item) => item && transactionTypes.includes(item.type) && Number.isSafeInteger(item.amount) && item.amount > 0);
  return state;
}

export function id() { return crypto.randomUUID(); }
export function today() { return new Date().toISOString().slice(0, 10); }
