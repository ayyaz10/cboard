import { useMemo, useRef, useState } from 'react';
import { createImageOcrSession } from '../../services/ocr/imageOcr.js';
import { linkExistingIncomeAsRefundState } from './refunds.js';
import { findMatchingAccountTransaction, findPossibleCardPayment, findPossibleTransfer, linkCardPaymentState, linkExistingTransactionsAsTransferState } from './financeAccounts.js';
import { buildImportedTransaction, detectDelimiter, detectImportColumns, detectPossibleRefund, findImportDuplicate, linkImportedBorrowedMoneyState, linkImportedPersonalSettlementState, matchImportAccount, rememberImportAccount, MAX_IMPORT_ROWS, parseDelimitedText, parseStatementText, rowsToImportTransactions, suggestCategory, suggestPersonalSettlement } from './transactionImport.js';
import { formatMoney } from './financeMath.js';
import { createFinanceAccount, financeAccountBalance } from './financeAccounts.js';
import { creditCardLiability } from './creditCards.js';
import { processIncomeTransactionChange } from './financeAllocations.js';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const OCR_PROFILE = { layout: 'receipt', parse: ({ text }) => ({ text, items: [], total: null }), score: (_, confidence) => ({ score: confidence || 0, complete: false, countMatches: false }) };
const escapePlainText = value => String(value).replace(/^[=+@]/, "'$");


async function extractPdfStatement(file, onProgress) {
  const [pdfjs, pdfWorker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker.default;
  const pdfDocument = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  if (pdfDocument.numPages > 80) { await pdfDocument.destroy(); throw new Error('This PDF has more than 80 pages. Split it into smaller statements and retry.'); }
  const records = [];
  let session = null;
  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber++) {
      onProgress(`Reading PDF page ${pageNumber} of ${pdfDocument.numPages}…`);
      const page = await pdfDocument.getPage(pageNumber), content = await page.getTextContent();
      const linesByY = new Map();
      for (const item of content.items) {
        if (!item.str?.trim()) continue;
        const y = Math.round(item.transform?.[5] || 0), line = linesByY.get(y) || [];
        line.push({ x: item.transform?.[4] || 0, text: item.str.trim() }); linesByY.set(y, line);
      }
      const pageText = [...linesByY.entries()].sort((a, b) => b[0] - a[0]).map(([, line]) => line.sort((a, b) => a.x - b.x).map(item => item.text).join(' ')).join('\n');
      let extracted = parseStatementText(pageText, { sourceType: 'pdf' });
      if (extracted.length) { if (records.length + extracted.length > MAX_IMPORT_ROWS) throw new Error('Statements can contain at most ' + MAX_IMPORT_ROWS.toLocaleString() + ' transaction rows. Split the statement and import it in parts.'); records.push(...extracted.map(item => ({ ...item, sourceRow: `${pageNumber}:${item.sourceRow}` }))); }
      else {
        if (!session) session = createImageOcrSession(OCR_PROFILE, event => onProgress(event.status || 'Reading scanned page locally…'));
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(2, 2400 / baseViewport.width, Math.sqrt(20000000 / (baseViewport.width * baseViewport.height)));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d');
        await page.render({ canvasContext: context, viewport }).promise;
        const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not prepare a scanned PDF page.')), 'image/png'));
        const result = await session.scan(new File([blob], `statement-page-${pageNumber}.png`, { type: 'image/png' }), 0);
        extracted = parseStatementText(result.text, { sourceType: 'pdf-scan' });
        if (records.length + extracted.length > MAX_IMPORT_ROWS) throw new Error('Statements can contain at most ' + MAX_IMPORT_ROWS.toLocaleString() + ' transaction rows. Split the statement and import it in parts.'); records.push(...extracted.map(item => ({ ...item, sourceRow: `${pageNumber}:${item.sourceRow}` })));
        canvas.width = canvas.height = 0;
      }
      page.cleanup();
    }
  } finally { session?.dispose(); await pdfDocument.destroy(); }
  return records;
}
export function TransactionImport({ data, busy, change, close }) {
  const [records, setRecords] = useState([]), [mapping, setMapping] = useState(null), [headers, setHeaders] = useState([]), [rawRows, setRawRows] = useState([]);
  const [visibleRecordCount, setVisibleRecordCount] = useState(100);
  const [accountId, setAccountId] = useState(''), [borrowPeople, setBorrowPeople] = useState({}), [borrowNames, setBorrowNames] = useState({}), [showAccountForm, setShowAccountForm] = useState(false), [newAccountName, setNewAccountName] = useState(''), [newAccountType, setNewAccountType] = useState('bank'), [newAccountOpening, setNewAccountOpening] = useState('0'), [error, setError] = useState(''), [progress, setProgress] = useState(''), [loading, setLoading] = useState(false), [complete, setComplete] = useState(false), [importedCount, setImportedCount] = useState(0);
  const input = useRef(null), ocr = useRef(null);
  const accountOptions = useMemo(() => {
    const result = [{ value: '', label: 'Spendable money (legacy)' }];
    for (const account of data.accounts || []) if (!account.archivedAt) result.push({ value: account.id, label: `${account.name} ? ${formatMoney(financeAccountBalance(data, account.id), data.settings.currency)}` });
    for (const card of data.creditCards || []) if (!card.archivedAt) result.push({ value: card.id, label: `${card.name} ? Credit Card ? Owed ${formatMoney(creditCardLiability(data, card), data.settings.currency)}` });
    for (const goal of data.goals || []) result.push({ value: `goal:${goal.id}`, label: `${goal.title} (goal)` });
    for (const fund of data.investments || []) result.push({ value: `investment:${fund.id}`, label: fund.name });
    return result;
  }, [data.accounts, data.creditCards, data.goals, data.investments, data.settings.currency, data.transactions]);
  const loadCsv = (text, type = 'csv') => {
    const rows = parseDelimitedText(text, detectDelimiter(text));
    if (rows.length < 2) throw new Error('The file needs a header row and at least one transaction.');
    const nextHeaders = rows[0].map(String), nextMapping = detectImportColumns(nextHeaders), body = rows.slice(1);
    setHeaders(nextHeaders); setRawRows(body); setMapping(nextMapping);
    const parsed = rowsToImportTransactions(body, nextHeaders, nextMapping, { sourceType: type });
    const accountNames = [...new Set(parsed.map(record => record.accountName).filter(Boolean))];
    if (accountNames.length === 1) { const suggested = matchImportAccount(accountNames[0], data); if (suggested) setAccountId(suggested); }
    setRecords(parsed.map(record => record.currency && record.currency.toUpperCase() !== data.settings.currency ? { ...record, confidence: 'review', validation: 'Currency ' + record.currency + ' differs from Finance ' + data.settings.currency + '.' } : record));
  };
  const readFile = async file => {
    if (!file) return;
    setError(''); setComplete(false); setLoading(true); setProgress('');
    try {
      if (!file.size || file.size > MAX_FILE_BYTES) throw new Error('Choose a non-empty statement smaller than 25 MB.');
      const ext = file.name.toLowerCase().split('.').pop();
      if (ext === 'csv' || file.type === 'text/csv' || file.type === 'text/plain') loadCsv(await file.text());
      else if (['jpg', 'jpeg', 'png', 'webp'].includes(ext) || ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        ocr.current = createImageOcrSession(OCR_PROFILE, event => setProgress(event.status === 'recognizing text' ? 'Reading statement locally…' : event.status || 'Preparing image…'));
        let result;
        try { result = await ocr.current.scan(file, 0); } catch { throw new Error('The image could not be read clearly. Use a clear, straight screenshot showing the full transaction rows.'); }
        const extracted = parseStatementText(result.text, { sourceType: 'image' });
        if (!extracted.length) throw new Error('No clear transaction rows were found. Use a clear, straight screenshot showing the full transaction rows.');
        setRecords(extracted); setHeaders([]); setRawRows([]); setMapping(null);
      } else if (ext === 'pdf' || file.type === 'application/pdf') {
        const extracted = await extractPdfStatement(file, setProgress);
        if (!extracted.length) throw new Error('No transaction rows were found. Use a clear statement PDF or export it as CSV.');
        setRecords(extracted); setHeaders([]); setRawRows([]); setMapping(null);
      } else throw new Error('Choose a CSV, PDF, JPG, JPEG, PNG or WEBP statement.');
    } catch (reason) { setError(reason?.message || 'The file could not be read.'); }
    finally { ocr.current?.dispose(); ocr.current = null; setLoading(false); setProgress(''); }
  };
  const updateMapping = (field, value) => {
    const next = { ...mapping, [field]: value === '' ? undefined : Number(value) };
    next.confident = Number.isInteger(next.date) && Number.isInteger(next.description) && (Number.isInteger(next.amount) || Number.isInteger(next.debit) || Number.isInteger(next.credit));
    setMapping(next); setRecords(rowsToImportTransactions(rawRows, headers, next).map(record => record.currency && record.currency.toUpperCase() !== data.settings.currency ? { ...record, confidence: 'review', validation: 'Currency ' + record.currency + ' differs from Finance ' + data.settings.currency + '.' } : record));
  };
  const updateRecord = (index, patch) => setRecords(current => current.map((record, at) => at === index ? { ...record, ...(patch.direction && patch.direction !== record.direction ? { classification: patch.direction === "income" ? "review" : "expense" } : {}), ...patch } : record));
  const duplicates = records.map((record, index) => findImportDuplicate(record, [...data.transactions, ...records.slice(0, index).map(prior => ({ date: prior.date, amount: prior.amount, title: prior.description, type: prior.direction }))]));
  const selectedCount = records.filter((record, index) => record.selected !== false && !record.linked && record.confidence === 'ready' && (record.direction !== 'income' || record.classification === 'income') && !duplicates[index]).length;
  async function addAccount() {
    setError('');
    try { const openingBalance = Math.round(Number(newAccountOpening) * 100); if (!Number.isSafeInteger(openingBalance)) throw new Error('Enter a valid opening balance.'); let added; const saved = await change(state => { added = createFinanceAccount(state, { name: newAccountName, type: newAccountType, openingBalance }); return state; }, 'Account added'); if (!saved) throw new Error('Could not save this account.'); setAccountId(added.id); setNewAccountName(''); setNewAccountOpening('0'); setShowAccountForm(false); } catch (reason) { setError(reason.message || 'Account could not be added.'); }
  }
  async function importRows() {
    setError('');
    try {
      const chosen = records.filter((record, index) => record.selected !== false && !record.linked && record.confidence === 'ready' && (record.direction !== 'income' || record.classification === 'income') && !duplicates[index]);
      if (!chosen.length) throw new Error('Select at least one ready transaction that is not a duplicate.');
      let imported = 0;
      const saved = await change(state => {
        const seen = [...state.transactions];
        const accountNames = [...new Set(chosen.map(record => record.accountName).filter(Boolean))];
        if (accountNames.length === 1) rememberImportAccount(state, accountNames[0], accountId);
        for (const record of chosen) {
          if (findImportDuplicate(record, seen)) continue;
          const duplicate = detectPossibleRefund(record, seen);
          const categoryId = suggestCategory(record.description, record.direction, state.categories, state.transactions);
          const transaction = buildImportedTransaction(record, state, { accountId, categoryId: record.categoryId || categoryId });
          if (duplicate) transaction.importMatch = 'possible-refund';
          state.transactions.push(transaction); processIncomeTransactionChange(state, null, transaction); seen.push(transaction); imported++;
        }
        return state;
      }, 'Transactions imported');
      if (!saved) throw new Error('Could not save these transactions. Your Finance data was not changed.');
      setImportedCount(imported); setComplete(true);
    } catch (reason) { setError(reason.message || 'Import failed.'); }
  }
  return <div className="f-import-workspace">
    <div className="f-between"><div><p className="f-help">Files stay in this browser and are discarded after parsing.</p></div><button type="button" className="f-button" onClick={close}>Close</button></div>
    {complete ? <div role="status" className="f-item"><strong>Import complete</strong><p>{importedCount} transaction{importedCount === 1 ? '' : 's'} imported into Finance.</p><button className="f-primary" onClick={close}>Done</button></div> : <>
      <div className="f-import-upload"><label className="f-primary" htmlFor="finance-import-file">Choose CSV, PDF or image</label><input ref={input} id="finance-import-file" type="file" accept=".csv,.pdf,.jpg,.jpeg,.png,.webp,text/csv,application/pdf,image/jpeg,image/png,image/webp" onChange={event => readFile(event.target.files?.[0])}/></div>
      <label>Import into account<select className="f-input" value={accountId} onChange={event => setAccountId(event.target.value)}>{accountOptions.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label><button type="button" className="f-button" onClick={() => setShowAccountForm(value => !value)}>{showAccountForm ? 'Cancel account setup' : 'Add bank or savings account'}</button>{showAccountForm && <div className="f-import-mapping"><label>Account name<input className="f-input" maxLength={80} value={newAccountName} onChange={event => setNewAccountName(event.target.value)}/></label><label>Type<select className="f-input" value={newAccountType} onChange={event => setNewAccountType(event.target.value)}><option value="bank">Current / bank</option><option value="savings">Savings</option><option value="cash">Cash</option><option value="other">Other</option></select></label><label>Opening balance<input className="f-input" inputMode="decimal" value={newAccountOpening} onChange={event => setNewAccountOpening(event.target.value)}/></label><button type="button" className="f-primary" onClick={addAccount} disabled={busy}>Save account</button></div>}
      {loading && <p className="f-help" role="status">{progress || 'Reading file locally…'}</p>}
      {error && <p className="f-alert" role="alert">{error}</p>}
      {mapping && !mapping.confident && <fieldset className="f-import-mapping"><legend>Match columns</legend>{['date', 'description', 'amount', 'debit', 'credit'].map(field => <label key={field}>{field[0].toUpperCase() + field.slice(1)}<select className="f-input" value={mapping[field] ?? ''} onChange={event => updateMapping(field, event.target.value)}><option value="">Not used</option>{headers.map((header, index) => <option key={index} value={index}>{escapePlainText(header)}</option>)}</select></label>)}</fieldset>}
      {records.length > 0 && <><div className="f-between f-import-summary"><strong>{records.length} rows</strong><span>{selectedCount} ready to import</span></div><div className="f-import-list">{records.slice(0, visibleRecordCount).map((record, index) => {
        const duplicate = duplicates[index], refund = detectPossibleRefund(record, data.transactions), personalMatch = suggestPersonalSettlement(record, data);
        const transfer = accountId ? findPossibleTransfer(record, accountId, data.transactions) : null;
        const existingSide = transfer && accountId ? findMatchingAccountTransaction(record, accountId, data.transactions) : null;
        const cardPayment = accountId && (data.creditCards || []).some(card => card.id === accountId) ? findPossibleCardPayment(record, accountId, data.transactions) : null;
        return <article className="f-import-row" key={`${record.sourceRow}-${index}`}><label className="f-import-select"><input type="checkbox" checked={record.selected !== false && !record.linked && !duplicate && record.confidence === 'ready' && (record.direction !== 'income' || record.classification === 'income')} disabled={Boolean(record.linked || duplicate) || record.confidence !== 'ready' || record.direction === 'income' && record.classification !== 'income'} onChange={event => updateRecord(index, { selected: event.target.checked })}/><span className="sr-only">Import row {record.sourceRow}</span></label><div className="f-import-fields"><label>Date<input className="f-input" type="date" value={record.date} onChange={event => updateRecord(index, { date: event.target.value, confidence: event.target.value && record.description && record.amount && (!record.currency || record.currency.toUpperCase() === data.settings.currency) ? 'ready' : 'review', validation: '' })}/></label><label>Description<input className="f-input" maxLength="200" value={record.description} onChange={event => updateRecord(index, { description: event.target.value, confidence: event.target.value && record.date && record.amount && (!record.currency || record.currency.toUpperCase() === data.settings.currency) ? 'ready' : 'review', validation: '' })}/></label><label>Amount<input className="f-input" inputMode="decimal" value={(record.amount / 100).toFixed(2)} onChange={event => { const amount = Math.round(Number(event.target.value) * 100); updateRecord(index, { amount: Number.isSafeInteger(amount) ? amount : 0, confidence: amount > 0 && record.date && record.description && (!record.currency || record.currency.toUpperCase() === data.settings.currency) ? 'ready' : 'review', validation: '' }); }}/></label><label>Direction<select className="f-input" value={record.direction} onChange={event => updateRecord(index, { direction: event.target.value })}><option value="expense">Expense / out</option><option value="income">Incoming / in</option></select></label>{record.direction === 'income' && <label>Classification<select className="f-input" aria-label={`Classification for ${record.description}`} value={record.classification || 'review'} onChange={event => updateRecord(index, { classification: event.target.value })}><option value="review">Needs review</option><option value="income">Income</option></select></label>}<label>Category<select className="f-input" value={record.categoryId ?? suggestCategory(record.description, record.direction, data.categories, data.transactions)} onChange={event => updateRecord(index, { categoryId: event.target.value })}><option value="">Uncategorized</option>{data.categories.filter(item => !item.archived && item.type === record.direction).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><div className="f-import-status">{duplicate ? <strong role="status">Duplicate · skipped</strong> : record.confidence !== 'ready' ? <span>Needs review · {record.validation || 'Check row values'}</span> : record.direction === 'income' && record.classification !== 'income' ? <span>Needs review · choose Income or use a matching action below</span> : <span>Ready</span>}{record.linked ? <small>Linked as {record.linked}</small> : personalMatch && !duplicate ? <><small>Possible {personalMatch.kind} to {personalMatch.personName} ? confirm before linking</small><button type="button" className="f-button" disabled={busy} onClick={async()=>{try{await change(state=>{if(findImportDuplicate(record,state.transactions))throw new Error('This transaction is already in Finance.');linkImportedPersonalSettlementState(state,{record,entryId:personalMatch.entryId,accountId,categoryId:record.categoryId||''});rememberImportAccount(state,record.accountName,accountId);return state},personalMatch.kind==='repayment'?'Imported personal repayment linked':'Imported reimbursement linked');updateRecord(index,{linked:personalMatch.kind,selected:false})}catch(cause){setError(cause.message)}}}>Link as {personalMatch.kind} to {personalMatch.personName}</button></> : null}{!record.linked && !personalMatch && refund && !duplicate && <><small>Possible refund for ?{refund.title}? ? not linked</small><button type="button" className="f-button" disabled={busy} onClick={async()=>{try{await change(state=>{const incoming=buildImportedTransaction(record,state,{accountId,categoryId:record.categoryId||suggestCategory(record.description,record.direction,state.categories,state.transactions)});state.transactions.push(incoming);rememberImportAccount(state,record.accountName,accountId);linkExistingIncomeAsRefundState(state,{incomingTransactionId:incoming.id,originalTransactionId:refund.id});return state},'Imported transaction linked as refund');updateRecord(index,{linked:'refund',selected:false})}catch(cause){setError(cause.message)}}}>Link as refund</button></>}{record.direction==='income'&&!record.linked&&!duplicate&&<details className="f-import-reclassify"><summary>Reclassify as borrowed money</summary><label>Who lent you this money?<select className="f-input" value={borrowPeople[index]||''} onChange={event=>setBorrowPeople(current=>({...current,[index]:event.target.value}))}><option value="">Enter a new person</option>{(data.financePeople||[]).filter(person=>!person.archived).map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>{!borrowPeople[index]&&<label>Person name<input className="f-input" maxLength={80} value={borrowNames[index]||''} onChange={event=>setBorrowNames(current=>({...current,[index]:event.target.value}))}/></label>}<button type="button" className="f-button" disabled={busy||!borrowPeople[index]&&!String(borrowNames[index]||'').trim()} onClick={async()=>{try{await change(state=>{if(findImportDuplicate(record,state.transactions))throw new Error('This transaction is already in Finance.');linkImportedBorrowedMoneyState(state,{record,personId:borrowPeople[index]||'',personName:borrowNames[index]||'',accountId});rememberImportAccount(state,record.accountName,accountId);return state},'Imported borrowed money recorded');updateRecord(index,{linked:'borrowed money',selected:false})}catch(cause){setError(cause.message)}}}>Record borrowed money</button></details>}{transfer && !duplicate && !record.linked && <><small>Possible transfer with {transfer.title}{existingSide ? ' ? matching transaction already exists' : ''}</small><button type="button" className="f-button" disabled={busy} onClick={async()=>{try{await change(state=>{const current=existingSide?state.transactions.find(item=>item.id===existingSide.id):buildImportedTransaction(record,state,{accountId,categoryId:record.categoryId||''});if(!existingSide)state.transactions.push(current);rememberImportAccount(state,record.accountName,accountId);linkExistingTransactionsAsTransferState(state,{firstId:current.id,secondId:transfer.id});return state},'Imported transfer linked');updateRecord(index,{linked:'transfer',selected:false})}catch(cause){setError(cause.message)}}}>Link transfer</button></>}{cardPayment && !duplicate && !record.linked && <><small>Possible card payment match ? {cardPayment.title}</small><button type="button" className="f-button" disabled={busy} onClick={async()=>{try{await change(state=>{const cardSide=buildImportedTransaction(record,state,{accountId,categoryId:''});state.transactions.push(cardSide);rememberImportAccount(state,record.accountName,accountId);linkCardPaymentState(state,{bankTransactionId:cardPayment.id,cardTransactionId:cardSide.id});return state},'Imported card payment linked');updateRecord(index,{linked:'card payment',selected:false})}catch(cause){setError(cause.message)}}}>Link card payment</button></>}</div><strong>{formatMoney(record.amount, data.settings.currency)}</strong></article>;
      })}</div>{records.length > visibleRecordCount && <button type="button" className="f-button" onClick={() => setVisibleRecordCount(count => Math.min(count + 100, records.length))}>Show 100 more ({records.length - visibleRecordCount} remaining)</button>}<div className="f-import-sticky"><button type="button" className="f-primary" disabled={busy || selectedCount === 0} onClick={importRows}>{busy ? 'Importing…' : `Import ${selectedCount} transaction${selectedCount === 1 ? '' : 's'}`}</button><button type="button" className="f-button" onClick={() => { setRecords([]); setRawRows([]); setHeaders([]); setMapping(null); if (input.current) input.current.value = ''; }}>Choose another file</button></div></>}
    </>}
  </div>;
}










