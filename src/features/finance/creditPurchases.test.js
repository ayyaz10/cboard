import test from 'node:test';
import assert from 'node:assert/strict';
import { initialFinanceState, normalizeFinanceState } from './financeData.js';
import { deriveFinancePosition } from './financeLedger.js';
import { financeSummary } from './financeMath.js';
import {
  archiveCreditAgreement, cancelCreditAgreement, createCreditAgreement, deleteUnusedCreditAgreement, generateCreditSchedule, getCreditAgreementBalances, getCreditAgreementStatus,
  getCreditDueSoon, getCreditInstalmentAmounts, getMonthlyCreditCommitment, getOverdueCreditPayments, recordCreditPayment,
  calculateRemainingBalance, calculateRemainingInstallmentCount, generateCustomCreditSchedule, mutateCreditState, restoreCreditAgreement, reverseCreditPayment, settleCreditAgreement, updateCreditAgreement, updateCreditInstalment, updateCreditPayment, validateCustomSchedule,
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

test('credit mutation adapter returns the updated Finance state when operation returns an entity', () => {
  const state = initialFinanceState();
  const returned = mutateCreditState(state, next => createCreditAgreement(next, agreementInput({ deposit: 0, financedAmount: 120_000 })));
  assert.equal(returned, state);
  assert.equal(returned.creditAgreements.length, 1);
  assert.ok(Array.isArray(returned.transactions));
});

test('monthly schedule splits cents exactly and clamps end-of-month dates', () => {
  const schedule = generateCreditSchedule({ agreementId: 'x', principalAmount: 100, financeCharge: 2, term: 3, firstPaymentDate: '2026-01-31' });
  assert.deepEqual(schedule.map(item => item.amount), [34, 34, 34]);
  assert.deepEqual(schedule.map(item => item.principalAmount), [34, 33, 33]);
  assert.deepEqual(schedule.map(item => item.dueDate), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.equal(schedule.reduce((sum, item) => sum + item.financeCostAmount, 0), 2);
  const remainderSchedule = generateCreditSchedule({ agreementId: 'remainder', principalAmount: 100, term: 3, firstPaymentDate: '2026-02-15' });
  assert.deepEqual(remainderSchedule.map(item => item.amount), [34, 33, 33]);
  assert.equal(remainderSchedule.reduce((sum, item) => sum + item.amount, 0), 100);
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

test('upfront amount counted as payment one reduces future payment count and does not create a duplicate transaction', () => {
  const state = initialFinanceState();
  const agreement = createCreditAgreement(state, agreementInput({
    id: 'philips', title: 'Philips Series 9000 Trimmer MG9561/30', purchaseDate: '2026-10-25', depositDate: '2026-10-25',
    cashPrice: 10_350, deposit: 4_500, financedAmount: 5_850, term: 3, firstPaymentDate: '2026-11-25', upfrontCountsAsFirstInstalment: true,
  }), { transactionId: 'philips-upfront', dateCreated: '2026-10-25' });
  assert.equal(agreement.totalRepayable, 10_350);
  assert.equal(agreement.schedule.length, 3);
  assert.deepEqual(agreement.schedule.map(item => item.amount), [4_500, 2_925, 2_925]);
  assert.equal(getCreditInstalmentAmounts(state, agreement, agreement.schedule[0]).paid, 4_500);
  assert.equal(getCreditAgreementBalances(state, agreement).paidTotal, 4_500);
  assert.equal(getCreditAgreementBalances(state, agreement).totalRemaining, 5_850);
  assert.equal(state.transactions.filter(item => item.creditAgreementId === agreement.id).length, 1);
  assert.equal(calculateRemainingInstallmentCount(3, 1), 2);
  assert.equal(calculateRemainingBalance(10_350, 4_500), 5_850);
  assert.equal(getMonthlyCreditCommitment(state, '2026-11-01'), 2_925);
});

test('an existing deposit plan can explicitly convert to an upfront first instalment without duplicating cash', () => {
  const { state, agreement } = makeAgreement({
    cashPrice: 10_350, deposit: 4_500, financedAmount: 5_850, term: 3, purchaseDate: '2026-10-25', depositDate: '2026-10-25', firstPaymentDate: '2026-11-25',
  });
  const before = deriveFinancePosition(state).totalOwned;
  updateCreditAgreement(state, agreement.id, { upfrontCountsAsFirstInstalment: true, term: 3, scheduleMode: 'auto', firstPaymentDate: '2026-11-25' }, '2026-10-25');
  assert.deepEqual(agreement.schedule.map(item => item.amount), [4_500, 2_925, 2_925]);
  assert.equal(agreement.schedule[0].upfrontTransactionId, 'deposit');
  assert.equal(getCreditInstalmentAmounts(state, agreement, agreement.schedule[0]).paid, 4_500);
  assert.equal(getCreditAgreementBalances(state, agreement).paidTotal, 4_500);
  assert.equal(getCreditAgreementBalances(state, agreement).totalRemaining, 5_850);
  assert.equal(deriveFinancePosition(state).totalOwned, before);
  assert.equal(state.transactions.filter(item => item.creditAgreementId === agreement.id).length, 1);
});

test('correcting a counted upfront amount updates its paid schedule row and reconciles the remainder', () => {
  const { state, agreement } = makeAgreement({
    cashPrice: 10_350, deposit: 4_500, financedAmount: 5_850, term: 3, purchaseDate: '2026-10-25', depositDate: '2026-10-25', firstPaymentDate: '2026-11-25',
    upfrontCountsAsFirstInstalment: true,
  });
  updateCreditAgreement(state, agreement.id, { cashPrice: 10_350, deposit: 4_000, upfrontCountsAsFirstInstalment: true, term: 3, scheduleMode: 'auto', firstPaymentDate: '2026-11-25' }, '2026-10-25');
  assert.deepEqual(agreement.schedule.map(item => item.amount), [4_000, 3_175, 3_175]);
  assert.equal(agreement.schedule.reduce((sum, item) => sum + item.amount, 0), agreement.totalRepayable);
  assert.equal(getCreditAgreementBalances(state, agreement).paidTotal, 4_000);
  assert.equal(getCreditAgreementBalances(state, agreement).totalRemaining, 6_350);
});

test('a reversed counted upfront transaction reopens its schedule amount and liability', () => {
  const { state, agreement } = makeAgreement({
    cashPrice: 10_350, deposit: 4_500, financedAmount: 5_850, term: 3, purchaseDate: '2026-10-25', depositDate: '2026-10-25', firstPaymentDate: '2026-11-25',
    upfrontCountsAsFirstInstalment: true,
  });
  const deposit = state.transactions.find(item => item.creditPaymentKind === 'deposit');
  deposit.reversedAt = new Date().toISOString();
  deposit.reversalDate = '2026-10-26';
  assert.equal(getCreditAgreementBalances(state, agreement).paidTotal, 0);
  assert.equal(getCreditAgreementBalances(state, agreement).totalRemaining, 10_350);
  assert.equal(getCreditInstalmentAmounts(state, agreement, agreement.schedule[0]).remaining, 4_500);
});

test('a true deposit stays outside the repayment term', () => {
  const { state, agreement } = makeAgreement({ cashPrice: 120_000, deposit: 20_000, financedAmount: 100_000, term: 10, firstPaymentDate: '2026-02-15' });
  assert.equal(agreement.upfrontCountsAsFirstInstalment, false);
  assert.equal(agreement.totalRepayable, 100_000);
  assert.equal(agreement.schedule.length, 10);
  assert.ok(agreement.schedule.every(item => item.amount === 10_000));
  assert.equal(getCreditAgreementBalances(state, agreement).paidTotal, 0);
  assert.equal(getCreditAgreementBalances(state, agreement).totalRemaining, 100_000);
});

test('counted upfront payment works with a fixed finance charge and reconciles gross plan totals', () => {
  const state = initialFinanceState();
  const agreement = createCreditAgreement(state, agreementInput({
    id: 'fee-upfront', cashPrice: 100_000, deposit: 20_000, financedAmount: 80_000, financeCharge: 12_000,
    term: 10, firstPaymentDate: '2026-02-15', upfrontCountsAsFirstInstalment: true,
  }), { transactionId: 'fee-deposit', dateCreated: '2026-01-15' });
  assert.equal(agreement.totalRepayable, 112_000);
  assert.equal(agreement.schedule.length, 10);
  assert.equal(agreement.schedule.reduce((sum, item) => sum + item.amount, 0), 112_000);
  assert.equal(getCreditAgreementBalances(state, agreement).totalRemaining, 92_000);
  assert.equal(getCreditAgreementBalances(state, agreement).paidTotal, 20_000);
});

test('custom schedules preserve user amounts and reconcile exactly', () => {
  const rows = [
    { dueDate: '2026-10-25', amount: 4_500 },
    { dueDate: '2026-11-25', amount: 3_000 },
    { dueDate: '2026-12-25', amount: 2_850 },
  ];
  const schedule = generateCustomCreditSchedule({ agreementId: 'custom', principalAmount: 10_350, rows });
  assert.deepEqual(schedule.map(item => item.amount), [4_500, 3_000, 2_850]);
  assert.deepEqual(validateCustomSchedule({ principalAmount: 10_350, rows }), { scheduled: 10_350, remaining: 0 });
  assert.throws(() => validateCustomSchedule({ principalAmount: 10_350, rows: rows.slice(0, 2) }), /must total/);
  assert.throws(() => validateCustomSchedule({ principalAmount: 10_350, rows: [...rows, { dueDate: '2026-12-30', amount: 1 }] }), /must total/);
});

test('an existing auto agreement can switch to an exact custom schedule and back', () => {
  const { state, agreement } = makeAgreement({ deposit: 0, cashPrice: 10_350, financedAmount: 10_350, term: 3, firstPaymentDate: '2026-02-15' });
  const customSchedule = [
    { dueDate: '2026-02-15', amount: 4_500 },
    { dueDate: '2026-03-15', amount: 3_000 },
    { dueDate: '2026-04-15', amount: 2_850 },
  ];
  updateCreditAgreement(state, agreement.id, { scheduleMode: 'custom', customSchedule, term: 3, firstPaymentDate: '2026-02-15' }, '2026-01-20');
  assert.equal(agreement.scheduleMode, 'custom');
  assert.deepEqual(agreement.schedule.map(item => item.amount), [4_500, 3_000, 2_850]);
  updateCreditAgreement(state, agreement.id, { scheduleMode: 'auto', term: 3, firstPaymentDate: '2026-02-15' }, '2026-01-20');
  assert.equal(agreement.scheduleMode, 'auto');
  assert.deepEqual(agreement.schedule.map(item => item.amount), [3_450, 3_450, 3_450]);
  assert.equal(agreement.schedule.reduce((sum, item) => sum + item.amount, 0), 10_350);
});

test('custom upfront plan links its paid first row and leaves future custom amounts unchanged', () => {
  const state = initialFinanceState();
  const agreement = createCreditAgreement(state, agreementInput({
    id: 'custom-upfront', cashPrice: 10_350, deposit: 4_500, financedAmount: 5_850, term: 3,
    upfrontCountsAsFirstInstalment: true, scheduleMode: 'custom', firstPaymentDate: '2026-11-25',
    customSchedule: [{ dueDate: '2026-11-25', amount: 3_000 }, { dueDate: '2026-12-25', amount: 2_850 }],
  }), { transactionId: 'custom-deposit', dateCreated: '2026-10-25' });
  assert.deepEqual(agreement.schedule.map(item => item.amount), [4_500, 3_000, 2_850]);
  assert.equal(getCreditInstalmentAmounts(state, agreement, agreement.schedule[0]).paid, 4_500);
  assert.equal(agreement.schedule.reduce((sum, item) => sum + item.amount, 0), agreement.totalRepayable);
  assert.equal(getMonthlyCreditCommitment(state, '2026-11-01'), 3_000);
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
  updateCreditAgreement(state, agreement.id, { title: 'Phone updated', financeCharge: 0, term: 3, frequency: 'monthly', firstPaymentDate: '2026-02-15' }, '2026-01-20');
  assert.equal(agreement.schedule[0].id, originalId);
  assert.equal(getCreditInstalmentAmounts(state, agreement, first).remaining, 0);
  assert.equal(agreement.title, 'Phone updated');
  assert.equal(agreement.schedule.filter(item => !item.supersededAt).length, 3);
});

test('metadata-only agreement edits preserve the schedule and its IDs', () => {
  const { state, agreement } = makeAgreement({ deposit: 0, financedAmount: 120_000 });
  const original = structuredClone(agreement.schedule);
  updateCreditAgreement(state, agreement.id, { title: 'MacBook Air', merchant: 'Correct Store', notes: 'Corrected metadata' }, '2026-01-20');
  assert.equal(agreement.title, 'MacBook Air');
  assert.deepEqual(agreement.schedule, original);
});

test('a future instalment edit changes date and amount while keeping the remaining schedule reconciled', () => {
  const { state, agreement } = makeAgreement({ deposit: 0, cashPrice: 30_000, financedAmount: 30_000, term: 3 });
  const target = agreement.schedule[0];
  updateCreditInstalment(state, agreement.id, target.id, { dueDate: '2026-02-20', amount: 12_000 }, '2026-01-20');
  assert.equal(target.dueDate, '2026-02-20');
  assert.equal(target.amount, 12_000);
  assert.deepEqual(agreement.schedule.map(item => item.amount), [12_000, 9_000, 9_000]);
  assert.equal(agreement.schedule.reduce((sum, item) => sum + item.amount, 0), getCreditAgreementBalances(state, agreement).totalRemaining);
  assert.equal(agreement.scheduleMode, 'custom');
});

test('a scheduled credit payment can be corrected in place without changing its Finance transaction ID', () => {
  const { state, agreement } = makeAgreement({ deposit: 0, cashPrice: 30_000, financedAmount: 30_000, term: 3 });
  const instalment = agreement.schedule[0];
  const before = deriveFinancePosition(state).totalOwned;
  const payment = recordCreditPayment(state, { agreementId: agreement.id, amount: 10_000, date: instalment.dueDate, instalmentId: instalment.id, paymentId: 'correctable', transactionId: 'stable-tx' });
  updateCreditPayment(state, payment.id, { amount: 8_000, date: '2026-02-16', paidFromFundId: 'savings', note: 'Corrected receipt' });
  assert.equal(payment.id, 'stable-tx');
  assert.equal(payment.amount, 8_000);
  assert.equal(payment.date, '2026-02-16');
  assert.equal(payment.note, 'Corrected receipt');
  assert.equal(getCreditAgreementBalances(state, agreement).totalRemaining, 22_000);
  assert.equal(deriveFinancePosition(state).totalOwned, before - 8_000);
  assert.equal(state.transactions.filter(item => item.creditPaymentId === 'correctable').length, 1);
});

test('reversing a manual payment restores the balance and leaves its transaction as audit history', () => {
  const { state, agreement } = makeAgreement({ deposit: 0, cashPrice: 30_000, financedAmount: 30_000, term: 3 });
  const instalment = agreement.schedule[0];
  const payment = recordCreditPayment(state, { agreementId: agreement.id, amount: 10_000, date: instalment.dueDate, instalmentId: instalment.id, paymentId: 'reverse-me', transactionId: 'reverse-tx' });
  reverseCreditPayment(state, payment.id, '2026-02-17');
  assert.equal(payment.reversedAt != null, true);
  assert.equal(payment.reversalDate, '2026-02-17');
  assert.equal(getCreditAgreementBalances(state, agreement).totalRemaining, 30_000);
  assert.equal(getCreditInstalmentAmounts(state, agreement, instalment).remaining, instalment.amount);
  assert.equal(financeSummary(state, '2026-02').creditPayments, 0);
  assert.equal(state.transactions.find(item => item.id === 'reverse-tx').id, payment.id);
});

test('unused zero-deposit agreements can be archived, restored, and safely deleted', () => {
  const { state, agreement } = makeAgreement({ deposit: 0, financedAmount: 120_000 });
  archiveCreditAgreement(state, agreement.id, '2026-01-20');
  assert.equal(agreement.archivedAt, '2026-01-20');
  restoreCreditAgreement(state, agreement.id);
  assert.equal(agreement.archivedAt, undefined);
  deleteUnusedCreditAgreement(state, agreement.id);
  assert.equal(state.creditAgreements.some(item => item.id === agreement.id), false);
});

test('agreements with a real deposit cannot be hard deleted', () => {
  const { state, agreement } = makeAgreement();
  assert.throws(() => deleteUnusedCreditAgreement(state, agreement.id), /linked financial activity/);
});

test('correcting a deposit updates its linked Finance transaction and regenerates the unused agreement', () => {
  const { state, agreement } = makeAgreement();
  const deposit = state.transactions.find(item => item.id === 'deposit');
  updateCreditAgreement(state, agreement.id, { title: agreement.title, cashPrice: 130_000, deposit: 10_000, financeCharge: 0, term: 3, firstPaymentDate: '2026-02-15' }, '2026-01-20');
  assert.equal(deposit.id, 'deposit');
  assert.equal(deposit.amount, 10_000);
  assert.equal(agreement.cashPrice, 130_000);
  assert.equal(agreement.deposit, 10_000);
  assert.equal(agreement.financedAmount, 120_000);
  assert.equal(agreement.schedule.reduce((sum, item) => sum + item.amount, 0), 120_000);
});

test('deposit corrected to zero reverses the linked Finance transaction instead of deleting it', () => {
  const { state, agreement } = makeAgreement();
  const deposit = state.transactions.find(item => item.id === 'deposit');
  updateCreditAgreement(state, agreement.id, { title: agreement.title, cashPrice: agreement.cashPrice, deposit: 0, financeCharge: 0, term: 3, firstPaymentDate: '2026-02-15' }, '2026-01-20');
  assert.ok(deposit.reversedAt);
  assert.equal(deposit.reversalReason, 'credit_deposit_corrected');
  assert.equal(state.transactions.some(item => item.id === deposit.id), true);
  assert.equal(agreement.financedAmount, 120_000);
});

test('a settled agreement can be reopened by reversing its linked settlement transaction', () => {
  const { state, agreement } = makeAgreement({ deposit: 0, financedAmount: 120_000 });
  const payment = settleCreditAgreement(state, { agreementId: agreement.id, settlementAmount: 120_000, date: '2026-02-01', paymentId: 'settlement-to-reverse', transactionId: 'settlement-tx' });
  assert.equal(getCreditAgreementStatus(state, agreement), 'settled_early');
  reverseCreditPayment(state, payment.id, '2026-02-02');
  assert.equal(getCreditAgreementStatus(state, agreement), 'active');
  assert.equal(getCreditAgreementBalances(state, agreement).totalRemaining, 120_000);
  assert.ok(agreement.schedule.every(item => !item.supersededAt));
});

test('reversing an extra payment redistributes only the remaining schedule', () => {
  const { state, agreement } = makeAgreement({ deposit: 0, financedAmount: 120_000 });
  const payment = recordCreditPayment(state, { agreementId: agreement.id, amount: 10_000, date: '2026-01-20', paymentId: 'extra-to-reverse', transactionId: 'extra-reversal-tx' });
  reverseCreditPayment(state, payment.id, '2026-01-21');
  assert.equal(getCreditAgreementBalances(state, agreement).principalRemaining, 120_000);
  assert.equal(agreement.schedule.filter(item => !item.supersededAt).reduce((sum, item) => sum + item.amount, 0), 120_000);
});

test('bank-booked credit payments cannot be edited or reversed through the agreement', () => {
  const { state, agreement } = makeAgreement({ deposit: 0, financedAmount: 120_000 });
  const payment = recordCreditPayment(state, { agreementId: agreement.id, amount: 10_000, date: '2026-02-15', instalmentId: agreement.schedule[0].id, paymentId: 'bank-linked', transactionId: 'bank-credit-tx' });
  payment.source = 'bank';
  payment.providerStatus = 'BOOK';
  assert.throws(() => updateCreditPayment(state, payment.id, { note: 'changed' }), /Bank-booked/);
  assert.throws(() => reverseCreditPayment(state, payment.id), /Bank-booked/);
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
