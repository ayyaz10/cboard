import test from 'node:test';
import assert from 'node:assert/strict';
import { markGoalCompletion, monthlyFinanceReport, monthlyFinanceReports } from './financeReports.js';

const state = {
  settings: { monthlyIncome: 0 }, budgets: {},
  transactions: [
    { type: 'income', amount: 300000, date: '2026-07-01' },
    { type: 'expense', amount: 90000, date: '2026-07-04' },
    { type: 'savings', amount: 40000, date: '2026-07-05' },
    { type: 'goal', amount: 20000, date: '2026-07-06', allocationRuleId: 'goal-rule' },
    { type: 'investment', amount: 30000, date: '2026-07-07' },
    { type: 'debt', amount: 15000, date: '2026-07-08', title: 'Car repayment' },
    { type: 'donation', amount: 5000, date: '2026-07-09', title: 'Food bank' },
  ],
  goals: [{ id: 'holiday', title: 'Holiday', target: 100000, saved: 100000, status: 'completed', createdAt: '2026-05-01T10:00:00Z' }],
  goalContributions: [
    { goalId: 'holiday', amount: 80000, kind: 'contribution', date: '2026-06-10' },
    { goalId: 'holiday', amount: 20000, kind: 'contribution', date: '2026-07-06', allocationRuleId: 'goal-rule' },
  ],
};

test('monthly report separates spending, saving and investing and lists achieved goals', () => {
  const report = monthlyFinanceReport(state, '2026-07');
  assert.equal(report.expenses, 90000);
  assert.equal(report.savedTotal, 60000);
  assert.equal(report.investments, 30000);
  assert.equal(report.debtPayments, 15000);
  assert.equal(report.donations, 5000);
  assert.equal(report.goalActivity.length, 1);
  assert.equal(report.investmentActivity.length, 1);
  assert.equal(report.debtActivity[0].title, 'Car repayment');
  assert.equal(report.donationActivity[0].title, 'Food bank');
  assert.deepEqual(report.achievedGoals.map((goal) => goal.title), ['Holiday']);
});

test('monthly history includes empty months between the first record and current month', () => {
  assert.deepEqual(monthlyFinanceReports(state, '2026-09').map((report) => report.month), ['2026-09', '2026-08', '2026-07', '2026-06']);
});

test('goal completion date remains in history if money is later withdrawn', () => {
  const goal = { saved: 10000, target: 10000, status: 'active' };
  markGoalCompletion(goal, '2026-07-12');
  assert.deepEqual(goal, { saved: 10000, target: 10000, status: 'completed', completedAt: '2026-07-12' });
  goal.saved = 9000;
  markGoalCompletion(goal, '2026-08-01');
  assert.deepEqual(goal, { saved: 9000, target: 10000, status: 'active', completedAt: '2026-07-12' });
});
