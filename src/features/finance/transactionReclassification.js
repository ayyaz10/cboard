import { id } from './financeData.js';
import { addFinancePerson, createPersonLiabilityState } from './flexiblePayments.js';
import { processIncomeTransactionChange } from './financeAllocations.js';
import { canRefundTransaction, linkExistingIncomeAsRefundState, remainingRefundable } from './refunds.js';
import { isValidTransferPair, linkExistingTransactionsAsTransferState } from './financeAccounts.js';

const clear = (record, keys) => keys.forEach(key => delete record[key]);

export function reclassifySavedTransactionState(state, { transactionId, type, originalTransactionId = '', receivableId = '', personId = '', personName = '' }) {
  const transaction = (state.transactions || []).find(item => item.id === transactionId);
  if (!transaction) throw new Error('This transaction no longer exists.');
  const previous = structuredClone(transaction);
  if (!['income', 'refund', 'reimbursement', 'transfer', 'borrowedCash', 'cardCredit'].includes(type)) throw new Error('Choose a supported classification.');
  if (previous.type === type) return transaction;
  const linkedEntry = collection => (state[collection] || []).find(entry => entry.id === previous.personalEntryId);

  if (previous.type === 'income' && type === 'refund') {
    const original = state.transactions.find(item => item.id === originalTransactionId);
    if (!canRefundTransaction(state.transactions, original) || remainingRefundable(state.transactions, original) < transaction.amount || Boolean(original.creditCardId) !== Boolean(transaction.creditCardId) || original.creditCardId && original.creditCardId !== transaction.creditCardId) throw new Error('Choose an eligible purchase with enough refundable amount.');
    linkExistingIncomeAsRefundState(state, { incomingTransactionId: transaction.id, originalTransactionId });
  } else if (previous.type === 'refund' && type === 'income') {
    if ((previous.refundKind && previous.refundKind !== 'merchant-refund') || previous.refundToPerson || previous.refundLiabilityApplied || previous.refundToCard || previous.refundStatus === 'pending' || previous.reversedAt) throw new Error('This refund has linked money changes that must be resolved before it can become Income.');
    transaction.reclassifiedFromRefund = { originalTransactionId: previous.originalTransactionId, reclassifiedAt: new Date().toISOString() };
    clear(transaction, ['originalTransactionId', 'refundStatus', 'refundKind', 'refundDestination', 'refundToCard', 'linkedAt']);
    transaction.type = 'income';
  } else if (previous.type === 'income' && type === 'reimbursement') {
    const entry = (state.personalReceivables || []).find(item => item.id === receivableId);
    if (!entry || entry.remainingAmount < transaction.amount) throw new Error('Choose an outstanding reimbursement that covers this amount.');
    const person = (state.financePeople || []).find(item => item.id === entry.personId);
    if (!person) throw new Error('The linked person is missing.');
    entry.remainingAmount -= transaction.amount;
    entry.history ||= [];
    entry.history.push({ id: id(), kind: 'reimbursement', amount: transaction.amount, date: transaction.date, accountId: transaction.accountId || '', transactionId: transaction.id, note: transaction.title || '' });
    Object.assign(transaction, { type: 'reimbursement', personId: person.id, personalEntryId: entry.id });
  } else if (previous.type === 'reimbursement' && type === 'income') {
    const entry = linkedEntry('personalReceivables');
    const history = entry?.history || [];
    const row = [...history].reverse().find(item => item.transactionId === transaction.id && item.kind === 'reimbursement' && item.amount === transaction.amount && !item.reversedAt);
    if (!entry || !row || entry.remainingAmount + transaction.amount > entry.originalAmount) throw new Error('This reimbursement has changed since it was recorded and cannot be safely unlinked.');
    entry.remainingAmount += transaction.amount;
    row.reversedAt = new Date().toISOString();
    clear(transaction, ['personId', 'personalEntryId']);
    transaction.type = 'income';
  } else if (previous.type === 'income' && type === 'borrowedCash') {
    const person = personId ? (state.financePeople || []).find(item => item.id === personId && !item.archived) : null;
    if (!person && !String(personName || '').trim()) throw new Error('Choose or enter the person who lent you this money.');
    const resolved = person || addFinancePerson(state, personName);
    const liability = createPersonLiabilityState(state, { personId: resolved.id, amount: transaction.amount, transactionId: transaction.id, date: transaction.date, notes: transaction.title || '', kind: 'borrowed-cash' });
    Object.assign(transaction, { type: 'borrowedCash', personId: resolved.id, personalEntryId: liability.id });
  } else if (previous.type === 'borrowedCash' && type === 'income') {
    const entry = linkedEntry('personalLiabilities');
    if (!entry || entry.remainingAmount !== entry.originalAmount || (entry.history || []).filter(item => item.transactionId === transaction.id).length !== 1 || (entry.history || []).length !== 1) throw new Error('This borrowed amount has later activity and cannot be safely unlinked.');
    entry.reversedAt = new Date().toISOString();
    entry.remainingAmount = 0;
    entry.history[0].reversedAt = entry.reversedAt;
    clear(transaction, ['personId', 'personalEntryId']);
    transaction.type = 'income';
  } else if (previous.type === 'transfer' && type === 'income') {
    if (!isValidTransferPair(state, transaction) || previous.transferKind !== 'linked' || previous.transferSide !== 'in') throw new Error('Only the incoming side of a linked own-account transfer can become Income.');
    const pair = state.transactions.filter(item => item.linkedTransferId === previous.linkedTransferId && item.id !== transaction.id);
    if (pair.length !== 1 || pair[0].transferSide !== 'out') throw new Error('The paired transfer record is missing.');
    const outgoing = pair[0];
    clear(transaction, ['transferKind', 'linkedTransferId', 'transferSide', 'linkedAt']);
    clear(outgoing, ['transferKind', 'linkedTransferId', 'transferSide', 'linkedAt']);
    transaction.type = 'income';
    outgoing.type = 'expense';
  } else if (previous.type === 'income' && type === 'cardCredit') {
    const cardId = previous.creditCardId || (state.creditCards || []).find(card => card.id === previous.accountId)?.id;
    if (!cardId || !(state.creditCards || []).some(card => card.id === cardId)) throw new Error('Card credit is only available for a transaction linked to a credit card.');
    Object.assign(transaction, { type: 'cardCredit', creditCardId: cardId, accountId: cardId });
  } else if (previous.type === 'income' && type === 'transfer') {
    const counterpart = state.transactions.find(item => item.id === originalTransactionId);
    if (!counterpart || counterpart.type !== 'expense') throw new Error('Choose the matching outgoing transaction.');
    linkExistingTransactionsAsTransferState(state, { firstId: transaction.id, secondId: counterpart.id });
  } else {
    throw new Error('This classification change is not supported for the current transaction.');
  }
  processIncomeTransactionChange(state, previous, transaction);
  return transaction;
}
