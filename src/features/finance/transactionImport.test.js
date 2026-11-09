import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImportedTransaction, matchImportAccount, rememberImportAccount, detectDelimiter, detectImportColumns, detectPossibleRefund, findImportDuplicate, MAX_IMPORT_ROWS, parseDelimitedText, parseImportAmount, parseImportDate, parseStatementText, rowsToImportTransactions, suggestCategory, suggestPersonalSettlement } from './transactionImport.js';

test('quoted CSV supports BOM, commas, escaped quotes, and CRLF', () => {
  const text = '\uFEFFDate,Description,Debit,Credit\r\n01/11/2026,"Tesco, ""Express""",45.20,\r\n';
  const rows = parseDelimitedText(text, detectDelimiter(text));
  const headers = rows.shift();
  const mapping = detectImportColumns(headers);
  const [row] = rowsToImportTransactions(rows, headers, mapping);
  assert.equal(row.date, '2026-11-01');
  assert.equal(row.description, 'Tesco, "Express"');
  assert.equal(row.amount, 4520);
  assert.equal(row.direction, 'expense');
});

test('detects semicolon and tab files and signed amount conventions', () => {
  const semicolon = 'Date;Payee;Amount\n02/11/2026;Amazon;-35.00';
  assert.equal(detectDelimiter(semicolon), ';');
  const tab = 'Date\tDetails\tAmount\n02/11/2026\tAmazon\t+10.00';
  assert.equal(detectDelimiter(tab), '\t');
  assert.equal(parseImportAmount('(1,234.50)'), -123450);
  assert.equal(parseImportAmount('1.234,50'), 123450);
});

test('validates date formats and amount bounds', () => {
  assert.equal(parseImportDate('2026-11-01'), '2026-11-01');
  assert.equal(parseImportDate('31/11/2026'), '');
  assert.equal(parseImportDate('11/02/2026', 'mdy'), '2026-11-02');
  assert.equal(parseImportAmount('0'), null);
  assert.equal(parseImportAmount('12.345'), null);
});

test('separate debit and credit columns produce expense and income rows', () => {
  const headers = ['Date', 'Description', 'Debit', 'Credit', 'Balance'];
  const mapping = detectImportColumns(headers);
  const records = rowsToImportTransactions([['01/11/2026', 'Tesco', '45.20', '', '954.80'], ['02/11/2026', 'Salary', '', '2000.00', '2954.80']], headers, mapping);
  assert.deepEqual(records.map(row => [row.amount, row.direction, row.confidence]), [[4520, 'expense', 'ready'], [200000, 'income', 'ready']]);
});

test('duplicate detection is based on date, amount, title, and direction', () => {
  const row = { date: '2026-11-01', amount: 4520, description: 'Tesco', direction: 'expense' };
  assert.equal(findImportDuplicate(row, [{ date: row.date, amount: 4520, title: 'tesco', type: 'expense' }]).type, 'expense');
  assert.equal(findImportDuplicate(row, []), null);
});

test('imported transactions use the canonical Finance transaction shape and sequence', () => {
  const state = { transactions: [{ id: 'a', sequence: 4 }], categories: [{ id: 'other', name: 'Other', type: 'expense' }] };
  const transaction = buildImportedTransaction({ date: '2026-11-01', description: 'Shop', amount: 100, direction: 'expense', confidence: 'ready', sourceType: 'csv' }, state);
  assert.equal(transaction.type, 'expense');
  assert.equal(transaction.sequence, 5);
  assert.equal(transaction.categoryId, 'other');
  assert.equal(transaction.sourceType, 'file_import');
});

test('statement text extraction rejects headings and keeps dated transaction lines', () => {
  const records = parseStatementText('01/11/2026 Tesco -45.20\nOpening balance 954.80\n02/11/2026 Salary +2,000.00');
  assert.equal(records.length, 2);
  assert.deepEqual(records.map(item => [item.direction, item.amount]), [['expense', 4520], ['income', 200000]]);
});
test('parses typical 100, 500, and 1,000 row imports without dropping rows', () => {
  const headers = ['Date', 'Description', 'Amount'];
  const rows = Array.from({ length: 1000 }, (_, index) => ['01/11/2026', `Purchase ${index}`, '-1.00']);
  for (const count of [100, 500, 1000]) assert.equal(rowsToImportTransactions(rows.slice(0, count), headers).length, count);
});

test('category suggestion reuses a prior merchant category when available', () => {
  const categories = [{ id: 'food', name: 'Groceries', type: 'expense' }, { id: 'other', name: 'Other', type: 'expense' }];
  const prior = [{ id: 'old', type: 'expense', title: 'Corner Market', categoryId: 'food', date: '2026-10-01', amount: 500 }];
  assert.equal(suggestCategory('Corner Market branch 2', 'expense', categories, prior), 'food');
});
test('bank currencies and currency-marked statement amounts parse as minor units', () => {
  assert.equal(parseImportAmount('\u00a31,234.50'), 123450);
  assert.equal(parseImportAmount('\u20ac1.234,50'), 123450);
  assert.equal(parseImportAmount('\u00a51,200'), 120000);
  const [record] = parseStatementText('01/11/2026 Shop \u00a325.50 DR');
  assert.equal(record.amount, 2550); assert.equal(record.confidence, 'ready');
});

test('refund duplicates match incoming refund rows without confusing them with expenses', () => {
  const refund = { id: 'refund-1', date: '2026-11-01', amount: 4500, title: 'Shop return', type: 'refund' };
  assert.equal(findImportDuplicate({ date: refund.date, amount: refund.amount, description: refund.title, direction: 'income' }, [refund]), refund);
  assert.equal(findImportDuplicate({ date: refund.date, amount: refund.amount, description: refund.title, direction: 'expense' }, [refund]), null);
});

test('delimited and statement imports reject more than the bounded transaction row count', () => {
  const rows = ['Date,Description,Amount', ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, index) => '01/11/2026,Shop ' + index + ',1.00')].join('\n');
  assert.throws(() => parseDelimitedText(rows, ','), /at most 1,000 transaction rows/);
  const statement = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, index) => '01/11/2026 Shop ' + index + ' -1.00').join('\n');
  assert.throws(() => parseStatementText(statement), /at most 1,000 transaction rows/);
});

test('possible refund hints require an eligible purchase with enough refundable room', () => {
  const purchase = { id: 'purchase', title: 'Corner Market', type: 'expense', amount: 10000, date: '2026-10-01' };
  const partiallyRefunded = { id: 'refund', type: 'refund', originalTransactionId: 'purchase', amount: 8000, refundStatus: 'received' };
  const row = { direction: 'income', description: 'Corner Market', amount: 3000 };
  assert.equal(detectPossibleRefund(row, [purchase, partiallyRefunded]), null);
  assert.equal(detectPossibleRefund({ ...row, amount: 2000 }, [purchase, partiallyRefunded]), purchase);
  assert.equal(detectPossibleRefund(row, [{ ...purchase, linkedReservationId: 'reservation' }]), null);
});


test('exact statement account metadata is matched uniquely and remembers a user-selected mapping', () => {
  const state = { accounts: [{ id: 'current', name: 'Current Account' }], creditCards: [{ id: 'card', name: 'Barclaycard' }] };
  assert.equal(matchImportAccount('Barclaycard', state), 'card');
  assert.equal(matchImportAccount('Unknown', state), '');
  rememberImportAccount(state, 'My Current', 'current');
  assert.equal(matchImportAccount('My Current', state), 'current');
});

test('account statement column is parsed for safe account matching', () => {
  const headers = ['Date', 'Description', 'Amount', 'Account'];
  const [row] = rowsToImportTransactions([['01/11/2026', 'Tesco', '-10.00', 'Current Account']], headers, detectImportColumns(headers));
  assert.equal(row.accountName, 'Current Account');
});


test('person matching suggests only a unique open repayment or reimbursement with a stable entry id',()=>{
 const state={financePeople:[{id:'person-1',name:'Ahmed'}],personalLiabilities:[{id:'owed-1',personId:'person-1',remainingAmount:7000}],personalReceivables:[{id:'receivable-1',personId:'person-1',remainingAmount:4000}]};
 assert.deepEqual(suggestPersonalSettlement({description:'Ahmed - ?50',direction:'expense',amount:5000},state),{kind:'repayment',entryId:'owed-1',personId:'person-1',personName:'Ahmed'});
 assert.deepEqual(suggestPersonalSettlement({description:'Ahmed transfer',direction:'income',amount:1500},state),{kind:'reimbursement',entryId:'receivable-1',personId:'person-1',personName:'Ahmed'});
 assert.equal(suggestPersonalSettlement({description:'Ahmed - ?80',direction:'expense',amount:8000},state),null);
 state.personalLiabilities.push({id:'owed-2',personId:'person-1',remainingAmount:8000});assert.equal(suggestPersonalSettlement({description:'Ahmed - ?50',direction:'expense',amount:5000},state),null);
});

test('confirmed imported repayment and reimbursement preserve the imported row and change balances without income or spending',async()=>{
 const { linkImportedPersonalSettlementState }=await import('./transactionImport.js');
 const state={transactions:[],financePeople:[{id:'person-1',name:'Ahmed'}],personalLiabilities:[{id:'owed-1',personId:'person-1',remainingAmount:7000,history:[]}],personalReceivables:[{id:'receivable-1',personId:'person-1',remainingAmount:4000,history:[]}],accounts:[{id:'bank-1',name:'Current'}],creditCards:[],categories:[]};
 const outgoing={description:'Ahmed - ?50',direction:'expense',amount:5000,date:'2026-11-08',confidence:'ready',sourceType:'csv'};
 const repayment=linkImportedPersonalSettlementState(state,{record:outgoing,entryId:'owed-1',accountId:'bank-1'});
 assert.equal(repayment.type,'personalRepayment');assert.equal(repayment.accountId,'bank-1');assert.equal(state.personalLiabilities[0].remainingAmount,2000);assert.equal(state.personalLiabilities[0].history[0].transactionId,repayment.id);
 const incoming={description:'Ahmed repayment',direction:'income',amount:1500,date:'2026-11-09',confidence:'ready',sourceType:'csv'};
 const reimbursement=linkImportedPersonalSettlementState(state,{record:incoming,entryId:'receivable-1',accountId:'bank-1'});
 assert.equal(reimbursement.type,'reimbursement');assert.equal(state.personalReceivables[0].remainingAmount,2500);assert.equal(state.transactions.length,2);assert.throws(()=>linkImportedPersonalSettlementState(state,{record:outgoing,entryId:'owed-1'}),/no longer matches/);
});


test('confirmed imported borrowed money keeps an incoming bank row out of income and records a liability',async()=>{
 const { linkImportedBorrowedMoneyState }=await import('./transactionImport.js');
 const state={transactions:[],financePeople:[],personalLiabilities:[],accounts:[{id:'bank-1',name:'Current'}],creditCards:[],categories:[]};
 const record={description:'Ahmed loan',direction:'income',amount:20000,date:'2026-11-08',confidence:'ready',sourceType:'csv'};
 const transaction=linkImportedBorrowedMoneyState(state,{record,personName:'Ahmed',accountId:'bank-1'});
 assert.equal(transaction.type,'borrowedCash');assert.equal(transaction.accountId,'bank-1');assert.equal(state.personalLiabilities[0].remainingAmount,20000);assert.equal(transaction.personalEntryId,state.personalLiabilities[0].id);
});
