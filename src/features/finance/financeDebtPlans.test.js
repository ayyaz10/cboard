import test from 'node:test';
import assert from 'node:assert/strict';
import { debtPlanStatus, debtPlanSummary, migrateDebtPlanStatuses, plannedDebtPayment } from './financeDebtPlans.js';

const debts = () => [
  { id: 'a', remaining: 4_394, status: 'active' },
  { id: 'b', remaining: 5_400, status: 'active' },
  { id: 'c', remaining: 8_000, status: 'active' },
];

test('legacy open debts migrate separately from their repayment plans', () => {
  const items = debts(), rules = [{ id: 'rule-a', targetType: 'debt', targetId: 'a', active: true }];
  migrateDebtPlanStatuses(items, rules, '2026-10-16');
  assert.deepEqual(items.map(debt => debt.status), ['open', 'open', 'open']);
  assert.deepEqual(items.map(debt => debt.repaymentPlanStatus), ['active', 'not_started', 'not_started']);
  assert.deepEqual(debtPlanSummary(items, rules, '2026-10-16'), { openDebtCount: 3, activePlanCount: 1 });
});

test('multiple plans can be active and pausing one leaves its debt open', () => {
  const items = debts();
  items[0].repaymentPlanStatus = 'active';
  items[1].repaymentPlanStatus = 'active';
  assert.equal(debtPlanSummary(items, [], '2026-10-16').activePlanCount, 2);
  items[0].repaymentPlanStatus = 'paused';
  assert.equal(items[0].remaining, 4_394);
  assert.equal(items[0].status, 'active');
  assert.equal(debtPlanSummary(items, [], '2026-10-16').activePlanCount, 1);
});

test('a manual payment on a not-started debt does not start its plan', () => {
  const debt = { id: 'b', remaining: 8_000, status: 'open', repaymentPlanStatus: 'not_started' };
  debt.remaining -= 1_000;
  assert.equal(debt.remaining, 7_000);
  assert.equal(debtPlanStatus(debt), 'not_started');
});

test('scheduled plans become active on their start date', () => {
  const debt = { id: 'c', remaining: 8_000, status: 'open', repaymentPlanStatus: 'scheduled', repaymentStartDate: '2026-11-01' };
  assert.equal(debtPlanStatus(debt, [], '2026-10-31'), 'scheduled');
  assert.equal(debtPlanStatus(debt, [], '2026-11-01'), 'active');
  assert.equal(debtPlanSummary([debt], [], '2026-10-31').activePlanCount, 0);
});

test('paid-off debt completes the plan and plan status never changes transaction balances', () => {
  const debt = { id: 'a', remaining: 0, status: 'paid', repaymentPlanStatus: 'active' };
  const state = { debts: [debt], transactions: [{ id: 'tx', amount: 500, type: 'debt' }] };
  assert.equal(debtPlanStatus(debt), 'completed');
  assert.equal(state.transactions[0].amount, 500);
  assert.equal(state.debts[0].remaining, 0);
});

test('future debt deduction rules stay enabled but cannot apply before their start date', () => {
  const items = [{ id: 'a', remaining: 100, status: 'active' }];
  const rules = [{ id: 'r', targetType: 'debt', targetId: 'a', active: true, startedOn: '2026-11-01' }];
  migrateDebtPlanStatuses(items, rules, '2026-10-16');
  assert.equal(items[0].repaymentPlanStatus, 'scheduled');
  assert.equal(rules[0].active, true);
});

test('percentage plan calculates a fixed share of original debt and caps the final payment', () => {
  const debt = { original: 80_000, remaining: 80_000, plannedPaymentMode: 'percentage', plannedPaymentPercent: 1250 };
  assert.equal(plannedDebtPayment(debt), 10_000);
  debt.remaining = 3_000;
  assert.equal(plannedDebtPayment(debt), 3_000);
});
