import test from 'node:test';
import assert from 'node:assert/strict';
import { expenseCategoryReport, markGoalCompletion, monthlyFinanceReport, monthlyFinanceReports } from './financeReports.js';

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

test('paid Expense transactions classified as Donation appear in donation activity and totals', () => {
  const value={settings:{monthlyIncome:0},budgets:{},categories:[],transactions:[{id:'gift',type:'expense',amount:3000,date:'2026-10-08',financeGroup:'donation',donationCategoryId:'education'}],goals:[],goalContributions:[],investments:[],debts:[],debtPayments:[]};
  const report=monthlyFinanceReport(value,'2026-10');
  assert.equal(report.expenses,0);
  assert.equal(report.donations,3000);
  assert.equal(report.donationActivity[0].id,'gift');
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

const expenseReportCategories = [
  { id: 'groceries', name: 'Groceries', type: 'expense' },
  { id: 'transport', name: 'Transport', type: 'expense' },
  { id: 'bills', name: 'Bills', type: 'expense' },
  { id: 'charity', name: 'Donations', type: 'donation' },
  { id: 'eating-out', name: 'Eating Out', type: 'expense' },
];

function expenseReportState(transactions) {
  return { settings: { monthlyIncome: 0 }, budgets: {}, categories: expenseReportCategories, transactions };
}

test('expense category report includes actual expense and donation payments, excluding internal and pending money movements', () => {
  const report = expenseCategoryReport(expenseReportState([
    { id: 'g1', type: 'expense', categoryId: 'groceries', amount: 5000, date: '2026-10-03' },
    { id: 'g2', type: 'expense', categoryId: 'groceries', amount: 7000, date: '2026-10-09' },
    { id: 'g3', type: 'expense', categoryId: 'groceries', amount: 10000, date: '2026-10-18' },
    { id: 't1', type: 'expense', categoryId: 'transport', amount: 2000, date: '2026-10-04' },
    { id: 't2', type: 'expense', categoryId: 'transport', amount: 4400, date: '2026-10-14' },
    { id: 'b1', type: 'expense', categoryId: 'bills', amount: 15000, date: '2026-10-15' },
    { id: 'd1', type: 'expense', financeGroup: 'donation', categoryId: 'charity', amount: 3000, date: '2026-10-20' },
    { id: 'transfer', type: 'transfer', amount: 20000, date: '2026-10-16', transferKind: 'internal', fromFundId: 'spendable', toFundId: 'savings' },
    { id: 'due', type: 'donation', amount: 4000, date: '2026-10-17', allocationStatus: 'allocated' },
    { id: 'reversed', type: 'expense', financeGroup: 'donation', categoryId: 'charity', amount: 3000, date: '2026-10-21', reversedAt: '2026-10-22' },
    { id: 'debt-due', type: 'debt', amount: 2200, date: '2026-10-18', allocationStatus: 'allocated' },
    { id: 'debt-paid', type: 'debt', amount: 2200, date: '2026-10-19' },
    { id: 'bank-pending', type: 'expense', categoryId: 'groceries', amount: 99999, date: '2026-10-22', source: 'bank', providerStatus: 'PENDING' },
  ]), { mode: 'month', month: '2026-10' });

  assert.equal(report.total, 46400);
  assert.deepEqual(report.categories.map(({ name, amount }) => [name, amount]), [
    ['Groceries', 22000], ['Bills', 15000], ['Transport', 6400], ['Donations', 3000],
  ]);
  assert.equal(report.transactions.length, 7);
  assert.equal(report.categories.find(row => row.id === 'groceries').percentage, 22000 / 46400 * 100);
});

test('uncategorised actual expenses remain included and all-time/year views use effective transaction dates', () => {
  const state = expenseReportState([
    { id: 'oct-end', type: 'expense', categoryId: 'groceries', amount: 2000, date: '2026-10-31' },
    { id: 'nov-start', type: 'expense', categoryId: 'groceries', amount: 3000, date: '2026-11-01' },
    { id: 'unknown', type: 'expense', categoryId: '', amount: 1700, date: '2025-12-30' },
    { id: 'foreign-year', type: 'expense', categoryId: 'transport', amount: 900, date: '2025-01-01' },
  ]);
  const october = expenseCategoryReport(state, { mode: 'month', month: '2026-10' });
  const year = expenseCategoryReport(state, { mode: 'year', year: '2026' });
  const allTime = expenseCategoryReport(state, { mode: 'all' });

  assert.equal(october.total, 2000);
  assert.deepEqual(october.transactions.map(item => item.id), ['oct-end']);
  assert.equal(year.total, 5000);
  assert.equal(allTime.total, 7600);
  assert.equal(allTime.categories.find(row => row.id === 'uncategorized').amount, 1700);
});

test('category totals follow ledger edits and reclassification without stored aggregates', () => {
  const state = expenseReportState([{ id: 'market', type: 'expense', categoryId: 'groceries', amount: 5000, date: '2026-10-08' }]);
  const before = expenseCategoryReport(state, { mode: 'month', month: '2026-10' });
  state.transactions[0].categoryId = 'eating-out';
  state.transactions[0].amount = 4000;
  const after = expenseCategoryReport(state, { mode: 'month', month: '2026-10' });

  assert.deepEqual(before.categories.map(row => [row.id, row.amount]), [['groceries', 5000]]);
  assert.deepEqual(after.categories.map(row => [row.id, row.amount]), [['eating-out', 4000]]);
  assert.equal(after.total, 4000);
});
