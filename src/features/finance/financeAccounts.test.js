import { test } from 'node:test';
import { financeSummary } from './financeMath.js';
import assert from 'node:assert/strict';
import { createFinanceAccount, financeAccountBalance, financeAccountPosition, findMatchingAccountTransaction, findPossibleCardPayment, findPossibleTransfer, linkCardPaymentState, linkExistingTransactionsAsTransferState } from './financeAccounts.js';

const state = () => ({ settings: { currency: 'GBP', monthlyIncome: 0 }, budgets: {}, accounts: [], creditCards: [], transactions: [] });

test('account imports change the selected stable account balance and persist via state', () => {
  const data = state(); createFinanceAccount(data, { name: 'Current', accountId: 'current', openingBalance: 10000 });
  data.transactions.push({ id: 'out', accountId: 'current', type: 'expense', amount: 2500, date: '2026-11-01' }, { id: 'in', accountId: 'current', type: 'income', amount: 5000, date: '2026-11-02' });
  assert.equal(financeAccountBalance(data, 'current'), 12500);
  assert.equal(data.accounts[0].id, 'current');
});

test('transfer matching is conservative and linking retains IDs and neutralizes categories', () => {
  const data = state(); createFinanceAccount(data, { name: 'Current', accountId: 'current' }); createFinanceAccount(data, { name: 'Savings', accountId: 'savings', type: 'savings' });
  const out = { id: 'out', accountId: 'current', type: 'expense', amount: 50000, date: '2026-11-02', title: 'TRANSFER SAVINGS' };
  const incoming = { id: 'in', accountId: 'savings', type: 'income', amount: 50000, date: '2026-11-03', title: 'CURRENT ACCOUNT' };
  data.transactions.push(out, incoming);
  assert.equal(findPossibleTransfer({ date: '2026-11-02', amount: 50000, direction: 'expense', description: 'Transfer to savings' }, 'current', [incoming])?.id, 'in');
  assert.equal(findMatchingAccountTransaction({ date: '2026-11-02', amount: 50000, direction: 'expense', description: 'Transfer to savings' }, 'current', [out])?.id, 'out');
  const result = linkExistingTransactionsAsTransferState(data, { firstId: 'out', secondId: 'in' });
  assert.equal(result.outgoing.id, 'out'); assert.equal(result.incoming.id, 'in');
  assert.equal(financeAccountBalance(data, 'current'), -50000); assert.equal(financeAccountBalance(data, 'savings'), 50000);
  assert.equal(data.transactions.length, 2);
  assert.equal(data.transactions.filter(item => item.type === 'income' || item.type === 'expense').length, 0);
});

import { deriveFinancePosition } from './financeLedger.js';
import { findImportDuplicate } from './transactionImport.js';
import { normalizeFinanceState } from './financeData.js';

test('card purchase, refund, and linked bank payment move cash and liability once', () => {
  const data = state(); createFinanceAccount(data, { name: 'Current', accountId: 'current', openingBalance: 100000 }); data.creditCards.push({ id: 'card', name: 'Card', openingLiability: 0, creditLimit: 200000 });
  const bank = { id: 'bank-pay', accountId: 'current', type: 'expense', amount: 7000, date: '2026-11-05', title: 'BARCLAYCARD PAYMENT', sourceType: 'file_import', importDirection: 'expense' };
  const cardIncome = { id: 'card-pay', accountId: 'card', type: 'income', amount: 7000, date: '2026-11-05', title: 'PAYMENT RECEIVED', sourceType: 'file_import', importDirection: 'income' };
  data.transactions.push({ id: 'purchase', accountId: 'card', creditCardId: 'card', type: 'expense', amount: 10000, date: '2026-11-01', title: 'Amazon', categoryId: 'shopping' }, { id: 'refund', type: 'refund', amount: 3000, date: '2026-11-03', title: 'Amazon', originalTransactionId: 'purchase', refundStatus: 'received' }, bank, cardIncome);
  assert.equal(findPossibleCardPayment({ direction: 'income', amount: 7000, date: '2026-11-05', description: 'PAYMENT RECEIVED' }, 'card', [bank])?.id, 'bank-pay');
  linkCardPaymentState(data, { bankTransactionId: 'bank-pay', cardTransactionId: 'card-pay' });
  assert.equal(findImportDuplicate({ date: '2026-11-05', amount: 7000, description: 'PAYMENT RECEIVED', direction: 'income' }, data.transactions)?.id, 'card-pay');
  const position = deriveFinancePosition(data, { openingBalance: 100000 });
  assert.equal(position.activity.income, 0); assert.equal(position.activity.expenses, 7000);
  assert.equal(position.totalOwned, 93000); assert.equal(financeAccountBalance(data, 'current'), 93000);
});

test('account IDs and linked transfer relationships survive workspace restore normalization', () => {
  const restored = normalizeFinanceState(JSON.parse(JSON.stringify({ settings: { currency: 'GBP' }, importAccountMappings: { 'my current': 'current' }, accounts: [{ id: 'current', name: 'Current', type: 'bank', openingBalance: 10000 }], creditCards: [{ id: 'card', name: 'Card', openingLiability: 0, creditLimit: 20000 }], transactions: [{ id: 'out', type: 'transfer', accountId: 'current', amount: 500, date: '2026-11-01', transferKind: 'linked', linkedTransferId: 'pair', transferSide: 'out' }, { id: 'in', type: 'transfer', accountId: 'card', amount: 500, date: '2026-11-01', transferKind: 'linked', linkedTransferId: 'pair', transferSide: 'in' }] })));
  assert.equal(restored.accounts[0].id, 'current'); assert.equal(restored.importAccountMappings['my current'], 'current'); assert.equal(restored.transactions[0].linkedTransferId, 'pair'); assert.equal(restored.transactions[1].accountId, 'card');
});

test('reclassified reimbursements and borrowed money remain positive account movements', () => {
  const data=state(); createFinanceAccount(data,{name:'Current',accountId:'current',openingBalance:10000});
  data.transactions.push({id:'reimbursed',accountId:'current',type:'reimbursement',amount:2500,date:'2026-11-01'},{id:'borrowed',accountId:'current',type:'borrowedCash',amount:5000,date:'2026-11-02'});
  assert.equal(financeAccountBalance(data,'current'),17500);
});
test('Credit Purchase payments reduce the selected stable account once and reversal restores it', () => {
  const data = state(); createFinanceAccount(data, { name: 'Current', accountId: 'current', openingBalance: 10000 });
  const payment = { id: 'credit-payment', accountId: 'current', type: 'creditPayment', amount: 2925, date: '2026-11-25' };
  data.transactions.push(payment);
  assert.equal(financeAccountBalance(data, 'current'), 7075);
  payment.reversedAt = '2026-11-26T10:00:00.000Z';
  assert.equal(financeAccountBalance(data, 'current'), 10000);
});

test('account position includes the opening balance, income, paid expenses, debt payments, and refunds in minor units', () => {
  const data = state(); createFinanceAccount(data, { name: 'Current', accountId: 'current', openingBalance: 10000 });
  data.transactions.push(
    { id: 'salary', accountId: 'current', type: 'income', amount: 12500, date: '2026-11-01' },
    { id: 'side-income', accountId: 'current', type: 'income', amount: 1500, date: '2026-11-01' },
    { id: 'groceries', accountId: 'current', type: 'expense', amount: 1250, date: '2026-11-02' },
    { id: 'debt', accountId: 'current', type: 'debt', amount: 300, date: '2026-11-03', allocationStatus: 'paid' },
    { id: 'donation', accountId: 'current', type: 'donation', amount: 700, date: '2026-11-04', allocationStatus: 'paid' },
    { id: 'original', accountId: 'current', type: 'expense', amount: 800, date: '2026-11-04' },
    { id: 'refund', accountId: 'current', type: 'refund', amount: 200, date: '2026-11-05', originalTransactionId: 'original', refundStatus: 'received' },
    { id: 'pending-refund', accountId: 'current', type: 'refund', amount: 100, date: '2026-11-06', originalTransactionId: 'original', refundStatus: 'pending' },
  );
  const position = financeAccountPosition(data, 'current');
  assert.deepEqual([position.openingBalance, position.income, position.refunds, position.otherIncome, position.expenses, position.balance, position.lastTransactionDate], [10000, 14000, 200, 0, 3050, 21150, '2026-11-05']);
  assert.equal(financeAccountBalance(data, 'current'), position.balance);
});


test('linked transfers and account-specific cash deposits are not combined across accounts or currencies', () => {
  const data = state();
  createFinanceAccount(data, { name: 'Current', accountId: 'current', openingBalance: 50000, currency: 'GBP' });
  createFinanceAccount(data, { name: 'Savings', accountId: 'savings', type: 'savings', openingBalance: 10000, currency: 'USD' });
  data.transactions.push(
    { id: 'out', accountId: 'current', type: 'transfer', transferKind: 'linked', linkedTransferId: 'pair', transferSide: 'out', amount: 12000, date: '2026-11-01' },
    { id: 'in', accountId: 'savings', type: 'transfer', transferKind: 'linked', linkedTransferId: 'pair', transferSide: 'in', amount: 12000, date: '2026-11-01' },
    { id: 'cash-withdrawal', accountId: 'current', type: 'expense', amount: 5000, date: '2026-11-02' },
    { id: 'cash-deposit', accountId: 'current', type: 'income', amount: 1500, date: '2026-11-03' },
  );
  const current = financeAccountPosition(data, 'current');
  const savings = financeAccountPosition(data, 'savings');
  assert.deepEqual([current.balance, current.transfers, current.expenses, current.income], [34500, -12000, 5000, 1500]);
  assert.deepEqual([savings.balance, savings.transfers, savings.account.currency], [22000, 12000, 'USD']);
});

test('pending bank imports, cancelled, planned, and allocated records do not change the account position', () => {
  const data = state(); createFinanceAccount(data, { name: 'Current', accountId: 'current', openingBalance: 50000 });
  data.transactions.push(
    { id: 'pending', accountId: 'current', type: 'income', amount: 10000, date: '2026-11-01', source: 'bank', providerStatus: 'PENDING' },
    { id: 'booked', accountId: 'current', type: 'income', amount: 3000, date: '2026-11-02', source: 'bank', providerStatus: 'BOOK' },
    { id: 'planned', accountId: 'current', type: 'expense', amount: 2000, date: '2026-11-03', allocationStatus: 'planned' },
    { id: 'cancelled', accountId: 'current', type: 'expense', amount: 2000, date: '2026-11-03', allocationStatus: 'cancelled' },
    { id: 'reserved-debt', accountId: 'current', type: 'debt', amount: 4000, date: '2026-11-03', allocationStatus: 'allocated' },
  );
  assert.equal(financeAccountPosition(data, 'current').balance, 53000);
});

test('edited or deleted transactions recalculate while missing opening balances stay unavailable', () => {
  const data = state(); data.accounts.push({ id: 'legacy', name: 'Legacy', type: 'bank', currency: 'GBP' });
  createFinanceAccount(data, { name: 'Current', accountId: 'current', openingBalance: 1000 });
  const edit = { id: 'expense', accountId: 'current', type: 'expense', amount: 250, date: '2026-11-01' };
  data.transactions.push(edit);
  assert.equal(financeAccountPosition(data, 'current').balance, 750);
  edit.amount = 125;
  assert.equal(financeAccountPosition(data, 'current').balance, 875);
  data.transactions = data.transactions.filter(item => item.id !== edit.id);
  assert.equal(financeAccountPosition(data, 'current').balance, 1000);
  assert.deepEqual([financeAccountPosition(data, 'legacy').available, financeAccountPosition(data, 'legacy').reason], [false, 'missing-opening-balance']);
});

test('account position rejects unsafe aggregate precision rather than rounding silently', () => {
  const data = state(); createFinanceAccount(data, { name: 'Current', accountId: 'current', openingBalance: Number.MAX_SAFE_INTEGER });
  data.transactions.push({ id: 'income', accountId: 'current', type: 'income', amount: 1, date: '2026-11-01' });
  assert.equal(financeAccountPosition(data, 'current').reason, 'precision-overflow');
});

test('account position calculation does not mutate or replace existing Finance totals', () => {
  const data = state(); createFinanceAccount(data, { name: 'Current', accountId: 'current', openingBalance: 20000 });
  data.transactions.push({ id: 'income', accountId: 'current', type: 'income', amount: 5000, date: '2026-11-01' }, { id: 'expense', accountId: 'current', type: 'expense', amount: 1200, date: '2026-11-02' }, { id: 'debt', accountId: 'current', type: 'debt', amount: 300, date: '2026-11-03' });
  const before = financeSummary(data, null);
  assert.equal(financeAccountPosition(data, 'current').balance, 23500);
  const after = financeSummary(data, null);
  assert.deepEqual([after.income, after.expenses, after.debtPayments, after.remaining], [before.income, before.expenses, before.debtPayments, before.remaining]);
});
