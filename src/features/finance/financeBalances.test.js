import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceViewValue, buildFinanceTimeline, calculateFinanceBalances, transactionCashEffect } from './financeBalances.js';

const tx = (id, type, amount, date, extra = {}) => ({ id, type, amount, date, ...extra });
const state = (transactions = [], values = {}) => ({ transactions, goals: [], goalContributions: [], investments: [], debts: [], debtPayments: [], ...values });

test('allocations reserve money without reducing actual cash; component selection adds reserves back', () => {
  const balances = calculateFinanceBalances(state([
    tx('salary', 'income', 100_000, '2026-09-01'),
    tx('save', 'savings', 20_000, '2026-09-01', { allocationStatus: 'allocated' }),
    tx('goal', 'goal', 10_000, '2026-09-01', { allocationStatus: 'allocated' }),
    tx('gift', 'donation', 5_000, '2026-09-01', { allocationStatus: 'allocated' }),
    tx('debt', 'debt', 10_000, '2026-09-01', { allocationStatus: 'allocated' }),
  ]));
  assert.equal(balances.actualCash, 100_000);
  assert.equal(balances.reservedTotal, 45_000);
  assert.equal(balances.availableCash, 55_000);
  assert.equal(balanceViewValue(balances, 'available', new Set(['savings'])), 75_000);
  assert.equal(balanceViewValue(balances, 'available', new Set(['savings', 'goal', 'donation', 'debt'])), 100_000);
});

test('paid donation releases its reserve and decreases cash exactly once', () => {
  const balances = calculateFinanceBalances(state([
    tx('salary', 'income', 100_000, '2026-09-01'),
    tx('gift', 'donation', 5_000, '2026-09-01', { allocationStatus: 'paid', allocatedOn: '2026-09-01', paymentDate: '2026-09-10' }),
  ]));
  assert.equal(balances.actualCash, 95_000);
  assert.equal(balances.reserved.donation, 0);
  assert.equal(balances.availableCash, 95_000);
  const timeline = balances.timeline.filter(point => point.transaction?.id === 'gift');
  assert.deepEqual(timeline.map(point => point.eventKind), ['reserve', 'payment']);
  assert.equal(timeline[0].actualCash, 100_000);
  assert.equal(timeline[1].actualCash, 95_000);
});

test('unpaid debt does not reduce overall owned; a recorded payment reduces cash once', () => {
  const balances = calculateFinanceBalances(state([
    tx('salary', 'income', 100_000, '2026-09-01'),
    tx('repay', 'debt', 10_000, '2026-09-10', { allocationStatus: 'paid', allocatedOn: '2026-09-02', paymentDate: '2026-09-10' }),
  ], { debts: [{ id: 'loan', original: 50_000, remaining: 40_000, startedOn: '2026-08-01' }], debtPayments: [{ id: 'p1', debtId: 'loan', amount: 10_000, date: '2026-09-10' }] }));
  assert.equal(balances.actualCash, 90_000);
  assert.equal(balances.overallOwned, 90_000);
});

test('tracked-account transfers preserve total cash; external transfers change it explicitly', () => {
  assert.equal(transactionCashEffect(tx('internal', 'transfer', 20_000, '2026-09-02', { transferKind: 'internal' })), 0);
  assert.equal(transactionCashEffect(tx('external-out', 'transfer', 20_000, '2026-09-02', { transferKind: 'external-out' })), -20_000);
  assert.equal(transactionCashEffect(tx('external-in', 'transfer', 20_000, '2026-09-02', { transferKind: 'external-in' })), 20_000);
});

test('a confirmed investment transfer reduces bank cash and adds the tracked asset back to owned money', () => {
  const balances = calculateFinanceBalances(state([
    tx('salary', 'income', 100_000, '2026-09-01'),
    tx('invest', 'investment', 20_000, '2026-09-05', { allocationStatus: 'transferred', allocatedOn: '2026-09-02', paymentDate: '2026-09-05', targetId: 'isa' }),
  ], { investments: [{ id: 'isa', contributed: 20_000, currentValue: 20_000, date: '2026-09-05' }] }));
  assert.equal(balances.actualCash, 100_000);
  assert.equal(balances.overallOwned, 100_000);
  assert.equal(balances.availableCash, 80_000);
});

test('unlinked goal side-ledger entries do not change transaction-derived balances', () => {
  const result = buildFinanceTimeline(state([tx('salary', 'income', 100_000, '2026-09-01')], {
    goalContributions: [
      { id: 'g1', goalId: 'holiday', amount: 20_000, kind: 'contribution', date: '2026-09-02' },
      { id: 'g2', goalId: 'holiday', amount: 5_000, kind: 'withdrawal', date: '2026-09-03' },
    ],
  }), null, 0);
  assert.equal(result.at(-1).actualCash, 100_000);
  assert.equal(result.at(-1).availableCash, 100_000);
});

test('goal spending lowers cash and releases the matching reserve once', () => {
  const result = buildFinanceTimeline(state([
    tx('salary', 'income', 100_000, '2026-09-01'),
    tx('fund', 'goal', 20_000, '2026-09-02', { targetId: 'holiday' }),
    tx('hotel', 'expense', 5_000, '2026-09-03', { goalId: 'holiday', paidFromFundId: 'goal:holiday', goalMovement: 'spend' }),
  ], {
    goalContributions: [
      { id: 'fund', goalId: 'holiday', amount: 20_000, kind: 'contribution', date: '2026-09-02' },
      { id: 'spend', goalId: 'holiday', amount: 5_000, kind: 'spending', date: '2026-09-03', transactionId: 'hotel' },
    ],
  }), null, 0);
  assert.equal(result.at(-1).actualCash, 95_000);
  assert.equal(result.at(-1).reserved.goal, 15_000);
  assert.equal(result.at(-1).availableCash, 80_000);
});

test('historical snapshots are not projected backward onto dates before the snapshot', () => {
  const result = buildFinanceTimeline(state([
    tx('salary', 'income', 100_000, '2026-09-01'),
    tx('shop', 'expense', 5_000, '2026-09-12'),
  ], { investments: [{ id: 'isa', currentValue: 30_000, date: '2026-09-10' }] }), null, 0);
  assert.equal(result[1].overallOwned, 100_000);
  assert.equal(result[2].overallOwned, 125_000);
});

test('monthly timeline carries prior funds and uses one opening balance', () => {
  const result = buildFinanceTimeline(state([
    tx('income', 'income', 100_000, '2026-08-01'),
    tx('reserve', 'savings', 20_000, '2026-08-02', { allocationStatus: 'allocated' }),
    tx('expense', 'expense', 5_000, '2026-09-03'),
  ]), '2026-09', 0);
  assert.equal(result[0].actualCash, 100_000);
  assert.equal(result[0].reservedTotal, 20_000);
  assert.equal(result.at(-1).actualCash, 95_000);
  assert.equal(result.at(-1).availableCash, 75_000);
});

test('cancelled and planned records do not change cash or reserve values', () => {
  const balances = calculateFinanceBalances(state([
    tx('salary', 'income', 100_000, '2026-09-01'),
    tx('plan', 'expense', 10_000, '2026-09-02', { allocationStatus: 'planned' }),
    tx('cancel', 'donation', 5_000, '2026-09-03', { allocationStatus: 'cancelled' }),
  ]));
  assert.equal(balances.actualCash, 100_000);
  assert.equal(balances.reservedTotal, 0);
});
