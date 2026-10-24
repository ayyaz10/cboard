import { transactionTypes } from './financeMath.js';
import { migrateDebtPlanStatuses } from './financeDebtPlans.js';

export const defaultCategories = [
  ['Salary', 'income', '#c5ff6f'], ['Freelance', 'income', '#9fe3ff'], ['Other income', 'income', '#ffd166'],
  ['Housing', 'expense', '#ff90e8'], ['Groceries', 'expense', '#c5ff6f'], ['Eating out', 'expense', '#ffd166'],
  ['Transport', 'expense', '#9fe3ff'], ['Utilities', 'expense', '#ffd166'], ['Internet & phone', 'expense', '#9fe3ff'],
  ['Subscriptions', 'expense', '#ff90e8'], ['Shopping', 'expense', '#ff90e8'], ['Healthcare', 'expense', '#c5ff6f'],
  ['Education', 'expense', '#9fe3ff'], ['Family', 'expense', '#ffd166'], ['Entertainment', 'expense', '#ff90e8'],
  ['Travel', 'expense', '#9fe3ff'], ['Personal care', 'expense', '#ff90e8'], ['Insurance', 'expense', '#ffd166'],
  ['Taxes', 'expense', '#ffd166'], ['Other', 'expense', '#d9d9d0'], ['Charity', 'donation', '#c5ff6f'],
  ['Portfolio', 'investment', '#9fe3ff'], ['Repayment', 'debt', '#ffd166'], ['Transfer', 'transfer', '#d9d9d0'],
  ['Savings', 'savings', '#c5ff6f'], ['Budget pot', 'budget', '#ffd166'], ['Goal contribution', 'goal', '#9fe3ff'],
].map(([name, type, color], index) => ({ id: `default-${index}`, name, type, color, icon: '', archived: false, order: index }));

export const defaultDonationCategories = [
  { id: 'donation-default-general', name: 'General Charity', description: '', icon: '', archived: false, createdAt: '2026-01-01T00:00:00.000Z' },
];

export function defaultCurrency() {
  const region = (navigator.language || 'en-GB').split('-')[1];
  return ({ GB: 'GBP', US: 'USD', CA: 'CAD', AU: 'AUD', EU: 'EUR', IN: 'INR', PK: 'PKR' })[region] || 'GBP';
}

export function initialFinanceState() {
  return {
    version: 1,
    settings: { configured: false, currency: defaultCurrency(), monthlyIncome: 0, budgetStartDay: 1, defaultForeignCurrency: 'PKR', leftoverDestination: 'rollover', leftoverGoalId: '' },
    categories: structuredClone(defaultCategories), donationCategories: structuredClone(defaultDonationCategories), donationTargets: [], donationAccruals: [], donationPayments: [], transactions: [], merchantProfiles: [], budgets: {}, openingBalances: {}, budgetPresets: [],
    goals: [], goalContributions: [], investments: [], debts: [], debtPayments: [], recurring: [], transactionPresets: [], allocationRules: [],
  };
}

export function normalizeFinanceState(value) {
  const fallback = initialFinanceState();
  if (!value || typeof value !== 'object') return fallback;
  const state = { ...fallback, ...structuredClone(value), settings: { ...fallback.settings, ...(value.settings || {}) } };
  for (const key of ['categories', 'donationCategories', 'donationTargets', 'donationAccruals', 'donationPayments', 'transactions', 'budgetPresets', 'goals', 'goalContributions', 'investments', 'debts', 'debtPayments', 'recurring', 'transactionPresets', 'allocationRules']) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  migrateDebtPlanStatuses(state.debts, state.allocationRules);
  if (!Array.isArray(state.merchantProfiles)) state.merchantProfiles = [];
  state.merchantProfiles = state.merchantProfiles.filter(item => item && typeof item.id === 'string' && typeof item.displayName === 'string' && Array.isArray(item.aliases) && item.aliases.every(alias => typeof alias === 'string') && (!item.logoData || (typeof item.logoData === 'string' && item.logoData.startsWith('data:image/webp;base64,') && item.logoData.length <= 500000)));
  if (!state.budgets || typeof state.budgets !== 'object' || Array.isArray(state.budgets)) state.budgets = {};
  if (!state.openingBalances || typeof state.openingBalances !== 'object' || Array.isArray(state.openingBalances)) state.openingBalances = {};
  state.transactions = state.transactions.filter((item) => item && transactionTypes.includes(item.type) && Number.isSafeInteger(item.amount) && item.amount > 0);
  // Previous auto deductions recorded virtual Savings/Goal/Budget allocations as
  // completed cash outflows. Their rule link identifies them safely as reservations.
  for (const item of state.transactions) {
    if (item.allocationRuleId && ['savings', 'goal', 'budget'].includes(item.type) && item.allocationStatus === 'completed') {
      item.legacyAllocationStatus = item.allocationStatus;
      item.allocationStatus = 'allocated';
      item.accountingKind = 'allocation';
      item.allocatedOn ||= item.date;
    }
  }
  for (const category of defaultCategories) {
    if (!state.categories.some((item) => item.name === category.name && item.type === category.type)) state.categories.push({ ...category, id: `added-${category.id}`, order: state.categories.length });
  }
  for (const category of defaultDonationCategories) {
    if (!state.donationCategories.some(item => item.id === category.id || item.name.trim().toLowerCase() === category.name.toLowerCase())) state.donationCategories.push(structuredClone(category));
  }
  const generalDonationCategoryId = state.donationCategories.find(item => item.id === defaultDonationCategories[0].id)?.id || state.donationCategories.find(item => item.name.trim().toLowerCase() === defaultDonationCategories[0].name.toLowerCase())?.id || '';
  for (const rule of state.allocationRules) if (rule.targetType === 'donation' && !rule.donationCategoryId) rule.donationCategoryId = generalDonationCategoryId;
  for (const transaction of state.transactions) {
    const financeCategory = state.categories.find(category => category.id === transaction.categoryId);
    const donationCategory = state.donationCategories.find(category => category.id === transaction.donationCategoryId);
    const isDonation = transaction.type === 'donation' || (transaction.type === 'expense' && (transaction.financeGroup === 'donation' || financeCategory?.type === 'donation' || Boolean(donationCategory)));
    if (isDonation && !transaction.donationCategoryId) transaction.donationCategoryId = generalDonationCategoryId;
    const allocationRule = state.allocationRules.find(rule => rule.id === transaction.allocationRuleId);
    if (isDonation && allocationRule?.targetType === 'donation' && allocationRule.donationCategoryId) transaction.donationCategoryId ||= allocationRule.donationCategoryId;
    if (transaction.type === 'expense' && isDonation) transaction.financeGroup = 'donation';
  }
  return state;
}

export function id() { return crypto.randomUUID(); }
export function today() { return new Date().toISOString().slice(0, 10); }
