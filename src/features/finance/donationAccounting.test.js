import test from 'node:test';
import assert from 'node:assert/strict';
import { accrueDonation, donationDue, payDonationDue, reconcileDonationIncome } from './donationAccounting.js';
import { applyIncomeAllocations } from './financeAllocations.js';
import { deriveFinancePosition } from './financeLedger.js';

function makeState() {
  return { settings: { currency: 'GBP' }, categories: [{ id: 'donation', type: 'donation', archived: false }], donationCategories: [{ id: 'wasiyat', name: 'Wasiyat' }], donationAccruals: [], donationPayments: [], transactions: [], allocationRules: [], donationTargets: [] };
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
