import { useEffect, useRef, useState } from 'react';
import { createReceiptOcrSession, validateReceiptImage } from './receiptOcr.js';
import { parseReceipt, receiptWarnings } from './receiptParser.js';
import { optionalReceiptMoney } from './receiptData.js';
import { formatMoney } from './financeMath.js';

const readMoney = value => { try { return optionalReceiptMoney(value); } catch { return null; } };

export function ReceiptEditor({ receipt, onChange, onExtract, total, currency, initialOpen, onBusy }) {
  const [file, setFile] = useState(null), [image, setImage] = useState(''), [rotation, setRotation] = useState(0);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(''), [error, setError] = useState(''), [raw, setRaw] = useState('');
  const [confidence, setConfidence] = useState(null);
  const session = useRef(null), job = useRef(0), locked = useRef(false);
  useEffect(() => () => { job.current++; session.current?.dispose(); }, []);
  useEffect(() => {
    if (!file) { setImage(''); return; }
    const url = URL.createObjectURL(file); setImage(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function cancel() { job.current++; session.current?.dispose(); session.current = null; locked.current = false; setBusy(false); onBusy(false); setProgress('Scan cancelled. Nothing was saved.'); }
  function choose(event) {
    const selected = event.target.files?.[0]; event.target.value = '';
    if (!selected) return;
    try { validateReceiptImage(selected); setFile(selected); setRotation(0); setError(''); setProgress(''); }
    catch (err) { setError(err.message); }
  }
  async function scan() {
    if (!file || locked.current) return;
    locked.current = true;
    const current = ++job.current;
    setBusy(true); onBusy(true); setError(''); setProgress('Preparing receipt…');
    if (!session.current) session.current = createReceiptOcrSession(message => {
      setProgress(message.status === 'recognizing text' ? `Scanning receipt… ${Math.round(message.progress * 100)}%` : 'Loading receipt scanner…');
    });
    const timeout = setTimeout(() => {
      if (current !== job.current) return;
      cancel(); setError('Scanning took too long. Try a smaller, clearer image and check your connection for the initial scanner download.');
    }, 120000);
    try {
      const result = await session.current.scan(file, rotation);
      if (current !== job.current) return;
      setRaw(result.text || ''); setConfidence(result.confidence);
      const parsed = parseReceipt(result.text);
      onExtract(parsed);
      setProgress('Scan complete. Review and correct the transaction before saving.');
      if (!result.text?.trim()) setError('No text detected. Try a brighter, sharper photo, rotate the image, or enter the items manually.');
    } catch {
      if (current === job.current) { setError('Could not scan this image. Try a clear JPEG, PNG or WEBP, check your connection, or enter items manually.'); session.current?.dispose(); session.current = null; }
    } finally {
      clearTimeout(timeout);
      if (current === job.current) { locked.current = false; setBusy(false); onBusy(false); }
    }
  }
  const structured = receipt && { ...receipt, items: receipt.items.map(item => ({ ...item, quantity: item.quantity === '' ? null : Number(item.quantity), unitPrice: readMoney(item.unitPrice), lineTotal: readMoney(item.lineTotal) })) };
  const warnings = structured ? receiptWarnings(structured, readMoney(total)) : [];
  const editItem = (id, patch) => onChange({ ...receipt, items: receipt.items.map(item => item.id === id ? { ...item, ...patch } : item) });
  return <details className="f-receipt" open={initialOpen || receipt ? true : undefined}>
    <summary className="font-bold cursor-pointer">Receipt scan &amp; items</summary>
    <div className="f-form mt-3">
      <p className="f-help">Scan on this device. JPEG, PNG or WEBP, up to 15 MB. The original image and full OCR text are available here only and are discarded when you close this form. First use downloads the scanner.</p>
      <div className="f-row">
        <label>Upload receipt<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={choose}/></label>
        <label>Take receipt photo<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={choose}/></label>
      </div>
      {image && <details><summary>View original receipt</summary><img className="f-receipt-image" src={image} alt="Original receipt for comparison"/></details>}
      {file && <div className="f-actions"><label>Scan rotation<select value={rotation} disabled={busy} onChange={event => setRotation(Number(event.target.value))}>{[0, 90, 180, 270].map(value => <option key={value} value={value}>{value}°</option>)}</select></label><button type="button" className="f-button" disabled={busy} onClick={scan}>{receipt ? 'Rescan and replace items' : 'Scan receipt'}</button></div>}
      {progress && <p role="status">{progress}</p>}
      {busy && <button type="button" className="f-button" onClick={cancel}>Cancel scan</button>}
      {error && <p role="alert" className="f-alert">{error}</p>}
      {confidence != null && confidence < 70 && <p className="f-alert">The image was difficult to read. Check every field against the receipt.</p>}
      {raw && <details><summary>Extracted text (temporary)</summary><pre className="f-receipt-raw">{raw}</pre></details>}
      {!receipt && <button type="button" className="f-button" disabled={busy} onClick={() => onExtract({ merchantName:'', date:'', time:'', currency:'', subtotal:null, tax:null, discounts:null, total:null, items:[] }, false)}>Enter receipt items manually</button>}
      {receipt && <>
        <p className="f-help">Merchant, date and total use the transaction fields above. Attaching to an existing transaction keeps those values; compare them with the extracted text. Scanning again replaces the draft items.</p>
        <div className="f-row"><label>Receipt time<input type="time" value={receipt.time || ''} onChange={e => onChange({ ...receipt, time:e.target.value })}/></label><label>Receipt currency<input maxLength={3} value={receipt.currency || currency} onChange={e => onChange({ ...receipt, currency:e.target.value.toUpperCase() })}/></label></div>
        {receipt.currency && receipt.currency !== currency && <p className="f-alert">Receipt currency differs from Finance ({currency}). Convert the amounts yourself and set the receipt currency to {currency} before saving. No automatic conversion is applied.</p>}
        <div className="f-row">{[['subtotal','Subtotal'],['tax','Tax / VAT'],['discounts','Discounts']].map(([key,label]) => <label key={key}>{label}<input inputMode="decimal" value={receipt[key] ?? ''} onChange={e => onChange({ ...receipt, [key]:e.target.value })}/></label>)}</div>
        <h3 className="font-bold">Receipt items ({receipt.items.length})</h3>
        {receipt.items.map((item, index) => <fieldset className="f-item f-form" key={item.id}><legend>Item {index + 1}</legend>
          <label>Item name<input maxLength={200} value={item.name} onChange={e => editItem(item.id, { name:e.target.value })}/></label>
          <div className="f-row"><label>Quantity<input inputMode="decimal" placeholder="Unknown" value={item.quantity} onChange={e => editItem(item.id, { quantity:e.target.value })}/></label><label>Unit<input maxLength={30} placeholder="each, kg, g, L, ml" value={item.unit} onChange={e => editItem(item.id, { unit:e.target.value })}/></label><label>Unit price<input inputMode="decimal" value={item.unitPrice} onChange={e => editItem(item.id, { unitPrice:e.target.value })}/></label><label>Line total<input inputMode="decimal" value={item.lineTotal} onChange={e => editItem(item.id, { lineTotal:e.target.value })}/></label></div>
          {item.rawText && <p className="f-help f-receipt-raw">Read as: {item.rawText}</p>}
          <button type="button" className="f-button" onClick={() => onChange({ ...receipt, items:receipt.items.filter(other => other.id !== item.id) })}>Remove item {index + 1}</button>
        </fieldset>)}
        <button type="button" className="f-button" onClick={() => onChange({ ...receipt, items:[...receipt.items, { id:crypto.randomUUID(), name:'', rawText:'', quantity:'', unit:'', unitPrice:'', lineTotal:'' }] })}>Add receipt item</button>
        <p className="font-bold">Item sum: {formatMoney(structured.items.reduce((sum, item) => sum + (item.lineTotal || 0), 0), currency)}</p>
        {!!warnings.length && <div className="f-alert" role="status"><p>Check before saving ({currency})</p><ul>{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
      </>}
    </div>
  </details>;
}

export function ReceiptItems({ receipt, currency }) {
  if (!receipt) return null;
  const money = value => value == null ? 'Unknown' : formatMoney(value, receipt.currency || currency);
  return <details className="f-receipt-saved"><summary>Items ({receipt.items?.length || 0})</summary>
    {receipt.time && <p className="f-meta">Receipt time: {receipt.time}</p>}
    <ul>{receipt.items?.map(item => <li key={item.id}><strong>{item.name}</strong><br/>{item.quantity ?? '?'} {item.unit || ''} × {money(item.unitPrice)} = {money(item.lineTotal)}</li>)}</ul>
    {receipt.subtotal != null && <p>Subtotal: {money(receipt.subtotal)}</p>}
    {receipt.tax != null && <p>Tax / VAT: {money(receipt.tax)}</p>}
    {receipt.discounts != null && <p>Discounts: {money(receipt.discounts)}</p>}
  </details>;
}
