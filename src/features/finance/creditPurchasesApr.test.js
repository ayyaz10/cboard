import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreditAgreement, generateAprCreditSchedule, generateCreditSchedule, updateCreditAgreement } from './creditPurchases.js';
import { initialFinanceState, normalizeFinanceState } from './financeData.js';

const plan = (apr, frequency = 'monthly', term = 12) => generateAprCreditSchedule({ agreementId: 'apr-test', principalAmount: 90000, apr, term, frequency, customDays: 30, firstPaymentDate: '2026-01-01' });

test('APR schedule uses reducing-balance interest and resolves to zero', () => {
  const result = plan(25);
  assert.equal(result.schedule.length, 12);
  assert.equal(result.schedule[0].openingBalance, 90000);
  assert.ok(result.schedule[0].financeCostAmount > result.schedule[11].financeCostAmount);
  assert.equal(result.schedule.at(-1).closingBalance, 0);
  assert.equal(result.schedule.reduce((sum, row) => sum + row.financeCostAmount, 0), result.financeCharge);
  assert.ok(result.financeCharge > 0);
  assert.equal(result.totalRepayable, 90000 + result.financeCharge);
});

test('APR zero equals an even zero-cost schedule with final rounding adjustment', () => {
  const result = plan(0, 'monthly', 6);
  assert.equal(result.financeCharge, 0);
  assert.deepEqual(result.schedule.map(row => row.amount), [15000, 15000, 15000, 15000, 15000, 15000]);
  assert.equal(result.schedule.at(-1).closingBalance, 0);
});

test('weekly and fortnightly frequencies apply different periodic interest', () => {
  const monthly = plan(25, 'monthly', 12), weekly = plan(25, 'weekly', 52), fortnightly = plan(25, 'fortnightly', 26);
  assert.ok(weekly.schedule[0].financeCostAmount < fortnightly.schedule[0].financeCostAmount);
  assert.ok(fortnightly.schedule[0].financeCostAmount < monthly.schedule[0].financeCostAmount);
  assert.equal(weekly.schedule.at(-1).closingBalance, 0);
  assert.equal(fortnightly.schedule.at(-1).closingBalance, 0);
});

test('APR accepts decimal percentages and schedule dates follow selected frequency', () => {
  const low = plan(4.9, 'weekly', 52), high = plan(34.99, 'monthly', 12);
  assert.ok(low.financeCharge > 0);
  assert.ok(high.financeCharge > low.financeCharge);
  assert.equal(low.schedule[1].dueDate, '2026-01-08');
  assert.equal(plan(19.9, 'fortnightly', 3).schedule[1].dueDate, '2026-01-15');
});

test('fixed finance charge schedule remains a separate equal-principal calculation', () => {
  const fixed = generateCreditSchedule({ agreementId: 'fixed', principalAmount: 90000, financeCharge: 10000, term: 12, frequency: 'monthly', firstPaymentDate: '2026-01-01' });
  assert.equal(fixed.reduce((sum, row) => sum + row.amount, 0), 100000);
  assert.equal(fixed.reduce((sum, row) => sum + row.financeCostAmount, 0), 10000);
});

test('APR result matches an independently calculated reducing-balance annuity and edits safely', () => {
  const result = plan(25);
  const periodicRate = 0.25 / 12;
  const expectedPayment = 90000 * periodicRate / (1 - Math.pow(1 + periodicRate, -12));
  assert.equal(result.schedule[0].amount, Math.round(expectedPayment));
  assert.equal(result.financeCharge, 12649);
  const state = initialFinanceState();
  createCreditAgreement(state, { id: 'agreement', title: 'Laptop', cashPrice: 90000, deposit: 0, financeMode: 'apr', apr: 25, financeCharge: 0, term: 12, scheduleMode: 'auto', frequency: 'monthly', customDays: 30, firstPaymentDate: '2027-01-01', purchaseDate: '2026-12-01' });
  const before = state.creditAgreements[0].schedule.map(row => row.id);
  const updated = updateCreditAgreement(state, 'agreement', { financeMode: 'apr', apr: 29.9, financeCharge: 0, term: 12, scheduleMode: 'auto', frequency: 'monthly', customDays: 30, firstPaymentDate: '2027-01-01' }, '2026-12-01');
  assert.equal(updated.apr, 29.9);
  assert.ok(updated.financeCharge > 11353);
  assert.ok(updated.schedule.at(-1).closingBalance === 0);
  assert.notDeepEqual(updated.schedule.map(row => row.id), before);
});

test('legacy zero and fixed plans migrate idempotently without changing finance cost', () => {
  const original = { creditAgreements: [{ id: 'zero', financeCharge: 0 }, { id: 'fixed', financeCharge: 10000 }] };
  const once = normalizeFinanceState(original);
  const twice = normalizeFinanceState(once);
  assert.deepEqual(once.creditAgreements.map(item => [item.financeMode, item.financeCharge, item.apr]), [['zero', 0, null], ['fixed', 10000, null]]);
  assert.deepEqual(twice.creditAgreements, once.creditAgreements);
});
