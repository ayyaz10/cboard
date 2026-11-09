import test from 'node:test';
import assert from 'node:assert/strict';
import { initialFinanceState } from './financeData.js';
import { createCreditCard, creditCardAvailable, creditCardLiability, recordCreditCardPayment } from './creditCards.js';
import { createFinanceAccount, financeAccountBalance } from './financeAccounts.js';
import { deriveFinancePosition } from './financeLedger.js';
import { financeSummary } from './financeMath.js';
import { createRefundState, reverseRefundState, remainingRefundable } from './refunds.js';

const card = (state, id = 'card-1', openingLiability = 0) => createCreditCard(state, { id, name: id, currency: 'GBP', creditLimit: 100000, openingLiability });

test('credit card opening balance, purchases and available credit derive from ledger events', () => {
  const state = initialFinanceState(); card(state, 'one', 25000);
  state.transactions.push({ id: 'purchase', type: 'expense', amount: 10000, date: '2026-01-01', creditCardId: 'one', categoryId: 'shopping' });
  assert.equal(creditCardLiability(state, 'one'), 35000);
  assert.equal(creditCardAvailable(state, 'one'), 65000);
  assert.equal(deriveFinancePosition(state).cardLiability, 35000);
});

test('card payment reduces owned money and liability without adding expense', () => {
  const state = initialFinanceState(); card(state, 'one');
  state.transactions.push({ id: 'purchase', type: 'expense', amount: 30000, date: '2026-01-01', creditCardId: 'one', categoryId: 'default-10' });
  recordCreditCardPayment(state, { cardId: 'one', amount: 10000, date: '2026-01-02', transactionId: 'payment' });
  assert.equal(creditCardLiability(state, 'one'), 20000);
  assert.equal(deriveFinancePosition(state, { openingBalance: 100000 }).totalOwned, 80000);
  assert.equal(financeSummary(state, null).expenses, 30000);
  assert.equal(financeSummary(state, null).creditPayments, 0);
  assert.equal(financeSummary(state, null).transferOut, 10000);
});

test('card refund offsets net category spend and does not add bank cash', () => {
  const state = initialFinanceState(); card(state, 'one');
  state.transactions.push({ id: 'purchase', type: 'expense', amount: 10000, date: '2026-01-01', creditCardId: 'one', categoryId: 'default-10' });
  createRefundState(state, { originalTransactionId: 'purchase', amount: 4000, date: '2026-01-03' });
  assert.equal(creditCardLiability(state, 'one'), 6000);
  assert.equal(deriveFinancePosition(state, { openingBalance: 100000 }).totalOwned, 94000);
  assert.equal(financeSummary(state, null).expenses, 6000);
});

test('refund after full card payment creates card credit without changing bank cash', () => {
  const state = initialFinanceState(); card(state, 'one');
  state.transactions.push({ id: 'purchase', type: 'expense', amount: 10000, date: '2026-01-01', creditCardId: 'one', categoryId: 'default-10' });
  recordCreditCardPayment(state, { cardId: 'one', amount: 10000, date: '2026-01-02', transactionId: 'payment' });
  createRefundState(state, { originalTransactionId: 'purchase', amount: 3000, date: '2026-01-03' });
  assert.equal(creditCardLiability(state, 'one'), -3000);
  assert.equal(creditCardAvailable(state, 'one'), 103000);
  assert.equal(deriveFinancePosition(state, { openingBalance: 100000 }).totalOwned, 100000);
  assert.equal(financeSummary(state, null).expenses, 7000);
});

test('pending refunds reserve capacity but do not change card liability until received', () => {
  const state = initialFinanceState(); card(state, 'one');
  state.transactions.push({ id: 'purchase', type: 'expense', amount: 5000, date: '2026-01-01', creditCardId: 'one' });
  createRefundState(state, { originalTransactionId: 'purchase', amount: 5000, date: '2026-01-02', status: 'pending' });
  assert.equal(creditCardLiability(state, 'one'), 5000);
  assert.equal(remainingRefundable(state.transactions, state.transactions[0]), 0);
});

test('reversed refunds restore liability and refund capacity', () => {
  const state = initialFinanceState(); card(state, 'one');
  state.transactions.push({ id: 'purchase', type: 'expense', amount: 5000, date: '2026-01-01', creditCardId: 'one' });
  const refund = createRefundState(state, { originalTransactionId: 'purchase', amount: 2000, date: '2026-01-02' });
  reverseRefundState(state, refund.id, '2026-01-03');
  assert.equal(creditCardLiability(state, 'one'), 5000);
});

test('multiple cards maintain separate balances', () => {
  const state = initialFinanceState(); card(state, 'one'); card(state, 'two');
  state.transactions.push({ id: 'a', type: 'expense', amount: 1000, date: '2026-01-01', creditCardId: 'one' }, { id: 'b', type: 'expense', amount: 4000, date: '2026-01-01', creditCardId: 'two' });
  assert.equal(creditCardLiability(state, 'one'), 1000);
  assert.equal(creditCardLiability(state, 'two'), 4000);
});

test('card fees and interest enter as expenses, raise liability, and remain after archive', async () => {
  const state = initialFinanceState(); card(state, 'one');
  state.transactions.push({ id: 'interest', type: 'expense', amount: 1250, date: '2026-02-01', creditCardId: 'one', categoryId: 'default-10', title: 'Card interest' });
  assert.equal(creditCardLiability(state, 'one'), 1250);
  assert.equal(financeSummary(state, null).expenses, 1250);
  const { archiveCreditCard } = await import('./creditCards.js');
  archiveCreditCard(state, 'one', '2026-02-02');
  assert.equal(creditCardLiability(state, 'one'), 1250);
  assert.equal(state.creditCards[0].archivedAt, '2026-02-02');
});

test('card payment from a bank account reduces that account and card liability without becoming spending',()=>{const state=initialFinanceState();card(state,'one');createFinanceAccount(state,{accountId:'bank-1',name:'Current account',type:'bank',openingBalance:50000});state.transactions.push({id:'purchase',type:'expense',amount:20000,date:'2026-01-01',creditCardId:'one',categoryId:'default-10'});recordCreditCardPayment(state,{cardId:'one',amount:5000,date:'2026-01-02',accountId:'bank-1',transactionId:'payment'});assert.equal(financeAccountBalance(state,'bank-1'),45000);assert.equal(creditCardLiability(state,'one'),15000);assert.equal(financeSummary(state,null).expenses,20000);assert.equal(financeSummary(state,null).transferOut,5000);});
