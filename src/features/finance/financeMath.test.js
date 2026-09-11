import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetTarget, debtSummary, financeSummary, goalProjection, investmentSummary, monthKey, nextRecurringDate, parseMoney, shiftMonth } from './financeMath.js';

test('money input is stored exactly in integer minor units', () => {
  assert.equal(parseMoney('1,234.56'), 123456);
  assert.equal(parseMoney('0.01'), 1);
  for (const value of ['0', '-1', '1.001', 'abc', '']) assert.throws(() => parseMoney(value));
});

test('fixed and percentage budgets calculate without floating point money', () => {
  assert.equal(budgetTarget({ mode: 'amount', value: 90000 }, 300000), 90000);
  assert.equal(budgetTarget({ mode: 'percent', value: 1250 }, 300000), 37500);
  assert.equal(budgetTarget({ mode: 'percent', value: 3333 }, 100), 33);
});

test('monthly totals separate income and each outflow type', () => {
  const state = {
    settings: { monthlyIncome: 0 }, budgets: { '2026-09': [{ mode: 'amount', value: 50000 }] },
    transactions: [
      ['income',300000],['expense',100000],['donation',10000],['investment',30000],['debt',20000],
    ].map(([type, amount], index) => ({ type, amount, date: `2026-09-${10 + index}` })),
  };
  const result = financeSummary(state, '2026-09');
  assert.deepEqual([result.income,result.expenses,result.donations,result.investments,result.debtPayments,result.remaining],[300000,100000,10000,30000,20000,140000]);
  assert.equal(result.savingsRate, 4667);
  assert.equal(result.budgetUsed, 20000);
});

test('investment gain, debt partial payments, and goal projections are correct', () => {
  assert.deepEqual(investmentSummary([{ contributed: 10000, currentValue: 12500 }]), { contributed:10000,value:12500,gain:2500,gainRate:2500 });
  assert.deepEqual(debtSummary([{ remaining: 7000 }],[{ amount:3000,date:'2026-09-10' }],'2026-09'),{ outstanding:7000,paidThisMonth:3000 });
  assert.deepEqual(goalProjection({ target:100000,saved:25000,monthlyContribution:10000 }),{percent:2500,months:8});
});

test('month and recurring calculations cross year boundaries safely', () => {
  assert.equal(shiftMonth('2026-12',1),'2027-01');
  assert.equal(monthKey(new Date(2026,0,1)),'2026-01');
  assert.equal(nextRecurringDate('2026-12-15','monthly'),'2027-01-15');
  assert.equal(nextRecurringDate('2026-12-28','weekly'),'2027-01-04');
  assert.equal(nextRecurringDate('2024-02-29','yearly'),'2025-03-01');
});
