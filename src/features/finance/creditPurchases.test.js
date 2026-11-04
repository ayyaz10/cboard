import test from 'node:test';
import assert from 'node:assert/strict';
import { initialFinanceState, normalizeFinanceState } from './financeData.js';
import { deriveFinancePosition } from './financeLedger.js';
import { financeSummary } from './financeMath.js';
import {
  cancelCreditAgreement, createCreditAgreement, generateCreditSchedule, getCreditAgreementBalances, getCreditAgreementStatus,
  getCreditDueSoon, getCreditInstalmentAmounts, getOverdueCreditPayments, recordCreditPayment,
  settleCreditAgreement, updateCreditAgreement,
} from './creditPurchases.js';

const agreementInput = overrides => ({
  id: 'phone', title: 'Phone', merchant: 'Example Store', purchaseDate: '2026-01-15',
  depositDate: '2026-01-15', cashPrice: 120_000, deposit: 20_000,
  financedAmount: 100_000, financeCharge: 0, categoryId: 'shopping',
  interestMode: 'zero', term: 3, frequency: 'monthly', customDays: 30,
  firstPaymentDate: '2026-02-15', ...overrides,
});

function makeAgreement(overrides = {}) {
  const state = initialFinanceState();
  state.transactions.push({ id: 'salary', type: 'income', amount: 200_000, date: '2026-01-01', title: 'Pay' });
  const agreement = createCreditAgreement(state, agreementInput(overrides), { transactionId: 'deposit', dateCreated: '2026-01-15' });
  return { state, agreement };
}

test('monthly schedule splits cents exactly and clamps end-of-month dates', () => {
  const schedule = generateCreditSchedule({ agreementId: 'x', principalAmount: 100, financeCharge: 2, term: 3, firstPaymentDate: '2026-01-31' });
  assert.deepEqual(schedule.map(item => item.amount), [34, 34, 34]);
  assert.deepEqual(schedule.map(item => item.principalAmount), [34, 33, 33]);
  assert.deepEqual(schedule.map(item => item.dueDate), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.equal(schedule.reduce((sum, item) => sum + item.financeCostAmount, 0), 2);
});

test('invalid calendar dates and invalid payment terms are rejected', () => {
  assert.throws(() => generateCreditSchedule({ agreementId: 'x', principalAmount: 100, term: 1, firstPaymentDate: '2026-02-30' }));
  assert.throws(() => generateCreditSchedule({ agreementId: 'x', principalAmount: 100, term: 0, firstPaymentDate: '2026-02-28' }));
  assert.throws(() => generateCreditSchedule({ agreementId: 'x', principalAmount: 100, term: 1, frequency: 'custom', customDays: 0, firstPaymentDate: '2026-02-28' }));
});

test('creating an agreement records only the real deposit as cash outflow', () => {
  const { state, agreement } = makeAgreement();
  const position = deriveFinancePosition(state);
  assert.equal(agreement.financedAmount, 100_000);
  assert.equal(position.totalOwned, 180_000);
  assert.equal(state.transactions.filter(item => item.type === 'expense').length, 1);
  assert.equal(state.transactions.find(item => item.id === 'deposit').amount, 20_000);
  assert.equal(getCreditAgreementBalances(state, agreement).totalRemaining, 100_000);
});

test('product links are normalized, optional, and restricted to safe web URLs', () => {
  const { agreement } = makeAgreement({ productUrl: ' https://shop.example/products/phone ' });
  assert.equal(agreement.productUrl, 'https://shop.example/products/phone');
  assert.equal(makeAgreement().agreement.productUrl, '');
  assert.throws(() => makeAgreement({ productUrl: 'javascript:alert(1)' }), /HTTP or HTTPS/);
  assert.throws(() => makeAgreement({ productUrl: 'https://user:pass@shop.example/product' }), /sign-in credentials/);
  assert.throws(() => makeAgreement({ productUrl: `https://shop.example/${'a'.repeat(2048)}` }), /2,048 characters/);
});

test('the requested £1,200 purchase creates only a £200 cash outflow and ten £100 dues', () => {
  const { state, agreement } = makeAgreement({ cashPrice: 120_000, deposit: 20_000, financedAmount: 100_000, term: 10 });
  assert.equal(deriveFinancePosition(state).totalOwned, 180_000);
  assert.equal(agreement.totalRepayable, 100_000);
  assert.deepEqual(agreement.schedule.map(item => item.amount), Array(10).fill(10_000));
  assert.equal(getCreditAgreementBalances(state, agreement).totalRemaining, 100_000);
});

test('0% and fixed-fee schedules reconcile to financed principal plus fixed fee', () => {
  const { agreement } = makeAgreement({ financeCharge: 1_001, interestMode: 'fixed_fee' });
  assert.equal(agreement.totalRepayable, 101_001);
  assert.equal(agreement.schedule.reduce((sum, item) => sum + item.amount, 0), 101_001);
  assert.equal(agreement.schedule.reduce((sum, item) => sum + item.principalAmount, 0), 100_000);
  assert.equal(agreement.schedule.reduce((sum, item) => sum + item.financeCostAmount, 0), 1_001);
});

test('scheduled partial payments change cash once and keep principal and fees separate', () => {
  const { state, agreement } = makeAgreement({ financeCharge: 1_000, interestMode: 'fixed_fee' });
  const first = agreement.schedule[0];
  const due = getCreditInstalmentAmounts(state, agreement, first);
  const before = deriveFinancePosition(state).totalOwned;
  const payment = recordCreditPayment(state, { agreementId: agreement.id, amount: 10_000, date: first.dueDate, instalmentId: first.id, paymentId: 'p1', transactionId: 't1' });
  assert.equal(payment.creditPrincipalAmount + payment.creditFinanceCostAmount, 10_000);
  assert.equal(getCreditInstalmentAmounts(state, agreement, first).remaining, due.remaining - 10_000);
  assert.equal(deriveFinancePosition(state).totalOwned, before - 10_000);
  assert.equal(financeSummary(state, '2026-02').expenses, 0);
  assert.equal(financeSummary(state, '2026-02').creditPayments, 10_000);
  assert.equal(recordCreditPayment(state, { agreementId: agreement.id, amount: 10_000, date: first.dueDate, instalmentId: first.id, paymentId: 'p1', transactionId: 'other' }).id, 't1');
  assert.equal(state.transactions.filter(item => item.type === 'creditPayment').length, 1);
});

test('a partial payment leaves the unpaid balance due and records only cash paid', () => {
  const { state, agreement } = makeAgreement({ cashPrice: 30_000, deposit: 0, financedAmount: 30_000, term: 3 });
  const due = agreement.schedule[0];
  const before = deriveFinancePosition(state).totalOwned;
  recordCreditPayment(state, { agreementId: agreement.id, amount: 6_000, date: due.dueDate, instalmentId: due.id, paymentId: 'partial', transactionId: 'partial-tx' });
  assert.equal(getCreditInstalmentAmounts(state, agreement, due).remaining, 4_000);
  assert.equal(deriveFinancePosition(state).totalOwned, before - 6_000);
});

test('extra principal reduces liability and reschedules future principal without reducing fees', () => {
  const { state, agreement } = makeAgreement({ financeCharge: 900, interestMode: 'fixed_fee' });
  const futureFees = agreement.schedule.map(item => item.financeCostAmount);
  const extra = recordCreditPayment(state, { agreementId: agreement.id, amount: 10_000, date: '2026-01-20', paymentId: 'extra', transactionId: 'extra-tx' });
  assert.equal(extra.creditPrincipalAmount, 10_000);
  assert.equal(extra.creditFinanceCostAmount, 0);
  assert.equal(getCreditAgreementBalances(state, agreement).principalRemaining, 90_000);
  assert.deepEqual(agreement.schedule.map(item => item.financeCostAmount), futureFees);
});

test('due and overdue schedule items are informational and do not affect the ledger', () => {
  const { state, agreement } = makeAgreement();
  const before = deriveFinancePosition(state);
  assert.equal(getOverdueCreditPayments(state, '2026-02-16').length, 1);
  assert.equal(getCreditDueSoon(state, '2026-02-10').length, 1);
  assert.deepEqual(deriveFinancePosition(state), before);
  assert.equal(getCreditAgreementStatus(state, agreement), 'active');
});

test('early settlement records one actual payment and supersedes unpaid instalments', () => {
  const { state, agreement } = makeAgreement();
  const before = deriveFinancePosition(state).totalOwned;
  const txn = settleCreditAgreement(state, { agreementId: agreement.id, settlementAmount: 97_000, settlementFee: 500, date: '2026-02-01', paymentId: 'settle', transactionId: 'settle-tx' });
  assert.equal(txn.amount, 97_500);
  assert.equal(deriveFinancePosition(state).totalOwned, before - 97_500);
  assert.equal(getCreditAgreementStatus(state, agreement), 'settled_early');
  assert.ok(agreement.schedule.every(item => item.supersededAt));
  assert.equal(settleCreditAgreement(state, { agreementId: agreement.id, settlementAmount: 97_000, settlementFee: 500, date: '2026-02-01', paymentId: 'settle', transactionId: 'duplicate' }).id, 'settle-tx');
});

test('editing terms preserves paid and past rows while replacing only future rows', () => {
  const { state, agreement } = makeAgreement({ firstPaymentDate: '2026-01-15' });
  const first = agreement.schedule[0];
  recordCreditPayment(state, { agreementId: agreement.id, amount: first.amount, date: first.dueDate, instalmentId: first.id, paymentId: 'paid-1', transactionId: 'payment-1' });
  const originalId = first.id;
  updateCreditAgreement(state, agreement.id, { title: 'Phone updated', financeCharge: 0, term: 2, frequency: 'monthly', firstPaymentDate: '2026-02-15' }, '2026-01-20');
  assert.equal(agreement.schedule[0].id, originalId);
  assert.equal(getCreditInstalmentAmounts(state, agreement, first).remaining, 0);
  assert.equal(agreement.title, 'Phone updated');
  assert.equal(agreement.schedule.filter(item => !item.supersededAt).length, 3);
});

test('editing an agreement can update or remove its product link', () => {
  const { state, agreement } = makeAgreement({ productUrl: 'https://shop.example/old' });
  const changes = { title: agreement.title, financeCharge: 0, term: 3, firstPaymentDate: '2026-02-15' };
  updateCreditAgreement(state, agreement.id, { ...changes, productUrl: 'https://shop.example/new' }, '2026-01-20');
  assert.equal(agreement.productUrl, 'https://shop.example/new');
  updateCreditAgreement(state, agreement.id, { ...changes, productUrl: '' }, '2026-01-20');
  assert.equal(agreement.productUrl, '');
});

test('future schedule can preserve finance fees after principal is paid early', () => {
  const { state, agreement } = makeAgreement({ financeCharge: 900, interestMode: 'fixed_fee' });
  recordCreditPayment(state, { agreementId: agreement.id, amount: 100_000, date: '2026-01-20', paymentId: 'principal', transactionId: 'principal-tx' });
  updateCreditAgreement(state, agreement.id, { title: agreement.title, financeCharge: 900, term: 2, firstPaymentDate: '2026-02-15' }, '2026-01-21');
  assert.equal(agreement.schedule.filter(item => !item.supersededAt).reduce((sum, item) => sum + item.principalAmount, 0), 0);
  assert.equal(agreement.schedule.filter(item => !item.supersededAt).reduce((sum, item) => sum + item.financeCostAmount, 0), 900);
});

test('unused agreements can be cancelled without deleting deposits or schedule history', () => {
  const { state, agreement } = makeAgreement();
  cancelCreditAgreement(state, agreement.id, '2026-01-20');
  assert.equal(getCreditAgreementStatus(state, agreement), 'cancelled');
  assert.equal(state.transactions.find(item => item.id === 'deposit').amount, 20_000);
  assert.equal(agreement.schedule.every(item => item.supersededAt === '2026-01-20'), true);
  assert.throws(() => cancelCreditAgreement(state, agreement.id, '2026-01-20'));
});

test('legacy Finance state normalizes with an empty credit agreement collection', () => {
  const legacy = initialFinanceState();
  delete legacy.creditAgreements;
  assert.deepEqual(normalizeFinanceState(legacy).creditAgreements, []);
});
