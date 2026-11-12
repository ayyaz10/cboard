import { id } from './financeData.js';
import { financeAccountBalance } from './financeAccounts.js';
import { deriveFinancePosition } from './financeLedger.js';
import { debtRemainingAmount, recordDebtPayment } from './debtAccounting.js';
import { settleAllocation } from './financeAllocations.js';

const whole = value => Number.isSafeInteger(value) && value > 0;
const activeAccount = (state, accountId) => (state.accounts || []).find(account => account.id === accountId && !account.archivedAt);

export function sendMoneyPreview(state, accountId, totalCost, reservedDebtUsed = 0) {
  const amount = Number(totalCost) || 0;
  if (accountId) {
    const account = activeAccount(state, accountId);
    const available = account ? financeAccountBalance(state, accountId) : 0;
    return { available, sufficient: Boolean(account && available >= amount) };
  }
  const available = deriveFinancePosition(state).spendable + reservedDebtUsed;
  return { available, sufficient: available >= amount };
}

export function recordSendMoney(state, plan) {
  if (!plan?.id || (state.sendMoneyHistory || []).some(item => item.id === plan.id)) throw new Error('This transfer was already recorded.');
  const currency = state.settings?.currency || 'GBP';
  const date = String(plan.date || '').slice(0, 10);
  const sourceAmount = Number(plan.sourceAmount), fee = Number(plan.fee || 0), cost = sourceAmount + fee;
  if (date.length !== 10 || date[4] !== '-' || date[7] !== '-' || Number.isNaN(Date.parse(date + 'T12:00:00')) || !whole(sourceAmount) || !Number.isSafeInteger(fee) || fee < 0 || !Number.isFinite(plan.rate) || plan.rate <= 0 || !plan.destinationCurrency) throw new Error('Check the amount, date, fee, destination currency, and exchange rate.');
  if (!Array.isArray(plan.items) || !plan.items.length || plan.items.reduce((sum, item) => sum + Number(item.amount || 0), 0) !== sourceAmount) throw new Error('The selected payments no longer match the transfer total.');
  if (plan.accountId && !activeAccount(state, plan.accountId)) throw new Error('Choose an available funding account.');
  const reservedDebtUsed = plan.accountId ? 0 : plan.items.filter(item => item.kind === 'debt').reduce((total, item) => {
    const reserved = (state.transactions || []).filter(row => row.type === 'debt' && row.targetId === item.debtId && row.allocationStatus === 'allocated' && !row.reversedAt).reduce((sum, row) => sum + row.amount, 0);
    return total + Math.min(item.amount, reserved);
  }, 0);
  const balance = sendMoneyPreview(state, plan.accountId, cost, reservedDebtUsed);
  if (!balance.sufficient) throw new Error(`Insufficient funds. Available: ${balance.available} minor units.`);

  const createdTransactionIds = [];
  for (const item of plan.items) {
    if (!whole(Number(item.amount))) throw new Error('Each payment must be greater than zero.');
    if (item.kind === 'debt') {
      const debt = (state.debts || []).find(record => record.id === item.debtId && !record.archivedAt);
      if (!debt || item.amount > debtRemainingAmount(state, debt.id)) throw new Error('A selected debt changed. Review the amount and try again.');
      let remaining = item.amount;
      const allocations = (state.transactions || []).filter(row => row.type === 'debt' && row.targetId === debt.id && row.allocationStatus === 'allocated' && !row.reversedAt).sort((a, b) => String(a.date).localeCompare(String(b.date)));
      for (const allocation of allocations) {
        if (!remaining) break;
        const used = Math.min(remaining, allocation.amount);
        const left = allocation.amount - used;
        if (left) state.transactions.push({ ...structuredClone(allocation), id: id(), amount: left, sequence: undefined, sendMoneyId: undefined });
        allocation.amount = used;
        allocation.accountId = plan.accountId || '';
        allocation.sendMoneyId = plan.id;
        if (!settleAllocation(state, allocation.id, date)) throw new Error('A reserved debt allocation could not be settled.');
        createdTransactionIds.push(allocation.id);
        remaining -= used;
      }
      if (remaining) {
        const transaction = recordDebtPayment(state, { debtId: debt.id, amount: remaining, date, title: `Payment to ${debt.name}`, note: plan.note || 'Recorded from Send Money' });
        transaction.accountId = plan.accountId || '';
        transaction.sendMoneyId = plan.id;
        createdTransactionIds.push(transaction.id);
      }
    } else if (item.kind === 'other') {
      const categoryId = (state.categories || []).some(category => category.id === item.categoryId && category.type === 'expense' && !category.archived) ? item.categoryId : '';
      if (!categoryId) throw new Error('Choose a current expense category for each other payment.');
      const transaction = { id: id(), title: String(item.recipient || '').trim().slice(0, 100) || 'Other payment', amount: item.amount, type: 'expense', categoryId, accountId: plan.accountId || '', date, note: [item.purpose, item.note, plan.note].filter(Boolean).join(' · ').slice(0, 300), createdAt: new Date().toISOString(), sendMoneyId: plan.id, sourceType: 'send_money' };
      state.transactions.push(transaction);
      createdTransactionIds.push(transaction.id);
    } else throw new Error('A selected payment type is not supported.');
  }
  let feeTransactionId = '';
  if (fee) {
    const category = (state.categories || []).find(item => item.name.toLowerCase() === 'other' && item.type === 'expense' && !item.archived) || (state.categories || []).find(item => item.type === 'expense' && !item.archived);
    if (!category) throw new Error('Add an expense category before recording a transfer fee.');
    feeTransactionId = id();
    state.transactions.push({ id: feeTransactionId, title: 'Transfer fee', amount: fee, type: 'expense', categoryId: category.id, accountId: plan.accountId || '', date, note: plan.note || '', createdAt: new Date().toISOString(), sendMoneyId: plan.id, sourceType: 'send_money_fee' });
    createdTransactionIds.push(feeTransactionId);
  }
  const history = { id: plan.id, date, destination: String(plan.destination || '').slice(0, 80), sourceCurrency: currency, destinationCurrency: plan.destinationCurrency, sourceAmount, fee, totalCost: cost, rate: Number(plan.rate), expectedAmount: Number(plan.expectedAmount), actualAmount: plan.actualAmount == null || plan.actualAmount === '' ? null : Number(plan.actualAmount), accountId: plan.accountId || '', note: String(plan.note || '').slice(0, 300), items: plan.items.map(item => ({ kind: item.kind, debtId: item.debtId || '', recipient: item.recipient || '', purpose: item.purpose || '', amount: item.amount, categoryId: item.categoryId || '' })), transactionIds: createdTransactionIds, feeTransactionId };
  state.sendMoneyHistory ||= [];
  state.sendMoneyHistory.push(history);
  return history;
}
