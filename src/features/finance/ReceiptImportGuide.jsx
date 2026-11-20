import { useRef, useState } from 'react';
import { receiptImportPrompt } from './receiptImport.js';

export function ReceiptImportGuide() {
  const promptField = useRef(null);
  const [notice, setNotice] = useState('');
  async function copyAndOpen() {
    const tab = window.open('https://chatgpt.com/', '_blank', 'noopener,noreferrer');
    try {
      await navigator.clipboard.writeText(receiptImportPrompt);
      setNotice(tab ? 'Prompt copied and ChatGPT opened. Attach your receipt image there, send the prompt, then paste the returned JSON below.' : 'Prompt copied. Your browser blocked the new tab; open ChatGPT from the link below.');
    } catch {
      promptField.current?.focus();
      promptField.current?.select();
      setNotice(tab ? 'ChatGPT opened. Automatic copying is unavailable; the prompt is selected below. Copy it, then attach your receipt image in ChatGPT.' : 'Automatic copying and opening a new tab are unavailable. The prompt is selected below; copy it and use the ChatGPT link.');
    }
  }
  return <section className="f-card f-form" aria-labelledby="receipt-import-help">
    <div><h3 id="receipt-import-help">Import one purchase receipt</h3><p className="f-help">Open ChatGPT, attach the receipt image yourself, and paste its JSON response here. CBoard fills the transaction and item rows so you can set each category and review date, time, account, payment method, and other details before saving. Refunds, unpaid invoices, and other documents need manual entry.</p></div>
    <ol className="list-decimal space-y-2 pl-5 text-sm"><li>Copy the prompt and open <a className="font-bold underline" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">ChatGPT</a>.</li><li>Attach the receipt image and send the prompt.</li><li>Paste the one-object JSON response below and choose <strong>Review Transaction</strong>. Receipt items and line amounts fill the existing item editor; assign a category to each item, then review the transaction details.</li><li>Review and correct the existing transaction fields, select a category and account in CBoard, then choose <strong>Save Transaction</strong>.</li></ol>
    <div className="f-actions"><button type="button" className="f-button" onClick={copyAndOpen}>Copy Prompt &amp; Open ChatGPT</button><a className="f-button" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">Open ChatGPT manually</a></div>
    <label>Reusable receipt prompt<textarea ref={promptField} className="f-input min-h-64 font-mono text-sm" readOnly value={receiptImportPrompt}/></label>
    <p className="f-help" role="status">{notice || 'The prompt is copied only when you choose the button. No receipt image or JSON is sent by CBoard.'}</p>
  </section>;
}
