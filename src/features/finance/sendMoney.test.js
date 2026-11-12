import test from 'node:test';
import assert from 'node:assert/strict';
import { recordSendMoney } from './sendMoney.js';
import { deriveFinancePosition } from './financeLedger.js';

function state() {
  return { settings: { currency: 'GBP' }, categories: [{ id: 'other', name: 'Other', type: 'expense' }], accounts: [], transactions: [{ id: 'income', type: 'income', amount: 1000000, date: '2026-11-01' }], debts: [], debtPayments: [], debtAccruals: [], allocationRules: [], sendMoneyHistory: [], goals: [], investments: [], creditCards: [] };
}
const plan = (overrides = {}) => ({ id: 'send-1', date: '2026-11-12', sourceAmount: 6000, fee: 350, rate: 370, destinationCurrency: 'PKR', expectedAmount: 222000, items: [{ kind: 'other', amount: 6000, recipient: 'Ali', categoryId: 'other' }], ...overrides });

test('records other payment and fee as linked canonical expenses and stores fixed FX history', () => {
  const data = state();
  const result = recordSendMoney(data, plan());
  assert.equal(data.transactions.filter(item => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0), 6350);
  assert.equal(data.transactions.filter(item => item.sendMoneyId === 'send-1').length, 2);
  assert.equal(result.expectedAmount, 222000);
  assert.equal(deriveFinancePosition(data).totalOwned, 993650);
  assert.throws(() => recordSendMoney(data, plan()), /already recorded/);
});

test('records partial debt repayment through the canonical debt payment ledger', () => {
  const data = state();
  data.debts.push({ id: 'debt-1', name: 'Ahmed', original: 24000, remaining: 24000 });
  recordSendMoney(data, plan({ sourceAmount: 15000, fee: 0, items: [{ kind: 'debt', debtId: 'debt-1', amount: 15000 }] }));
  assert.equal(data.debtPayments.reduce((sum, item) => sum + item.amount, 0), 15000);
  assert.equal(data.transactions.find(item => item.type === 'debt').amount, 15000);
  assert.equal(deriveFinancePosition(data).totalOwned, 985000);
});

test('settles reserved debt allocation once and leaves partial remainder reserved', () => {
  const data = state();
  data.debts.push({ id: 'debt-1', name: 'Ahmed', original: 24000, remaining: 24000 });
  data.transactions.push({ id: 'reserve-1', type: 'debt', targetId: 'debt-1', title: 'Ahmed', amount: 18000, date: '2026-11-01', allocationStatus: 'allocated', accountingKind: 'allocation', allocatedOn: '2026-11-01' });
  recordSendMoney(data, plan({ sourceAmount: 12000, fee: 0, items: [{ kind: 'debt', debtId: 'debt-1', amount: 12000 }] }));
  assert.equal(data.transactions.find(item => item.id === 'reserve-1').allocationStatus, 'paid');
  assert.equal(data.transactions.find(item => item.id !== 'reserve-1' && item.type === 'debt').amount, 6000);
  assert.equal(data.debtPayments.reduce((sum, item) => sum + item.amount, 0), 12000);
  assert.equal(deriveFinancePosition(data).reserves.debt, 6000);
  assert.equal(deriveFinancePosition(data).totalOwned, 988000);
});
