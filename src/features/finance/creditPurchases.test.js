import test from 'node:test';
import assert from 'node:assert/strict';
import { initialFinanceState, normalizeFinanceState } from './financeData.js';
import { deriveFinancePosition, inspectFinanceIntegrity } from './financeLedger.js';
import { financeSummary } from './financeMath.js';
import {
  archiveCreditAgreement, canDeleteCreditPurchase, cancelCreditAgreement, createCreditAgreement, createCreditTransactionIndex, deleteUnusedCreditAgreement, generateCreditSchedule, getCreditAgreementBalances, getCreditAgreementStatus, getCreditPurchaseDeleteBlockReason,
  getCreditAgreementMonthlyCommitment, getCreditAgreementRepaymentSummary, getCreditDueSoon, getCreditInstalmentAmounts, getCreditOverview, getMonthlyCreditCommitment, getOverdueCreditPayments, planCreditReminderReconciliation, recordCreditPayment,
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

test('indexed Credit selectors preserve balances and instalment amounts while reusing transaction grouping', () => {
  const { state, agreement } = makeAgreement({ deposit: 0, financedAmount: 120_000 });
  const instalment = agreement.schedule[0];
  recordCreditPayment(state, { agreementId: agreement.id, instalmentId: instalment.id, amount: 10_000, date: '2026-02-15', paymentId: 'indexed-payment', transactionId: 'indexed-payment' });
  const index = createCreditTransactionIndex(state);
  assert.deepEqual(getCreditAgreementBalances(state, agreement, index), getCreditAgreementBalances(state, agreement));
  assert.deepEqual(getCreditInstalmentAmounts(state, agreement, instalment, index), getCreditInstalmentAmounts(state, agreement, instalment));
  state.transactions.find(item => item.id === 'indexed-payment').reversedAt = new Date().toISOString();
  assert.equal(getCreditAgreementBalances(state, agreement).totalRemaining, 120_000);
});

test('monthly schedule splits cents exactly and clamps end-of-month dates', () => {
  const schedule = generateCreditSchedule({ agreementId: 'x', principalAmount: 100, financeCharge: 2, term: 3, firstPaymentDate: '2026-01-31' });
  assert.deepEqual(schedule.map(item => item.amount), [33, 33, 36]);
  assert.deepEqual(schedule.map(item => item.principalAmount), [33, 33, 34]);
  assert.deepEqual(schedule.map(item => item.dueDate), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.equal(schedule.reduce((sum, item) => sum + item.financeCostAmount, 0), 2);
  const remainderSchedule = generateCreditSchedule({ agreementId: 'remainder', principalAmount: 100, term: 3, firstPaymentDate: '2026-02-15' });
  assert.deepEqual(remainderSchedule.map(item => item.amount), [33, 33, 34]);
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
  assert.equal(agreement.schedule.filter(item => getCreditInstalmentAmounts(state, agreement, item).remaining === 0).length, 1);
  assert.equal(agreement.schedule.filter(item => getCreditInstalmentAmounts(state, agreement, item).remaining > 0).length, 2);
  assert.equal(agreement.schedule.filter(item => !item.upfrontPayment).reduce((sum, item) => sum + item.amount, 0), 5_850);
  assert.deepEqual(
    (({ totalRepayable, actualPaid, remainingBalance, totalInstallments, completedInstallments, remainingInstallments, progressPercent }) => ({ totalRepayable, actualPaid, remainingBalance, totalInstallments, completedInstallments, remainingInstallments, progressPercent }))(getCreditAgreementRepaymentSummary(state, agreement)),
    { totalRepayable: 10_350, actualPaid: 4_500, remainingBalance: 5_850, totalInstallments: 3, completedInstallments: 1, remainingInstallments: 2, progressPercent: 43.48 },
  );
  assert.equal(inspectFinanceIntegrity(state).some(issue => issue.type === 'credit-agreement-total-mismatch'), false);
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

test('editing an existing custom schedule persists changed dates and amounts', () => {
  const { state, agreement } = makeAgreement({
    cashPrice: 10_350, deposit: 0, financedAmount: 10_350, term: 2, scheduleMode: 'custom', firstPaymentDate: '2026-02-15',
    customSchedule: [{ dueDate: '2026-02-15', amount: 5_000 }, { dueDate: '2026-03-15', amount: 5_350 }],
  });
  const updatedRows = agreement.schedule.map((item, index) => ({ id: item.id, dueDate: item.dueDate, amount: item.amount + (index === 0 ? 100 : -100) }));
  updatedRows[0].dueDate = '2026-02-20';
  updateCreditAgreement(state, agreement.id, { scheduleMode: 'custom', customSchedule: updatedRows, term: 2, firstPaymentDate: '2026-02-15' }, '2026-01-20');
  assert.deepEqual(agreement.schedule.map(({ dueDate, amount }) => ({ dueDate, amount })), [
    { dueDate: '2026-02-20', amount: 5_100 }, { dueDate: '2026-03-15', amount: 5_250 },
  ]);
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

test('custom schedule can add and delete future rows only when the exact remaining balance reconciles', () => {
  const { state, agreement } = makeAgreement({ deposit: 0, cashPrice: 10_000, financedAmount: 10_000, term: 2, firstPaymentDate: '2026-02-15' });
  const expanded = [
    { id: agreement.schedule[0].id, dueDate: '2026-02-15', amount: 3_000 },
    { id: agreement.schedule[1].id, dueDate: '2026-03-15', amount: 3_000 },
    { id: 'new-row', dueDate: '2026-04-15', amount: 4_000 },
  ];
  updateCreditAgreement(state, agreement.id, { scheduleMode: 'custom', customSchedule: expanded, term: 3, firstPaymentDate: '2026-02-15' }, '2026-01-20');
  assert.equal(agreement.schedule.filter(row => !row.supersededAt).length, 3);
  assert.equal(agreement.schedule.reduce((sum, row) => sum + (!row.supersededAt ? row.amount : 0), 0), getCreditAgreementBalances(state, agreement).totalRemaining);
  const reduced = expanded.slice(0, 2).map(row => ({ ...row, amount: row.amount + (row.id === expanded[0].id ? 2_000 : 2_000) }));
  updateCreditAgreement(state, agreement.id, { scheduleMode: 'custom', customSchedule: reduced, term: 2, firstPaymentDate: '2026-02-15' }, '2026-01-20');
  assert.equal(agreement.schedule.filter(row => !row.supersededAt).length, 2);
  assert.equal(agreement.schedule.filter(row => !row.supersededAt).reduce((sum, row) => sum + row.amount, 0), 10_000);
  assert.throws(() => updateCreditAgreement(state, agreement.id, { scheduleMode: 'custom', customSchedule: [{ ...reduced[0], amount: 9_999 }], term: 1, firstPaymentDate: '2026-02-15' }, '2026-01-20'), /must total/);
  assert.equal(agreement.schedule.filter(row => !row.supersededAt).reduce((sum, row) => sum + row.amount, 0), getCreditAgreementBalances(state, agreement).totalRemaining);
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

test('one payment can satisfy the selected instalment and apply excess to future principal once', () => {
  const { state, agreement } = makeAgreement({ deposit: 0, cashPrice: 30_000, financedAmount: 30_000, term: 3 });
  const due = agreement.schedule[0];
  const before = deriveFinancePosition(state).totalOwned;
  const payment = recordCreditPayment(state, { agreementId: agreement.id, amount: 12_000, date: due.dueDate, instalmentId: due.id, paymentId: 'combined', transactionId: 'combined-tx' });
  assert.equal(payment.amount, 12_000);
  assert.equal(payment.creditPaymentKind, 'scheduled_extra');
  assert.equal(payment.scheduledPortionAmount, 10_000);
  assert.equal(payment.extraPrincipalAmount, 2_000);
  assert.equal(getCreditInstalmentAmounts(state, agreement, due).paid, 10_000);
  assert.equal(getCreditInstalmentAmounts(state, agreement, due).remaining, 0);
  assert.equal(getCreditAgreementBalances(state, agreement).totalRemaining, 18_000);
  assert.equal(deriveFinancePosition(state).totalOwned, before - 12_000);
  assert.equal(state.transactions.filter(item => item.creditPaymentId === 'combined').length, 1);
  assert.equal(agreement.schedule.filter(item => !item.supersededAt).reduce((sum, item) => sum + getCreditInstalmentAmounts(state, agreement, item).remaining, 0), 18_000);
  reverseCreditPayment(state, payment.id, '2026-02-16');
  assert.equal(getCreditAgreementBalances(state, agreement).totalRemaining, 30_000);
  assert.equal(agreement.schedule.filter(item => !item.supersededAt).reduce((sum, item) => sum + getCreditInstalmentAmounts(state, agreement, item).remaining, 0), 30_000);
  assert.equal(financeSummary(state, '2026-02').creditPayments, 0);
});

test('correcting a scheduled payment upward preserves its Finance ID and records the excess once', () => {
  const { state, agreement } = makeAgreement({ deposit: 0, cashPrice: 30_000, financedAmount: 30_000, term: 3 });
  const due = agreement.schedule[0];
  const payment = recordCreditPayment(state, { agreementId: agreement.id, amount: 10_000, date: due.dueDate, instalmentId: due.id, paymentId: 'correct-up', transactionId: 'correct-up-tx' });
  updateCreditPayment(state, payment.id, { amount: 12_000, date: due.dueDate });
  assert.equal(payment.id, 'correct-up-tx');
  assert.equal(payment.creditPaymentKind, 'scheduled_extra');
  assert.equal(payment.extraPrincipalAmount, 2_000);
  assert.equal(getCreditAgreementBalances(state, agreement).totalRemaining, 18_000);
  assert.equal(state.transactions.filter(item => item.creditPaymentId === 'correct-up').length, 1);
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

test('Auto Split puts all integer minor-unit remainder in the final instalment without negative fee rows', () => {
  const schedule = generateCreditSchedule({ agreementId: 'awkward', principalAmount: 101, financeCharge: 1, term: 3, firstPaymentDate: '2026-02-15' });
  assert.deepEqual(schedule.map(item => item.principalAmount), [33, 33, 35]);
  assert.deepEqual(schedule.map(item => item.financeCostAmount), [0, 0, 1]);
  assert.deepEqual(schedule.map(item => item.amount), [33, 33, 36]);
  assert.ok(schedule.every(item => item.principalAmount >= 0 && item.financeCostAmount >= 0));
  assert.equal(schedule.reduce((sum, item) => sum + item.amount, 0), 102);
});

test('monthly commitment sums actual upcoming rows and excludes paid, reversed, cancelled, and archived plans', () => {
  const { state, agreement } = makeAgreement({ deposit: 0, cashPrice: 30_000, financedAmount: 30_000, term: 3, firstPaymentDate: '2026-02-15' });
  assert.equal(getMonthlyCreditCommitment(state, '2026-02-15'), 20_000);
  const first = agreement.schedule[0];
  const payment = recordCreditPayment(state, { agreementId: agreement.id, amount: 10_000, date: first.dueDate, instalmentId: first.id, paymentId: 'monthly-paid', transactionId: 'monthly-paid-tx' });
  assert.equal(getMonthlyCreditCommitment(state, '2026-02-15'), 10_000);
  reverseCreditPayment(state, payment.id, '2026-02-16');
  assert.equal(getMonthlyCreditCommitment(state, '2026-02-15'), 20_000);
  archiveCreditAgreement(state, agreement.id, '2026-02-16');
  assert.equal(getMonthlyCreditCommitment(state, '2026-02-15'), 0);
  assert.equal(getCreditAgreementMonthlyCommitment(state, agreement, '2026-02-15'), 0);
  assert.equal(getCreditOverview(state, '2026-02-15').outstanding, 30_000);
  assert.equal(getCreditOverview(state, '2026-02-15').nextPayment, null);

  const cancelled = makeAgreement({ id: 'cancelled-plan', title: 'Cancelled plan', deposit: 0, cashPrice: 15_000, financedAmount: 15_000, term: 3, firstPaymentDate: '2026-02-15' });
  cancelCreditAgreement(cancelled.state, cancelled.agreement.id, '2026-01-20');
  assert.equal(getMonthlyCreditCommitment(cancelled.state, '2026-02-15'), 0);
});

test('credit reminder reconciliation is idempotent and drops paid or archived instalments', () => {
  const { state, agreement } = makeAgreement({ deposit: 0, cashPrice: 30_000, financedAmount: 30_000, term: 3, firstPaymentDate: '2026-02-15' });
  updateCreditAgreement(state, agreement.id, { creditReminderPreferences: { enabled: true, daysBefore: 3, onDueDate: true } }, '2026-01-20');
  const firstPlan = planCreditReminderReconciliation(state, [], '2026-02-01');
  assert.equal(firstPlan.add.length, 6);
  assert.equal(firstPlan.cancelIds.length, 0);
  const active = firstPlan.add.map(item => ({ ...item, id: `reminder-${item.key}`, status: 'waiting', creditAgreementId: item.agreementId, creditInstalmentId: item.instalmentId, creditReminderEvent: item.event }));
  assert.deepEqual(planCreditReminderReconciliation(state, active, '2026-02-01'), { add: [], cancelIds: [] });
  const first = agreement.schedule[0];
  recordCreditPayment(state, { agreementId: agreement.id, amount: first.amount, date: first.dueDate, instalmentId: first.id, paymentId: 'reminded-paid', transactionId: 'reminded-paid-tx' });
  const afterPayment = planCreditReminderReconciliation(state, active, '2026-02-01');
  assert.equal(afterPayment.add.length, 0);
  assert.equal(afterPayment.cancelIds.length, 2);
  archiveCreditAgreement(state, agreement.id, '2026-02-02');
  assert.deepEqual(planCreditReminderReconciliation(state, active, '2026-02-02'), { add: [], cancelIds: active.map(item => item.id) });
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

test('early settlement uses one transaction, clears outstanding liability, and retains its history', () => {
  const { state, agreement } = makeAgreement({ deposit: 0, cashPrice: 10_000, financedAmount: 10_000, term: 3 });
  const payment = settleCreditAgreement(state, { agreementId: agreement.id, settlementAmount: 10_000, date: '2026-02-01', paymentId: 'full-settle', transactionId: 'full-settle-tx' });
  assert.equal(getCreditAgreementBalances(state, agreement).totalRemaining, 0);
  assert.equal(getCreditAgreementStatus(state, agreement), 'settled_early');
  assert.equal(payment.amount, 10_000);
  assert.equal(state.transactions.filter(item => item.creditPaymentKind === 'settlement').length, 1);
  assert.ok(agreement.schedule.every(item => item.supersededAt));
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
  assert.equal(canDeleteCreditPurchase(state, agreement.id), true);
  archiveCreditAgreement(state, agreement.id, '2026-01-20');
  assert.equal(agreement.archivedAt, '2026-01-20');
  restoreCreditAgreement(state, agreement.id);
  assert.equal(agreement.archivedAt, undefined);
  deleteUnusedCreditAgreement(state, agreement.id);
  assert.equal(state.creditAgreements.some(item => item.id === agreement.id), false);
  assert.equal(canDeleteCreditPurchase(state, agreement.id), false);
});

test('archive and restore update the visible plan count while preserving live liabilities', () => {
  const { state, agreement } = makeAgreement({ deposit: 0, financedAmount: 120_000 });
  const before = getCreditOverview(state, '2026-01-20');
  assert.equal(before.activePlans, 1);
  archiveCreditAgreement(state, agreement.id, '2026-01-20');
  const archived = getCreditOverview(state, '2026-01-20');
  assert.equal(archived.activePlans, 0);
  assert.equal(archived.outstanding, before.outstanding);
  assert.equal(archived.monthlyCommitment, 0);
  assert.equal(archived.nextPayment, null);
  restoreCreditAgreement(state, agreement.id);
  const restored = getCreditOverview(state, '2026-01-20');
  assert.equal(restored.activePlans, 1);
  assert.equal(restored.outstanding, before.outstanding);
});

test('Credit overview separates active, settled, cancelled, and archived agreement counts', () => {
  const state = initialFinanceState();
  const active = createCreditAgreement(state, agreementInput({ id: 'active', title: 'Active', deposit: 0, financedAmount: 120_000 }));
  const settled = createCreditAgreement(state, agreementInput({ id: 'settled', title: 'Settled', deposit: 0, financedAmount: 120_000 }));
  const cancelled = createCreditAgreement(state, agreementInput({ id: 'cancelled', title: 'Cancelled', deposit: 0, financedAmount: 120_000 }));
  const archived = createCreditAgreement(state, agreementInput({ id: 'archived', title: 'Archived', deposit: 0, financedAmount: 120_000 }));
  settleCreditAgreement(state, { agreementId: settled.id, settlementAmount: 120_000, settlementFee: 0, date: '2026-01-20', paymentId: 'count-settlement', transactionId: 'count-settlement-tx' });
  cancelCreditAgreement(state, cancelled.id, '2026-01-20');
  archiveCreditAgreement(state, archived.id, '2026-01-20');
  const summary = getCreditOverview(state, '2026-01-20');
  assert.equal(summary.activePlans, 1);
  assert.equal(summary.settledPlans, 1);
  assert.equal(summary.cancelledPlans, 1);
  assert.equal(summary.archivedPlans, 1);
  assert.equal(summary.outstanding, 240_000);
  assert.equal(summary.nextPayment.agreement.id, active.id);
});

test('agreements with a real deposit cannot be hard deleted', () => {
  const { state, agreement } = makeAgreement();
  assert.equal(canDeleteCreditPurchase(state, agreement.id), false);
  assert.match(getCreditPurchaseDeleteBlockReason(state, agreement.id), /linked Finance transaction/);
  assert.throws(() => deleteUnusedCreditAgreement(state, agreement.id), /linked Finance transaction/);
});

test('a linked recorded or reversed payment blocks hard deletion and preserves its references', () => {
  const { state, agreement } = makeAgreement({ deposit: 0, financedAmount: 120_000 });
  const payment = recordCreditPayment(state, { agreementId: agreement.id, amount: 1_000, date: '2026-02-15', paymentId: 'keep-history', transactionId: 'keep-history-tx' });
  payment.reversedAt = new Date().toISOString();
  assert.equal(canDeleteCreditPurchase(state, agreement.id), false);
  assert.match(getCreditPurchaseDeleteBlockReason(state, agreement.id), /payment history/);
  assert.throws(() => deleteUnusedCreditAgreement(state, agreement.id), /payment history/);
  assert.equal(state.creditAgreements.some(item => item.id === agreement.id), true);
  assert.equal(state.transactions.some(item => item.id === payment.id), true);
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
