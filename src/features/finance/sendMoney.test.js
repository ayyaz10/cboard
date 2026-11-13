import test from 'node:test';
import assert from 'node:assert/strict';
import { debtReserveAvailable, familySupportAvailable, recordSendMoney, reverseSendMoney } from './sendMoney.js';
import { applyIncomeAllocations } from './financeAllocations.js';
import { autoAllocationEvents } from './autoAllocationHistory.js';
import { financeAccountBalance } from './financeAccounts.js';
import { calculateFinanceBalances } from './financeBalances.js';
import { accrueDebtPayment, debtPaymentDue, recordDebtPayment } from './debtAccounting.js';
import { deriveFinancePosition } from './financeLedger.js';
import { normalizeFinanceState } from './financeData.js';

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


test('allocates Family Support from each eligible income once and exposes its provenance', () => {
  const data = state();
  data.allocationRules.push({ id: 'family-rule', name: 'Family', targetType: 'familySupport', mode: 'amount', value: 5000, timing: 'income', active: true });
  data.transactions[0].title = 'Salary';
  applyIncomeAllocations(data, data.transactions[0]);
  applyIncomeAllocations(data, data.transactions[0]);
  const extra = { id: 'income-2', type: 'income', title: 'Freelance', amount: 100000, date: '2026-11-10' };
  data.transactions.push(extra); applyIncomeAllocations(data, extra);
  data.transactions.push({ id: 'refund', type: 'refund', amount: 20000, date: '2026-11-11' });
  assert.equal(data.transactions.filter(item => item.type === 'familySupport').length, 2);
  assert.equal(familySupportAvailable(data), 10000);
  assert.equal(autoAllocationEvents(data).filter(event => event.allocationType === 'familySupport').length, 2);
  assert.equal(deriveFinancePosition(data).reserves.familySupport, 10000);
});

test('partially settles Family Support allocations and records actual expense once', () => {
  const data = state();
  data.categories.push({ id: 'family', name: 'Family', type: 'expense' });
  data.transactions.push({ id: 'family-1', type: 'familySupport', title: 'Family support allocation', amount: 30000, date: '2026-11-01', allocatedOn: '2026-11-01', sourceIncomeId: 'income', sourceIncomeDescription: 'Salary', allocationRuleId: 'family-rule', allocationStatus: 'allocated', accountingKind: 'allocation' });
  const initialOwned = deriveFinancePosition(data).totalOwned;
  const send = (id, amount) => recordSendMoney(data, plan({ id, sourceAmount: amount, fee: 0, items: [{ kind: 'familySupport', amount }] }));
  send('family-send-1', 20000);
  assert.equal(familySupportAvailable(data), 10000);
  assert.equal(deriveFinancePosition(data).reserves.familySupport, 10000);
  assert.equal(calculateFinanceBalances(data).reserved.familySupport, 10000);
  assert.equal(data.transactions.filter(item => item.sourceType === 'send_money_family_support' && !item.reversedAt).reduce((sum, item) => sum + item.amount, 0), 20000);
  send('family-send-2', 5000);
  assert.equal(familySupportAvailable(data), 5000);
  assert.equal(deriveFinancePosition(data).reserves.familySupport, 5000);
  assert.equal(deriveFinancePosition(data).activity.expenses, 25000);
  assert.equal(deriveFinancePosition(data).totalOwned, initialOwned - 25000);
});

test('reverses a Family Support payment once and restores reserve, account and provenance', () => {
  const data = state();
  data.accounts.push({ id: 'account', name: 'Current', openingBalance: 50000 });
  data.transactions.push({ id: 'family-1', type: 'familySupport', amount: 30000, date: '2026-11-01', allocatedOn: '2026-11-01', sourceIncomeId: 'income', sourceIncomeDescription: 'Salary', allocationRuleId: 'family-rule', allocationStatus: 'allocated', accountingKind: 'allocation' });
  recordSendMoney(data, plan({ sourceAmount: 20000, fee: 0, accountId: 'account', items: [{ kind: 'familySupport', amount: 20000 }] }));
  const expense = data.transactions.find(item => item.sourceType === 'send_money_family_support');
  assert.equal(financeAccountBalance(data, 'account'), 30000);
  reverseSendMoney(data, 'send-1', '2026-11-12', 'Entered incorrectly');
  assert.equal(expense.reversedAt != null, true);
  assert.equal(familySupportAvailable(data), 30000);
  assert.equal(financeAccountBalance(data, 'account'), 50000);
  assert.equal(deriveFinancePosition(data).reserves.familySupport, 30000);
  assert.throws(() => reverseSendMoney(data, 'send-1', '2026-11-13'), /already been reversed/);
});

test('reverses mixed debt, other payment and fee without changing later debt activity', () => {
  const data = state();
  data.debts.push({ id: 'debt-1', name: 'Ahmed', original: 30000, remaining: 30000 });
  data.accounts.push({ id: 'mixed-account', name: 'Current Account', openingBalance: 100000 });
  data.transactions.push({ id: 'family-1', type: 'familySupport', amount: 30000, date: '2026-11-01', allocatedOn: '2026-11-01', sourceIncomeId: 'income', sourceIncomeDescription: 'Salary', allocationRuleId: 'family-rule', allocationStatus: 'allocated', accountingKind: 'allocation' });
  recordSendMoney(data, plan({ sourceAmount: 39000, accountId: 'mixed-account', items: [
    { kind: 'familySupport', amount: 18000 },
    { kind: 'debt', debtId: 'debt-1', amount: 15000 },
    { kind: 'other', amount: 6000, recipient: 'Ali', categoryId: 'other' },
  ] }));
  const payment = data.transactions.find(item => item.type === 'debt');
  assert.equal(data.debts[0].remaining, 15000);
  assert.equal(financeAccountBalance(data, 'mixed-account'), 60650);
  recordDebtPayment(data, { debtId: 'debt-1', amount: 5000, date: '2026-11-13' });
  reverseSendMoney(data, 'send-1', '2026-11-14');
  assert.equal(data.debts[0].remaining, 25000);
  assert.equal(payment.reversedAt != null, true);
  assert.equal(familySupportAvailable(data), 30000);
  assert.equal(financeAccountBalance(data, 'mixed-account'), 100000);
  assert.equal(deriveFinancePosition(data).reserves.familySupport, 30000);
  assert.equal(deriveFinancePosition(data).activity.expenses, 0);
  assert.equal(deriveFinancePosition(data).totalOwned, 995000);
  assert.equal(data.transactions.filter(item => item.sendMoneyId === 'send-1' && item.type === 'expense').every(item => item.reversedAt), true);
});


test('percentage Family Support applies only to booked Income and respects a paused rule', () => {
  const data = state();
  data.allocationRules.push({ id: 'family-percent', name: 'Family percentage', targetType: 'familySupport', mode: 'percent', value: 1250, timing: 'income', active: true });
  for (const type of ['refund', 'reimbursement', 'borrowedCash', 'cardCredit']) applyIncomeAllocations(data, { id: `not-income-${type}`, type, amount: 20000, date: '2026-11-02' });
  applyIncomeAllocations(data, { id: 'pending-bank', type: 'income', source: 'bank', providerStatus: 'PENDING', amount: 20000, date: '2026-11-03' });
  const income = { id: 'percent-income', type: 'income', amount: 20000, date: '2026-11-04' };
  applyIncomeAllocations(data, income);
  assert.equal(familySupportAvailable(data), 2500);
  data.allocationRules[0].active = false;
  applyIncomeAllocations(data, { id: 'paused-income', type: 'income', amount: 10000, date: '2026-11-05' });
  assert.equal(familySupportAvailable(data), 2500);
});


test('normalization preserves Family Support records and transfer reversal links', () => {
  const normalized = normalizeFinanceState({
    settings: { configured: true, currency: 'GBP' },
    allocationRules: [{ id: 'family-rule', targetType: 'familySupport', timing: 'income', active: true }],
    transactions: [{ id: 'family-row', type: 'familySupport', amount: 2500, date: '2026-11-01', allocationStatus: 'allocated', sourceIncomeId: 'income', allocationRuleId: 'family-rule' }],
    sendMoneyHistory: [{ id: 'transfer', status: 'reversed', reversalId: 'reverse-1', transactionIds: ['family-row'] }],
  });
  assert.equal(normalized.transactions[0].type, 'familySupport');
  assert.equal(normalized.transactions[0].sourceIncomeId, 'income');
  assert.equal(normalized.sendMoneyHistory[0].reversalId, 'reverse-1');
  assert.equal(normalized.allocationRules[0].targetType, 'familySupport');
});

test('Send Money can use canonical accumulated debt reserve for the real payment', () => {
  const data = state();
  data.transactions[0].amount = 20_000;
  data.debts.push({ id: 'debt-1', name: 'Ahmed', original: 24_000, remaining: 24_000 });
  accrueDebtPayment(data, { debtId: 'debt-1', amount: 12_000, effectiveDate: '2026-11-05', sourceType: 'income_rule' });
  assert.equal(deriveFinancePosition(data).spendable, 8_000);
  assert.equal(debtReserveAvailable(data, 'debt-1'), 12_000);
  const history = recordSendMoney(data, plan({ sourceAmount: 12_000, fee: 0, items: [{ kind: 'debt', debtId: 'debt-1', amount: 12_000 }] }));
  assert.equal(history.transactionIds.length, 1);
  assert.equal(data.debts[0].remaining, 12_000);
  assert.equal(debtPaymentDue(data, 'debt-1'), 0);
  assert.equal(deriveFinancePosition(data).totalOwned, 8_000);
  assert.equal(deriveFinancePosition(data).reserves.debt, 0);
});
