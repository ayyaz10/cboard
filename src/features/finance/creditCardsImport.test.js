import test from 'node:test';
import assert from 'node:assert/strict';
import { initialFinanceState } from './financeData.js';
import { createCreditCard, creditCardLiability } from './creditCards.js';
import { deriveFinancePosition } from './financeLedger.js';
import { financeSummary } from './financeMath.js';
import { linkCardPaymentState } from './financeAccounts.js';
import { buildImportedTransaction } from './transactionImport.js';
import { linkExistingIncomeAsRefundState } from './refunds.js';

test('card statement import records purchases as expense and credits outside ordinary income', () => {
  const state = initialFinanceState(); createCreditCard(state, { id: 'card', name: 'Amex', creditLimit: 100000 });
  const purchase = buildImportedTransaction({ confidence: 'ready', date: '2026-01-01', description: 'Shop', amount: 8000, direction: 'expense' }, state, { accountId: 'card' });
  const credit = buildImportedTransaction({ confidence: 'ready', date: '2026-01-02', description: 'Merchant credit', amount: 1000, direction: 'income' }, state, { accountId: 'card' });
  assert.equal(purchase.type, 'expense');
  assert.equal(credit.type, 'cardCredit');
  state.transactions.push(purchase, credit);
  assert.equal(creditCardLiability(state, 'card'), 7000);
  assert.equal(financeSummary(state, null).income, 0);
});

test('card credit links to same-card purchase without changing cash twice', () => {
  const state = initialFinanceState(); createCreditCard(state, { id: 'card', name: 'Amex', creditLimit: 100000 });
  const purchase = { id: 'purchase', type: 'expense', amount: 8000, date: '2026-01-01', creditCardId: 'card', categoryId: 'default-10' };
  const credit = { id: 'credit', type: 'cardCredit', amount: 3000, date: '2026-01-02', creditCardId: 'card', accountId: 'card' };
  state.transactions.push(purchase, credit);
  linkExistingIncomeAsRefundState(state, { incomingTransactionId: 'credit', originalTransactionId: 'purchase' });
  assert.equal(state.transactions.find(item => item.id === 'credit').type, 'refund');
  assert.equal(creditCardLiability(state, 'card'), 5000);
  assert.equal(deriveFinancePosition(state, { openingBalance: 20000 }).totalOwned, 15000);
  assert.equal(financeSummary(state, null).expenses, 5000);
});

test('matching bank and card statement payment reduces cash and card balance once', () => {
  const state = initialFinanceState(); createCreditCard(state, { id: 'card', name: 'Amex', creditLimit: 100000 });
  state.transactions.push({ id: 'purchase', type: 'expense', amount: 10000, date: '2026-01-01', creditCardId: 'card' });
  const bank = { id: 'bank-out', type: 'expense', amount: 4000, date: '2026-01-02', accountId: 'bank', title: 'Card payment', sourceType: 'file_import' };
  const cardCredit = { id: 'card-in', type: 'cardCredit', amount: 4000, date: '2026-01-02', accountId: 'card', creditCardId: 'card', title: 'Payment received' };
  state.transactions.push(bank, cardCredit);
  linkCardPaymentState(state, { bankTransactionId: 'bank-out', cardTransactionId: 'card-in' });
  assert.equal(creditCardLiability(state, 'card'), 6000);
  assert.equal(deriveFinancePosition(state, { openingBalance: 20000 }).totalOwned, 10000);
  assert.equal(financeSummary(state, null).expenses, 10000);
  assert.equal(financeSummary(state, null).transferOut, 4000);
});

