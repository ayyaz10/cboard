import { id } from './financeData.js';
import { financeAccountBalance } from './financeAccounts.js';
import { deriveFinancePosition } from './financeLedger.js';
import { debtPaymentDue, debtRemainingAmount, markDebtPaymentUnpaid, recordDebtPayment } from './debtAccounting.js';
import { settleAllocation } from './financeAllocations.js';

const whole = value => Number.isSafeInteger(value) && value > 0;
const activeAccount = (state, accountId) => (state.accounts || []).find(account => account.id === accountId && !account.archivedAt);

export function debtReserveAvailable(state, debtId) {
  const legacy = (state.transactions || []).filter(row => row.type === 'debt' && row.targetId === debtId && row.allocationStatus === 'allocated' && !row.reversedAt).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  return legacy + debtPaymentDue(state, debtId);
}
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
  const reservedDebtUsed = plan.accountId ? 0 : plan.items.filter(item => item.kind === 'debt').reduce((total, item) => total + Math.min(item.amount, debtReserveAvailable(state, item.debtId)), 0);
  const reservedFamilySupportUsed = plan.accountId ? 0 : plan.items.filter(item => item.kind === 'familySupport').reduce((total, item) => total + Math.min(item.amount, familySupportAvailable(state)), 0);
  const balance = sendMoneyPreview(state, plan.accountId, cost, reservedDebtUsed + reservedFamilySupportUsed);
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
    } else if (item.kind === 'familySupport') {
      let remaining = item.amount;
      const allocations = (state.transactions || []).filter(row => row.type === 'familySupport' && row.allocationStatus === 'allocated' && !row.reversedAt).sort((a, b) => String(a.allocatedOn || a.date).localeCompare(String(b.allocatedOn || b.date)));
      for (const allocation of allocations) {
        if (!remaining) break;
        const used = Math.min(remaining, allocation.amount);
        let settled = allocation;
        if (used < allocation.amount) {
          allocation.amount -= used;
          settled = { ...structuredClone(allocation), id: id(), amount: used, sequence: undefined, allocationStatus: 'allocated', settlementTransactionId: '', paymentDate: '', sendMoneyId: plan.id };
          state.transactions.push(settled);
        }
        settled.accountId = plan.accountId || '';
        settled.sendMoneyId = plan.id;
        settled.allocationStatus = 'paid';
        settled.allocatedOn ||= settled.date;
        settled.paymentDate = date;
        settled.date = date;
        settled.updatedAt = new Date().toISOString();
        const familyCategory = (state.categories || []).find(category => category.type === 'expense' && !category.archived && category.name.toLocaleLowerCase() === 'family') || (state.categories || []).find(category => category.type === 'expense' && !category.archived);
        if (!familyCategory) throw new Error('Add an expense category before recording Family Support.');
        const payment = { id: id(), title: 'Family Support', amount: used, type: 'expense', categoryId: familyCategory.id, accountId: plan.accountId || '', date, paymentDate: date, note: plan.note || 'Recorded from Family Support reserve', createdAt: new Date().toISOString(), sendMoneyId: plan.id, sourceType: 'send_money_family_support', linkedReservationId: settled.id, familySupportSourceIncomeId: settled.sourceIncomeId || '' };
        settled.settlementTransactionId = payment.id;
        state.transactions.push(payment);
        createdTransactionIds.push(settled.id, payment.id);
        remaining -= used;
      }
      if (remaining) throw new Error('Family Support reserve changed. Review the available amount and try again.');
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
  const history = { id: plan.id, date, status: 'recorded', destination: String(plan.destination || '').slice(0, 80), sourceCurrency: currency, destinationCurrency: plan.destinationCurrency, sourceAmount, fee, totalCost: cost, rate: Number(plan.rate), expectedAmount: Number(plan.expectedAmount), actualAmount: plan.actualAmount == null || plan.actualAmount === '' ? null : Number(plan.actualAmount), accountId: plan.accountId || '', note: String(plan.note || '').slice(0, 300), items: plan.items.map(item => ({ kind: item.kind, debtId: item.debtId || '', recipient: item.recipient || '', purpose: item.purpose || '', amount: item.amount, categoryId: item.categoryId || '' })), transactionIds: createdTransactionIds, feeTransactionId };
  state.sendMoneyHistory ||= [];
  state.sendMoneyHistory.push(history);
  return history;
}


export function familySupportAvailable(state) {
  return (state.transactions || []).filter(row => row.type === 'familySupport' && row.allocationStatus === 'allocated' && !row.reversedAt).reduce((sum, row) => sum + row.amount, 0);
}

/** Reverses every canonical event in one workspace state update. */
export function reverseSendMoney(state, transferId, date, reason = '') {
  const transfer = (state.sendMoneyHistory || []).find(item => item.id === transferId);
  if (!transfer) throw new Error('This transfer record could not be found.');
  if (transfer.status === 'reversed' || transfer.reversedAt) throw new Error('This transfer has already been reversed.');
  const rows = (state.transactions || []).filter(item => item.sendMoneyId === transferId);
  if (!rows.length || rows.some(item => item.source === 'bank' || item.sourceType === 'bank_import')) throw new Error('The transfer contains a bank imported event and cannot be safely reversed here.');
  const reversalId = id();
  const linkedIds = new Set(transfer.transactionIds || []);
  for (const linkedId of linkedIds) { const linked = (state.transactions || []).find(item => item.id === linkedId); if (!linked || linked.sendMoneyId !== transferId) throw new Error('A linked transfer component has been reused or changed by later activity. Reverse the later activity first; no changes were saved.'); }
  const debtRows = rows.filter(item => item.type === 'debt' && !item.reversedAt);
  for (const transaction of debtRows) { if (!markDebtPaymentUnpaid(state, transaction.id, date, '', true)) throw new Error(`Debt payment '${transaction.title || transaction.id}' cannot be safely reversed. Check later debt activity and try again.`); transaction.reversalId = reversalId; transaction.reversalReason = String(reason || 'Send Money transfer reversed').slice(0, 240); const payment = (state.debtPayments || []).find(item => item.transactionId === transaction.id); if (payment) payment.reversalId = reversalId; }
  for (const transaction of rows) {
    if (transaction.type === 'debt') continue;
    if (transaction.type === 'familySupport') {
      const expense = (state.transactions || []).find(item => item.id === transaction.settlementTransactionId && item.sendMoneyId === transferId);
      if (!expense || expense.reversedAt) throw new Error('A Family Support payment link is missing or already changed; no transfer changes were saved.');
      transaction.allocationStatus = 'allocated';
      transaction.paymentDate = '';
      transaction.date = transaction.allocatedOn || transaction.date;
      transaction.settlementTransactionId = '';
      transaction.accountId = '';
      transaction.reversalId = reversalId;
      expense.reversedAt = new Date().toISOString();
      expense.reversalId = reversalId;
      expense.reversalReason = String(reason || '').slice(0, 240);
      continue;
    }
    if (transaction.type === 'expense') {
      if (transaction.reversedAt && transaction.reversalId === reversalId) continue;
      if (transaction.reversedAt) throw new Error('A linked expense has already been reversed; no transfer changes were saved.');
      transaction.reversedAt = new Date().toISOString();
      transaction.reversalId = reversalId;
      transaction.reversalReason = String(reason || '').slice(0, 240);
    }
  }
  transfer.status = 'reversed';
  transfer.reversedAt = new Date().toISOString();
  transfer.reversalDate = date;
  transfer.reversalId = reversalId;
  transfer.reversalReason = String(reason || '').slice(0, 240);
  return transfer;
}
