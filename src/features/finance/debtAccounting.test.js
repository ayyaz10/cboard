import test from 'node:test';
import assert from 'node:assert/strict';
import { accrueDebtPayment, canMarkDebtPaymentUnpaid, debtAccrualSettlementStatus, debtPaymentDue, debtPaymentSummary, debtRemainingAmount, editDebtAccumulation, markDebtPaymentUnpaid, migrateLegacyDebtAllocations, reconcileDebtBalance, recordDebtPayment, recordDebtPaymentState, removeDebtAccumulation } from './debtAccounting.js';
import { applyIncomeAllocations, reconcileIncomeAllocations } from './financeAllocations.js';
import { deriveFinancePosition, inspectFinanceIntegrity } from './financeLedger.js';
import { debtSummary, financeSummary } from './financeMath.js';

function makeState() {
  return {
    settings: { currency: 'GBP', monthlyIncome: 0 }, budgets: {},
    debts: [{ id: 'wasik', name: 'Wasik Malik', original: 50_000, remaining: 50_000, sourceCurrency: 'GBP', sourceOriginal: 50_000, sourceRemaining: 50_000, status: 'open', repaymentPlanStatus: 'active' }],
    debtPayments: [], debtAccruals: [], transactions: [], allocationRules: [], goals: [], investments: [],
  };
}

test('income rule accrues due once without creating a payment or moving balances', () => {
  const state = makeState();
  state.allocationRules = [{ id: 'rule', targetType: 'debt', targetId: 'wasik', mode: 'amount', value: 2_203, timing: 'income', active: true }];
  const income = { id: 'salary-1', type: 'income', amount: 100_000, date: '2026-10-05' };
  state.transactions.push(income);
  applyIncomeAllocations(state, income);
  applyIncomeAllocations(state, income);
  assert.equal(state.debtAccruals.length, 1);
  assert.equal(state.debtAccruals[0].accruedAmount, 2_203);
  assert.equal(state.transactions.length, 1);
  assert.equal(state.debts[0].remaining, 50_000);
  assert.equal(debtPaymentDue(state, 'wasik'), 2_203);
  assert.equal(debtSummary(state.debts, state.debtPayments, '2026-10').paidThisMonth, 0);
  assert.equal(deriveFinancePosition(state).totalOwned, 100_000);
});

test('income percentage and fixed accruals cap at debt remaining and current due', () => {
  const state = makeState();
  state.debts[0].original = 5_000;
  state.debts[0].remaining = 5_000;
  assert.equal(accrueDebtPayment(state, { debtId: 'wasik', amount: 4_000, effectiveDate: '2026-10-01', executionKey: 'one' }), true);
  assert.equal(accrueDebtPayment(state, { debtId: 'wasik', amount: 2_203, effectiveDate: '2026-10-02', executionKey: 'two' }), true);
  assert.equal(debtPaymentDue(state, 'wasik'), 5_000);
  assert.equal(accrueDebtPayment(state, { debtId: 'wasik', amount: 1_000, effectiveDate: '2026-10-03', executionKey: 'three' }), false);
  assert.equal(state.debtAccruals[1].amount, 1_000);
});

test('remaining debt and payable accumulation derive from real payments when cached balance has drifted', () => {
  const state = makeState();
  state.debts[0].original = 8_800;
  state.debts[0].remaining = 6_597;
  state.debtPayments.push({ id: 'p1', debtId: 'wasik', amount: 8_812, date: '2026-10-25', transactionId: 'tx1' });
  state.debtAccruals.push({ id: 'a1', debtId: 'wasik', amount: 6_597, accruedAmount: 6_597, paidAmount: 0, effectiveDate: '2026-10-25', status: 'outstanding' });
  assert.equal(debtRemainingAmount(state, 'wasik'), 0);
  assert.equal(debtPaymentDue(state, 'wasik'), 0);
  assert.equal(debtSummary(state.debts, state.debtPayments, '2026-10').outstanding, 0);
  assert.equal(debtPaymentSummary(state, 'wasik', '2026-10').paidAllTime, 8_812);
  assert.equal(reconcileDebtBalance(state, 'wasik'), true);
  assert.equal(state.debts[0].remaining, 0);
  assert.equal(reconcileDebtBalance(state, 'wasik'), false);
});

test('manual accumulation can be edited or removed without changing debt or Finance transactions', () => {
  const state = makeState();
  accrueDebtPayment(state, { debtId: 'wasik', amount: 2_500, effectiveDate: '2026-10-15', sourceType: 'manual' });
  const entry = state.debtAccruals[0];
  editDebtAccumulation(state, entry.id, { amount: 3_000, effectiveDate: '2026-10-16', note: 'corrected' });
  assert.equal(debtPaymentDue(state, 'wasik'), 3_000);
  assert.equal(entry.effectiveDate, '2026-10-16');
  assert.equal(entry.note, 'corrected');
  assert.equal(state.debts[0].remaining, 50_000);
  assert.equal(state.transactions.length, 0);
  assert.equal(removeDebtAccumulation(state, entry.id, '2026-10-17'), true);
  assert.equal(debtPaymentDue(state, 'wasik'), 0);
  assert.equal(state.debts[0].remaining, 50_000);
  assert.equal(state.transactions.length, 0);
});

test('entry payment supports partial settlement and undo restores the same accumulation entry', () => {
  const state = makeState();
  accrueDebtPayment(state, { debtId: 'wasik', amount: 2_200, effectiveDate: '2026-10-01', executionKey: 'oldest' });
  accrueDebtPayment(state, { debtId: 'wasik', amount: 2_200, effectiveDate: '2026-10-02', executionKey: 'newer' });
  const newer = state.debtAccruals[1];
  const payment = recordDebtPayment(state, { debtId: 'wasik', amount: 1_000, date: '2026-10-20', preferredAccrualId: newer.id });
  assert.equal(state.debtAccruals[0].paidAmount, 0);
  assert.equal(newer.paidAmount, 1_000);
  assert.equal(debtPaymentDue(state, 'wasik'), 3_400);
  assert.equal(debtRemainingAmount(state, 'wasik'), 49_000);
  markDebtPaymentUnpaid(state, payment.id, '2026-10-21');
  assert.equal(state.debtAccruals.length, 2);
  assert.equal(newer.paidAmount, 0);
  assert.equal(debtPaymentDue(state, 'wasik'), 4_400);
  assert.equal(debtRemainingAmount(state, 'wasik'), 50_000);
});

test('partial and larger-than-due actual payments consume oldest due and reduce debt once', () => {
  const state = makeState();
  accrueDebtPayment(state, { debtId: 'wasik', amount: 2_000, effectiveDate: '2026-10-01', executionKey: 'one' });
  accrueDebtPayment(state, { debtId: 'wasik', amount: 2_203, effectiveDate: '2026-10-02', executionKey: 'two' });
  const first = recordDebtPayment(state, { debtId: 'wasik', amount: 3_000, sourceAmount: 3_000, date: '2026-10-25' });
  assert.equal(debtPaymentDue(state, 'wasik'), 1_203);
  assert.equal(state.debts[0].remaining, 47_000);
  assert.equal(first.type, 'debt');
  assert.equal(state.debtAccruals[0].paidAmount, 2_000);
  assert.equal(state.debtAccruals[1].paidAmount, 1_000);
  recordDebtPayment(state, { debtId: 'wasik', amount: 5_000, sourceAmount: 5_000, date: '2026-10-26' });
  assert.equal(debtPaymentDue(state, 'wasik'), 0);
  assert.equal(state.debts[0].remaining, 42_000);
  assert.equal(state.debtPayments.reduce((sum, item) => sum + item.amount, 0), 8_000);
  assert.equal(financeSummary(state, '2026-10').debtPayments, 8_000);
  assert.equal(deriveFinancePosition(state).totalOwned, -8_000);
});

test('finance payment change adapter returns the updated state, not the transaction row', () => {
  const state = makeState();
  const result = recordDebtPaymentState(state, { debtId: 'wasik', amount: 2_203, date: '2026-10-25' });
  assert.equal(result, state);
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].type, 'debt');
});

test('accrual history distinguishes outstanding, partially settled, settled, and reversed due', () => {
  assert.equal(debtAccrualSettlementStatus({ amount: 2_203, paidAmount: 0, status: 'outstanding' }), 'outstanding');
  assert.equal(debtAccrualSettlementStatus({ amount: 2_203, paidAmount: 1_000, status: 'partially_paid' }), 'partially_settled');
  assert.equal(debtAccrualSettlementStatus({ amount: 2_203, paidAmount: 2_203, status: 'fully_paid' }), 'settled');
  assert.equal(debtAccrualSettlementStatus({ amount: 2_203, paidAmount: 0, status: 'reversed' }), 'reversed');
});

test('marking a payment unpaid is idempotent and re-payment creates a new transaction', () => {
  const state = makeState();
  accrueDebtPayment(state, { debtId: 'wasik', amount: 2_203, effectiveDate: '2026-10-01', executionKey: 'one' });
  const old = recordDebtPayment(state, { debtId: 'wasik', amount: 2_203, date: '2026-10-05' });
  const before = deriveFinancePosition(state).totalOwned;
  assert.equal(canMarkDebtPaymentUnpaid(state, old), true);
  assert.equal(markDebtPaymentUnpaid(state, old.id, '2026-10-25'), true);
  const restored = deriveFinancePosition(state).totalOwned;
  assert.equal(restored - before, 2_203);
  assert.equal(state.debts[0].remaining, 50_000);
  assert.equal(debtPaymentDue(state, 'wasik'), 2_203);
  assert.equal(state.debtAccruals.length, 1);
  assert.equal(state.debtAccruals[0].paidAmount, 0);
  assert.equal(state.debtAccruals[0].status, 'outstanding');
  assert.equal(debtSummary(state.debts, state.debtPayments, '2026-10').paidThisMonth, 0);
  assert.equal(markDebtPaymentUnpaid(state, old.id, '2026-10-25'), false);
  const fresh = recordDebtPayment(state, { debtId: 'wasik', amount: 2_203, date: '2026-10-30' });
  assert.notEqual(fresh.id, old.id);
  assert.equal(old.reversedAt != null, true);
  assert.equal(debtPaymentDue(state, 'wasik'), 0);
  assert.equal(state.debts[0].remaining, 47_797);
  assert.equal(inspectFinanceIntegrity(state).some(item => item.type === 'debt-payment-due-exceeds-remaining'), false);
});

test('bank-imported debt payment cannot be marked unpaid', () => {
  const state = makeState();
  const transaction = { id: 'bank-payment', type: 'debt', targetId: 'wasik', amount: 1_000, source: 'bank', sourceType: 'bank_import' };
  state.transactions.push(transaction);
  state.debtPayments.push({ id: 'payment', debtId: 'wasik', amount: 1_000, date: '2026-10-01', transactionId: transaction.id });
  assert.equal(canMarkDebtPaymentUnpaid(state, transaction), false);
  assert.equal(markDebtPaymentUnpaid(state, transaction.id, '2026-10-25'), false);
});

test('unlinked legacy manual debt transaction can be corrected after choosing the debt', () => {
  const state = makeState();
  const transaction = { id: 'old-manual', type: 'debt', title: 'Repayment', amount: 2_203, date: '2026-10-05', allocationStatus: 'paid' };
  state.transactions.push(transaction);
  assert.equal(canMarkDebtPaymentUnpaid(state, transaction), true);
  assert.equal(markDebtPaymentUnpaid(state, transaction.id, '2026-10-25', 'wasik'), true);
  assert.equal(transaction.reversedAt !== undefined, true);
  assert.equal(state.debtPayments[0].debtId, 'wasik');
  assert.equal(debtPaymentDue(state, 'wasik'), 2_203);
  assert.equal(state.debts[0].remaining, 50_000);
});

test('only clearly unpaid legacy automatic allocations migrate; confirmed payments remain for user review', () => {
  const state = makeState();
  state.transactions.push(
    { id: 'pending', type: 'debt', targetId: 'wasik', amount: 2_203, date: '2026-10-05', allocationStatus: 'allocated', allocationRuleId: 'rule', sourceIncomeId: 'salary' },
    { id: 'confirmed', type: 'debt', targetId: 'wasik', amount: 2_203, date: '2026-10-06', allocationStatus: 'paid', allocationRuleId: 'rule', sourceIncomeId: 'salary-2' },
  );
  assert.equal(migrateLegacyDebtAllocations(state), 1);
  assert.equal(state.transactions.length, 1);
  assert.equal(state.transactions[0].id, 'confirmed');
  assert.equal(state.debtAccruals[0].sourceType, 'income_rule');
  assert.equal(debtPaymentDue(state, 'wasik'), 2_203);
  assert.equal(migrateLegacyDebtAllocations(state), 0);
});

test('editing income reconciles only its unpaid debt due', () => {
  const state = makeState();
  state.allocationRules = [{ id: 'rule', targetType: 'debt', targetId: 'wasik', mode: 'percent', value: 1_000, timing: 'income', active: true }];
  const income = { id: 'salary', type: 'income', amount: 100_000, date: '2026-10-05' };
  state.transactions.push(income);
  applyIncomeAllocations(state, income);
  income.amount = 50_000;
  reconcileIncomeAllocations(state, income, 'replace');
  assert.equal(debtPaymentDue(state, 'wasik'), 5_000);
  assert.equal(state.transactions.length, 1);
  assert.equal(state.debts[0].remaining, 50_000);
});
