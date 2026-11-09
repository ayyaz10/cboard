import { id, today } from './financeData.js';

const cents = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const active = transaction => transaction && !transaction.reversedAt && !['cancelled', 'planned'].includes(transaction.allocationStatus);

export function refundsForTransaction(transactions, originalTransactionId) {
  return (transactions || []).filter(item => item.type === 'refund' && item.originalTransactionId === originalTransactionId);
}

export function receivedRefundTotal(transactions, originalTransactionId) {
  return refundsForTransaction(transactions, originalTransactionId)
    .filter(item => active(item) && (item.refundStatus || 'received') === 'received')
    .reduce((total, item) => total + cents(item.amount), 0);
}

export function remainingRefundable(transactions, original) {
  if (!original || !['expense', 'donation'].includes(original.type) || !active(original)) return 0;
  const committed = refundsForTransaction(transactions, original.id).filter(item => active(item) && ['received', 'pending'].includes(item.refundStatus || 'received')).reduce((total,item)=>total+cents(item.amount),0);
  return Math.max(0, cents(original.amount) - committed);
}

export function canRefundTransaction(transactions, original) {
  return Boolean(original && original.type === 'expense' && !original.originalTransactionId
    && !original.donationPaymentId && !original.linkedReservationId && !original.donationCategoryId && !original.financeGroup
    && (!original.creditAgreementId || original.creditPaymentKind === 'deposit') && !original.creditPaymentId && !original.linkedDonationTargetId
    && !['allocated', 'planned', 'cancelled'].includes(original.allocationStatus)
    && !(original.allocationStatus === 'completed' && original.accountingKind === 'allocation')
    && active(original) && remainingRefundable(transactions, original) > 0 && (!original.source || original.providerStatus === 'BOOK'));
}
export function createRefundState(state, { originalTransactionId, amount, date = today(), status = 'received', destination = '', note = '', kind = 'merchant-refund' }) {
  const original = state.transactions.find(item => item.id === originalTransactionId);
  if (!canRefundTransaction(state.transactions, original)) throw new Error('This transaction has no refundable amount remaining.');
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Enter a valid refund amount.');
  if (!['received', 'pending'].includes(status)) throw new Error('Choose Pending or Received.');
  if (amount > remainingRefundable(state.transactions, original)) throw new Error('Refund amount exceeds the remaining refundable amount.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Enter a valid refund date.');
  const transaction = {
    id: id(), sequence: Math.max(0, ...state.transactions.map((item, index) => item.sequence ?? index + 1)) + 1,
    type: 'refund', title: original.title, amount, date, categoryId: original.categoryId || '',
    originalTransactionId: original.id, refundStatus: status, refundKind: kind, ...(original.accountId && !original.creditCardId ? { accountId: original.accountId } : {}),
    refundDestination: destination || original.paidFromFundId || (original.creditCardId || status === 'pending' ? '' : 'user'), refundToCard: Boolean(original.creditCardId) || String(destination).startsWith('card:'),
    paymentMethod: original.paymentMethod || '', note: String(note).trim(), createdAt: new Date().toISOString(),
  };
  if (destination.startsWith('person:')) {
    const personId = destination.slice(7);
    const linked = original.fundingSources?.some(source => ['person', 'creditor', 'bnpl'].includes(source.kind) && (source.personId === personId || source.sourceId === personId)) || original.paymentSourceType === 'person' && (state.personalLiabilities || []).some(item => item.transactionId === original.id && item.personId === personId);
    const liability = (state.personalLiabilities || []).find(item => item.transactionId === original.id && item.personId === personId && item.remainingAmount > 0);
    if (!linked || !liability || amount > liability.remainingAmount) throw new Error('This refund cannot exceed what you still owe that person.');
    if (status === 'received') { liability.remainingAmount -= amount; liability.history ||= []; liability.history.push({ id: id(), kind: 'merchant-refund-to-person', amount, date, transactionId: transaction.id }); transaction.refundLiabilityApplied = true; }
    else transaction.refundLiabilityApplied = false;
    transaction.refundToPerson = true; transaction.refundPersonId = personId; transaction.personalLiabilityId = liability.id;
  }
  state.transactions.push(transaction);
  return transaction;
}

export function linkExistingIncomeAsRefundState(state, { incomingTransactionId, originalTransactionId }) {
  const incoming = state.transactions.find(item => item.id === incomingTransactionId);
  const original = state.transactions.find(item => item.id === originalTransactionId);
  if (!incoming || !['income', 'cardCredit'].includes(incoming.type) || !active(incoming) || incoming.originalTransactionId) throw new Error('Choose an active incoming transaction to link.');
  if (!canRefundTransaction(state.transactions, original)) throw new Error('Choose an eligible expense with a refundable amount remaining.');
  if (incoming.type === 'cardCredit' && (!original.creditCardId || original.creditCardId !== incoming.creditCardId)) throw new Error('A card credit can only be linked to a purchase made with the same card.');
  if (incoming.amount > remainingRefundable(state.transactions, original)) throw new Error('This incoming amount exceeds the remaining refundable amount.');
  if (incoming.source && incoming.providerStatus !== 'BOOK') throw new Error('Only booked incoming transactions can be linked as refunds.');
  Object.assign(incoming, {
    type: 'refund', originalTransactionId: original.id, refundStatus: 'received',
    refundKind: 'merchant-refund', refundDestination: original.creditCardId ? '' : incoming.paidFromFundId || original.paidFromFundId || 'user', refundToCard: Boolean(original.creditCardId),
    categoryId: original.categoryId || '', linkedAt: new Date().toISOString(),
  });
  return incoming;
}

export function refundNetAmount(transactions, original) {
  return Math.max(0, cents(original?.amount) - receivedRefundTotal(transactions, original?.id));
}

export function reverseRefundState(state, refundId, date = today()) {
  const refund = state.transactions.find(item => item.id === refundId && item.type === 'refund');
  if (!refund || refund.reversedAt) throw new Error('This refund has already been reversed or is unavailable.');
  const applied = refund.refundToPerson && (refund.refundLiabilityApplied ?? true);
  const liability = applied ? (state.personalLiabilities || []).find(item => item.id === refund.personalLiabilityId) : null;
  if (applied && !liability) throw new Error('The linked personal liability is missing; this refund cannot be safely reversed.');
  refund.reversedAt = date;
  if (applied) { liability.remainingAmount += refund.amount; liability.history ||= []; liability.history.push({ id: id(), kind: 'refund-reversed', amount: refund.amount, date, transactionId: refund.id }); refund.refundLiabilityApplied = false; }

  return refund;
}
export function editRefundState(state, { refundId, amount, date, status = 'received', note = '' }) {
  const refund = state.transactions.find(item => item.id === refundId && item.type === 'refund' && !item.reversedAt);
  const original = state.transactions.find(item => item.id === refund?.originalTransactionId);
  if (!refund || !original || original.type !== 'expense' || original.financeGroup || (original.creditAgreementId && original.creditPaymentKind !== 'deposit') || original.donationPaymentId) throw new Error('This refund is unavailable or has no original purchase.');
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Enter a valid refund amount.');
  if (!['received', 'pending'].includes(status)) throw new Error('Choose Pending or Received.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Enter a valid refund date.');
  const others = refundsForTransaction(state.transactions, original.id).filter(item => item.id !== refund.id && active(item) && ['received', 'pending'].includes(item.refundStatus || 'received')).reduce((total,item)=>total+cents(item.amount),0);
  if (amount + others > cents(original.amount)) throw new Error('Refund amount exceeds the remaining refundable amount.');
  const wasApplied = refund.refundToPerson && (refund.refundLiabilityApplied ?? true);
  const shouldApply = refund.refundToPerson && status === 'received';
  if (refund.refundToPerson && (wasApplied || shouldApply)) {
    const liability=(state.personalLiabilities||[]).find(item=>item.id===refund.personalLiabilityId);
    if(!liability)throw new Error('The linked personal liability is missing; this refund cannot be safely edited.');
    const oldApplied=wasApplied?refund.amount:0, nextApplied=shouldApply?amount:0, delta=nextApplied-oldApplied;
    if(delta>liability.remainingAmount)throw new Error('The adjusted refund exceeds the amount you still owe that person.');
    liability.remainingAmount-=delta;liability.history||=[];if(delta)liability.history.push({id:id(),kind:shouldApply?'person-refund-edited':'person-refund-pending',amount:Math.abs(delta),date,transactionId:refund.id});
    refund.refundLiabilityApplied=shouldApply;
  }
  Object.assign(refund, { amount, date, refundStatus: status, note: String(note).trim(), updatedAt: new Date().toISOString() });
  return refund;
}
export function receiveRefundState(state, refundId, date = today()) {
  const refund = (state.transactions || []).find(item => item.id === refundId && item.type === 'refund' && !item.reversedAt && item.refundStatus === 'pending');
  if (!refund) throw new Error('This pending refund cannot be received.');
  return editRefundState(state, { refundId, amount: refund.amount, date, status: 'received', note: refund.note || '' });
}
