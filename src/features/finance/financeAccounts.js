import { id } from './financeData.js';

const live = item => item && !item.reversedAt && !['cancelled', 'planned'].includes(item.allocationStatus);

export function createFinanceAccount(state, { name, type = 'bank', openingBalance = 0, currency = state.settings?.currency || 'GBP', accountId = id() }) {
  state.accounts ||= [];
  const normalizedName = String(name || '').trim();
  if (!normalizedName || normalizedName.length > 80 || state.accounts.some(item => item.id === accountId) || (state.creditCards || []).some(item => item.id === accountId)) throw new Error('Enter a unique account name.');
  if (!['bank', 'savings', 'cash', 'other'].includes(type) || !Number.isSafeInteger(openingBalance)) throw new Error('Enter a supported account type and opening balance.');
  const account = { id: accountId, name: normalizedName, type, openingBalance, currency, archivedAt: '', createdAt: new Date().toISOString() };
  state.accounts.push(account);
  return account;
}

export function financeAccountBalance(state, accountId, asOfDate = '9999-12-31') {
  const account = (state.accounts || []).find(item => item.id === accountId);
  if (!account) return 0;
  return (state.transactions || []).filter(item => live(item) && String(item.date || '').slice(0, 10) <= asOfDate && item.accountId === accountId)
    .reduce((balance, item) => {
      if (item.type === 'transfer' && item.transferKind === 'linked' && item.linkedTransferId) return balance + (item.transferSide === 'in' ? item.amount : -item.amount);
      if (item.type === 'transfer' && item.transferKind === 'external-out') return balance - item.amount;
      if (item.type === 'transfer' && item.transferKind === 'card-payment' && item.accountId === accountId && item.accountingKind !== 'card-liability-only') return balance - item.amount;
      if (item.type === 'transfer' && item.transferKind === 'external-in') return balance + item.amount;
      if (item.type === 'expense') return balance - item.amount;
      if (['income', 'reimbursement', 'borrowedCash'].includes(item.type) || item.type === 'refund' && (item.refundStatus || 'received') === 'received') return balance + item.amount;
      return balance;
    }, account.openingBalance || 0);
}

export function findPossibleTransfer(record, accountId, transactions, windowDays = 3) {
  const date = Date.parse(`${record.date}T00:00:00Z`);
  if (!Number.isFinite(date)) return null;
  const opposite = record.direction === 'expense' ? 'income' : 'expense';
  const evidence = item => /\b(?:transfer|standing order|internal|savings|between accounts|own account|move money)\b/i.test(`${record.description || ''} ${item.title || ''}`);
  const matches = (transactions || []).filter(item => evidence(item) && live(item) && item.type === opposite && item.amount === record.amount && item.accountId && item.accountId !== accountId && Math.abs(Date.parse(`${item.date}T00:00:00Z`) - date) <= windowDays * 86400000)
    .sort((a, b) => Math.abs(Date.parse(`${a.date}T00:00:00Z`) - date) - Math.abs(Date.parse(`${b.date}T00:00:00Z`) - date));
  return matches[0] || null;
}

export function findMatchingAccountTransaction(record, accountId, transactions, windowDays = 3) {
  const date = Date.parse(String(record.date || '') + 'T00:00:00Z');
  if (!Number.isFinite(date)) return null;
  const title = String(record.description || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const words = title.split(/\s+/).filter(word => word.length >= 4 && !['payment', 'transfer', 'purchase'].includes(word));
  const candidates = (transactions || []).filter(item => live(item) && item.accountId === accountId && item.type === record.direction && item.amount === record.amount && Math.abs(Date.parse(String(item.date || '') + 'T00:00:00Z') - date) <= windowDays * 86400000);
  return candidates.map(item => {
    const other = String(item.title || item.rawMerchantText || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const referenceMatch = Boolean(record.reference && item.reference && record.reference === item.reference);
    const shared = words.filter(word => other.includes(word));
    return { item, score: referenceMatch ? 10 : shared.length };
  }).filter(candidate => candidate.score > 0).sort((a, b) => b.score - a.score)[0]?.item || null;
}
export function linkExistingTransactionsAsTransferState(state, { firstId, secondId, linkId = id() }) {
  const first = (state.transactions || []).find(item => item.id === firstId), second = (state.transactions || []).find(item => item.id === secondId);
  if (!first || !second || first === second || !live(first) || !live(second) || !['expense', 'income'].includes(first.type) || !['expense', 'income'].includes(second.type) || first.amount !== second.amount || first.type === second.type || !first.accountId || !second.accountId || first.accountId === second.accountId) throw new Error('Choose equal, opposite transactions from different accounts.');
  const outgoing = first.type === 'expense' ? first : second, incoming = outgoing === first ? second : first;
  for (const [item, side] of [[outgoing, 'out'], [incoming, 'in']]) Object.assign(item, { type: 'transfer', transferKind: 'linked', linkedTransferId: linkId, transferSide: side, linkedAt: new Date().toISOString() });
  return { outgoing, incoming, linkId };
}

export function linkCardPaymentState(state, { bankTransactionId, cardTransactionId }) {
  const bank = state.transactions.find(item => item.id === bankTransactionId), payment = state.transactions.find(item => item.id === cardTransactionId);
  const cardId = payment?.creditCardId || payment?.accountId;
  if (!live(bank) || bank.type !== 'expense' || !live(payment) || !['income', 'cardCredit'].includes(payment.type) || bank.amount !== payment.amount || bank === payment || !(state.creditCards || []).some(card => card.id === cardId)) throw new Error('Choose a matching bank outflow and credit-card payment credit.');
  Object.assign(bank, { type: 'transfer', transferKind: 'external-out', cardPaymentLinkId: payment.id, linkedAt: new Date().toISOString() });
  Object.assign(payment, { type: 'transfer', transferKind: 'card-payment', creditCardId: cardId, accountId: cardId, accountingKind: 'card-liability-only', cardPaymentLinkId: bank.id, linkedAt: bank.linkedAt });
  return { bank, payment };
}

export function findPossibleCardPayment(record, cardId, transactions, windowDays = 3) {
  if (record.direction !== 'income') return null;
  const date = Date.parse(`${record.date}T00:00:00Z`);
  return (transactions || []).filter(item => live(item) && item.type === 'expense' && item.amount === record.amount && item.accountId && item.accountId !== cardId && /card|payment|direct debit/i.test(`${item.title || ''} ${record.description || ''}`) && Math.abs(Date.parse(`${item.date}T00:00:00Z`) - date) <= windowDays * 86400000).sort((x, y) => Math.abs(Date.parse(`${x.date}T00:00:00Z`) - date) - Math.abs(Date.parse(`${y.date}T00:00:00Z`) - date))[0] || null;
}

export function isValidTransferPair(state, transaction) {
  if (transaction?.transferKind !== 'linked' || !transaction.linkedTransferId) return false;
  const pair = state.transactions.filter(item => item.linkedTransferId === transaction.linkedTransferId && live(item));
  return pair.length === 2 && pair[0].amount === pair[1].amount && pair[0].accountId !== pair[1].accountId && pair.some(item => item.transferSide === 'in') && pair.some(item => item.transferSide === 'out');
}
