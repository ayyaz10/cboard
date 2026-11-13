import { useMemo, useRef, useState } from 'react';
import { createImageOcrSession } from '../../services/ocr/imageOcr.js';
import { extractPdfStatement, reconcileStatementBalances } from './statementPdfExtraction.js';
import { linkExistingIncomeAsRefundState } from './refunds.js';
import { findMatchingAccountTransaction, findPossibleCardPayment, findPossibleTransfer, linkCardPaymentState, linkExistingTransactionsAsTransferState } from './financeAccounts.js';
import { buildImportedTransaction, detectDelimiter, detectImportColumns, detectPossibleRefund, findImportDuplicate, linkImportedBorrowedMoneyState, linkImportedPersonalSettlementState, matchImportAccount, rememberImportAccount, parseDelimitedText, parseStatementText, statementOcrInput, rowsToImportTransactions, suggestCategory, suggestPersonalSettlement } from './transactionImport.js';
import { formatMoney } from './financeMath.js';
import { createFinanceAccount, financeAccountBalance } from './financeAccounts.js';
import { creditCardLiability } from './creditCards.js';
import { processIncomeTransactionChange } from './financeAllocations.js'; import { getCreditAgreementStatus, getCreditInstalmentAmounts, recordImportedCreditPayment } from './creditPurchases.js';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const OCR_PROFILE = { layout: 'receipt', parse: ({ text }) => ({ text, items: [], total: null }), score: (_, confidence) => ({ score: confidence || 0, complete: false, countMatches: false }) };
const escapePlainText = value => String(value).replace(/^[=+@]/, "'$");


function inferCsvStatementBalances(records) {
  const rows = records.filter(record => Number.isSafeInteger(record.balance));
  if (!rows.length) return { opening: null, closing: null };
  const first = rows[0], last = rows.at(-1);
  const firstMovement = first.direction === 'income' ? first.amount : -first.amount;
  return { opening: first.balance - firstMovement, closing: last.balance };
}

export function TransactionImport({ data, busy, change, close }) {
  const [records, setRecords] = useState([]), [mapping, setMapping] = useState(null), [headers, setHeaders] = useState([]), [rawRows, setRawRows] = useState([]);
  const [visibleRecordCount, setVisibleRecordCount] = useState(100), [statementBalances, setStatementBalances] = useState(null), [statementExtraction, setStatementExtraction] = useState(null);
  const [accountId, setAccountId] = useState(''), [borrowPeople, setBorrowPeople] = useState({}), [borrowNames, setBorrowNames] = useState({}), [showAccountForm, setShowAccountForm] = useState(false), [newAccountName, setNewAccountName] = useState(''), [newAccountType, setNewAccountType] = useState('bank'), [newAccountOpening, setNewAccountOpening] = useState('0'), [error, setError] = useState(''), [progress, setProgress] = useState(''), [loading, setLoading] = useState(false), [complete, setComplete] = useState(false), [importedCount, setImportedCount] = useState(0);
  const input = useRef(null), ocr = useRef(null), creditPaymentLocks = useRef(new Set()); const [creditLinkDrafts, setCreditLinkDrafts] = useState({});
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
    const balances = inferCsvStatementBalances(parsed);
    setStatementBalances(balances); setStatementExtraction({ balances, reconciliation: reconcileStatementBalances(parsed, balances), diagnostics: { pages: [], pagesRequiringOcr: [], unresolvedPages: [] } });
    setRecords(parsed.map(record => record.currency && record.currency.toUpperCase() !== data.settings.currency ? { ...record, confidence: 'review', validation: 'Currency ' + record.currency + ' differs from Finance ' + data.settings.currency + '.' } : record));
  };
  const readFile = async file => {
    if (!file) return;
    setError(''); setComplete(false); setLoading(true); setProgress(''); setStatementBalances(null); setStatementExtraction(null);
    try {
      if (!file.size || file.size > MAX_FILE_BYTES) throw new Error('Choose a non-empty statement smaller than 25 MB.');
      const ext = file.name.toLowerCase().split('.').pop();
      if (ext === 'csv' || file.type === 'text/csv' || file.type === 'text/plain') loadCsv(await file.text());
      else if (['jpg', 'jpeg', 'png', 'webp'].includes(ext) || ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        ocr.current = createImageOcrSession(OCR_PROFILE, event => setProgress(event.status === 'recognizing text' ? 'Reading statement locallyÃ¢â‚¬Â¦' : event.status || 'Preparing imageÃ¢â‚¬Â¦'));
        let result;
        try { result = await ocr.current.scan(file, 0); } catch { throw new Error('The image could not be read clearly. Use a clear, straight screenshot showing the full transaction rows.'); }
        const diagnostics = {};
        const extracted = parseStatementText(statementOcrInput(result), { sourceType: 'image', diagnostics });
        const balances = { opening: diagnostics.openingBalance, closing: diagnostics.closingBalance };
        setStatementBalances(balances); setStatementExtraction({ balances, reconciliation: reconcileStatementBalances(extracted, balances), diagnostics: { pages: [], pagesRequiringOcr: [], unresolvedPages: [] } });
        if (!extracted.length) throw new Error('No clear transaction rows were found. Use a clear, straight screenshot showing the full transaction rows.');
        setRecords(extracted); setHeaders([]); setRawRows([]); setMapping(null);
      } else if (ext === 'pdf' || file.type === 'application/pdf') {
        const result = await extractPdfStatement(file, setProgress), extracted = result.records;
        setStatementBalances(result.balances); setStatementExtraction(result); setRecords(extracted); setHeaders([]); setRawRows([]); setMapping(null);
        if (!extracted.length) throw new Error('No transaction rows were found. Review OCR status or export the statement as CSV.');
      } else throw new Error('Choose a CSV, PDF, JPG, JPEG, PNG or WEBP statement.');
    } catch (reason) { setError(reason?.message || 'The file could not be read.'); }
    finally { ocr.current?.dispose(); ocr.current = null; setLoading(false); setProgress(''); }
  };
  const updateMapping = (field, value) => {
    const next = { ...mapping, [field]: value === '' ? undefined : Number(value) };
    next.confident = Number.isInteger(next.date) && Number.isInteger(next.description) && (Number.isInteger(next.amount) || Number.isInteger(next.debit) || Number.isInteger(next.credit));
    setMapping(next);
    const parsed = rowsToImportTransactions(rawRows, headers, next);
    const nextRecords = parsed.map(record => record.currency && record.currency.toUpperCase() !== data.settings.currency ? { ...record, confidence: 'review', validation: 'Currency ' + record.currency + ' differs from Finance ' + data.settings.currency + '.' } : record);
    const balances = inferCsvStatementBalances(parsed);
    setRecords(nextRecords); setStatementBalances(balances);
    setStatementExtraction({ balances, reconciliation: reconcileStatementBalances(parsed, balances), diagnostics: { pages: [], pagesRequiringOcr: [], unresolvedPages: [] } });
  };
  const updateRecord = (index, patch) => setRecords(current => current.map((record, at) => at === index ? { ...record, ...(patch.direction && patch.direction !== record.direction ? { classification: patch.direction === "income" ? "review" : "expense" } : {}), ...patch } : record));
  const duplicates = records.map((record, index) => findImportDuplicate(record, [...data.transactions, ...records.slice(0, index).map(prior => ({ date: prior.date, amount: prior.amount, title: prior.description, type: prior.direction, accountId }))], accountId));
  const selectedCount = records.filter((record, index) => record.selected !== false && !record.linked && record.confidence === 'ready' && (record.direction !== 'income' || record.classification === 'income') && !duplicates[index]).length;
  const duplicateCount = duplicates.filter(Boolean).length;
  const readyCount = records.filter((record, index) => !duplicates[index] && !record.linked && record.confidence === 'ready' && (record.direction !== 'income' || record.classification === 'income')).length;
  const reviewCount = records.filter((record, index) => !duplicates[index] && !record.linked && (record.confidence !== 'ready' || record.direction === 'income' && record.classification !== 'income')).length;
  const paidInTotal = records.filter(record => record.direction === 'income').reduce((sum, record) => sum + record.amount, 0);
  const withdrawnTotal = records.filter(record => record.direction === 'expense').reduce((sum, record) => sum + record.amount, 0);
  const reconciliation = statementExtraction?.reconciliation || reconcileStatementBalances(records, statementBalances);
  const extractedCount = records.filter(record => record.confidence === 'ready').length;
  const pagesRequiringOcr = statementExtraction?.diagnostics?.pagesRequiringOcr || [];
  const unresolvedExtractionPages = statementExtraction?.diagnostics?.unresolvedPages || [];
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
          if (findImportDuplicate(record, seen, accountId)) continue;
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
  async function linkCreditPayment(index, record, agreementId, instalmentId) {
    if (creditPaymentLocks.current.has(index)) return;
    creditPaymentLocks.current.add(index);
    setError('');
    try {
      if (!accountId || !(data.accounts || []).some(item => item.id === accountId && !item.archivedAt)) throw new Error('Choose an active bank or savings account before linking this payment.');
      const agreement = (data.creditAgreements || []).find(item => item.id === agreementId);
      if (!agreement || getCreditAgreementStatus(data, agreement) !== 'active') throw new Error('Choose an active Credit Purchase agreement.');
      const paymentId = crypto.randomUUID(), transactionId = crypto.randomUUID();
      const saved = await change(state => {
        if (findImportDuplicate(record, state.transactions, accountId)) throw new Error('This payment is already in Finance.');
        recordImportedCreditPayment(state, { agreementId, amount: record.amount, date: record.date, accountId, instalmentId, record, paymentId, transactionId });
        rememberImportAccount(state, record.accountName, accountId);
        return state;
      }, 'Imported Credit Purchase payment linked');
      if (!saved) throw new Error('Could not save this payment.');
      updateRecord(index, { linked: 'Credit Purchase payment', selected: false });
    } catch (reason) { setError(reason.message || 'Credit Purchase payment could not be linked.'); }
    finally { creditPaymentLocks.current.delete(index); }
  }
  return <div className="f-import-workspace">
    <div className="f-between"><div><p className="f-help">Files stay in this browser and are discarded after parsing.</p></div><button type="button" className="f-button" onClick={close}>Close</button></div>
    {complete ? <div role="status" className="f-item"><strong>Import complete</strong><p>{importedCount} transaction{importedCount === 1 ? '' : 's'} imported into Finance.</p><button className="f-primary" onClick={close}>Done</button></div> : <>
      <div className="f-import-upload"><label className="f-primary" htmlFor="finance-import-file">Choose CSV, PDF or image</label><input ref={input} id="finance-import-file" type="file" accept=".csv,.pdf,.jpg,.jpeg,.png,.webp,text/csv,application/pdf,image/jpeg,image/png,image/webp" onChange={event => readFile(event.target.files?.[0])}/></div>
      <label>Import into account<select className="f-input" value={accountId} onChange={event => setAccountId(event.target.value)}>{accountOptions.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label><button type="button" className="f-button" onClick={() => setShowAccountForm(value => !value)}>{showAccountForm ? 'Cancel account setup' : 'Add bank or savings account'}</button>{showAccountForm && <div className="f-import-mapping"><label>Account name<input className="f-input" maxLength={80} value={newAccountName} onChange={event => setNewAccountName(event.target.value)}/></label><label>Type<select className="f-input" value={newAccountType} onChange={event => setNewAccountType(event.target.value)}><option value="bank">Current / bank</option><option value="savings">Savings</option><option value="cash">Cash</option><option value="other">Other</option></select></label><label>Opening balance<input className="f-input" inputMode="decimal" value={newAccountOpening} onChange={event => setNewAccountOpening(event.target.value)}/></label><button type="button" className="f-primary" onClick={addAccount} disabled={busy}>Save account</button></div>}
      {loading && <p className="f-help" role="status">{progress || 'Reading file locallyÃ¢â‚¬Â¦'}</p>}
      {error && <p className="f-alert" role="alert">{error}</p>}
      {mapping && !mapping.confident && <fieldset className="f-import-mapping"><legend>Match columns</legend>{['date', 'description', 'amount', 'debit', 'credit'].map(field => <label key={field}>{field[0].toUpperCase() + field.slice(1)}<select className="f-input" value={mapping[field] ?? ''} onChange={event => updateMapping(field, event.target.value)}><option value="">Not used</option>{headers.map((header, index) => <option key={index} value={index}>{escapePlainText(header)}</option>)}</select></label>)}</fieldset>}
      {statementExtraction && records.length === 0 && <section className="f-import-summary" aria-label="Import extraction status" data-testid="finance-import-summary"><div><h3 data-testid="finance-import-count-found">0 transactions found</h3><dl><div><dt>Extracted</dt><dd data-testid="finance-import-count-extracted">0</dd></div><div><dt>Needs review</dt><dd>0</dd></div><div><dt>Pages requiring OCR</dt><dd data-testid="finance-import-ocr-pages">{pagesRequiringOcr.length ? pagesRequiringOcr.join(', ') : 'None'}</dd></div></dl>{reconciliation.status === 'unavailable' ? <p role="status" data-testid="finance-import-reconciliation">Balance reconciliation unavailable; opening or closing balance was not detected.</p> : reconciliation.status === 'discrepancy' ? <p role="alert" className="f-alert" data-testid="finance-import-reconciliation">Statement totals do not reconcile. Missing or incorrectly classified transactions may be responsible.</p> : <p role="status" data-testid="finance-import-reconciliation">Statement balances reconcile.</p>}{unresolvedExtractionPages.length > 0 && <p role="alert" className="f-alert" data-testid="finance-import-extraction-warning">Pages {unresolvedExtractionPages.join(', ')} still have unresolved extraction issues.</p>}</div></section>}
      {records.length > 0 && <><section className="f-import-summary" aria-label="Import summary" data-testid="finance-import-summary"><div><h3 data-testid="finance-import-count-found">{records.length} transactions found</h3><dl><div><dt>Extracted</dt><dd data-testid="finance-import-count-extracted">{extractedCount}</dd></div><div><dt>Ready</dt><dd data-testid="finance-import-count-ready">{readyCount}</dd></div><div><dt>Needs review</dt><dd data-testid="finance-import-count-review">{reviewCount}</dd></div><div><dt>Duplicates</dt><dd data-testid="finance-import-count-duplicates">{duplicateCount}</dd></div><div><dt>Pages requiring OCR</dt><dd data-testid="finance-import-ocr-pages">{pagesRequiringOcr.length ? pagesRequiringOcr.join(', ') : 'None'}</dd></div></dl><p>Paid in <strong>{formatMoney(paidInTotal, data.settings.currency)}</strong> Ã‚Â· Withdrawn <strong>{formatMoney(withdrawnTotal, data.settings.currency)}</strong></p>{reconciliation.status === 'reconciled' && <p role="status" data-testid="finance-import-reconciliation">Statement balances reconcile within {formatMoney(reconciliation.tolerance, data.settings.currency)}.</p>}{reconciliation.status === 'discrepancy' && <p role="alert" className="f-alert" data-testid="finance-import-reconciliation">Statement totals differ from the closing balance by {formatMoney(Math.abs(reconciliation.difference), data.settings.currency)}. Missing or incorrectly classified transactions may be responsible.</p>}{reconciliation.status === 'unavailable' && statementExtraction && <p role="status" data-testid="finance-import-reconciliation">Balance reconciliation unavailable; opening or closing balance was not detected.</p>}{unresolvedExtractionPages.length > 0 && <p role="alert" className="f-alert" data-testid="finance-import-extraction-warning">Pages {unresolvedExtractionPages.join(', ')} still have unresolved extraction issues. Review affected transactions before importing.</p>}</div><div className="f-import-selection-actions"><button type="button" className="f-button" onClick={() => setRecords(current => current.map((record, index) => ({ ...record, selected: !duplicates[index] && !record.linked && record.confidence === 'ready' && (record.direction !== 'income' || record.classification === 'income') })))}>Select all ready</button>{duplicateCount > 0 && <button type="button" className="f-button" onClick={() => setRecords(current => current.map((record, index) => duplicates[index] ? { ...record, selected: false } : record))}>Deselect duplicates</button>}<strong>{selectedCount} selected</strong></div></section><div className="f-import-list">{records.slice(0, visibleRecordCount).map((record, index) => {
        const duplicate = duplicates[index], refund = detectPossibleRefund(record, data.transactions), personalMatch = suggestPersonalSettlement(record, data);
        const transfer = accountId ? findPossibleTransfer(record, accountId, data.transactions) : null;
        const existingSide = transfer && accountId ? findMatchingAccountTransaction(record, accountId, data.transactions) : null;
        const cardPayment = accountId && (data.creditCards || []).some(card => card.id === accountId) ? findPossibleCardPayment(record, accountId, data.transactions) : null;
        const statusText = duplicate ? 'Duplicate Ã‚Â· skipped' : record.confidence !== 'ready' ? `Needs review Ã‚Â· ${record.validation || 'Check row values'}` : record.direction === 'income' && record.classification !== 'income' ? 'Needs review Ã‚Â· choose Income or use a matching action below' : record.linked ? `Linked as ${record.linked}` : 'Ready';
        const dateLabel = record.date ? new Date(`${record.date}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : 'Date missing';
        const categoryLabel = data.categories.find(item => item.id === (record.categoryId || suggestCategory(record.description, record.direction, data.categories, data.transactions)))?.name || 'Uncategorized';
        const linkDraft = creditLinkDrafts[index] || {};
        const creditAgreements = (data.creditAgreements || []).filter(item => getCreditAgreementStatus(data, item) === 'active' && !item.archivedAt);
        const linkedAgreement = creditAgreements.find(item => item.id === linkDraft.agreementId);
        const linkRows = linkedAgreement ? (linkedAgreement.schedule || []).filter(item => !item.supersededAt && getCreditInstalmentAmounts(data, linkedAgreement, item).remaining > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate)) : [];
        const linkedInstalmentId = linkDraft.instalmentId === undefined || linkDraft.instalmentId === 'auto' ? linkRows[0]?.id || '' : linkDraft.instalmentId;        return <article className="f-import-row" key={`${record.sourceRow}-${index}`} data-testid="finance-import-row">
          <div className="f-import-row-summary">
            <label className="f-import-select"><input type="checkbox" aria-label={`Select ${record.description || 'transaction'} for import`} checked={record.selected !== false && !record.linked && !duplicate && record.confidence === 'ready' && (record.direction !== 'income' || record.classification === 'income')} disabled={Boolean(record.linked || duplicate) || record.confidence !== 'ready' || record.direction === 'income' && record.classification !== 'income'} onChange={event => updateRecord(index, { selected: event.target.checked })}/></label>
            <div className="f-import-row-copy">
              <div className="f-import-row-labels"><time dateTime={record.date || undefined}>{dateLabel}</time><span>{record.direction === 'income' ? 'Incoming' : 'Expense'} Ã‚Â· {categoryLabel}</span></div>
              <strong title={record.description}>{record.description || 'Description missing'}</strong>{record.sourceRow && <small className="f-import-source" data-testid="finance-import-source">Source row {record.sourceRows?.join(', ') || record.sourceRow}</small>}
            </div>
            <strong className={`f-import-amount ${record.direction === 'income' ? 'is-incoming' : ''}`}>{record.direction === 'income' ? '+' : 'Ã¢Ë†â€™'}{formatMoney(record.amount, data.settings.currency)}</strong>
            <div className="f-import-status">
              <strong className={`f-import-badge ${duplicate ? 'is-duplicate' : record.confidence !== 'ready' || record.direction === 'income' && record.classification !== 'income' ? 'is-review' : ''}`} role={duplicate ? 'status' : undefined}>{statusText}</strong>
              {record.direction === 'income' && !duplicate && !record.linked && <label className="f-import-classification">Classify incoming<select className="f-input" aria-label={`Classification for ${record.description}`} value={record.classification || 'review'} onChange={event => updateRecord(index, { classification: event.target.value })}><option value="review">Choose type</option><option value="income">Income</option></select></label>}
              {record.linked ? <small>Linked as {record.linked}</small> : personalMatch && !duplicate ? <><small>Possible {personalMatch.kind} to {personalMatch.personName} Ã‚Â· confirm before linking</small><button type="button" className="f-button" disabled={busy} onClick={async()=>{try{await change(state=>{if(findImportDuplicate(record,state.transactions,accountId))throw new Error('This transaction is already in Finance.');linkImportedPersonalSettlementState(state,{record,entryId:personalMatch.entryId,accountId,categoryId:record.categoryId||''});rememberImportAccount(state,record.accountName,accountId);return state},personalMatch.kind==='repayment'?'Imported personal repayment linked':'Imported reimbursement linked');updateRecord(index,{linked:personalMatch.kind,selected:false})}catch(cause){setError(cause.message)}}}>Link as {personalMatch.kind} to {personalMatch.personName}</button></> : null}
              {!record.linked && !personalMatch && refund && !duplicate && <><small>Possible refund for Ã¢â‚¬Å“{refund.title}Ã¢â‚¬Â Ã‚Â· not linked</small><button type="button" className="f-button" disabled={busy} onClick={async()=>{try{await change(state=>{const incoming=buildImportedTransaction(record,state,{accountId,categoryId:record.categoryId||suggestCategory(record.description,record.direction,state.categories,state.transactions)});state.transactions.push(incoming);rememberImportAccount(state,record.accountName,accountId);linkExistingIncomeAsRefundState(state,{incomingTransactionId:incoming.id,originalTransactionId:refund.id});return state},'Imported transaction linked as refund');updateRecord(index,{linked:'refund',selected:false})}catch(cause){setError(cause.message)}}}>Link as refund</button></>}
              {record.direction==='income'&&!record.linked&&!duplicate&&<details className="f-import-reclassify"><summary>Reclassify as borrowed money</summary><label>Who lent you this money?<select className="f-input" value={borrowPeople[index]||''} onChange={event=>setBorrowPeople(current=>({...current,[index]:event.target.value}))}><option value="">Enter a new person</option>{(data.financePeople||[]).filter(person=>!person.archived).map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>{!borrowPeople[index]&&<label>Person name<input className="f-input" maxLength={80} value={borrowNames[index]||''} onChange={event=>setBorrowNames(current=>({...current,[index]:event.target.value}))}/></label>}<button type="button" className="f-button" disabled={busy||!borrowPeople[index]&&!String(borrowNames[index]||'').trim()} onClick={async()=>{try{await change(state=>{if(findImportDuplicate(record,state.transactions,accountId))throw new Error('This transaction is already in Finance.');linkImportedBorrowedMoneyState(state,{record,personId:borrowPeople[index]||'',personName:borrowNames[index]||'',accountId});rememberImportAccount(state,record.accountName,accountId);return state},'Imported borrowed money recorded');updateRecord(index,{linked:'borrowed money',selected:false})}catch(cause){setError(cause.message)}}}>Record borrowed money</button></details>}
              {transfer && !duplicate && !record.linked && <><small>Possible transfer with {transfer.title}{existingSide ? ' Ã‚Â· matching transaction already exists' : ''}</small><button type="button" className="f-button" disabled={busy} onClick={async()=>{try{await change(state=>{const current=existingSide?state.transactions.find(item=>item.id===existingSide.id):buildImportedTransaction(record,state,{accountId,categoryId:record.categoryId||''});if(!existingSide)state.transactions.push(current);rememberImportAccount(state,record.accountName,accountId);linkExistingTransactionsAsTransferState(state,{firstId:current.id,secondId:transfer.id});return state},'Imported transfer linked');updateRecord(index,{linked:'transfer',selected:false})}catch(cause){setError(cause.message)}}}>Link transfer</button></>}
              {cardPayment && !duplicate && !record.linked && <><small>Possible card payment match Ã‚Â· {cardPayment.title}</small><button type="button" className="f-button" disabled={busy} onClick={async()=>{try{await change(state=>{const cardSide=buildImportedTransaction(record,state,{accountId,categoryId:''});state.transactions.push(cardSide);rememberImportAccount(state,record.accountName,accountId);linkCardPaymentState(state,{bankTransactionId:cardPayment.id,cardTransactionId:cardSide.id});return state},'Imported card payment linked');updateRecord(index,{linked:'card payment',selected:false})}catch(cause){setError(cause.message)}}}>Link card payment</button></>}
              {record.direction === 'expense' && !duplicate && !record.linked && creditAgreements.length > 0 && <details className="f-import-reclassify"><summary>Link as Credit Purchase payment</summary><label>Credit Purchase<select className="f-input" value={linkDraft.agreementId || ''} onChange={event => setCreditLinkDrafts(current => ({ ...current, [index]: { agreementId: event.target.value, instalmentId: 'auto' } }))}><option value="">Choose agreement</option>{creditAgreements.map(item => <option key={item.id} value={item.id}>{item.merchant ? item.merchant + ' Ã‚Â· ' : ''}{item.title}</option>)}</select></label>{linkedAgreement && <label>Scheduled instalment<select className="f-input" value={linkedInstalmentId} onChange={event => setCreditLinkDrafts(current => ({ ...current, [index]: { ...current[index], instalmentId: event.target.value } }))}><option value="">Extra principal (no scheduled instalment)</option>{linkRows.map(item => <option key={item.id} value={item.id}>{new Date(item.dueDate + 'T12:00:00').toLocaleDateString('en-GB')} Ã‚Â· {formatMoney(getCreditInstalmentAmounts(data, linkedAgreement, item).remaining, data.settings.currency)} remaining</option>)}</select></label>}<p className="f-help">This uses the imported payment amount, date, and selected account. The linked instalment and principal/fee split update through the Credit Purchase payment record.</p><button type="button" className="f-button" disabled={busy || !accountId || !linkDraft.agreementId} onClick={() => linkCreditPayment(index, record, linkDraft.agreementId, linkedInstalmentId)}>Record Credit Purchase payment</button></details>}              {!duplicate && !record.linked && <details className="f-import-edit"><summary>Edit details</summary><div className="f-import-fields">
                <label>Date<input className="f-input" type="date" value={record.date} onChange={event => updateRecord(index, { date: event.target.value, confidence: event.target.value && record.description && record.amount && (!record.currency || record.currency.toUpperCase() === data.settings.currency) ? 'ready' : 'review', validation: '' })}/></label>
                <label>Description<input className="f-input" maxLength="200" value={record.description} onChange={event => updateRecord(index, { description: event.target.value, confidence: event.target.value && record.date && record.amount && (!record.currency || record.currency.toUpperCase() === data.settings.currency) ? 'ready' : 'review', validation: '' })}/></label>
                <label>Amount<input className="f-input" inputMode="decimal" value={(record.amount / 100).toFixed(2)} onChange={event => { const amount = Math.round(Number(event.target.value) * 100); updateRecord(index, { amount: Number.isSafeInteger(amount) ? amount : 0, confidence: amount > 0 && record.date && record.description && (!record.currency || record.currency.toUpperCase() === data.settings.currency) ? 'ready' : 'review', validation: '' }); }}/></label>
                <label>Direction<select className="f-input" value={record.direction} onChange={event => updateRecord(index, { direction: event.target.value })}><option value="expense">Expense / out</option><option value="income">Incoming / in</option></select></label>
                <label>Category<select className="f-input" value={record.categoryId ?? suggestCategory(record.description, record.direction, data.categories, data.transactions)} onChange={event => updateRecord(index, { categoryId: event.target.value })}><option value="">Uncategorized</option>{data.categories.filter(item => !item.archived && item.type === record.direction).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              </div></details>}
            </div>
          </div>
        </article>;
      })}</div>{records.length > visibleRecordCount && <button type="button" className="f-button" onClick={() => setVisibleRecordCount(count => Math.min(count + 100, records.length))}>Show 100 more ({records.length - visibleRecordCount} remaining)</button>}<div className="f-import-sticky"><button type="button" className="f-primary" disabled={busy || selectedCount === 0} onClick={importRows}>{busy ? 'ImportingÃ¢â‚¬Â¦' : `Import ${selectedCount} transaction${selectedCount === 1 ? '' : 's'}`}</button><button type="button" className="f-button" onClick={() => { setRecords([]); setRawRows([]); setHeaders([]); setMapping(null); setStatementBalances(null); setStatementExtraction(null); if (input.current) input.current.value = ''; }}>Choose another file</button></div></>}
    </>}
  </div>;
}










