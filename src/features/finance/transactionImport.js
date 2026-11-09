import { nextTransactionSequence } from './transactionOrder.js';
import { addFinancePerson, createPersonLiabilityState } from './flexiblePayments.js';
import { matchingTransactions } from './transactionSuggestions.js';
import { normalizeMerchantName } from './merchantDirectory.js';
import { isValidFinanceDate } from './transactionOrder.js';
import { canRefundTransaction, remainingRefundable } from './refunds.js';

export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_TEXT_LENGTH = 25 * 1024 * 1024;
const rowLimitError = () => new Error('Import files can contain at most ' + MAX_IMPORT_ROWS.toLocaleString() + ' transaction rows. Split the statement and import it in parts.');

const aliases = {
  date: ['date', 'transaction date', 'posted date', 'booking date', 'value date'],
  description: ['description', 'merchant', 'payee', 'transaction', 'details', 'narrative', 'memo', 'reference'],
  amount: ['amount', 'transaction amount'], debit: ['debit', 'money out', 'paid out', 'withdrawal'],
  credit: ['credit', 'money in', 'paid in', 'deposit'], balance: ['balance', 'running balance'], currency: ['currency', 'ccy'], account: ['account', 'account name', 'account nickname', 'account holder'],
};
const normalizeHeader = value => String(value || '').replace(/^\uFEFF/, '').trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function parseDelimitedText(input, delimiter) {
  const text = String(input || '').replace(/^\uFEFF/, ''), rows = [];
  if (text.length > MAX_IMPORT_TEXT_LENGTH) throw new Error('This statement is too large to parse safely.');
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && char === delimiter) { row.push(field); field = ''; }
    else if (!quoted && (char === '\n' || char === '\r')) { if (char === '\r' && text[i + 1] === '\n') i++; row.push(field); field = ''; if (row.some(cell => String(cell).trim())) { if (rows.length >= MAX_IMPORT_ROWS + 1) throw rowLimitError(); rows.push(row); } row = []; }
    else field += char;
  }
  if (quoted) throw new Error('This file has an unfinished quoted field.');
  row.push(field); if (row.some(cell => String(cell).trim())) { if (rows.length >= MAX_IMPORT_ROWS + 1) throw rowLimitError(); rows.push(row); }
  return rows;
}

export function detectDelimiter(text) {
  const sample = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).slice(0, 8);
  return [',', ';', '\t'].map(delimiter => {
    const counts = sample.map(line => { let quoted = false, count = 0; for (let i = 0; i < line.length; i++) { if (line[i] === '"') quoted = !quoted; else if (!quoted && line[i] === delimiter) count++; } return count; });
    const nonzero = counts.filter(count => count > 0);
    return { delimiter, score: nonzero.length ? nonzero.reduce((sum, count) => sum + count, 0) / nonzero.length * nonzero.length / sample.length : 0 };
  }).sort((a, b) => b.score - a.score)[0]?.delimiter || ',';
}

export function detectImportColumns(headers) {
  const normalized = headers.map(normalizeHeader), map = {};
  for (const [field, names] of Object.entries(aliases)) { const index = normalized.findIndex(header => names.map(normalizeHeader).includes(header)); if (index >= 0) map[field] = index; }
  return { ...map, confident: Number.isInteger(map.date) && Number.isInteger(map.description) && (Number.isInteger(map.amount) || Number.isInteger(map.debit) || Number.isInteger(map.credit)) };
}

export function parseImportDate(value, order = 'dmy') {
  const text = String(value || '').trim();
  let year, month, day;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) [year, month, day] = text.split('-').map(Number);
  else if (/[A-Za-z]/.test(text)) {
    const parsed = new Date(text);
    if (!Number.isFinite(parsed.getTime())) return '';
    year = parsed.getFullYear(); month = parsed.getMonth() + 1; day = parsed.getDate();
  } else {
    const match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/); if (!match) return '';
    const first = Number(match[1]), second = Number(match[2]);
    day = order === 'mdy' ? second : first; month = order === 'mdy' ? first : second;
    if (first > 12) { day = first; month = second; } else if (second > 12) { day = second; month = first; }
    year = Number(match[3]); if (year < 100) year += year >= 70 ? 1900 : 2000;
  }
  const result = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isValidFinanceDate(result) ? result : '';
}

export function parseImportAmount(value) {
  let text = String(value ?? '').trim(); if (!text) return null;
  const negative = /^\(.*\)$/.test(text) || /^-/.test(text) || /-$/.test(text);
  text = text.replace(/[()\s£$€¥]/g, '').replace(/^(?:GBP|USD|EUR|CAD|AUD|INR|PKR)/i, '').replace(/(?:GBP|USD|EUR|CAD|AUD|INR|PKR)$/i, '');
  if (text.includes(',') && text.includes('.')) text = text.lastIndexOf(',') > text.lastIndexOf('.') ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  else if (text.includes(',') && /,\d{1,2}$/.test(text)) text = text.replace(',', '.'); else text = text.replace(/,/g, '');
  text = text.replace(/^[+-]|-$/g, ''); if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.'), amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount > 0 ? (negative ? -amount : amount) : null;
}

const cell = (row, index) => Number.isInteger(index) ? String(row[index] ?? '').trim() : '';
export function rowsToImportTransactions(rows, headers, mapping = detectImportColumns(headers), { sourceType = 'csv', dateOrder = 'dmy' } = {}) {
  if (rows.length > MAX_IMPORT_ROWS) throw rowLimitError();
  return rows.map((row, index) => {
    const date = parseImportDate(cell(row, mapping.date), dateOrder), description = cell(row, mapping.description).slice(0, 200);
    const debit = parseImportAmount(cell(row, mapping.debit)), credit = parseImportAmount(cell(row, mapping.credit));
    const amount = Number.isInteger(mapping.amount) ? parseImportAmount(cell(row, mapping.amount)) : null;
    const value = amount !== null ? amount : debit !== null ? -Math.abs(debit) : credit !== null ? Math.abs(credit) : null;
    const invalid = !date || !description || value === null || value === 0 || (debit !== null && credit !== null && debit !== 0 && credit !== 0);
    return { date, description, amount: value === null ? 0 : Math.abs(value), direction: value < 0 ? 'expense' : 'income', currency: cell(row, mapping.currency), accountName: cell(row, mapping.account).slice(0, 80), balance: parseImportAmount(cell(row, mapping.balance)), reference: '', sourceType, sourceRow: index + 2, confidence: invalid ? 'review' : 'ready', validation: invalid ? 'Check date, description, and amount.' : '' };
  });
}

export function suggestCategory(description, direction, categories, transactions = []) {
  const query = String(description || '').toLocaleLowerCase();
  const normalizedDescription = normalizeMerchantName(description);
  const historical = (transactions || []).find(item => {
    const prior = normalizeMerchantName(item.title || item.rawMerchantText || '');
    return item.type === direction && prior && (normalizedDescription.includes(prior) || prior.includes(normalizedDescription) && normalizedDescription.length > 3) && categories.some(category => category.id === item.categoryId && category.type === direction && !category.archived);
  });
  if (historical) return historical.categoryId;
  const category = (categories || []).find(item => !item.archived && item.type === direction && (query.includes(item.name.toLocaleLowerCase()) || (item.name === 'Groceries' && /tesco|aldi|lidl|sainsbury|asda|waitrose|morrisons/i.test(query)) || (item.name === 'Transport' && /train|uber|bus|fuel|petrol|tfl/i.test(query))));
  return category?.id || (categories || []).find(item => item.name === (direction === 'income' ? 'Other income' : 'Other') && item.type === direction)?.id || '';
}

export function findImportDuplicate(record, transactions) {
  const title = String(record.description || '').trim().toLocaleLowerCase();
  return (transactions || []).find(item => !item.reversedAt && item.date === record.date && Math.abs(Number(item.amount)) === record.amount && String(item.title || '').trim().toLocaleLowerCase() === title && ((record.direction === 'income' ? ['income', 'refund', 'cardCredit'].includes(item.type) : item.type === 'expense') || (item.sourceType === 'file_import' && item.importDirection === record.direction))) || null;
}

export function matchImportAccount(accountName, state) {
  const key = String(accountName || '').trim().toLocaleLowerCase();
  if (!key) return '';
  const candidates = [...(state.accounts || []), ...(state.creditCards || [])].filter(item => !item.archivedAt && [item.name, item.provider].some(value => String(value || '').trim().toLocaleLowerCase() === key));
  if (candidates.length === 1) return candidates[0].id;
  const remembered = state.importAccountMappings?.[key];
  return [...(state.accounts || []), ...(state.creditCards || [])].some(item => item.id === remembered && !item.archivedAt && (candidates.length === 0 || candidates.some(candidate => candidate.id === item.id))) ? remembered : '';
}

export function rememberImportAccount(state, accountName, accountId) {
  const key = String(accountName || '').trim().toLocaleLowerCase();
  if (!key || !accountId || ![...(state.accounts || []), ...(state.creditCards || [])].some(item => item.id === accountId && !item.archivedAt)) return;
  state.importAccountMappings ||= {};
  state.importAccountMappings[key] = accountId;
}

export function buildImportedTransaction(record, state, { accountId = '', categoryId = '' } = {}) {
  if (record.confidence !== 'ready' || !record.date || !record.description || !Number.isSafeInteger(record.amount) || record.amount <= 0) throw new Error('Resolve invalid import rows before saving.');
  const selectedAccount = (state.accounts || []).find(item => item.id === accountId) || (state.creditCards || []).find(item => item.id === accountId);
  const card = selectedAccount && (state.creditCards || []).some(item => item.id === selectedAccount.id);
  return { id: crypto.randomUUID(), sequence: nextTransactionSequence(state), title: record.description, amount: record.amount, type: card ? record.direction === 'expense' ? 'expense' : 'cardCredit' : record.direction, ...(accountId ? { accountId } : {}), ...(card ? { creditCardId: accountId } : {}), categoryId: card && record.direction === 'income' ? '' : categoryId || record.categoryId || suggestCategory(record.description, record.direction, state.categories, state.transactions), date: record.date, note: '', paymentMethod: '', paidFromFundId: record.direction === 'expense' && !card ? accountId || '' : '', sourceType: 'file_import', importSource: record.sourceType, importDirection: record.direction, reference: record.reference || '', createdAt: new Date().toISOString() };
}

export function detectPossibleRefund(record, transactions) {
  if (record.direction !== 'income') return null;
  return matchingTransactions(transactions, record.description).find(item => canRefundTransaction(transactions, item) && remainingRefundable(transactions, item) >= record.amount) || null;
}



export function linkImportedBorrowedMoneyState(state, { record, personId = '', personName = '', accountId = '' }) {
  if (record?.direction !== 'income' || !Number.isSafeInteger(record.amount) || record.amount <= 0 || !record.date || !record.description) throw new Error('Choose a valid incoming transaction to record as borrowed money.');
  const person = personId ? (state.financePeople || []).find(item => item.id === personId && !item.archived) : addFinancePerson(state, personName);
  if (!person) throw new Error('Choose or enter the person who lent you the money.');
  const transaction = buildImportedTransaction(record, state, { accountId });
  transaction.type = 'borrowedCash'; transaction.title = record.description; transaction.personId = person.id;
  const liability = createPersonLiabilityState(state, { personId: person.id, amount: record.amount, date: record.date, notes: record.description, kind: 'borrowed-cash' });
  transaction.personalEntryId = liability.id;
  state.transactions.push(transaction);
  return transaction;
}

export function suggestPersonalSettlement(record, state) {
  const isOutgoing = record?.direction === 'expense';
  const collection = isOutgoing ? state.personalLiabilities || [] : state.personalReceivables || [];
  const people = state.financePeople || [];
  const description = String(record?.description || '').trim().toLocaleLowerCase();
  if (!description || !Number.isSafeInteger(record?.amount) || record.amount <= 0) return null;
  const matches = collection.filter(entry => entry.remainingAmount >= record.amount).flatMap(entry => {
    const person = people.find(item => item.id === entry.personId && !item.archived);
    return person && description.includes(String(person.name || '').trim().toLocaleLowerCase())
      ? [{ entry, person }] : [];
  });
  return matches.length === 1 ? { kind: isOutgoing ? 'repayment' : 'reimbursement', entryId: matches[0].entry.id, personId: matches[0].person.id, personName: matches[0].person.name } : null;
}

export function linkImportedPersonalSettlementState(state, { record, entryId, accountId = '', categoryId = '' }) {
  const kind = record?.direction === 'expense' ? 'repayment' : record?.direction === 'income' ? 'reimbursement' : '';
  const collection = kind === 'repayment' ? 'personalLiabilities' : 'personalReceivables';
  const entry = (state[collection] || []).find(item => item.id === entryId);
  if (!entry || !Number.isSafeInteger(record?.amount) || record.amount <= 0 || record.amount > entry.remainingAmount || !record.date || !record.description) throw new Error('This imported row no longer matches the outstanding personal balance.');
  const person = (state.financePeople || []).find(item => item.id === entry.personId);
  if (!person) throw new Error('The linked person is missing.');
  const transaction = buildImportedTransaction(record, state, { accountId, categoryId });
  transaction.type = kind === 'repayment' ? 'personalRepayment' : 'reimbursement';
  transaction.title = record.description;
  transaction.personId = person.id;
  transaction.personalEntryId = entry.id;
  transaction.paymentMethod = '';
  entry.remainingAmount -= record.amount;
  entry.history ||= [];
  entry.history.push({ id: crypto.randomUUID(), kind, amount: record.amount, date: record.date, accountId, transactionId: transaction.id, note: record.description.slice(0, 300) });
  state.transactions.push(transaction);
  return transaction;
}

export function parseStatementText(text, { sourceType = 'statement', dateOrder = 'dmy' } = {}) {
  const records = [], source = String(text || '');
  if (source.length > MAX_IMPORT_TEXT_LENGTH) throw new Error('This statement is too large to parse safely.');
  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const line = raw.trim().replace(/\s+/g, ' ');
    const dateMatch = line.match(/^((?:\d{1,4}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}))\s+(.+)$/);
    if (!dateMatch) continue;
    const amounts = [...dateMatch[2].matchAll(/(?:\(?[-+]?\s*[$£€]?\s*\d[\d,.]*\)?-?)/g)].filter(match => parseImportAmount(match[0]) !== null);
    if (!amounts.length) continue;
    const amountMatch = amounts.length >= 2 && !/[+-]|\(|\)/.test(amounts.at(-1)[0]) ? amounts.at(-2) : amounts.at(-1);
    const afterAmount = dateMatch[2].slice(amountMatch.index + amountMatch[0].length);
    const suffix = afterAmount.match(/^\s*(DR|DEBIT|CR|CREDIT)\b/i)?.[1]?.toUpperCase() || '';
    const description = dateMatch[2].slice(0, amountMatch.index).trim().replace(/[|·-]+$/, '').trim();
    const parsedAmount = parseImportAmount(amountMatch[0]), date = parseImportDate(dateMatch[1], dateOrder);
    const explicitDirection = /[-+]|\(|\)$/.test(amountMatch[0]) || Boolean(suffix);
    const ignored = /\b(?:opening|closing|statement total|page \d+)\b/i.test(description);
    const invalid = !date || description.length < 2 || !parsedAmount || ignored || !explicitDirection;
    const direction = suffix ? (suffix.startsWith('D') ? 'expense' : 'income') : parsedAmount < 0 ? 'expense' : 'income';
    if (records.length >= MAX_IMPORT_ROWS) throw rowLimitError();
    records.push({ date, description: description.slice(0, 200), amount: Math.abs(parsedAmount || 0), direction, currency: '', balance: null, reference: '', sourceType, sourceRow: index + 1, confidence: invalid ? 'review' : 'ready', validation: invalid ? (!explicitDirection ? 'Confirm whether this is money in or out.' : 'Review this extracted line.') : '' });
  }
  return records;
}

