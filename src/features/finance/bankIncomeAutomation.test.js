import test from 'node:test';
import assert from 'node:assert/strict';
import { initialFinanceState } from './financeData.js';
import { applyDueMonthlyAllocations, applyIncomeAllocations, eligibleBookedBankIncome } from './financeAllocations.js';
import { financeSummary } from './financeMath.js';

test('pending bank credits are excluded from totals and income allocations until booked', () => {
  const state = initialFinanceState();
  state.transactions.push({ id: 'bank-pending', title: 'Salary', type: 'income', amount: 50000, date: '2026-10-01', source: 'bank', providerStatus: 'PDNG' });
  state.allocationRules.push({ id: 'rule', active: true, timing: 'income', targetType: 'savings', mode: 'amount', value: 1000 });
  assert.equal(financeSummary(state, null).income, 0);
  assert.deepEqual(eligibleBookedBankIncome(state), []);
  assert.equal(state.transactions.length, 1);
});

test('booked bank credits trigger an income allocation once across repeated evaluation', () => {
  const state = initialFinanceState();
  state.transactions.push({ id: 'bank-booked', title: 'Salary', type: 'income', amount: 50000, date: '2026-10-01', source: 'bank', providerStatus: 'BOOK' });
  state.allocationRules.push({ id: 'rule', active: true, timing: 'income', targetType: 'savings', mode: 'amount', value: 1000 });
  const [income] = eligibleBookedBankIncome(state);
  assert.equal(financeSummary(state, null).income, 50000);
  applyIncomeAllocations(state, income);
  applyIncomeAllocations(state, income);
  income.bankIncomeAllocationsApplied = true;
  assert.equal(state.transactions.filter(item => item.allocationRuleId === 'rule').length, 1);
  assert.deepEqual(eligibleBookedBankIncome(state), []);
});

test('pending bank credits do not inflate the income base for monthly deductions', () => {
  const state = initialFinanceState();
  state.settings.monthlyIncome = 20000;
  state.transactions.push({ id: 'bank-pending', title: 'Salary', type: 'income', amount: 50000, date: '2026-10-01', source: 'bank', providerStatus: 'PDNG' });
  state.allocationRules.push({ id: 'monthly-rule', active: true, timing: 'monthly', day: 1, targetType: 'savings', mode: 'percent', value: 1000 });
  applyDueMonthlyAllocations(state, '2026-10-20');
  const allocation = state.transactions.find(item => item.allocationRuleId === 'monthly-rule');
  assert.equal(allocation.amount, 2000);
});
