import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildImportedTransaction, matchImportAccount, rememberImportAccount, detectDelimiter, detectImportColumns, detectPossibleRefund, findImportDuplicate, MAX_IMPORT_ROWS, parseDelimitedText, parseImportAmount, parseImportDate, parseStatementText, statementOcrInput, rowsToImportTransactions, suggestCategory, suggestPersonalSettlement } from './transactionImport.js';

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
  assert.throws(() => parseDelimitedText(rows, ','), /at most 2,500 transaction rows/);
  const statement = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, index) => '01/11/2026 Shop ' + index + ' -1.00').join('\n');
  assert.throws(() => parseStatementText(statement), /at most 2,500 transaction rows/);
});

test('statement parser accepts more than one thousand transaction rows within its bound', () => {
  const statement = Array.from({ length: 1200 }, (_, index) => '01/11/2026 Shop ' + index + ' -1.00').join('\n');
  assert.equal(parseStatementText(statement).length, 1200);
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


test('grouped bank statement fixture keeps inherited dates, descriptions, directions, references, and balances separate', () => {
  const statement = readFileSync(new URL('./fixtures/groupedBankStatement.txt', import.meta.url), 'utf8');
  const diagnostics = {};
  const records = parseStatementText(statement, { sourceType: 'pdf-scan', diagnostics });
  assert.equal(records.length, 23);
  assert.deepEqual(records.slice(0, 3).map(item => [item.date, item.amount, item.direction]), [
    ['2026-10-05', 22500, 'income'], ['2026-10-05', 8960, 'expense'], ['2026-10-05', 150, 'expense'],
  ]);
  assert.equal(records[0].description, 'Automated Credit SOI WAD LTD - FP 05/10/26 0945 54416004843074297');
  assert.match(records[1].description, /STAGECOACH SERVICES STOCKPORT GB/);
  assert.equal(records.find(item => item.amount === 100).description, 'Account interest');
  assert.deepEqual(records.filter(item => item.date === '2026-10-12').map(item => item.amount), [15000, 100, 1427, 1199, 295, 249, 370]);
  assert.ok(records.filter(item => item.direction === 'expense').every(item => item.confidence === 'ready'));
  assert.ok(records.filter(item => item.direction === 'income').every(item => item.classification === 'review'));
  assert.equal(records.some(item => /brought forward|balance/i.test(item.description)), false);
  assert.equal(diagnostics.openingBalance, 42964);
  assert.equal(diagnostics.closingBalance, 10000);
  assert.equal(diagnostics.transactionRowsDetected, 23);
  assert.ok(diagnostics.ignoredBalanceRows >= 8);
});

test('parser context carries a grouped date and a split description across PDF pages and repeated headers', () => {
  const context = {};
  const first = parseStatementText('03 OCT 2026\n26 OCT\nCard Transaction 7118 23OCT26 D STAGECOACH', { sourceType: 'pdf', context, sourceRowPrefix: '1' });
  const second = parseStatementText('Page 2 of 4\nDate Description Paid In (£) Withdrawn (£) Balance (£)\nSERVICES STOCKPORT GB\nWithdrawn £2.50', { sourceType: 'pdf-scan', context, sourceRowPrefix: '2' });
  assert.equal(first.length, 0);
  assert.equal(second.length, 1);
  assert.equal(second[0].date, '2026-10-26');
  assert.equal(second[0].description, 'Card Transaction 7118 23OCT26 D STAGECOACH SERVICES STOCKPORT GB');
  assert.equal(second[0].amount, 250);
  assert.equal(second[0].direction, 'expense');
  assert.equal(second[0].sourceRow.startsWith('2:'), true);
});

test('OCR word geometry maps statement columns, ignores running balances, and keeps the first brought-forward opening', () => {
  const line = (row, pairs) => ({
    text: pairs.map(([, text]) => text).join(' '),
    words: pairs.map(([x, text]) => ({ text, bbox: { x0: x, x1: x + text.length * 5, y0: row * 20, y1: row * 20 + 10 } })),
  });
  const header = line(1, [[20, 'Date'], [100, 'Description'], [400, 'Paid'], [430, 'In'], [490, 'Withdrawn'], [590, 'Balance']]);
  const opening = line(2, [[20, '03'], [32, 'OCT'], [47, '2026'], [100, 'BROUGHT'], [150, 'FORWARD'], [590, '429.64']]);
  const credit = line(3, [[20, '05'], [38, 'OCT'], [60, '2026'], [100, 'Automated'], [155, 'Credit'], [195, 'SOI'], [220, 'WAD'], [250, 'LTD'], [400, '225.00'], [590, '654.64']]);
  const debit = line(4, [[100, 'Card'], [130, 'Transaction'], [200, 'STAGECOACH'], [490, '89.60'], [590, '565.04']]);
  const nextPageHeader = line(5, [[20, 'Date'], [100, 'Description'], [400, 'Paid'], [430, 'In'], [490, 'Withdrawn'], [590, 'Balance']]);
  const carried = line(6, [[100, 'BROUGHT'], [150, 'FORWARD'], [590, '579.66']]);
  const context = {}, diagnostics = {};
  const ocrInput = statementOcrInput({ lines: [header, opening, credit, debit, nextPageHeader, carried] });
  const records = parseStatementText(ocrInput, { sourceType: 'pdf-scan', context, diagnostics });
  assert.deepEqual(records.map(record => [record.date, record.amount, record.direction]), [
    ['2026-10-05', 22500, 'income'],
    ['2026-10-05', 8960, 'expense'],
  ]);
  assert.equal(context.openingBalance, 42964);
  assert.equal(context.closingBalance, null);
  assert.ok(diagnostics.ignoredBalanceRows >= 2);
});

test('positioned PDF text uses the Paid In and Withdrawn columns and never imports the running balance', () => {
  const header = { text: 'Date Description Paid In (£) Withdrawn (£) Balance (£)', sourceRow: 1, items: [
    { x: 10, text: 'Date' }, { x: 60, text: 'Description' }, { x: 220, text: 'Paid In (£)' }, { x: 340, text: 'Withdrawn (£)' }, { x: 440, text: 'Balance (£)' },
  ] };
  const positioned = (sourceRow, cells) => ({ sourceRow, text: cells.map(item => item.text).join(' '), items: cells });
  const records = parseStatementText([
    header,
    positioned(2, [{ x: 10, text: '03 OCT 2026' }, { x: 60, text: 'BROUGHT FORWARD' }, { x: 440, text: '£429.64' }]),
    positioned(3, [{ x: 10, text: '05 OCT' }, { x: 60, text: 'Automated Credit long reference 54416004843074297' }]),
    positioned(4, [{ x: 220, text: '£225.00' }, { x: 440, text: '£654.64' }]),
    positioned(5, [{ x: 60, text: 'Card Transaction 7118 02OCT26 D STAGECOACH' }]),
    positioned(6, [{ x: 60, text: 'SERVICES STOCKPORT GB' }]),
    positioned(7, [{ x: 340, text: '£89.60' }, { x: 440, text: '£565.04' }]),
  ], { sourceType: 'pdf' });
  assert.deepEqual(records.map(item => [item.date, item.amount, item.direction]), [['2026-10-05', 22500, 'income'], ['2026-10-05', 8960, 'expense']]);
  assert.match(records[0].description, /54416004843074297/);
  assert.match(records[1].description, /STAGECOACH SERVICES STOCKPORT GB/);
});

test('Paid In and Withdrawn CSV headers map directly and running balance is not the amount', () => {
  const headers = ['Date', 'Description', 'Paid In (£)', 'Withdrawn (£)', 'Balance (£)'];
  const rows = parseDelimitedText('Date,Description,Paid In (£),Withdrawn (£),Balance (£)\n05/10/2026,Salary,225.00,,654.64\n05/10/2026,Travel,,89.60,565.04', ',').slice(1);
  const records = rowsToImportTransactions(rows, headers);
  assert.deepEqual(records.map(item => [item.amount, item.direction, item.balance]), [[22500, 'income', 65464], [8960, 'expense', 56504]]);
});


test('statement duplicate matching normalizes descriptions and respects account and reference signals', () => {
  const record = { date: '2026-10-05', amount: 8960, description: 'Card Transaction 7118 02OCT26 D Stagecoach Services', direction: 'expense', reference: 'FP 0945' };
  const canonical = { id: 'saved', date: record.date, amount: 8960, title: 'card transaction 7118 02oct26 d-stagecoach services', type: 'expense', accountId: 'bank-1', reference: 'FP 0945' };
  assert.equal(findImportDuplicate(record, [canonical], 'bank-1'), canonical);
  assert.equal(findImportDuplicate(record, [canonical], 'bank-2'), null);
  assert.equal(findImportDuplicate({ ...record, description: 'Different narrative' }, [canonical], 'bank-1'), canonical);
});

test('labelled amount rows with no description require review', () => {
  const [record] = parseStatementText('03 OCT 2026\n05 OCT\nPaid In £1.00');
  assert.equal(record.date, '2026-10-05');
  assert.equal(record.amount, 100);
  assert.equal(record.confidence, 'review');
  assert.equal(record.validation, 'Add a transaction description.');
});


test('unlabelled positive currency amounts need direction review and a second column amount is never used as balance', () => {
  const uncertain = parseStatementText('03 OCT 2026\n05 OCT Shop £5.00');
  assert.equal(uncertain.length, 1);
  assert.equal(uncertain[0].confidence, 'review');
  assert.equal(uncertain[0].validation, 'Confirm whether this is money in or out.');
  const diagnostics = {};
  const ambiguous = parseStatementText('03 OCT 2026\n05 OCT Shop £5.00 £100.00', { diagnostics });
  assert.equal(ambiguous.length, 0);
  assert.equal(diagnostics.unparsedCandidateRows, 1);
});

test('import duplicate detection recognizes a linked Credit Purchase payment by provider and stable account', () => {
  const payment = { id: 'cp-payment', type: 'creditPayment', amount: 2925, date: '2026-11-25', accountId: 'bank-current', creditAgreementId: 'agreement-1', creditAgreementTitle: 'Philips Series 9000 Trimmer', creditAgreementMerchant: 'Klarna' };
  const imported = { date: '2026-11-27', amount: 2925, direction: 'expense', description: 'KLARNA payment' };
  assert.equal(findImportDuplicate(imported, [payment], 'bank-current'), payment);
  assert.equal(findImportDuplicate(imported, [payment], 'bank-savings'), null);
  assert.equal(findImportDuplicate({ ...imported, description: 'Tesco groceries' }, [payment], 'bank-current'), null);
});
