import { createImageOcrSession } from '../../services/ocr/imageOcr.js';
import { MAX_IMPORT_ROWS, parseStatementText, statementOcrInput } from './transactionImport.js';

const OCR_PROFILE = { layout: 'receipt', parse: ({ text }) => ({ text, items: [], total: null }), score: (_, confidence) => ({ score: confidence || 0, complete: false, countMatches: false }) };
const dateSignal = /^(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{2,4})?|[A-Za-z]{3,9}\s+\d{1,2}(?:,?\s+\d{2,4})?)(?:\s|$)/i;
const moneySignal = /(?:[$\u00A3\u20AC\u00A5]\s*[-+]?\s*\d[\d,.]*|[-+]\s*\d[\d,.]*|\b\d+[.,]\d{2}\b)/;
const cloneContext = context => ({ ...context, pendingDescription: [...(context.pendingDescription || [])] });
const cleanText = value => String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ').replace(/\s+/g, ' ').trim();

function buildPageLines(content) {
  const linesByY = new Map();
  for (const item of content.items || []) {
    if (!item.str?.trim()) continue;
    const y = Math.round((item.transform?.[5] || 0) / 2) * 2;
    const line = linesByY.get(y) || [];
    line.push({ x: item.transform?.[4] || 0, text: item.str.trim() });
    linesByY.set(y, line);
  }
  return [...linesByY.entries()].sort((a, b) => b[0] - a[0]).map(([, rawItems], index) => {
    const items = rawItems.sort((a, b) => a.x - b.x);
    return { text: items.map(item => item.text).join(' '), items, sourceRow: index + 1 };
  });
}

export function assessPdfPageQuality(lines, records, context = {}, parserDiagnostics = {}) {
  const text = lines.map(line => line.text).join('\n');
  const normalized = cleanText(text);
  const replacementCount = (text.match(/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
  const textQuality = normalized.length > 0 && replacementCount / Math.max(1, text.length) <= 0.01;
  const dateRows = lines.filter(line => dateSignal.test(String(line.text || '').trim())).length;
  const monetaryRows = lines.filter(line => moneySignal.test(String(line.text || ''))).length;
  const pendingDescription = (context.pendingDescription || []).filter(Boolean).join(' ').trim();
  const reasons = [];
  if (!textQuality) reasons.push(lines.length ? 'garbled-native-text' : 'empty-native-page');
  if (!records.length && normalized.length < 24 && textQuality) reasons.push('too-little-native-text');
  if (records.some(record => !record.description || record.description.trim().length < 3)) reasons.push('description-too-short');
  if ((parserDiagnostics.unparsedCandidateRows || 0) > 0) reasons.push('unparsed-transaction-candidate');
  if ((parserDiagnostics.ambiguousAmountRows || 0) > 0) reasons.push('ambiguous-monetary-values');
  if ((parserDiagnostics.missingAmountCandidates || 0) > 0) reasons.push('date-without-amount');
  if (pendingDescription) reasons.push('description-incomplete-at-page-end');
  if ((dateRows || monetaryRows) && !records.length) reasons.push('transaction-signals-with-no-valid-rows');
  if (monetaryRows > records.length * 2 + 1 && !/\b(?:balance|paid\s*in|withdrawn)\b/i.test(text)) reasons.push('more-amount-candidates-than-transactions');
  return {
    page: null,
    status: reasons.length ? 'needs-review' : 'reliable',
    reasons: [...new Set(reasons)],
    readableCharacters: normalized.length,
    dateRows,
    monetaryRows,
    nativeTransactions: records.length,
    pendingDescription,
  };
}

const normalizeDate = value => String(value || '').trim().replace(/[./]/g, '-');
const normalizeAmount = value => Number.isSafeInteger(value) ? Math.abs(value) : null;
const normalizeText = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function recordReference(record) {
  const explicit = String(record.reference || '').replace(/[^a-z0-9]/gi, '').toLocaleLowerCase();
  if (explicit) return explicit;
  const matches = String(record.description || '').match(/\b(?:\d{8,}|[A-Z]{2,}\d{6,})\b/gi) || [];
  return matches.map(value => value.toLocaleLowerCase()).join('|');
}
function descriptionSimilarity(left, right) {
  const a = normalizeText(left), b = normalizeText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const wordsA = new Set(a.split(' ').filter(word => word.length > 1));
  const wordsB = new Set(b.split(' ').filter(word => word.length > 1));
  if (!wordsA.size || !wordsB.size) return 0;
  const overlap = [...wordsA].filter(word => wordsB.has(word)).length;
  return overlap / Math.max(wordsA.size, wordsB.size);
}
const sameTuple = (left, right) => normalizeDate(left.date) === normalizeDate(right.date) && normalizeAmount(left.amount) === normalizeAmount(right.amount) && left.direction === right.direction;
const sameReference = (left, right) => Boolean(recordReference(left) && recordReference(left) === recordReference(right));
const descriptionRelated = (left, right) => descriptionSimilarity(left.description, right.description) >= 0.55;

function reviewRecord(record, reason) {
  return { ...record, confidence: 'review', validation: [record.validation, reason].filter(Boolean).join(' ') };
}

export function mergePdfExtractionRecords(nativeRecords, ocrRecords) {
  const native = nativeRecords.map(record => ({ ...record }));
  const ocr = ocrRecords.map(record => ({ ...record }));
  const usedNative = new Set(), usedOcr = new Set(), merged = [];
  const matches = [];
  for (let ni = 0; ni < native.length; ni++) {
    for (let oi = 0; oi < ocr.length; oi++) {
      const ref = sameReference(native[ni], ocr[oi]);
      const related = descriptionRelated(native[ni], ocr[oi]);
      if (ref || related) matches.push({ ni, oi, ref, related, tuple: sameTuple(native[ni], ocr[oi]) });
    }
  }
  const nativeDegree = new Map(), ocrDegree = new Map();
  const ambiguousNative = new Set(), ambiguousOcr = new Set();
  for (const pair of matches) {
    nativeDegree.set(pair.ni, (nativeDegree.get(pair.ni) || 0) + 1);
    ocrDegree.set(pair.oi, (ocrDegree.get(pair.oi) || 0) + 1);
  }
  for (const pair of matches) {
    if (nativeDegree.get(pair.ni) !== 1 || ocrDegree.get(pair.oi) !== 1) { ambiguousNative.add(pair.ni); ambiguousOcr.add(pair.oi); continue; }
    if (usedNative.has(pair.ni) || usedOcr.has(pair.oi)) continue;
    const a = native[pair.ni], b = ocr[pair.oi];
    usedNative.add(pair.ni); usedOcr.add(pair.oi);
    const descriptionsAgree = descriptionSimilarity(a.description, b.description) >= 0.55 || !a.description || !b.description;
    const tupleAgrees = pair.tuple;
    const description = String(a.description || '').length >= String(b.description || '').length ? a.description : b.description;
    const sourceRows = [...new Set([...(a.sourceRows || [a.sourceRow].filter(Boolean)), ...(b.sourceRows || [b.sourceRow].filter(Boolean))])];
    const refA = recordReference(a), refB = recordReference(b);
    const referenceConflict = Boolean(refA && refB && refA !== refB);
    const conflict = !tupleAgrees || !descriptionsAgree || referenceConflict;
    merged.push({
      ...a,
      description,
      reference: a.reference || b.reference || '',
      sourceType: 'pdf-merged',
      sourceRows,
      confidence: conflict || a.confidence === 'review' || b.confidence === 'review' ? 'review' : 'ready',
      validation: conflict ? [a.validation, b.validation, 'Native PDF text and OCR disagree; verify this transaction before importing.'].filter(Boolean).join(' ') : [a.validation, b.validation].filter(Boolean).join(' '),
    });
  }
  for (const [index, record] of native.entries()) if (!usedNative.has(index)) merged.push({ ...(ambiguousNative.has(index) ? reviewRecord(record, 'Native/OCR matches are ambiguous; confirm the transaction before importing.') : record), sourceRows: record.sourceRows || [record.sourceRow].filter(Boolean) });
  for (const [index, record] of ocr.entries()) if (!usedOcr.has(index)) merged.push({ ...(ambiguousOcr.has(index) ? reviewRecord(record, 'Native/OCR matches are ambiguous; confirm the transaction before importing.') : record), sourceRows: record.sourceRows || [record.sourceRow].filter(Boolean) });

  // Same date, amount and direction without a reliable narrative/reference match is
  // ambiguous. Keep both candidates visible, but prevent either from auto-importing.
  for (let i = 0; i < merged.length; i++) for (let j = i + 1; j < merged.length; j++) {
    const a = merged[i], b = merged[j];
    if (a.sourceType === 'pdf-merged' || b.sourceType === 'pdf-merged' || !sameTuple(a, b)) continue;
    if (a.sourceType === b.sourceType && a.sourceType !== 'pdf-scan' && a.sourceType !== 'pdf') continue;
    if (sameReference(a, b) || descriptionRelated(a, b)) continue;
    merged[i] = reviewRecord(a, 'A matching native/OCR candidate is ambiguous; confirm whether these are separate transactions.');
    merged[j] = reviewRecord(b, 'A matching native/OCR candidate is ambiguous; confirm whether these are separate transactions.');
  }
  return merged;
}

export function reconcileStatementBalances(records, balances, tolerance = 1) {
  const opening = balances?.opening, closing = balances?.closing;
  if (!Number.isSafeInteger(opening) || !Number.isSafeInteger(closing)) return { status: 'unavailable', opening: null, closing: null, paidIn: 0, withdrawn: 0, difference: null, tolerance };
  const paidIn = records.filter(record => record.direction === 'income').reduce((sum, record) => sum + normalizeAmount(record.amount), 0);
  const withdrawn = records.filter(record => record.direction === 'expense').reduce((sum, record) => sum + normalizeAmount(record.amount), 0);
  const difference = opening + paidIn - withdrawn - closing;
  return { status: Math.abs(difference) <= tolerance ? 'reconciled' : 'discrepancy', opening, closing, paidIn, withdrawn, difference, tolerance };
}

function pageToFile(page, pageNumber) {
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 2400 / baseViewport.width, Math.sqrt(20000000 / (baseViewport.width * baseViewport.height)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d');
  return page.render({ canvasContext: context, viewport }).promise
    .then(() => new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not prepare a scanned PDF page.')), 'image/png')))
    .then(blob => new File([blob], `statement-page-${pageNumber}.png`, { type: 'image/png' }))
    .finally(() => { canvas.width = 0; canvas.height = 0; });
}

export async function extractPdfStatement(file, onProgress = () => {}, dependencies = {}) {
  const pdfjs = dependencies.pdfjs || await import('pdfjs-dist');
  if (!dependencies.pdfjs) {
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  const pdfDocument = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  if (pdfDocument.numPages > 80) { await pdfDocument.destroy(); throw new Error('This PDF has more than 80 pages. Split the statement and import it in parts.'); }
  const records = [], pageDiagnostics = [], context = {};
  let session = null;
  const makeSession = dependencies.createOcrSession || ((profile, progress) => createImageOcrSession(profile, progress));
  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber++) {
      onProgress(`Reading PDF page ${pageNumber} of ${pdfDocument.numPages}...`);
      const page = await pdfDocument.getPage(pageNumber);
      let nativeLines = [], nativeRecords = [], nativeContext = cloneContext(context), nativeDiagnostics = {}, content = null;
      try { content = await page.getTextContent(); } catch (error) { nativeDiagnostics.extractionError = String(error?.message || 'PDF text extraction failed.'); }
      if (content) {
        nativeLines = buildPageLines(content);
        nativeRecords = parseStatementText(nativeLines, { sourceType: 'pdf', context: nativeContext, sourceRowPrefix: String(pageNumber), diagnostics: nativeDiagnostics });
      }
      const quality = assessPdfPageQuality(nativeLines, nativeRecords, nativeContext, nativeDiagnostics);
      quality.page = pageNumber;
      const needsOcr = quality.status === 'needs-review';
      let ocrRecords = [], ocrContext = cloneContext(context), ocrConfidence = null, ocrError = '';
      if (needsOcr) {
        try {
          if (!session) session = makeSession(OCR_PROFILE, event => onProgress(event.status || 'Reading scanned page locally...'));
          const imageFile = dependencies.renderPage ? await dependencies.renderPage(page, pageNumber) : await pageToFile(page, pageNumber);
          const result = await session.scan(imageFile, 0);
          ocrConfidence = Number.isFinite(result.confidence) ? result.confidence : null;
          ocrRecords = parseStatementText(statementOcrInput(result), { sourceType: 'pdf-scan', context: ocrContext, sourceRowPrefix: String(pageNumber), diagnostics: {} });
          if (ocrConfidence !== null && ocrConfidence < (dependencies.minimumOcrConfidence ?? 55)) {
            ocrRecords = ocrRecords.map(record => reviewRecord(record, 'OCR confidence is low; verify the recognized text and amount.'));
          }
          if (!ocrRecords.length) ocrError = 'OCR did not recover a transaction from this page.';
        } catch (error) { ocrError = String(error?.message || 'OCR failed for this page.'); }
      }
      const pageRecords = needsOcr ? mergePdfExtractionRecords(nativeRecords, ocrRecords) : nativeRecords;
      const useOcrContext = needsOcr && (ocrRecords.length > nativeRecords.length || (!nativeRecords.length && ocrContext.pendingDescription?.length));
      Object.assign(context, cloneContext(useOcrContext ? ocrContext : nativeContext));
      pageDiagnostics.push({ ...quality, ocrAttempted: needsOcr, ocrTransactions: ocrRecords.length, ocrConfidence, ocrError, selectedSource: useOcrContext ? 'ocr' : 'native' });
      if (records.length + pageRecords.length > MAX_IMPORT_ROWS) throw new Error(`Statements can contain at most ${MAX_IMPORT_ROWS.toLocaleString()} transaction rows. Split the statement and import them in parts.`);
      records.push(...pageRecords);
      page.cleanup();
    }
  } finally { session?.dispose(); await pdfDocument.destroy(); }
  const balances = { opening: context.openingBalance, closing: context.closingBalance };
  const reconciliation = reconcileStatementBalances(records, balances, dependencies.reconciliationTolerance ?? 1);
  const pagesRequiringOcr = pageDiagnostics.filter(page => page.ocrAttempted).map(page => page.page);
  const unresolvedPages = pageDiagnostics.filter(page => page.status === 'needs-review' && page.ocrError).map(page => page.page);
  return { records, balances, reconciliation, diagnostics: { pages: pageDiagnostics, pagesRequiringOcr, unresolvedPages, nativeTransactions: records.filter(record => record.sourceType === 'pdf').length, ocrTransactions: records.filter(record => record.sourceType === 'pdf-scan').length, mergedTransactions: records.filter(record => record.sourceType === 'pdf-merged').length } };
}
