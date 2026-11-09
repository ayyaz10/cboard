import { id, today } from './financeData.js';

const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const minor = value => Number.isSafeInteger(value) && value >= 0;
const active = item => !item.reversedAt && !['planned', 'cancelled'].includes(item.allocationStatus) && (!item.source || item.providerStatus === 'BOOK');

export function createCreditCard(state, card) {
  state.creditCards ||= [];
  const name = String(card.name || '').trim();
  const creditLimit = card.creditLimit ?? 0, openingLiability = card.openingLiability ?? 0;
  if (!card.id || !name || name.length > 80 || state.creditCards.some(item => item.id === card.id)) throw new Error('Enter a unique card name.');
  if (!minor(creditLimit) || !minor(openingLiability)) throw new Error('Credit limit and opening balance must be valid amounts.');
  const lastFour = String(card.lastFour || '').trim();
  if (lastFour && !/^\d{4}$/.test(lastFour)) throw new Error('Last four digits must contain four numbers.');
  const apr = card.apr === '' || card.apr == null ? null : Number(card.apr);
  if (apr != null && (!Number.isFinite(apr) || apr < 0 || apr > 1000)) throw new Error('APR must be between 0 and 1000%.');
  const result = { id: card.id, name, provider: String(card.provider || '').trim().slice(0, 80), lastFour, currency: card.currency || 'GBP', creditLimit, openingLiability, statementBalance: minor(card.statementBalance) ? card.statementBalance : null, minimumPayment: minor(card.minimumPayment) ? card.minimumPayment : 0, dueDate: validDate(card.dueDate) ? card.dueDate : '', statementDate: validDate(card.statementDate) ? card.statementDate : '', apr, archivedAt: '', createdAt: card.createdAt || new Date().toISOString() };
  state.creditCards.push(result);
  return result;
}

export function creditCardLiability(state, cardOrId, asOfDate = '9999-12-31') {
  const card = typeof cardOrId === 'string' ? (state.creditCards || []).find(item => item.id === cardOrId) : cardOrId;
  if (!card) return 0;
  let liability = Number.isSafeInteger(card.openingLiability) ? card.openingLiability : 0;
  const transactions = (state.transactions || []).filter(item => active(item) && String(item.date || '').slice(0, 10) <= asOfDate);
  const byId = new Map(transactions.map(item => [item.id, item]));
  for (const item of transactions) {
    if (item.type === 'expense' && item.creditCardId === card.id) liability += item.amount;
    if (item.type === 'cardCredit' && item.creditCardId === card.id) liability -= item.amount;
    if (item.type === 'refund' && (item.refundStatus || 'received') === 'received') {
      const original = byId.get(item.originalTransactionId);
      if (original?.creditCardId === card.id) liability -= item.amount;
    }
    if (item.type === 'transfer' && item.transferKind === 'card-payment' && item.creditCardId === card.id) liability -= item.amount;
  }
  return liability;
}

export function creditCardAvailable(state, cardOrId, asOfDate) {
  const card = typeof cardOrId === 'string' ? (state.creditCards || []).find(item => item.id === cardOrId) : cardOrId;
  if (!card) return 0;
  return Number(card.creditLimit || 0) - creditCardLiability(state, card, asOfDate);
}

export function recordCreditCardPayment(state, { cardId, amount, date = today(), paidFromFundId = '', accountId = '', note = '', transactionId = id() }) {
  const card = (state.creditCards || []).find(item => item.id === cardId && !item.archivedAt);
  if (!card) throw new Error('Choose an active credit card.');
  if (!Number.isSafeInteger(amount) || amount <= 0 || !validDate(date)) throw new Error('Enter a valid payment amount and date.');
  if (amount > Math.max(0, creditCardLiability(state, card))) throw new Error('Payment cannot exceed the current amount owed.');
  if ((state.transactions || []).some(item => item.id === transactionId)) throw new Error('This transaction identifier is already in use.');
  const transaction = { id: transactionId, sequence: Math.max(0, ...(state.transactions || []).map((item, index) => item.sequence ?? index + 1)) + 1, type: 'transfer', transferKind: 'card-payment', title: `Payment to ${card.name}`, amount, date, creditCardId: card.id, ...(accountId ? { accountId } : {}), fromFundId: paidFromFundId || '', note: String(note || '').trim(), createdAt: new Date().toISOString() };
  state.transactions.push(transaction);
  return transaction;
}

export function archiveCreditCard(state, cardId, date = today()) {
  const card = (state.creditCards || []).find(item => item.id === cardId);
  if (!card || card.archivedAt || !validDate(date)) throw new Error('This card cannot be archived.');
  card.archivedAt = date;
  return card;
}
