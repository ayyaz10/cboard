export const transactionTypes = ['income', 'expense', 'donation', 'investment', 'debt', 'transfer'];

export function parseMoney(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  const text = String(value ?? '').trim().replace(/,/g, '');
  if (!/^\d+(?:\.\d{0,2})?$/.test(text)) throw new Error('Enter a valid amount with up to 2 decimal places.');
  const [whole, decimal = ''] = text.split('.');
  const amount = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Amount must be greater than zero.');
  return amount;
}

export function moneyInput(minorUnits) {
  return (Number(minorUnits || 0) / 100).toFixed(2);
}

export function formatMoney(minorUnits, currency = 'GBP', locale) {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format((minorUnits || 0) / 100);
  } catch {
    return `${currency} ${moneyInput(minorUnits)}`;
  }
}

export function monthKey(date = new Date()) {
  const value = typeof date === 'string' ? new Date(`${date.slice(0, 10)}T12:00:00`) : date;
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(key, offset) {
  const [year, month] = key.split('-').map(Number);
  return monthKey(new Date(year, month - 1 + offset, 15));
}

export function inMonth(date, key) {
  return typeof date === 'string' && date.slice(0, 7) === key;
}

export function budgetTarget(item, income) {
  return item.mode === 'percent' ? Math.round(income * Number(item.value || 0) / 10000) : Number(item.value || 0);
}

export function financeSummary(state, selectedMonth) {
  const transactions = state.transactions.filter((item) => inMonth(item.date, selectedMonth));
  const sum = (type) => transactions.filter((item) => item.type === type).reduce((total, item) => total + item.amount, 0);
  const income = sum('income');
  const expenses = sum('expense');
  const donations = sum('donation');
  const investments = sum('investment');
  const debtPayments = sum('debt');
  const outflow = expenses + donations + investments + debtPayments;
  const remaining = income - outflow;
  const savings = Math.max(0, remaining);
  const budget = state.budgets[selectedMonth] || [];
  const budgetPlanned = budget.reduce((total, item) => total + budgetTarget(item, income || state.settings.monthlyIncome), 0);
  return {
    income, expenses, donations, investments, debtPayments, remaining, savings,
    savingsRate: income ? Math.round(savings * 10000 / income) : 0,
    budgetPlanned,
    budgetUsed: budgetPlanned ? Math.round(expenses * 10000 / budgetPlanned) : 0,
    transactions,
  };
}

export function investmentSummary(items) {
  const contributed = items.reduce((sum, item) => sum + item.contributed, 0);
  const value = items.reduce((sum, item) => sum + item.currentValue, 0);
  const gain = value - contributed;
  return { contributed, value, gain, gainRate: contributed ? Math.round(gain * 10000 / contributed) : 0 };
}

export function debtSummary(items, payments, selectedMonth) {
  return {
    outstanding: items.reduce((sum, item) => sum + item.remaining, 0),
    paidThisMonth: payments.filter((item) => inMonth(item.date, selectedMonth)).reduce((sum, item) => sum + item.amount, 0),
  };
}

export function nextRecurringDate(date, frequency, customMonths = 1) {
  const current = new Date(`${date}T12:00:00`);
  if (frequency === 'weekly') current.setDate(current.getDate() + 7);
  else if (frequency === 'fortnightly') current.setDate(current.getDate() + 14);
  else if (frequency === 'yearly') current.setFullYear(current.getFullYear() + 1);
  else current.setMonth(current.getMonth() + Math.max(1, Number(customMonths) || 1));
  return current.toISOString().slice(0, 10);
}

export function goalProjection(goal) {
  const remaining = Math.max(0, goal.target - goal.saved);
  if (!remaining) return { percent: 10000, months: 0 };
  return { percent: Math.min(10000, Math.round(goal.saved * 10000 / goal.target)), months: goal.monthlyContribution ? Math.ceil(remaining / goal.monthlyContribution) : null };
}
