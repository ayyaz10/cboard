import test from 'node:test';
import assert from 'node:assert/strict';
import { accrueDonation, canMarkDonationPaymentUnpaid, canUndoDonationPayment, donationDue, markDonationPaymentUnpaid, payDonationDue, reconcileDonationIncome, undoDonationPayment } from './donationAccounting.js';
import { applyIncomeAllocations } from './financeAllocations.js';
import { deriveFinancePosition, inspectFinanceIntegrity } from './financeLedger.js';
import { donationSummary } from './donationAnalytics.js';

function makeState() {
  return { settings: { currency: 'GBP' }, categories: [{ id: 'donation', type: 'donation', archived: false }], donationCategories: [{ id: 'wasiyat', name: 'Wasiyat' }], donationAccruals: [], donationPayments: [], donationReversals: [], transactions: [], allocationRules: [], donationTargets: [] };
}

test('income percentage is idempotent, and editing income reconciles unpaid due', () => {
  const state = makeState();
  const rule = { id: 'five-percent', targetType: 'donation', donationCategoryId: 'wasiyat', mode: 'percent', value: 500, timing: 'income', active: true };
  state.allocationRules.push(rule);
  const income = { id: 'salary', amount: 100000, date: '2026-10-01' };
  applyIncomeAllocations(state, income);
  applyIncomeAllocations(state, income);
  assert.equal(state.donationAccruals.length, 1);
  assert.equal(donationDue(state, 'wasiyat'), 5000);
  assert.equal(state.transactions.length, 0);
  reconcileDonationIncome(state, income, 'replace');
  const edited = { ...income, amount: 80000 };
  reconcileDonationIncome(state, edited, 'replace');
  assert.equal(donationDue(state, 'wasiyat'), 4000);
});

test('partial payment creates one expense and allocates to the oldest accrual first', () => {
  const state = makeState();
  accrueDonation(state, { categoryId: 'wasiyat', amount: 2000, effectiveDate: '2026-10-01', sourceType: 'income_percentage' });
  accrueDonation(state, { categoryId: 'wasiyat', amount: 3000, effectiveDate: '2026-10-02', sourceType: 'income_percentage' });
  const payment = payDonationDue(state, { categoryId: 'wasiyat', amount: 3500, date: '2026-10-10' });
  assert.equal(payment.type, 'expense');
  assert.equal(payment.financeGroup, 'donation');
  assert.equal(payment.amount, 3500);
  assert.deepEqual(state.donationPayments[0].sourceAccruals.map(item => item.amount), [2000, 1500]);
  assert.equal(state.donationAccruals[0].status, 'fully_paid');
  assert.equal(state.donationAccruals[1].paidAmount, 1500);
  assert.equal(donationDue(state, 'wasiyat'), 1500);
  assert.equal(deriveFinancePosition({ ...state, transactions: [{ id: 'salary', type: 'income', amount: 10000, date: '2026-10-01' }, payment] }).totalOwned, 6500);
  assert.throws(() => payDonationDue(state, { categoryId: 'wasiyat', amount: 1501, date: '2026-10-11' }), /greater than the amount due/);
});

test('deleting or editing income after a payment preserves paid history and flags reconciliation', () => {
  const state = makeState();
  const rule = { id: 'five-percent', targetType: 'donation', donationCategoryId: 'wasiyat', mode: 'percent', value: 500, timing: 'income', active: true };
  state.allocationRules.push(rule);
  const income = { id: 'salary', amount: 100000, date: '2026-10-01' };
  applyIncomeAllocations(state, income);
  payDonationDue(state, { categoryId: 'wasiyat', amount: 3000, date: '2026-10-04' });
  reconcileDonationIncome(state, { ...income, amount: 40000 }, 'replace');
  assert.equal(donationDue(state, 'wasiyat'), 0);
  assert.equal(state.donationAccruals[0].paidAmount, 3000);
  assert.equal(state.donationAccruals[0].reconciliationRequired, true);
  assert.equal(state.transactions.filter(item => item.financeGroup === 'donation').length, 1);
});

test('undo restores exact due, paid analytics, and the original spendable balance exactly once', () => {
  const state = makeState();
  accrueDonation(state, { categoryId: 'wasiyat', amount: 5000, effectiveDate: '2026-10-01' });
  const income = { id: 'salary', type: 'income', amount: 10000, date: '2026-10-01' };
  state.transactions.push(income);
  const payment = payDonationDue(state, { categoryId: 'wasiyat', amount: 5000, date: '2026-10-10' });
  assert.equal(donationDue(state, 'wasiyat'), 0);
  assert.equal(donationSummary(state, '2026-10').donated, 5000);
  assert.equal(deriveFinancePosition(state).totalOwned, 5000);
  const result = undoDonationPayment(state, payment.id, '2026-10-25');
  assert.equal(result.restoredTo, 'due');
  assert.equal(donationDue(state, 'wasiyat'), 5000);
  assert.equal(state.donationAccruals[0].paidAmount, 0);
  assert.equal(donationSummary(state, '2026-10').donated, 0);
  assert.equal(donationSummary(state, null).lifetime, 0);
  assert.equal(deriveFinancePosition(state).totalOwned, 10000);
  assert.equal(undoDonationPayment(state, payment.id, '2026-10-26').alreadyReversed, true);
  assert.equal(state.donationReversals.length, 1);
  assert.equal(deriveFinancePosition(state).totalOwned, 10000);
  assert.deepEqual(inspectFinanceIntegrity(state), []);
});

test('undoing one of multiple payments restores only its exact partial allocations', () => {
  const state = makeState();
  accrueDonation(state, { categoryId: 'wasiyat', amount: 2000, effectiveDate: '2026-10-01' });
  accrueDonation(state, { categoryId: 'wasiyat', amount: 3000, effectiveDate: '2026-10-02' });
  const first = payDonationDue(state, { categoryId: 'wasiyat', amount: 3000, date: '2026-10-10' });
  const second = payDonationDue(state, { categoryId: 'wasiyat', amount: 1000, date: '2026-10-11' });
  assert.equal(donationDue(state, 'wasiyat'), 1000);
  undoDonationPayment(state, first.id, '2026-10-12');
  assert.equal(donationDue(state, 'wasiyat'), 4000);
  assert.deepEqual(state.donationAccruals.map(item => item.paidAmount), [0, 1000]);
  assert.equal(donationSummary(state, '2026-10').donated, 1000);
  assert.equal(second.reversedAt, undefined);
  assert.deepEqual(inspectFinanceIntegrity(state), []);
});

test('legacy manual Donation transaction converts to due once, then genuine re-payment creates a new active transaction', () => {
  const state = makeState();
  const income = { id: 'salary', type: 'income', amount: 10000, date: '2026-10-01' };
  const legacy = { id: 'old-wasiyat', type: 'expense', amount: 2250, categoryId: 'donation', donationCategoryId: 'wasiyat', title: 'Hissa Amad', date: '2026-10-05', note: 'Automatic income allocation', paidFromFundId: 'cash', sourceType: 'manual' };
  state.transactions.push(income, legacy);
  assert.equal(canUndoDonationPayment(state, legacy), false);
  assert.equal(canMarkDonationPaymentUnpaid(state, legacy), true);
  assert.equal(deriveFinancePosition(state).totalOwned, 7750);

  const result = markDonationPaymentUnpaid(state, legacy.id, '', '2026-10-25');
  assert.equal(result.legacyConverted, true);
  assert.equal(legacy.reversedAt, '2026-10-25');
  assert.equal(state.donationPayments.length, 1);
  assert.equal(state.donationReversals.length, 1);
  assert.equal(donationDue(state, 'wasiyat'), 2250);
  assert.equal(donationSummary(state, '2026-10').donated, 0);
  assert.equal(donationSummary(state, null).lifetime, 0);
  assert.equal(deriveFinancePosition(state).totalOwned, 10000);
  assert.deepEqual(inspectFinanceIntegrity(state), []);

  assert.equal(markDonationPaymentUnpaid(state, legacy.id, '', '2026-10-26').alreadyReversed, true);
  assert.equal(state.donationAccruals.length, 1);
  assert.equal(state.donationReversals.length, 1);
  assert.equal(deriveFinancePosition(state).totalOwned, 10000);

  const repaid = payDonationDue(state, { categoryId: 'wasiyat', amount: 2250, date: '2026-10-30', paidFromFundId: 'cash' });
  assert.notEqual(repaid.id, legacy.id);
  assert.equal(legacy.reversedAt, '2026-10-25');
  assert.equal(repaid.reversedAt, undefined);
  assert.equal(donationDue(state, 'wasiyat'), 0);
  assert.equal(donationSummary(state, '2026-10').donated, 2250);
  assert.equal(donationSummary(state, null).lifetime, 2250);
  assert.equal(deriveFinancePosition(state).totalOwned, 7750);
  assert.deepEqual(inspectFinanceIntegrity(state), []);
});

test('legacy Donation correction asks for category when stable Donation category data is missing', () => {
  const state = makeState();
  const legacy = { id: 'ambiguous', type: 'expense', amount: 500, categoryId: 'donation', title: 'Old donation', date: '2026-10-05' };
  state.transactions.push(legacy);
  assert.equal(canMarkDonationPaymentUnpaid(state, legacy), true);
  assert.throws(() => markDonationPaymentUnpaid(state, legacy.id, '', '2026-10-25'), /Choose the Donation category/);
  assert.equal(markDonationPaymentUnpaid(state, legacy.id, 'wasiyat', '2026-10-25').legacyConverted, true);
  assert.equal(donationDue(state, 'wasiyat'), 500);
});

test('undo of a legacy Donation Reserve settlement restores reserve, not due or spendable', () => {
  const state = makeState();
  const reserve = { id: 'reserve', type: 'donation', amount: 4500, date: '2026-10-01', allocationStatus: 'allocated', donationCategoryId: 'wasiyat' };
  const payment = { id: 'reserve-payment', type: 'expense', amount: 1500, date: '2026-10-10', financeGroup: 'donation', donationCategoryId: 'wasiyat', linkedReservationId: reserve.id };
  reserve.settlementTransactionId = payment.id;
  state.transactions.push(reserve, payment);
  assert.equal(deriveFinancePosition(state).reserves.donation, 3000);
  assert.equal(canUndoDonationPayment(state, payment), true);
  const result = undoDonationPayment(state, payment.id, '2026-10-12');
  assert.equal(result.restoredTo, 'reserve');
  assert.equal(reserve.settlementTransactionId, undefined);
  assert.equal(deriveFinancePosition(state).reserves.donation, 4500);
  assert.equal(donationDue(state, 'wasiyat'), 0);
  assert.deepEqual(inspectFinanceIntegrity(state), []);
});

test('bank imported donation transactions cannot be undone as CBoard payments', () => {
  const state = makeState();
  const transaction = { id: 'bank-tx', type: 'expense', amount: 2500, date: '2026-10-10', source: 'bank', sourceType: 'bank_import', financeGroup: 'donation', donationCategoryId: 'wasiyat', donationPaymentId: 'payment' };
  state.transactions.push(transaction);
  state.donationPayments.push({ id: 'payment', financeTransactionId: transaction.id, categoryId: 'wasiyat', amount: transaction.amount, sourceAccruals: [] });
  assert.equal(canUndoDonationPayment(state, transaction), false);
  assert.equal(canMarkDonationPaymentUnpaid(state, transaction), false);
  assert.throws(() => undoDonationPayment(state, transaction.id), /Bank transactions cannot be undone/);
  assert.equal(transaction.reversedAt, undefined);
  assert.deepEqual(inspectFinanceIntegrity(state), []);
});
