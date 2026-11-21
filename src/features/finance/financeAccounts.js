import { id } from './financeData.js';

const live = item => item && !item.reversedAt && !['cancelled', 'planned'].includes(item.allocationStatus);
const booked = item => !item.source || item.providerStatus === 'BOOK';

function accountTransactionMovement(item, state) {
  const amount = Number.isSafeInteger(item.amount) ? item.amount : 0;
  if (item.type === 'transfer') {
    if (item.transferKind === 'linked' && item.linkedTransferId) return item.transferSide === 'in' ? amount : item.transferSide === 'out' ? -amount : 0;
    if (item.transferKind === 'external-out') return -amount;
    if (item.transferKind === 'external-in') return amount;
    if (item.transferKind === 'card-payment' && item.accountingKind !== 'card-liability-only') return -amount;
    return 0;
  }
  if (item.type === 'expense' || item.type === 'creditPayment') return -amount;
  if (item.type === 'donation') return item.allocationStatus === 'allocated' ? 0 : -amount;
  if (item.type === 'debt') return item.allocationStatus === 'allocated' ? 0 : -amount;
  if (item.type === 'personalRepayment') return -amount;
  if (['income', 'reimbursement', 'borrowedCash'].includes(item.type)) return amount;
  if (item.type === 'refund') {
    const original = (state.transactions || []).find(transaction => transaction.id === item.originalTransactionId);
    const eligibleOriginal = original?.type === 'expense' && !original.financeGroup && !original.donationPaymentId
      && (!original.creditAgreementId || original.creditPaymentKind === 'deposit') && !original.creditCardId;
    return (item.refundStatus || 'received') === 'received' && eligibleOriginal && !item.refundToCard && !item.refundToPerson ? amount : 0;
  }
  return 0;
}

/** Per-account transaction totals in the same minor units used by the account ledger. */
export function financeAccountPosition(state, accountId, asOfDate = '9999-12-31') {
  const account = (state.accounts || []).find(item => item.id === accountId);
  if (!account) return { account: null, available: false, reason: 'missing-account' };
  const hasOpeningBalance = Number.isSafeInteger(account.openingBalance);
  const openingBalance = hasOpeningBalance ? account.openingBalance : 0;
  const transactions = (state.transactions || []).filter(item => live(item) && booked(item)
    && String(item.date || '').slice(0, 10) <= asOfDate && item.accountId === accountId);
  const totals = { openingBalance, income: 0, refunds: 0, otherIncome: 0, expenses: 0, transfers: 0, balance: openingBalance, lastTransactionDate: '' };
  for (const item of transactions) {
    const movement = accountTransactionMovement(item, state);
    if (!movement) continue;
    if (item.type === 'transfer') totals.transfers += movement;
    else if (item.type === 'refund') totals.refunds += movement;
    else if (item.type === 'income') totals.income += movement;
    else if (movement > 0) totals.otherIncome += movement;
    else totals.expenses -= movement;
    totals.balance += movement;
    if (!Number.isSafeInteger(totals.balance) || !Number.isSafeInteger(totals.income) || !Number.isSafeInteger(totals.refunds) || !Number.isSafeInteger(totals.otherIncome) || !Number.isSafeInteger(totals.expenses) || !Number.isSafeInteger(totals.transfers)) {
      return { account, available: false, reason: 'precision-overflow' };
    }
    const date = String(item.date || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date > totals.lastTransactionDate) totals.lastTransactionDate = date;
  }
  return { account, ...totals, available: hasOpeningBalance, ...(hasOpeningBalance ? {} : { reason: 'missing-opening-balance' }) };
}

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
  const position = financeAccountPosition(state, accountId, asOfDate);
  return position.available || position.reason === 'missing-opening-balance' ? position.balance : 0;
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
