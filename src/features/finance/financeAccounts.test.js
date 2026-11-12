import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFinanceAccount, financeAccountBalance, findMatchingAccountTransaction, findPossibleCardPayment, findPossibleTransfer, linkCardPaymentState, linkExistingTransactionsAsTransferState } from './financeAccounts.js';

const state = () => ({ settings: { currency: 'GBP' }, accounts: [], creditCards: [], transactions: [] });

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