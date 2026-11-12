import { nextTransactionSequence } from './transactionOrder.js';
import { addFinancePerson, createPersonLiabilityState } from './flexiblePayments.js';
import { matchingTransactions } from './transactionSuggestions.js';
import { normalizeMerchantName } from './merchantDirectory.js';
import { isValidFinanceDate } from './transactionOrder.js';
import { canRefundTransaction, remainingRefundable } from './refunds.js';

export const MAX_IMPORT_ROWS = 2500;
export const MAX_IMPORT_TEXT_LENGTH = 25 * 1024 * 1024;
const rowLimitError = () => new Error('Import files can contain at most ' + MAX_IMPORT_ROWS.toLocaleString() + ' transaction rows. Split the statement and import it in parts.');

const aliases = {
  date: ['date', 'transaction date', 'posted date', 'booking date', 'value date'],
  description: ['description', 'merchant', 'payee', 'transaction', 'details', 'narrative', 'memo', 'reference'],
  amount: ['amount', 'transaction amount'], debit: ['debit', 'money out', 'paid out', 'withdrawal', 'withdrawn'],
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

function normalizeImportDescription(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function findImportDuplicate(record, transactions, accountId = '') {
  const description = normalizeImportDescription(record.description);
  const reference = normalizeImportDescription(record.reference);
  const selectedAccountId = accountId || record.accountId || '';
  return (transactions || []).find(item => {
    const existingAccountId = item.accountId || item.creditCardId || '';
    if (selectedAccountId && existingAccountId && selectedAccountId !== existingAccountId) return false;
    const sameDescription = description && normalizeImportDescription(item.title || item.rawMerchantText) === description;
    const sameReference = reference && normalizeImportDescription(item.reference) === reference;
    const sameDirection = (record.direction === 'income' ? ['income', 'refund', 'cardCredit'].includes(item.type) : item.type === 'expense') || (item.sourceType === 'file_import' && item.importDirection === record.direction);
    return !item.reversedAt && item.date === record.date && Math.abs(Number(item.amount)) === record.amount && (sameDescription || sameReference) && sameDirection;
  }) || null;
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

const statementDatePattern = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{2,4})?|[A-Za-z]{3,9}\s+\d{1,2},?(?:\s+\d{2,4})?)$/i;
const statementCurrency = /[$£€¥]/;
const statementMonth = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function parseStatementDate(value, context, dateOrder) {
  const text = String(value || '').trim().replace(/,$/, '');
  if (!statementDatePattern.test(text)) return '';
  const yearless = text.match(/^(\d{1,2})\s+([A-Za-z]{3,9})$/i) || text.match(/^([A-Za-z]{3,9})\s+(\d{1,2})$/i);
  if (yearless) {
    if (!Number.isInteger(context.year)) return '';
    const day = Number(/^[A-Za-z]/.test(yearless[1]) ? yearless[2] : yearless[1]);
    const monthName = /^[A-Za-z]/.test(yearless[1]) ? yearless[1] : yearless[2];
    const month = statementMonth[monthName.slice(0, 3).toLowerCase()];
    const date = `${context.year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return month && isValidFinanceDate(date) ? date : '';
  }
  const explicit = parseImportDate(text, dateOrder);
  if (explicit) context.year = Number(explicit.slice(0, 4));
  return explicit;
}

function normalizeStatementInput(input) {
  if (Array.isArray(input)) return input.map((line, index) => typeof line === 'string' ? { text: line, sourceRow: index + 1 } : { ...line, text: String(line?.text || ''), sourceRow: line?.sourceRow ?? index + 1 });
  const source = String(input || '');
  if (source.length > MAX_IMPORT_TEXT_LENGTH) throw new Error('This statement is too large to parse safely.');
  return source.split(/\r?\n/).map((text, index) => ({ text, sourceRow: index + 1 }));
}

function findStatementColumns(lines) {
  for (const line of lines) {
    if (!Array.isArray(line.items) || !line.items.length) continue;
    const joined = line.items.map(item => item.text).join(' ').toLowerCase().replace(/[^a-z]+/g, ' ');
    if (!/\bdate\b/.test(joined) || !/\bdescription\b|\bdetails\b/.test(joined) || !/\bpaid\b/.test(joined) || !/\bwithdrawn\b|\bpaid out\b/.test(joined) || !/\bbalance\b/.test(joined)) continue;
    const fieldX = {
      date: line.items.find(item => /^date$/i.test(item.text.trim()))?.x,
      description: line.items.find(item => /^(?:description|details)$/i.test(item.text.trim()))?.x,
      paidIn: line.items.find(item => /^paid(?:\s*in)?\b/i.test(item.text.trim()))?.x,
      withdrawn: line.items.find(item => /^(?:withdrawn|paid\s*out)\b/i.test(item.text.trim()))?.x,
      balance: line.items.find(item => /^balance\b/i.test(item.text.trim()))?.x,
    };
    if (Object.values(fieldX).every(Number.isFinite)) return fieldX;
  }
  return null;
}

function columnsForLine(line, columnX) {
  const fields = Object.entries(columnX).sort((a, b) => a[1] - b[1]);
  const columns = Object.fromEntries(Object.keys(columnX).map(key => [key, []]));
  for (const item of line.items || []) {
    let field = fields[0]?.[0];
    for (let index = 0; index < fields.length - 1; index++) {
      if (item.x >= (fields[index][1] + fields[index + 1][1]) / 2) field = fields[index + 1][0];
      else break;
    }
    columns[field].push(item.text);
  }
  return Object.fromEntries(Object.entries(columns).map(([key, values]) => [key, values.join(' ').replace(/\s+/g, ' ').trim()]));
}

function statementAmountToken(text) {
  const match = String(text || '').match(/(?:[$£€¥]\s*[-+]?\s*\d[\d,.]*|[-+]?\s*\d[\d,.]*\s*[$£€¥]?)/);
  if (!match) return null;
  const token = match[0].trim();
  if (!statementCurrency.test(token) && !/[,.]\d{1,2}$/.test(token) && !/^[-+]\s*\d/.test(token)) return null;
  return parseImportAmount(token);
}

function cleanStatementDescription(value) {
  return String(value || '').replace(/[|·]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s,:;-]+|[\s,:;-]+$/g, '').trim();
}

function statementHeaderOrFooter(line) {
  const value = String(line || '').trim();
  return !value || /^(?:date\s+description\b|description\s+date\b|paid in(?:\s*\([^)]*\))?$|withdrawn(?:\s*\([^)]*\))?$|balance(?:\s*\([^)]*\))?$|page\s+\d+(?:\s+of\s+\d+)?|statement(?:\s+date|\s+number|\s+period)?\b|account\s+(?:number|name)\b|sort code\b|customer service\b)/i.test(value);
}

function makeStatementRecord({ date, description, amount, direction, sourceType, sourceRow, confidence = 'ready', validation = '' }) {
  return { date: date || '', description: cleanStatementDescription(description).slice(0, 200), amount: Math.abs(amount || 0), direction, currency: '', balance: null, reference: '', sourceType, sourceRow, confidence: !date || !cleanStatementDescription(description) ? 'review' : confidence, validation: !date ? 'Statement year or transaction date is missing.' : !cleanStatementDescription(description) ? 'Add a transaction description.' : validation, ...(direction === 'income' ? { classification: 'review' } : {}) };
}

export function parseStatementText(input, options = {}) {
  const { sourceType = 'statement', dateOrder = 'dmy', context: sharedContext = null, sourceRowPrefix = '', diagnostics = null } = options;
  const lines = normalizeStatementInput(input), context = sharedContext || {};
  context.year ??= null;
  context.currentDate ??= '';
  context.pendingDescription ??= [];
  context.pendingBalanceKind ??= '';
  context.statementColumns ??= null;
  context.openingBalance ??= null;
  context.closingBalance ??= null;
  if (diagnostics) diagnostics.linesProcessed = (diagnostics.linesProcessed || 0) + lines.length;
  context.statementColumns = findStatementColumns(lines) || context.statementColumns;
  const records = [];
  const pushRecord = (description, amount, direction, sourceRow, confidence = 'ready', validation = '') => {
    if (records.length >= MAX_IMPORT_ROWS) throw rowLimitError();
    const normalized = cleanStatementDescription(description);
    if (/\b(?:brought forward|opening balance|closing balance|carried forward|statement total)\b/i.test(normalized)) {
      if (diagnostics) diagnostics.ignoredBalanceRows = (diagnostics.ignoredBalanceRows || 0) + 1;
      return;
    }
    records.push(makeStatementRecord({ date: context.currentDate, description: normalized, amount, direction, sourceType, sourceRow: sourceRowPrefix ? `${sourceRowPrefix}:${sourceRow}` : sourceRow, confidence, validation }));
  };

  for (const line of lines) {
    const rawText = line.text.trim().replace(/\s+/g, ' ');
    if (context.statementColumns && Array.isArray(line.items) && line.items.length) {
      const columns = columnsForLine(line, context.statementColumns);
      const combined = line.items.map(item => item.text).join(' ').trim();
      const headerLine = /\bdate\b/i.test(combined) && /\bbalance\b/i.test(combined) && (/\bpaid\b/i.test(combined) || /\bwithdrawn\b/i.test(combined));
      if (headerLine) { if (diagnostics) diagnostics.ignoredHeaderRows = (diagnostics.ignoredHeaderRows || 0) + 1; continue; }
      if (columns.date) {
        const parsedDate = parseStatementDate(columns.date, context, dateOrder);
        if (parsedDate) {
          if (context.currentDate && parsedDate !== context.currentDate && context.pendingDescription.length) context.pendingDescription = [];
          context.currentDate = parsedDate;
        }
      }
      const description = cleanStatementDescription(columns.description);
      const balance = statementAmountToken(columns.balance);
      const balanceLabel = /\b(?:brought forward|opening balance|closing balance|carried forward|statement total)\b/i.test(combined);
      if (/\b(?:brought forward|opening balance)\b/i.test(combined)) context.pendingBalanceKind = 'opening';
      if (/\b(?:closing balance|balance carried forward|balance brought forward)\b/i.test(combined)) context.pendingBalanceKind = 'closing';
      if (balance !== null) {
        if (context.pendingBalanceKind === 'opening') context.openingBalance = Math.abs(balance);
        if (context.pendingBalanceKind === 'closing') context.closingBalance = Math.abs(balance);
        context.pendingBalanceKind = '';
        if (diagnostics) diagnostics.ignoredBalanceRows = (diagnostics.ignoredBalanceRows || 0) + 1;
      }
      if (balanceLabel) {
        if (diagnostics) diagnostics.ignoredBalanceRows = (diagnostics.ignoredBalanceRows || 0) + 1;
        context.pendingDescription = [];
        continue;
      }
      const paidIn = statementAmountToken(columns.paidIn), withdrawn = statementAmountToken(columns.withdrawn);
      if (paidIn !== null || withdrawn !== null) {
        if (description) context.pendingDescription.push(description);
        if (paidIn !== null && withdrawn !== null) {
          pushRecord(context.pendingDescription.join(' '), paidIn, 'income', line.sourceRow, 'review', 'Both Paid In and Withdrawn columns contain an amount.');
          pushRecord(context.pendingDescription.join(' '), withdrawn, 'expense', line.sourceRow, 'review', 'Both Paid In and Withdrawn columns contain an amount.');
        } else pushRecord(context.pendingDescription.join(' '), paidIn ?? withdrawn, paidIn !== null ? 'income' : 'expense', line.sourceRow);
        context.pendingDescription = [];
        continue;
      }
      if (description) context.pendingDescription.push(description);
      continue;
    }

    const dateMatch = rawText.match(/^((?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{2,4})?|[A-Za-z]{3,9}\s+\d{1,2},?(?:\s+\d{2,4})?))(?:\s+(.+))?$/i);
    let lineText = rawText;
    if (dateMatch) {
      const nextDate = parseStatementDate(dateMatch[1], context, dateOrder);
      if (nextDate) {
        if (context.currentDate && nextDate !== context.currentDate && context.pendingDescription.length) context.pendingDescription = [];
        context.currentDate = nextDate;
        lineText = dateMatch[2] || '';
        if (!lineText) continue;
      }
    }
    if (/\b(?:brought forward|opening balance)\b/i.test(lineText)) context.pendingBalanceKind = 'opening';
    if (/\b(?:closing balance|balance carried forward|balance brought forward)\b/i.test(lineText)) context.pendingBalanceKind = 'closing';
    const balanceLine = lineText.match(/\bbalance\b\s*[:]?\s*(.*)$/i);
    if (balanceLine) {
      const amount = statementAmountToken(balanceLine[1]);
      if (amount !== null && context.pendingBalanceKind === 'opening') context.openingBalance = Math.abs(amount);
      if (amount !== null && context.pendingBalanceKind === 'closing') context.closingBalance = Math.abs(amount);
      if (amount !== null) context.pendingBalanceKind = '';
      if (diagnostics) diagnostics.ignoredBalanceRows = (diagnostics.ignoredBalanceRows || 0) + 1;
      continue;
    }
    if (/\b(?:brought forward|opening balance|closing balance|balance carried forward|statement total)\b/i.test(lineText)) {
      if (diagnostics) diagnostics.ignoredBalanceRows = (diagnostics.ignoredBalanceRows || 0) + 1;
      context.pendingDescription = [];
      continue;
    }
    if (statementHeaderOrFooter(lineText)) { if (diagnostics) diagnostics.ignoredHeaderRows = (diagnostics.ignoredHeaderRows || 0) + 1; continue; }
    const labelled = lineText.match(/\b(paid\s*in|money\s*in|deposit|credit|withdrawn|paid\s*out|money\s*out|debit|withdrawal)\b\s*[:]?\s*(.*)$/i);
    if (labelled) {
      const directionLabel = labelled[1].toLowerCase().replace(/\s+/g, ' '), amountText = labelled[2].split(/\bbalance\b/i)[0];
      const amount = statementAmountToken(amountText);
      if (amount !== null) {
        const prefix = cleanStatementDescription(lineText.slice(0, labelled.index));
        if (prefix) context.pendingDescription.push(prefix);
        const direction = ['paid in', 'money in', 'deposit', 'credit'].includes(directionLabel) ? 'income' : 'expense';
        pushRecord(context.pendingDescription.join(' '), amount, direction, line.sourceRow);
        context.pendingDescription = [];
        context.pendingBalanceKind = '';
        continue;
      }
    }
    const inline = lineText.match(/(?:[$£€¥]\s*[-+]?\s*\d[\d,.]*|[-+]\s*(?:[$£€¥]\s*)?\d[\d,.]*|\(?\d[\d,.]*\)?-?\s*(?:DR|DEBIT|CR|CREDIT))\s*$/i);
    if (inline) {
      const token = inline[0].trim(), parsedAmount = parseImportAmount(token.replace(/\s*(?:DR|DEBIT|CR|CREDIT)$/i, ''));
      const moneyTokens = [...lineText.matchAll(/(?:[$£€¥]\s*[-+]?\s*\d[\d,.]*|[-+]?\s*\d[\d,.]*\s*[$£€¥]?)/g)].filter(match => statementAmountToken(match[0]) !== null);
      if (moneyTokens.length > 1) {
        if (diagnostics) diagnostics.unparsedCandidateRows = (diagnostics.unparsedCandidateRows || 0) + 1;
        context.pendingDescription = [];
        continue;
      }
      const explicitDirection = /[-+]|\(|\)|\b(?:DR|DEBIT|CR|CREDIT)\b/i.test(token);
      if (parsedAmount !== null) {
        const beforeAmount = cleanStatementDescription(lineText.slice(0, inline.index));
        if (beforeAmount) context.pendingDescription.push(beforeAmount);
        const suffix = token.match(/(DR|DEBIT|CR|CREDIT)$/i)?.[1]?.toUpperCase();
        const direction = suffix ? (suffix.startsWith('D') ? 'expense' : 'income') : parsedAmount < 0 ? 'expense' : 'income';
        pushRecord(context.pendingDescription.join(' '), parsedAmount, direction, line.sourceRow, explicitDirection ? 'ready' : 'review', explicitDirection ? '' : 'Confirm whether this is money in or out.');
        context.pendingDescription = [];
        context.pendingBalanceKind = '';
        continue;
      }
    }
    if (statementHeaderOrFooter(lineText)) { if (diagnostics) diagnostics.ignoredHeaderRows = (diagnostics.ignoredHeaderRows || 0) + 1; continue; }
    if (context.currentDate && /(?:[$£€¥]\s*\d|[-+]\s*\d+[.,]\d{1,2})/.test(lineText)) {
      if (diagnostics) diagnostics.unparsedCandidateRows = (diagnostics.unparsedCandidateRows || 0) + 1;
      context.pendingDescription = [];
      continue;
    }
    if (context.currentDate && lineText) context.pendingDescription.push(lineText);
  }
  if (diagnostics) {
    diagnostics.transactionRowsDetected = (diagnostics.transactionRowsDetected || 0) + records.length;
    diagnostics.openingBalance = context.openingBalance;
    diagnostics.closingBalance = context.closingBalance;
  }
  return records;
}

