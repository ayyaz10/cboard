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

export function TransactionImport({ data, busy, change, close, initialRecords = [] }) {
  const [records, setRecords] = useState(initialRecords), [mapping, setMapping] = useState(null), [headers, setHeaders] = useState([]), [rawRows, setRawRows] = useState([]);
  const [visibleRecordCount, setVisibleRecordCount] = useState(100), [statementBalances, setStatementBalances] = useState(null), [statementExtraction, setStatementExtraction] = useState(null);
  const [accountId, setAccountId] = useState(''), [borrowPeople, setBorrowPeople] = useState({}), [borrowNames, setBorrowNames] = useState({}), [showAccountForm, setShowAccountForm] = useState(false), [newAccountName, setNewAccountName] = useState(''), [newAccountType, setNewAccountType] = useState('bank'), [newAccountOpening, setNewAccountOpening] = useState('0'), [error, setError] = useState(''), [progress, setProgress] = useState(''), [loading, setLoading] = useState(false), [complete, setComplete] = useState(false), [importedCount, setImportedCount] = useState(0);
  const input = useRef(null), ocr = useRef(null), fileRun = useRef(0), savedListScroll = useRef(0), creditPaymentLocks = useRef(new Set()); const [creditLinkDrafts, setCreditLinkDrafts] = useState({}), [editor, setEditor] = useState(null), [duplicateDetails, setDuplicateDetails] = useState(null);
  const accountOptions = useMemo(() => {
    const result = [{ value: '', label: 'Spendable money (legacy)' }];
    for (const account of data.accounts || []) if (!account.archivedAt) result.push({ value: account.id, label: `${account.name} · ${formatMoney(financeAccountBalance(data, account.id), data.settings.currency)}` });
    for (const card of data.creditCards || []) if (!card.archivedAt) result.push({ value: card.id, label: `${card.name} · Credit Card · Owed ${formatMoney(creditCardLiability(data, card), data.settings.currency)}` });
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
    return parsed.length;
  };
  const readFile = async file => {
    if (!file) return;
    const run = ++fileRun.current;
    let parsedCount = 0, localOcr = null;
    setError(''); setRecords([]); setHeaders([]); setRawRows([]); setMapping(null); setComplete(false); setLoading(true); setProgress(file.name.toLowerCase().endsWith('.csv') ? 'Reading transactions' : 'Reading statement'); setStatementBalances(null); setStatementExtraction(null); setVisibleRecordCount(100); setEditor(null);
    try {
      if (!file.size || file.size > MAX_FILE_BYTES) throw new Error('Choose a non-empty statement smaller than 25 MB.');
      const ext = file.name.toLowerCase().split('.').pop();
      if (ext === 'csv' || file.type === 'text/csv' || file.type === 'text/plain') { const text = await file.text(); if (run !== fileRun.current) return; parsedCount = loadCsv(text); }
      else if (['jpg', 'jpeg', 'png', 'webp'].includes(ext) || ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        localOcr = createImageOcrSession(OCR_PROFILE, event => { if (run === fileRun.current) setProgress(event.status === "recognizing text" ? `Reading statement image${Number.isFinite(event.progress) ? ` ${Math.round(event.progress * 100)}%` : ''}` : event.status || "Reading statement image"); }); ocr.current = localOcr;
        let result;
        try { result = await localOcr.scan(file, 0); } catch { throw new Error('The image could not be read clearly. Use a clear, straight screenshot showing the full transaction rows.'); }
        const diagnostics = {};
        const extracted = parseStatementText(statementOcrInput(result), { sourceType: 'image', diagnostics }); if (run !== fileRun.current) return;
        const balances = { opening: diagnostics.openingBalance, closing: diagnostics.closingBalance };
        setStatementBalances(balances); setStatementExtraction({ balances, reconciliation: reconcileStatementBalances(extracted, balances), diagnostics: { pages: [], pagesRequiringOcr: [], unresolvedPages: [] } });
        if (!extracted.length) throw new Error('No clear transaction rows were found. Use a clear, straight screenshot showing the full transaction rows.');
        setRecords(extracted); parsedCount = extracted.length; setHeaders([]); setRawRows([]); setMapping(null);
      } else if (ext === 'pdf' || file.type === 'application/pdf') {
        const result = await extractPdfStatement(file, message => { if (run === fileRun.current) setProgress(message.replace('Reading PDF page', 'Reading page').replace('...', '')); }), extracted = result.records; if (run !== fileRun.current) return;
        setStatementBalances(result.balances); setStatementExtraction(result); setRecords(extracted); parsedCount = extracted.length; setHeaders([]); setRawRows([]); setMapping(null);
        if (!extracted.length) throw new Error('No transaction rows were found. Review OCR status or export the statement as CSV.');
      } else throw new Error('Choose a CSV, PDF, JPG, JPEG, PNG or WEBP statement.');
    } catch (reason) { if (run === fileRun.current) { setError(reason?.message || 'The file could not be read.'); setRecords([]); } }
    finally { localOcr?.dispose(); if (run === fileRun.current) { ocr.current = null; setLoading(false); setProgress(parsedCount ? `Preview ready: ${parsedCount} transactions` : ''); } }
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
  const restoreEditPosition = index => requestAnimationFrame(() => { const workspace = document.querySelector('.f-import-workspace'); if (workspace) workspace.scrollTop = savedListScroll.current; document.querySelector(`[data-import-edit-index="${index}"]`)?.focus(); });
  const updateRecord = (index, patch) => setRecords(current => current.map((record, at) => at === index ? { ...record, ...(patch.direction && patch.direction !== record.direction ? { classification: patch.direction === "income" ? "review" : "expense", categoryId: '' } : {}), ...patch } : record));
  const usedDuplicates = new Set();
  const duplicateMatches = records.map(record => { const match = findImportDuplicate(record, data.transactions.filter(item => !usedDuplicates.has(item.id)), record.accountOverride || accountId); if (match?.id) usedDuplicates.add(match.id); return match; });
  const duplicates = duplicateMatches.map((match, index) => records[index].duplicateChoice === 'separate' ? null : match);
  const activeRecords = records.filter(record => !record.skipped);
  const selectedCount = records.filter((record, index) => !record.skipped && record.selected !== false && !record.linked && record.confidence === 'ready' && (record.direction !== 'income' || record.classification === 'income') && !duplicates[index]).length;
  const duplicateCount = duplicates.filter(Boolean).length;
  const readyCount = records.filter((record, index) => !record.skipped && !duplicates[index] && !record.linked && record.confidence === 'ready' && (record.direction !== 'income' || record.classification === 'income')).length;
  const reviewCount = records.filter((record, index) => !record.skipped && !duplicates[index] && !record.linked && (record.confidence !== 'ready' || record.direction === 'income' && record.classification !== 'income')).length;
  const paidInTotal = activeRecords.filter(record => record.direction === 'income').reduce((sum, record) => sum + record.amount, 0);
  const withdrawnTotal = activeRecords.filter(record => record.direction === 'expense').reduce((sum, record) => sum + record.amount, 0);
  const reconciliation = reconcileStatementBalances(activeRecords, statementBalances);
  const extractedCount = records.filter(record => !record.skipped && record.confidence === 'ready').length;
  const hasUnresolvedMatch = records.some(record => !record.skipped && record.reviewReasons?.some(reason => reason.id === 'native-ocr-ambiguous-match'));
  const reasonMessages = record => { const reasons = [...new Set((record.reviewReasons || []).map(reason => reason.message))]; if (reasons.length) return reasons; return record.validation ? [record.validation] : []; };
  const applyMatchDecision = (decision, draft) => {
    const current = records[editor.index]; if (!current) return;
    const reason = current.reviewReasons?.find(item => item.id === 'native-ocr-ambiguous-match');
    const candidates = reason?.candidates || current.matchCandidates || []; const sourceRows = new Set(candidates.map(item => item.sourceRow));
    const clear = record => { const remaining = (record.reviewReasons || []).filter(item => item.id !== 'native-ocr-ambiguous-match'); let validation = record.validation || ''; if (reason?.message) validation = validation.replace(reason.message, '').replace(/\s{2,}/g, ' ').trim(); const requiredReady = Boolean(record.date && record.description?.trim() && Number.isSafeInteger(record.amount) && record.amount > 0); return { ...record, reviewReasons: remaining, validation, confidence: remaining.length || validation || !requiredReady ? 'review' : 'ready', selected: remaining.length || validation || !requiredReady ? false : true, matchCandidates: undefined, matchCandidateRows: undefined }; };
    setRecords(currentRows => { if (decision === 'skip') return currentRows.map((record, at) => at === editor.index ? { ...record, skipped: true, selected: false } : record); if (decision === 'separate') return currentRows.map(record => sourceRows.has(record.sourceRow) ? clear(record) : record); const chosenSource = draft.sourceRow; const chosen = currentRows.find(record => record.sourceRow === chosenSource) || current; const mergedSources = [...new Set(currentRows.filter(record => sourceRows.has(record.sourceRow)).flatMap(record => record.sourceRows || [record.sourceRow]).filter(Boolean))]; const cleanedValidation = draft.description?.trim() ? (chosen.validation || '').replace(/(?:Description missing|Add a transaction description\.)/g, '').trim() : chosen.validation; const next = clear({ ...chosen, ...draft, sourceType: 'pdf-merged', sourceRows: mergedSources, confidence: 'review', validation: cleanedValidation }); const needsDescription = !String(draft.description || '').trim(); const reasons = (next.reviewReasons || []).filter(item => item.id !== 'description-missing' || needsDescription); if (needsDescription && !reasons.some(item => item.id === 'description-missing')) reasons.push({ id: 'description-missing', message: 'Description missing' }); const finalized = { ...next, reviewReasons: reasons, confidence: reasons.length || next.validation ? 'review' : 'ready', selected: reasons.length || next.validation ? false : true }; let inserted = false; const output = []; for (const row of currentRows) { if (sourceRows.has(row.sourceRow)) { if (!inserted && row.sourceRow === chosenSource) { output.push(finalized); inserted = true; } } else output.push(row); } if (!inserted) output[editor.index] = finalized; return output; }); setEditor(null);
  };
  const pagesRequiringOcr = statementExtraction?.diagnostics?.pagesRequiringOcr || [];
  const unresolvedExtractionPages = statementExtraction?.diagnostics?.unresolvedPages || [];
  async function addAccount() {
    setError('');
    try { const openingBalance = Math.round(Number(newAccountOpening) * 100); if (!Number.isSafeInteger(openingBalance)) throw new Error('Enter a valid opening balance.'); let added; const saved = await change(state => { added = createFinanceAccount(state, { name: newAccountName, type: newAccountType, openingBalance }); return state; }, 'Account added'); if (!saved) throw new Error('Could not save this account.'); setAccountId(added.id); setNewAccountName(''); setNewAccountOpening('0'); setShowAccountForm(false); } catch (reason) { setError(reason.message || 'Account could not be added.'); }
  }
  async function importRows() {
    setError('');
    try {
      const chosen = records.filter((record, index) => !record.skipped && record.selected !== false && !record.linked && record.confidence === 'ready' && (record.direction !== 'income' || record.classification === 'income') && !duplicates[index]);
      if (!chosen.length) throw new Error('Select at least one ready transaction that is not a duplicate.');
      let imported = 0;
      const saved = await change(state => {
        const seen = [...state.transactions];
        const accountNames = [...new Set(chosen.map(record => record.accountName).filter(Boolean))];
        if (accountNames.length === 1) rememberImportAccount(state, accountNames[0], accountId);
        for (const record of chosen) {
          if (record.duplicateChoice !== 'separate' && findImportDuplicate(record, seen, record.accountOverride || accountId)) continue;
          const duplicate = detectPossibleRefund(record, seen);
          const categoryId = record.categoryId ?? suggestCategory(record.description, record.direction, state.categories, state.transactions);
          const transaction = buildImportedTransaction(record, state, { accountId: record.accountOverride || accountId, categoryId });
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
  if (editor?.kind === 'match') {
    const record = records[editor.index]; const candidates = record?.reviewReasons?.find(item => item.id === 'native-ocr-ambiguous-match')?.candidates || record?.matchCandidates || [];
    if (record) return <div className="f-import-workspace f-import-editor-view f-import-match-view" data-testid="finance-import-match-review">
      <div className="f-between"><div><h2>Review match</h2><p className="f-help">Compare the extracted rows below. Amounts alone do not establish that these are the same transaction.</p></div><button type="button" className="f-button" onClick={() => setEditor(null)}>Back to preview</button></div>
      <div className="f-import-match-candidates" aria-label="Candidate rows">{candidates.map((candidate, at) => <article key={`${candidate.sourceType}-${candidate.sourceRow}-${at}`}><strong>{candidate.description || 'Description missing'}</strong><span>{formatMoney(candidate.amount, data.settings.currency)} ? {candidate.date ? new Date(`${candidate.date}T00:00:00`).toLocaleDateString('en-GB') : 'Date missing'}</span><small>Page {candidate.page || '?'} ? Source row {candidate.sourceRow} ? {candidate.sourceType === 'pdf-scan' ? 'OCR' : 'Native PDF text'}</small></article>)}</div>
      <label className="is-wide">Use fields from candidate<select className="f-input" value={editor.draft.sourceRow} onChange={event => { const candidate = records.find(item => item.sourceRow === event.target.value); if (candidate) setEditor(current => ({ ...current, draft: { sourceRow: candidate.sourceRow, description: candidate.description || '', amount: candidate.amount, date: candidate.date, direction: candidate.direction } })); }}>{candidates.map((candidate, at) => <option key={`${candidate.sourceType}-${candidate.sourceRow}-${at}`} value={candidate.sourceRow}>{candidate.description || 'Description missing'} {'\u00b7'} row {candidate.sourceRow} {'\u00b7'} {candidate.sourceType === 'pdf-scan' ? 'OCR' : 'Native PDF text'}</option>)}</select></label>
      <label className="is-wide">Keep or correct this description<input className="f-input" value={editor.draft.description || ''} onChange={event => setEditor(current => ({ ...current, draft: { ...current.draft, description: event.target.value } }))} placeholder="Enter a description"/></label>
      <div className="f-import-editor-grid"><label>Amount<input className="f-input" inputMode="decimal" value={(editor.draft.amount / 100).toFixed(2)} onChange={event => { const amount = Math.round(Number(event.target.value) * 100); setEditor(current => ({ ...current, draft: { ...current.draft, amount: Number.isSafeInteger(amount) ? amount : 0 } })); }}/></label><label>Date<input className="f-input" type="date" value={editor.draft.date || ''} onChange={event => setEditor(current => ({ ...current, draft: { ...current.draft, date: event.target.value } }))}/></label><label>Direction<select className="f-input" value={editor.draft.direction} onChange={event => setEditor(current => ({ ...current, draft: { ...current.draft, direction: event.target.value } }))}><option value="expense">Expense / out</option><option value="income">Income / in</option></select></label></div>
      <div className="f-actions f-import-match-actions"><button type="button" className="f-primary" onClick={() => applyMatchDecision('same', editor.draft)}>Same transaction</button><button type="button" className="f-button" onClick={() => applyMatchDecision('separate')}>Separate transactions</button><button type="button" className="f-button" onClick={() => applyMatchDecision('skip')}>Skip selected row</button></div>
    </div>;
  }
  if (editor) {
    const record = records[editor.index];
    if (record) return <div className="f-import-workspace f-import-editor-view">
      <div className="f-between"><div><h2>Edit transaction</h2><p className="f-help">{record.description} - {formatMoney(record.amount, data.settings.currency)}</p></div><button type="button" className="f-button" onClick={() => { setEditor(null); restoreEditPosition(editor.index); }}>Cancel</button></div>
      <div className="f-import-editor-grid">
        <label className="is-wide">Merchant / title<input autoFocus className="f-input" maxLength={200} value={editor.draft.description} onChange={event => setEditor(current => ({ ...current, draft: { ...current.draft, description: event.target.value } }))}/></label>
        <label>Category<select className="f-input" value={editor.draft.categoryId ?? ''} onChange={event => setEditor(current => ({ ...current, draft: { ...current.draft, categoryId: event.target.value } }))}><option value="">Uncategorized</option>{data.categories.filter(item => !item.archived && item.type === editor.draft.direction).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Amount<input className="f-input" inputMode="decimal" value={(editor.draft.amount / 100).toFixed(2)} onChange={event => { const amount = Math.round(Number(event.target.value) * 100); setEditor(current => ({ ...current, draft: { ...current.draft, amount: Number.isSafeInteger(amount) ? amount : 0 } })); }}/></label>
        <label>Date<input className="f-input" type="date" value={editor.draft.date} onChange={event => setEditor(current => ({ ...current, draft: { ...current.draft, date: event.target.value } }))}/></label>
        <label>Direction<select className="f-input" value={editor.draft.direction} onChange={event => setEditor(current => ({ ...current, draft: { ...current.draft, direction: event.target.value } }))}><option value="expense">Expense / out</option><option value="income">Income / in</option></select></label>
        <label>Payment method<input className="f-input" maxLength={60} value={editor.draft.paymentMethod || ''} onChange={event => setEditor(current => ({ ...current, draft: { ...current.draft, paymentMethod: event.target.value } }))}/></label>
        <label>Account override<select className="f-input" value={editor.draft.accountOverride ?? ''} onChange={event => setEditor(current => ({ ...current, draft: { ...current.draft, accountOverride: event.target.value } }))}><option value="">Use selected import account</option>{accountOptions.filter(item => item.value && !item.value.startsWith('goal:') && !item.value.startsWith('investment:')).map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="is-wide">Notes<textarea className="f-input" maxLength={1000} value={editor.draft.note || ''} onChange={event => setEditor(current => ({ ...current, draft: { ...current.draft, note: event.target.value } }))}/></label>
      </div>
      {record.statementDetails && <details className="f-import-statement-details"><summary>Statement details</summary><p>{record.statementDetails}</p>{record.cardLastFour && <p>Card ending {record.cardLastFour}</p>}{record.purchaseDate && <p>Purchase date: {record.purchaseDate}; posting date: {record.date}</p>}</details>}
      {!editor.draft.description.trim() || !editor.draft.date || !Number.isSafeInteger(editor.draft.amount) || editor.draft.amount <= 0 ? <p className="f-alert" role="alert">Enter a title, valid date, and amount greater than zero.</p> : null}
      <div className="f-actions"><button type="button" className="f-primary" disabled={!editor.draft.description.trim() || !editor.draft.date || !Number.isSafeInteger(editor.draft.amount) || editor.draft.amount <= 0} onClick={() => { const edited = editor.draft; const reasons = (record.reviewReasons || []).filter(reason => reason.id !== 'description-missing' || !edited.description.trim()); const validCurrency = !record.currency || record.currency.toUpperCase() === data.settings.currency; const validation = edited.description.trim() ? (record.validation || '').replace(/(?:Description missing|Add a transaction description\.)/g, '').trim() : record.validation; const confidence = validCurrency && !reasons.length && !validation && edited.date && edited.amount > 0 ? 'ready' : 'review'; updateRecord(editor.index, { ...edited, reviewReasons: reasons, confidence, validation, selected: confidence === 'ready' }); setEditor(null); restoreEditPosition(editor.index); }}>Apply changes</button><button type="button" className="f-button" onClick={() => { setEditor(null); restoreEditPosition(editor.index); }}>Cancel</button></div>
    </div>;
  }
  return <div className="f-import-workspace">
    <div className="f-between"><div><p className="f-help">Files stay in this browser and are discarded after parsing.</p></div><button type="button" className="f-button" onClick={close}>Close</button></div>
    {complete ? <div role="status" className="f-item"><strong>Import complete</strong><p>{importedCount} transaction{importedCount === 1 ? '' : 's'} imported into Finance.</p><button className="f-primary" onClick={close}>Done</button></div> : <>
      <div className="f-import-upload"><label className="f-primary" htmlFor="finance-import-file">{error || records.length ? "Choose another file" : "Choose CSV, PDF or image"}</label><input ref={input} id="finance-import-file" type="file" accept=".csv,.pdf,.jpg,.jpeg,.png,.webp,text/csv,application/pdf,image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; readFile(file); }}/></div>
      <label>Import into account<select className="f-input" value={accountId} onChange={event => setAccountId(event.target.value)}>{accountOptions.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label><button type="button" className="f-button" onClick={() => setShowAccountForm(value => !value)}>{showAccountForm ? 'Cancel account setup' : 'Add bank or savings account'}</button>{showAccountForm && <div className="f-import-mapping"><label>Account name<input className="f-input" maxLength={80} value={newAccountName} onChange={event => setNewAccountName(event.target.value)}/></label><label>Type<select className="f-input" value={newAccountType} onChange={event => setNewAccountType(event.target.value)}><option value="bank">Current / bank</option><option value="savings">Savings</option><option value="cash">Cash</option><option value="other">Other</option></select></label><label>Opening balance<input className="f-input" inputMode="decimal" value={newAccountOpening} onChange={event => setNewAccountOpening(event.target.value)}/></label><button type="button" className="f-primary" onClick={addAccount} disabled={busy}>Save account</button></div>}
      {(loading || progress) && <div className="f-import-progress"><p className="f-help" role="status" aria-live="polite">{loading ? progress || 'Reading transactions' : progress}</p>{(() => { const page = progress.match(/(?:Reading|Scanning) page (\d+) of (\d+)/i), percent = progress.match(/(\d{1,3})%/); return <progress aria-label="File processing progress" max={page ? Number(page[2]) : percent ? 100 : undefined} value={page ? Number(page[1]) : percent ? Math.min(100, Number(percent[1])) : undefined}/>; })()}</div>}
      {error && <p className="f-alert" role="alert">{error}</p>}
      {mapping && !mapping.confident && <fieldset className="f-import-mapping"><legend>Match columns</legend>{['date', 'description', 'amount', 'debit', 'credit'].map(field => <label key={field}>{field[0].toUpperCase() + field.slice(1)}<select className="f-input" value={mapping[field] ?? ''} onChange={event => updateMapping(field, event.target.value)}><option value="">Not used</option>{headers.map((header, index) => <option key={index} value={index}>{escapePlainText(header)}</option>)}</select></label>)}</fieldset>}
      {statementExtraction && records.length === 0 && <section className="f-import-summary" aria-label="Import extraction status" data-testid="finance-import-summary"><div><h3 data-testid="finance-import-count-found">0 transactions found</h3><dl><div><dt>Extracted and valid</dt><dd data-testid="finance-import-count-extracted">0</dd></div><div><dt>Needs review</dt><dd>0</dd></div><div><dt>Pages requiring OCR</dt><dd data-testid="finance-import-ocr-pages">{pagesRequiringOcr.length ? pagesRequiringOcr.join(', ') : 'None'}</dd></div></dl>{reconciliation.status === 'unavailable' ? <p role="status" data-testid="finance-import-reconciliation">Balance reconciliation unavailable; opening or closing balance was not detected.</p> : reconciliation.status === 'discrepancy' ? <p role="alert" className="f-alert" data-testid="finance-import-reconciliation">Statement totals do not reconcile. Missing or incorrectly classified transactions may be responsible.</p> : <p role="status" data-testid="finance-import-reconciliation">Statement balances reconcile.</p>}{unresolvedExtractionPages.length > 0 && <p role="alert" className="f-alert" data-testid="finance-import-extraction-warning">Pages {unresolvedExtractionPages.join(', ')} still have unresolved extraction issues.</p>}</div></section>}
      {records.length > 0 && <><section className="f-import-summary" aria-label="Import summary" data-testid="finance-import-summary"><div><h3 data-testid="finance-import-count-found">{activeRecords.length} transactions found</h3><dl><div><dt>Extracted and valid</dt><dd data-testid="finance-import-count-extracted">{extractedCount}</dd></div><div><dt>Ready to import</dt><dd data-testid="finance-import-count-ready">{readyCount}</dd></div><div><dt>Needs review</dt><dd data-testid="finance-import-count-review">{reviewCount}</dd></div><div><dt>Already in ledger</dt><dd data-testid="finance-import-count-duplicates">{duplicateCount}</dd></div><div><dt>Pages requiring OCR</dt><dd data-testid="finance-import-ocr-pages">{pagesRequiringOcr.length ? pagesRequiringOcr.join(', ') : 'None'}</dd></div></dl><p>Paid in <strong>{formatMoney(paidInTotal, data.settings.currency)}</strong> · Withdrawn <strong>{formatMoney(withdrawnTotal, data.settings.currency)}</strong></p>{reconciliation.status === 'reconciled' && <p role="status" data-testid="finance-import-reconciliation">Statement balances reconcile within {formatMoney(reconciliation.tolerance, data.settings.currency)}.</p>}{reconciliation.status === 'discrepancy' && <p role="alert" className="f-alert" data-testid="finance-import-reconciliation">Statement totals differ from the closing balance by {formatMoney(Math.abs(reconciliation.difference), data.settings.currency)}. Missing or incorrectly classified transactions may be responsible.</p>}{reconciliation.status === 'unavailable' && statementExtraction && <p role="status" data-testid="finance-import-reconciliation">Balance reconciliation unavailable; opening or closing balance was not detected.</p>}{unresolvedExtractionPages.length > 0 && <p role="alert" className="f-alert" data-testid="finance-import-extraction-warning">Pages {unresolvedExtractionPages.join(', ')} still have unresolved extraction issues. Review affected transactions before importing.</p>}</div><div className="f-import-selection-actions"><button type="button" className="f-button" onClick={() => setRecords(current => current.map((record, index) => ({ ...record, selected: !record.skipped && !duplicates[index] && !record.linked && record.confidence === 'ready' && (record.direction !== 'income' || record.classification === 'income') })))}>Select all ready</button>{duplicateCount > 0 && <button type="button" className="f-button" onClick={() => setRecords(current => current.map((record, index) => duplicates[index] ? { ...record, selected: false } : record))}>Deselect duplicates</button>}<strong>{selectedCount} selected</strong></div></section><div className="f-import-list">{records.slice(0, visibleRecordCount).map((record, index) => {
        const duplicate = duplicates[index], uncertainDuplicate = Boolean(duplicate && (record.confidence !== 'ready' || !record.description?.trim() || record.purchaseDate && duplicate.date !== record.purchaseDate)), refund = detectPossibleRefund(record, data.transactions), personalMatch = suggestPersonalSettlement(record, data);
        const transfer = accountId ? findPossibleTransfer(record, accountId, data.transactions) : null;
        const existingSide = transfer && accountId ? findMatchingAccountTransaction(record, accountId, data.transactions) : null;
        const cardPayment = accountId && (data.creditCards || []).some(card => card.id === accountId) ? findPossibleCardPayment(record, accountId, data.transactions) : null;
        const statusText = record.skipped || duplicate && record.duplicateChoice === 'skip' ? 'Skipped' : duplicate ? (uncertainDuplicate ? 'Possible duplicate' : 'Already recorded') : record.confidence !== 'ready' ? 'Needs review' : record.direction === 'income' && record.classification !== 'income' ? 'Needs review - choose Income or use a matching action below' : record.linked ? `Linked as ${record.linked}` : 'Ready';
        const dateLabel = record.date ? new Date(`${record.date}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : 'Date missing';
        const categoryLabel = data.categories.find(item => item.id === (record.categoryId || suggestCategory(record.description, record.direction, data.categories, data.transactions)))?.name || 'Uncategorized';
        const linkDraft = creditLinkDrafts[index] || {};
        const creditAgreements = (data.creditAgreements || []).filter(item => getCreditAgreementStatus(data, item) === 'active' && !item.archivedAt);
        const linkedAgreement = creditAgreements.find(item => item.id === linkDraft.agreementId);
        const linkRows = linkedAgreement ? (linkedAgreement.schedule || []).filter(item => !item.supersededAt && getCreditInstalmentAmounts(data, linkedAgreement, item).remaining > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate)) : [];
        const linkedInstalmentId = linkDraft.instalmentId === undefined || linkDraft.instalmentId === 'auto' ? linkRows[0]?.id || '' : linkDraft.instalmentId;        return <article className="f-import-row" key={`${record.sourceRow}-${index}`} data-testid="finance-import-row">
          <div className="f-import-row-summary">
            <label className="f-import-select"><input type="checkbox" aria-label={`Select ${record.description || 'transaction'} for import`} checked={!record.skipped && record.selected !== false && !record.linked && (!duplicate || record.duplicateChoice === 'separate') && record.confidence === 'ready' && (record.direction !== 'income' || record.classification === 'income')} disabled={Boolean(record.skipped || record.linked || duplicate && record.duplicateChoice !== 'separate') || record.confidence !== 'ready' || record.direction === 'income' && record.classification !== 'income'} onChange={event => updateRecord(index, { selected: event.target.checked, ...(duplicate ? { duplicateChoice: event.target.checked ? 'separate' : 'skip' } : {}) })}/></label>
            <div className="f-import-row-copy">
              <div className="f-import-row-labels"><time dateTime={record.date || undefined}>{dateLabel}</time><span>{record.direction === 'income' ? 'Incoming' : 'Expense'} · {categoryLabel}</span></div>
              <strong title={record.description}>{record.description || 'Description missing'}</strong>{record.sourceRow && <small className="f-import-source" data-testid="finance-import-source">Source row {record.sourceRows?.join(', ') || record.sourceRow}</small>}{reasonMessages(record).map((message, at) => <small className="f-import-reason" key={`${message}-${at}`}>{message}</small>)}
            </div>
            <strong className={`f-import-amount ${record.direction === 'income' ? 'is-incoming' : ''}`}>{record.direction === 'income' ? '+' : '-'}{formatMoney(record.amount, data.settings.currency)}</strong>
            <div className="f-import-status">
              <strong className={`f-import-badge ${duplicate ? 'is-duplicate' : record.confidence !== 'ready' || record.direction === 'income' && record.classification !== 'income' ? 'is-review' : ''}`} role={duplicate ? 'status' : undefined}>{statusText}</strong>
              {record.direction === 'income' && !duplicate && !record.linked && <label className="f-import-classification">Classify incoming<select className="f-input" aria-label={`Classification for ${record.description}`} value={record.classification || 'review'} onChange={event => updateRecord(index, { classification: event.target.value })}><option value="review">Choose type</option><option value="income">Income</option></select></label>}
              {duplicate && <div className="f-import-duplicate-actions"><small>Existing: {duplicate.title || 'Transaction'} - {duplicate.date} - {formatMoney(duplicate.amount, data.settings.currency)}</small>{!uncertainDuplicate && <button type="button" className="f-button" onClick={() => setDuplicateDetails(duplicateDetails === index ? null : index)}>{duplicateDetails === index ? 'Hide existing' : 'View existing'}</button>}{uncertainDuplicate && <button type="button" className="f-button" onClick={() => updateRecord(index, { duplicateChoice: 'skip', selected: false })}>Skip</button>}<button type="button" className="f-button" onClick={() => updateRecord(index, { duplicateChoice: 'separate', selected: true })}>Import as separate transaction</button>{duplicateDetails === index && <p>{duplicate.title} - {formatMoney(duplicate.amount, data.settings.currency)} - {duplicate.date}</p>}</div>}{record.reviewReasons?.some(reason => reason.id === 'native-ocr-ambiguous-match') && !record.skipped && <button type="button" className="f-button f-import-review-match" onClick={() => setEditor({ kind: 'match', index, draft: { sourceRow: record.sourceRow, description: record.description || '', amount: record.amount, date: record.date, direction: record.direction } })}>Review match</button>}              {!record.linked && !record.skipped && <button data-import-edit-index={index} type="button" className="f-button f-import-edit-button" onClick={event => { savedListScroll.current = event.currentTarget.closest('.f-import-workspace')?.scrollTop || 0; setEditor({ index, draft: { ...record, categoryId: record.categoryId ?? suggestCategory(record.description, record.direction, data.categories, data.transactions), accountOverride: record.accountOverride || '' } }); }}>Edit</button>}
            </div>
          </div>
          <details className="f-import-more-actions"><summary>More actions</summary>{record.linked ? <small>Linked as {record.linked}</small> : personalMatch && !duplicate ? <><small>Possible {personalMatch.kind} to {personalMatch.personName} · confirm before linking</small><button type="button" className="f-button" disabled={busy} onClick={async()=>{try{await change(state=>{if(findImportDuplicate(record,state.transactions,accountId))throw new Error('This transaction is already in Finance.');linkImportedPersonalSettlementState(state,{record,entryId:personalMatch.entryId,accountId,categoryId:record.categoryId||''});rememberImportAccount(state,record.accountName,accountId);return state},personalMatch.kind==='repayment'?'Imported personal repayment linked':'Imported reimbursement linked');updateRecord(index,{linked:personalMatch.kind,selected:false})}catch(cause){setError(cause.message)}}}>Link as {personalMatch.kind} to {personalMatch.personName}</button></> : null}
              {!record.linked && !personalMatch && refund && !duplicate && <><small>Possible refund for “{refund.title}” · not linked</small><button type="button" className="f-button" disabled={busy} onClick={async()=>{try{await change(state=>{const incoming=buildImportedTransaction(record,state,{accountId,categoryId:record.categoryId ?? suggestCategory(record.description,record.direction,state.categories,state.transactions)});state.transactions.push(incoming);rememberImportAccount(state,record.accountName,accountId);linkExistingIncomeAsRefundState(state,{incomingTransactionId:incoming.id,originalTransactionId:refund.id});return state},'Imported transaction linked as refund');updateRecord(index,{linked:'refund',selected:false})}catch(cause){setError(cause.message)}}}>Link as refund</button></>}
              {record.direction==='income'&&!record.linked&&!duplicate&&<details className="f-import-reclassify"><summary>Reclassify as borrowed money</summary><label>Who lent you this money?<select className="f-input" value={borrowPeople[index]||''} onChange={event=>setBorrowPeople(current=>({...current,[index]:event.target.value}))}><option value="">Enter a new person</option>{(data.financePeople||[]).filter(person=>!person.archived).map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>{!borrowPeople[index]&&<label>Person name<input className="f-input" maxLength={80} value={borrowNames[index]||''} onChange={event=>setBorrowNames(current=>({...current,[index]:event.target.value}))}/></label>}<button type="button" className="f-button" disabled={busy||!borrowPeople[index]&&!String(borrowNames[index]||'').trim()} onClick={async()=>{try{await change(state=>{if(findImportDuplicate(record,state.transactions,accountId))throw new Error('This transaction is already in Finance.');linkImportedBorrowedMoneyState(state,{record,personId:borrowPeople[index]||'',personName:borrowNames[index]||'',accountId});rememberImportAccount(state,record.accountName,accountId);return state},'Imported borrowed money recorded');updateRecord(index,{linked:'borrowed money',selected:false})}catch(cause){setError(cause.message)}}}>Record borrowed money</button></details>}
              {transfer && !duplicate && !record.linked && <><small>Possible transfer with {transfer.title}{existingSide ? ' · matching transaction already exists' : ''}</small><button type="button" className="f-button" disabled={busy} onClick={async()=>{try{await change(state=>{const current=existingSide?state.transactions.find(item=>item.id===existingSide.id):buildImportedTransaction(record,state,{accountId,categoryId:record.categoryId||''});if(!existingSide)state.transactions.push(current);rememberImportAccount(state,record.accountName,accountId);linkExistingTransactionsAsTransferState(state,{firstId:current.id,secondId:transfer.id});return state},'Imported transfer linked');updateRecord(index,{linked:'transfer',selected:false})}catch(cause){setError(cause.message)}}}>Link transfer</button></>}
              {cardPayment && !duplicate && !record.linked && <><small>Possible card payment match · {cardPayment.title}</small><button type="button" className="f-button" disabled={busy} onClick={async()=>{try{await change(state=>{const cardSide=buildImportedTransaction(record,state,{accountId,categoryId:''});state.transactions.push(cardSide);rememberImportAccount(state,record.accountName,accountId);linkCardPaymentState(state,{bankTransactionId:cardPayment.id,cardTransactionId:cardSide.id});return state},'Imported card payment linked');updateRecord(index,{linked:'card payment',selected:false})}catch(cause){setError(cause.message)}}}>Link card payment</button></>}
              {record.direction === 'expense' && !duplicate && !record.linked && creditAgreements.length > 0 && <details className="f-import-reclassify"><summary>Link as Credit Purchase payment</summary><label>Credit Purchase<select className="f-input" value={linkDraft.agreementId || ''} onChange={event => setCreditLinkDrafts(current => ({ ...current, [index]: { agreementId: event.target.value, instalmentId: 'auto' } }))}><option value="">Choose agreement</option>{creditAgreements.map(item => <option key={item.id} value={item.id}>{item.merchant ? item.merchant + ' · ' : ''}{item.title}</option>)}</select></label>{linkedAgreement && <label>Scheduled instalment<select className="f-input" value={linkedInstalmentId} onChange={event => setCreditLinkDrafts(current => ({ ...current, [index]: { ...current[index], instalmentId: event.target.value } }))}><option value="">Extra principal (no scheduled instalment)</option>{linkRows.map(item => <option key={item.id} value={item.id}>{new Date(item.dueDate + 'T12:00:00').toLocaleDateString('en-GB')} · {formatMoney(getCreditInstalmentAmounts(data, linkedAgreement, item).remaining, data.settings.currency)} remaining</option>)}</select></label>}<p className="f-help">This uses the imported payment amount, date, and selected account. The linked instalment and principal/fee split update through the Credit Purchase payment record.</p><button type="button" className="f-button" disabled={busy || !accountId || !linkDraft.agreementId} onClick={() => linkCreditPayment(index, record, linkDraft.agreementId, linkedInstalmentId)}>Record Credit Purchase payment</button></details>}</details>
        </article>;
      })}</div>{records.length > visibleRecordCount && <button type="button" className="f-button" onClick={() => setVisibleRecordCount(count => Math.min(count + 100, records.length))}>Show 100 more ({records.length - visibleRecordCount} remaining)</button>}<div className="f-import-sticky"><button type="button" className="f-primary" disabled={busy || loading || selectedCount === 0} onClick={importRows}>{busy ? 'Importing…' : `Import ${selectedCount} transaction${selectedCount === 1 ? '' : 's'}`}</button><button type="button" className="f-button" onClick={() => { setRecords([]); setRawRows([]); setHeaders([]); setMapping(null); setStatementBalances(null); setStatementExtraction(null); if (input.current) input.current.value = ''; }}>Choose another file</button></div></>}
    </>}
  </div>;
}










