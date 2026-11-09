import test from 'node:test';
import assert from 'node:assert/strict';
import { initialFinanceState, normalizeFinanceState } from './financeData.js';
import { financeSummary } from './financeMath.js';
import { deriveFinancePosition, inspectFinanceIntegrity } from './financeLedger.js';
import { expenseCategoryReport } from './financeReports.js';
import { createRefundState, editRefundState, linkExistingIncomeAsRefundState, remainingRefundable, reverseRefundState } from './refunds.js';

const setup = () => {
  const state = initialFinanceState();
  state.categories = [{ id: 'shopping', name: 'Shopping', type: 'expense' }];
  state.transactions = [
    { id: 'opening-income', type: 'income', amount: 100_000, date: '2026-11-01' },
    { id: 'purchase', type: 'expense', amount: 8_000, categoryId: 'shopping', title: 'Amazon', date: '2026-11-02' },
  ];
  return state;
};

test('cash refund, multiple partial refunds, remaining amount, net spend and category totals reconcile', () => {
  const state = setup();
  assert.equal(deriveFinancePosition(state).totalOwned, 92_000);
  const first = createRefundState(state, { originalTransactionId: 'purchase', amount: 2_000, date: '2026-11-04' });
  const second = createRefundState(state, { originalTransactionId: 'purchase', amount: 3_000, date: '2026-11-05' });
  assert.notEqual(first.id, second.id);
  assert.equal(remainingRefundable(state.transactions, state.transactions.find(item => item.id === 'purchase')), 3_000);
  assert.equal(deriveFinancePosition(state).totalOwned, 97_000);
  const summary = financeSummary(state, '2026-11');
  assert.equal(summary.income, 100_000);
  assert.equal(summary.grossExpenses, 8_000);
  assert.equal(summary.refunds, 5_000);
  assert.equal(summary.expenses, 3_000);
  const report = expenseCategoryReport(state, { mode: 'month', month: '2026-11' });
  assert.equal(report.total, 3_000);
  assert.equal(report.categories[0].amount, 3_000);
  assert.deepEqual(inspectFinanceIntegrity(state), []);
});

test('full refund is capped at the original amount and restores owned balance exactly once', () => {
  const state = setup();
  createRefundState(state, { originalTransactionId: 'purchase', amount: 8_000, date: '2026-11-03' });
  assert.equal(remainingRefundable(state.transactions, state.transactions.find(item => item.id === 'purchase')), 0);
  assert.equal(deriveFinancePosition(state).totalOwned, 100_000);
  assert.equal(financeSummary(state, '2026-11').expenses, 0);
  assert.throws(() => createRefundState(state, { originalTransactionId: 'purchase', amount: 1, date: '2026-11-04' }), /no refundable amount remaining/);
});

test('pending refunds do not affect owned money and reserve room; reversal restores refundable room', () => {
  const state = setup();
  const refund = createRefundState(state, { originalTransactionId: 'purchase', amount: 2_000, date: '2026-11-03', status: 'pending' });
  assert.equal(deriveFinancePosition(state).totalOwned, 92_000);
  assert.equal(remainingRefundable(state.transactions, state.transactions.find(item => item.id === 'purchase')), 6_000);
  reverseRefundState(state, refund.id, '2026-11-04');
  assert.equal(remainingRefundable(state.transactions, state.transactions.find(item => item.id === 'purchase')), 8_000);
  assert.equal(deriveFinancePosition(state).totalOwned, 92_000);
});

test('linking a pre-entered incoming transaction preserves its ID and balance movement', () => {
  const state = setup();
  state.transactions.push({ id: 'incoming-refund', type: 'income', amount: 3_000, title: 'Amazon return', date: '2026-11-08' });
  const before = deriveFinancePosition(state).totalOwned;
  const linked = linkExistingIncomeAsRefundState(state, { incomingTransactionId: 'incoming-refund', originalTransactionId: 'purchase' });
  assert.equal(linked.id, 'incoming-refund');
  assert.equal(linked.type, 'refund');
  assert.equal(deriveFinancePosition(state).totalOwned, before);
  assert.equal(financeSummary(state, '2026-11').income, 100_000);
  assert.equal(financeSummary(state, '2026-11').expenses, 5_000);
  assert.equal(remainingRefundable(state.transactions, state.transactions.find(item => item.id === 'purchase')), 5_000);
});

test('refund restores the original protected fund when the purchase came from it', () => {
  const state = setup();
  state.transactions = [
    { id: 'opening-income', type: 'income', amount: 50_000, date: '2026-11-01' },
    { id: 'fund', type: 'savings', amount: 20_000, date: '2026-11-01', targetId: 'reserve' },
    { id: 'purchase', type: 'expense', amount: 5_000, categoryId: 'shopping', title: 'Amazon', date: '2026-11-02', paidFromFundId: 'savings:reserve' },
  ];
  const before = deriveFinancePosition(state);
  createRefundState(state, { originalTransactionId: 'purchase', amount: 2_000, date: '2026-11-03' });
  const after = deriveFinancePosition(state);
  assert.equal(after.totalOwned, before.totalOwned + 2_000);
  assert.equal(after.funds['savings:reserve'], before.funds['savings:reserve'] + 2_000);
});

test('reversing a received refund restores the account balance and gross net reporting', () => {
  const state = setup();
  const refund = createRefundState(state, { originalTransactionId: 'purchase', amount: 2_500, date: '2026-11-03' });
  assert.equal(deriveFinancePosition(state).totalOwned, 94_500);
  reverseRefundState(state, refund.id, '2026-11-04');
  assert.equal(deriveFinancePosition(state).totalOwned, 92_000);
  assert.equal(remainingRefundable(state.transactions, state.transactions.find(item => item.id === 'purchase')), 8_000);
  assert.equal(financeSummary(state, '2026-11').expenses, 8_000);
});

test('refund relationships and status survive backup-shaped JSON restore normalization', () => {
  const state = setup();
  createRefundState(state, { originalTransactionId: 'purchase', amount: 1_500, date: '2026-11-03', status: 'pending' });
  const restored = normalizeFinanceState(JSON.parse(JSON.stringify(state)));
  const refund = restored.transactions.find(item => item.type === 'refund');
  assert.equal(refund.originalTransactionId, 'purchase');
  assert.equal(refund.refundStatus, 'pending');
  assert.equal(refund.refundDestination, '');
  assert.equal(remainingRefundable(restored.transactions, restored.transactions.find(item => item.id === 'purchase')), 6_500);
});
test('editing a refund updates the same event and prevents refunds above the remaining amount', () => {
  const state = setup();
  const refund = createRefundState(state, { originalTransactionId: 'purchase', amount: 2_000, date: '2026-11-03' });
  const edited = editRefundState(state, { refundId: refund.id, amount: 4_000, date: '2026-11-04', status: 'pending', note: 'Merchant processing' });
  assert.equal(edited.id, refund.id);
  assert.equal(edited.amount, 4_000);
  assert.equal(edited.refundStatus, 'pending');
  assert.equal(deriveFinancePosition(state).totalOwned, 92_000);
  assert.equal(remainingRefundable(state.transactions, state.transactions.find(item => item.id === 'purchase')), 4_000);
  assert.throws(() => editRefundState(state, { refundId: refund.id, amount: 8_001, date: '2026-11-05' }), /exceeds the remaining/);
});

test('credit purchase deposit refunds return owned money without rewriting the agreement', () => {
  const state = normalizeFinanceState({
    creditAgreements: [{ id: 'bnpl-1', title: 'Sofa', cashPrice: 60000, financedAmount: 50000, financeCharge: 0, status: 'active' }],
    transactions: [{ id: 'deposit', type: 'expense', amount: 10000, date: '2026-01-01', creditAgreementId: 'bnpl-1', creditPaymentKind: 'deposit', categoryId: 'default-10' }],
  });
  const agreementBefore = structuredClone(state.creditAgreements[0]);
  createRefundState(state, { originalTransactionId: 'deposit', amount: 2500, date: '2026-01-02' });
  assert.equal(deriveFinancePosition(state, { openingBalance: 10000 }).totalOwned, 2500);
  assert.equal(financeSummary(state, null).expenses, 7500);
  assert.deepEqual(state.creditAgreements[0], agreementBefore);
});
