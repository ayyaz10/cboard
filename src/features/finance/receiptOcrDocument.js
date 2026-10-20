import {reconstructReceiptLines} from './receiptLayout.js';
import {parseReceipt} from './receiptParser.js';

/** Adapt the provider-neutral OCR.Space document for the existing receipt parser. */
export function ocrSpaceDocumentToReceiptInput(document){
  const pages=Array.isArray(document?.pages)?document.pages:[];
  const rawText=pages.map(page=>String(page?.rawText||'')).filter(Boolean).join('\n');
  const blocks=pages.map(page=>({paragraphs:[{lines:(Array.isArray(page?.lines)?page.lines:[]).map(line=>({words:(Array.isArray(line?.words)?line.words:[]).map(word=>({text:String(word?.text||''),confidence:word?.confidence??null,bbox:word?.bbox||null}))}))}]}));
  const lines=reconstructReceiptLines({text:rawText,blocks});
  const text=lines.length?lines.map(line=>line.text).join('\n'):rawText;
  return {text,rawText,lines,document};
}

export function parseOcrSpaceReceipt(document){
  const input=ocrSpaceDocumentToReceiptInput(document);
  return {...input,parsed:parseReceipt({text:input.text,lines:input.lines})};
}
