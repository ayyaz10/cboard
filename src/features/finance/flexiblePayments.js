import { id, today } from './financeData.js';

const validAmount = value => Number.isSafeInteger(value) && value > 0;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function validateFunding(amount, sources) {
  if (!validAmount(amount)) throw new Error('Enter a valid purchase amount.');
  const kinds = new Set(['owned', 'bank', 'cash', 'creditCard', 'person', 'creditor', 'bnpl']);
  if (!Array.isArray(sources) || !sources.length || sources.some(source => !source || !validAmount(source.amount) || !kinds.has(source.kind))) throw new Error('Add a valid payment amount for each source.');
  if (sources.some(source => ['creditCard', 'bnpl'].includes(source.kind) && !String(source.sourceId || '').trim())) throw new Error('Choose an account, provider, or person for each borrowed payment source.');
  const total = sources.reduce((sum, source) => sum + source.amount, 0);
  if (!Number.isSafeInteger(total) || total !== amount) throw new Error(total < amount ? `${((amount-total)/100).toFixed(2)} still needs a payment source.` : 'Payment sources exceed the purchase amount.');
  return sources.map(source => ({ kind: source.kind, sourceId: String(source.sourceId || ''), amount: source.amount, ...(source.personId ? { personId: String(source.personId) } : {}), ...(source.label ? { label: String(source.label).slice(0,80) } : {}) }));
}

export function addFinancePerson(state, name) {
  const displayName = String(name || '').trim().slice(0,80);
  if (!displayName) throw new Error('Enter a person name.');
  const existing = (state.financePeople || []).find(person => !person.archived && person.name.toLocaleLowerCase() === displayName.toLocaleLowerCase());
  if (existing) return existing;
  const person = { id: id(), name: displayName, archived: false, createdAt: new Date().toISOString() };
  state.financePeople ||= []; state.financePeople.push(person);
  return person;
}

export function createPersonLiabilityState(state, { personId, amount, transactionId = '', date = today(), dueDate = '', notes = '', kind = 'purchase' }) {
  if (!(state.financePeople || []).some(person => person.id === personId && !person.archived)) throw new Error('Choose an active person.');
  if (!validAmount(amount) || !datePattern.test(date)) throw new Error('Enter a valid amount and date.');
  if (dueDate && !datePattern.test(dueDate)) throw new Error('Enter a valid due date.');
  const purchase=(state.transactions||[]).find(item=>item.id===transactionId&&item.type==='expense');
  if(purchase){const linkedSources=Array.isArray(purchase.fundingSources);const sourceLimit=linkedSources?purchase.fundingSources.filter(source=>['person','creditor','bnpl'].includes(source.kind)&&(source.personId===personId||source.sourceId===personId)).reduce((sum,source)=>sum+Number(source.amount||0),0):(purchase.paymentSourceType==='person'||purchase.paymentSourceType==='creditor'?purchase.amount:0);const already=(state.personalLiabilities||[]).filter(item=>item.transactionId===transactionId&&item.personId===personId).reduce((sum,item)=>sum+item.originalAmount,0);if(amount+already>sourceLimit)throw new Error('The amount owed cannot exceed this person?s share of the purchase.');}
  const liability = { id: id(), personId, originalAmount: amount, remainingAmount: amount, transactionId, createdAt: date, dueDate, notes: String(notes).trim().slice(0,300), history: [{ id: id(), kind, amount, date, transactionId }] };
  state.personalLiabilities ||= []; state.personalLiabilities.push(liability);
  return liability;
}

export function createReceivableState(state, { personId, amount, transactionId = '', date = today(), dueDate = '', notes = '' }) {
  if (!(state.financePeople || []).some(person => person.id === personId && !person.archived)) throw new Error('Choose an active person.');
  if (!validAmount(amount) || !datePattern.test(date)) throw new Error('Enter a valid amount and date.');
  if (dueDate && !datePattern.test(dueDate)) throw new Error('Enter a valid due date.');
  const purchase=(state.transactions||[]).find(item=>item.id===transactionId&&item.type==='expense');
  if(purchase){const already=(state.personalReceivables||[]).filter(item=>item.transactionId===transactionId).reduce((sum,item)=>sum+item.originalAmount,0);if(amount+already>purchase.amount)throw new Error('The amount owed cannot exceed the purchase amount.');}
  const receivable = { id: id(), personId, originalAmount: amount, remainingAmount: amount, transactionId, createdAt: date, dueDate, notes: String(notes).trim().slice(0,300), history: [{ id: id(), kind: 'expected', amount, date, transactionId }] };
  state.personalReceivables ||= []; state.personalReceivables.push(receivable);
  return receivable;
}

function settleEntry(state, collection, entryId, { amount, date = today(), accountId = '', kind, note = '' }) {
  const entry = (state[collection] || []).find(item => item.id === entryId);
  if (!entry || !validAmount(amount) || amount > entry.remainingAmount || !datePattern.test(date)) throw new Error('Enter a valid amount up to the remaining balance.');
  const transactionId = id();
  entry.remainingAmount -= amount;
  entry.history ||= []; entry.history.push({ id: id(), kind, amount, date, accountId, transactionId, note: String(note).trim().slice(0,300) });
  const person = state.financePeople?.find(item => item.id === entry.personId);
  const transaction = { id: transactionId, sequence: Math.max(0, ...(state.transactions || []).map((item,index) => item.sequence ?? index+1))+1, type: kind === 'repayment' ? 'personalRepayment' : 'reimbursement', title: kind === 'repayment' ? `Repay ${person?.name || 'person'}` : `Reimbursement from ${person?.name || 'person'}`, amount, date, accountId, personId: entry.personId, personalEntryId: entry.id, paymentMethod: '', note: String(note).trim(), createdAt: new Date().toISOString() };
  state.transactions ||= []; state.transactions.push(transaction);
  return transaction;
}

export function repayPersonState(state, liabilityId, values) { return settleEntry(state, 'personalLiabilities', liabilityId, { ...values, kind: 'repayment' }); }
export function receiveReimbursementState(state, receivableId, values) { return settleEntry(state, 'personalReceivables', receivableId, { ...values, kind: 'reimbursement' }); }

export function recordBorrowedCashState(state, { personId, amount, accountId = '', date = today(), dueDate = '', notes = '' }) {
  const liability = createPersonLiabilityState(state, { personId, amount, date, dueDate, notes, kind: 'borrowed-cash' });
  const person = state.financePeople.find(item => item.id === personId);
  const transaction = { id: id(), sequence: Math.max(0, ...(state.transactions || []).map((item,index) => item.sequence ?? index+1))+1, type: 'borrowedCash', title: `Borrowed from ${person.name}`, amount, date, accountId, personId, personalEntryId: liability.id, note: String(notes).trim(), createdAt: new Date().toISOString() };
  state.transactions ||= []; state.transactions.push(transaction);
  return { liability, transaction };
}

export function flexibleBalanceSummary(state) {
  const active = entry => Math.max(0, Number(entry.remainingAmount) || 0);
  const liabilities = (state.personalLiabilities || []).reduce((sum, entry) => sum + active(entry), 0);
  const receivables = (state.personalReceivables || []).reduce((sum, entry) => sum + active(entry), 0);
  return { liabilities, receivables, net: receivables - liabilities };
}
