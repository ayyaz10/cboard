import { useEffect, useRef, useState } from 'react';
import { createCloudReceiptOcrSession, createReceiptOcrSession, validateReceiptImage } from './receiptOcr.js';
import { parseReceipt, receiptWarnings } from './receiptParser.js';
import { optionalReceiptMoney } from './receiptData.js';
import { formatMoney } from './financeMath.js';

const readMoney = value => { try { return optionalReceiptMoney(value); } catch { return null; } };

export function ReceiptEditor({ receipt, onChange, onExtract, total, currency, onBusy, manualEntryRef }) {
  const [file, setFile] = useState(null), [image, setImage] = useState(''), [rotation, setRotation] = useState(0);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(''), [error, setError] = useState(''), [raw, setRaw] = useState('');
  const [debugData, setDebugData] = useState(null);
  const debugEnabled = import.meta.env.DEV && new URLSearchParams(window.location.search).get('receiptDebug') === '1';
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
    try { validateReceiptImage(selected); setFile(selected); setRotation(0); setError(''); setProgress(''); void scan(selected,'cloud'); }
    catch (err) { setError(err.message); }
  }
  async function scan(selectedFile=file,preferredMode='cloud') {
    if (!selectedFile || locked.current) return;
    locked.current = true;
    const current = ++job.current;
    setBusy(true); onBusy(true); setError(''); setProgress('Preparing receipt image...');
    const progressHandler=message=>setProgress(message.status === 'recognizing text' ? `Scanning receipt with local OCR... pass ${message.pass || 1}, ${Math.round(message.progress * 100)}%` : `${message.status || 'Preparing local receipt scanner'}...`);
    const getSession=mode=>{
      if(!session.current||session.current.mode!==mode){
        session.current?.dispose();
        session.current=mode==='cloud'?createCloudReceiptOcrSession(message=>setProgress(`${message.status||'Scanning receipt'}...`)):createReceiptOcrSession(progressHandler);
      }
      return session.current;
    };
    const run=mode=>getSession(mode).scan(selectedFile,rotation,{debug:debugEnabled});
    const timeout = setTimeout(() => {
      if (current !== job.current) return;
      cancel(); setError('Scanning took too long. Try a smaller, clearer image and check your connection for the initial scanner download.');
    }, 120000);
    let cloudError='';
    try {
      let result,usedMode=preferredMode;
      try{
        result=await run(preferredMode);
        if(preferredMode==='cloud'&&!result.parsed.items.length&&result.parsed.total==null)throw new Error('OCR.Space could not find receipt items or a total.');
      }catch(error){
        if(preferredMode!=='cloud'||current!==job.current||/cancelled/i.test(error.message||''))throw error;
        cloudError=error.message||'OCR.Space could not complete this scan.';
        setProgress('OCR.Space could not complete this scan. Trying your existing local OCR...');
        usedMode='local';
        result=await run('local');
      }
      if (current !== job.current) return;
      setRaw(result.rawText||result.lines?.map(line=>line.text).join('\n') || result.text || ''); setDebugData(result.debug || null);
      onExtract(result.parsed || parseReceipt(result));
      if(cloudError)setProgress(`Local OCR completed. Review the transaction; OCR.Space issue: ${cloudError}`);
      else setProgress(`${usedMode==='cloud'?'OCR.Space':'Local OCR'} scan complete. Review and correct the transaction before saving.`);
      if (!result.text?.trim()&&!result.rawText?.trim()) setError('No text detected. Try a brighter, sharper photo, rotate the image, or enter the items manually.');
    } catch (error) {
      if (current === job.current) { setError(error.message||'Could not scan this image. Try a clear JPEG, PNG or WEBP, check your connection, or enter items manually.'); session.current?.dispose(); session.current = null; }
    } finally {
      clearTimeout(timeout);
      if (current === job.current) { locked.current = false; setBusy(false); onBusy(false); }
    }
  }
  const structured = receipt && { ...receipt, items: receipt.items.map(item => ({ ...item, quantity: item.quantity === '' ? null : Number(item.quantity), unitPrice: readMoney(item.unitPrice), lineTotal: readMoney(item.lineTotal) })) };
  const warnings = structured ? receiptWarnings(structured, readMoney(total)) : [];
  const editItem = (id, patch) => onChange({ ...receipt, items: receipt.items.map(item => item.id === id ? { ...item, ...patch, confidence:{...item.confidence,...Object.fromEntries(Object.keys(patch).map(key=>[key,100]))} } : item) });
  return <section className="f-receipt" aria-label="Receipt scanning and items">
    <div className="f-between"><div><h3 className="font-bold">Start with a receipt</h3><p className="f-help">OCR.Space scans first. If it cannot read enough, CBoard tries the existing local OCR. You can also compare both scans or enter the transaction manually below.</p></div><button type="button" className="f-button" onClick={()=>{manualEntryRef?.current?.scrollIntoView({behavior:'smooth',block:'center'});manualEntryRef?.current?.focus();}}>Enter manually</button></div>
    <div className="f-form mt-3">
      <p className="f-help">Choose a photo or open the camera. OCR.Space processes the image online. CBoard does not save or attach the photo. Choose the 'Try existing local OCR' button to scan on this device.</p>
      <div className="f-actions f-receipt-choices">
        <label className="f-primary f-receipt-pick">Take receipt photo<input aria-label="Take receipt photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={choose}/></label>
        <label className="f-button f-receipt-pick">Choose receipt photo<input aria-label="Choose receipt photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={choose}/></label>
      </div>
      {image && <details><summary>View original receipt</summary><img className="f-receipt-image" src={image} alt="Original receipt for comparison"/></details>}
      {file && <div className="f-actions"><label>Scan rotation<select value={rotation} disabled={busy} onChange={event => setRotation(Number(event.target.value))}>{[0, 90, 180, 270].map(value => <option key={value} value={value}>{value}&deg;</option>)}</select></label><button type="button" className="f-button" disabled={busy} onClick={() => scan(file,'cloud')}>{receipt ? 'Rescan with OCR.Space' : 'Scan with OCR.Space'}</button><button type="button" className="f-button" disabled={busy} onClick={() => scan(file,'local')}>Try existing local OCR</button></div>}
      {progress && <p role="status">{progress}</p>}
      {busy && <button type="button" className="f-button" onClick={cancel}>Cancel scan</button>}
      {error && <p role="alert" className="f-alert">{error}</p>}
      {raw && <details><summary>Extracted text (temporary)</summary><pre className="f-receipt-raw">{raw}</pre></details>}
      {debugEnabled && debugData && <details><summary>Developer OCR comparison (temporary)</summary><p>Selected: {debugData.selected}. Crop: {debugData.region?'detected':'original fallback'}; deskew: {debugData.angle || 0}°; local row alignment: {debugData.rowDeskew?.length || 0} rows.</p>{debugData.cropped&&<img className="f-receipt-image" src={debugData.cropped} alt="Cropped receipt before thermal processing"/>}{debugData.candidates.map(candidate=><details key={candidate.name}><summary>{candidate.name} · PSM {candidate.psm} · score {candidate.score.toFixed(1)} · {candidate.elapsedMs} ms</summary><img className="f-receipt-image" src={candidate.image} alt={`${candidate.name} processed OCR image`}/><pre className="f-receipt-raw">{JSON.stringify({text:candidate.text,lines:candidate.lines,parsed:candidate.parsed},null,2)}</pre></details>)}</details>}
      {!receipt && <button type="button" className="f-button" disabled={busy} onClick={() => onExtract({ merchantName:'', date:'', time:'', currency:'', subtotal:null, tax:null, discounts:null, total:null, items:[] }, false)}>Enter receipt items manually</button>}
      {receipt && <>
        <p className="f-help">Merchant, date and total use the transaction fields above. Attaching to an existing transaction keeps those values; compare them with the extracted text. Scanning again replaces the draft items.</p>
        <div className="f-row"><label>Receipt time<input type="time" value={receipt.time || ''} onChange={e => onChange({ ...receipt, time:e.target.value })}/></label><label>Receipt currency<input maxLength={3} value={receipt.currency || currency} onChange={e => onChange({ ...receipt, currency:e.target.value.toUpperCase() })}/></label></div>
        {receipt.currency && receipt.currency !== currency && <p className="f-alert">Receipt currency differs from Finance ({currency}). Convert the amounts yourself and set the receipt currency to {currency} before saving. No automatic conversion is applied.</p>}
        <div className="f-row">{[['subtotal','Subtotal'],['tax','Tax / VAT'],['discounts','Discounts']].map(([key,label]) => <label key={key}>{label}<input inputMode="decimal" value={receipt[key] ?? ''} onChange={e => onChange({ ...receipt, [key]:e.target.value })}/></label>)}</div>
        <h3 className="font-bold">Receipt items ({receipt.items.length})</h3>
        {receipt.confidence && Object.values(receipt.confidence).some(value=>value<70) && <p className="f-help">Check receipt fields: {Object.entries(receipt.confidence).filter(([,value])=>value<70).map(([key])=>key).join(', ')}. Other detected fields have stronger evidence.</p>}
        {receipt.items.map((item, index) => <fieldset className="f-item f-form" key={item.id}><legend>Item {index + 1}</legend>
          {item.retailerProductCode && <p className="f-help">Product code: {item.retailerProductCode}</p>}
          {item.confidence && Object.values(item.confidence).some(value=>value<70) && <p className="f-receipt-check">Check: {Object.entries(item.confidence).filter(([,value])=>value<70).map(([key])=>({name:'item name',quantity:'quantity',unitPrice:'unit price',lineTotal:'line total'}[key]||key)).join(', ')}.</p>}
          <label>Item name<input maxLength={200} value={item.name} onChange={e => editItem(item.id, { name:e.target.value })}/></label>
          <div className="f-row"><label>Quantity<input inputMode="decimal" placeholder="Unknown" value={item.quantity} onChange={e => editItem(item.id, { quantity:e.target.value })}/></label><label>Unit<input maxLength={30} placeholder="each, kg, g, L, ml" value={item.unit} onChange={e => editItem(item.id, { unit:e.target.value })}/></label><label>Unit price<input inputMode="decimal" value={item.unitPrice} onChange={e => editItem(item.id, { unitPrice:e.target.value })}/></label><label>Line total<input inputMode="decimal" value={item.lineTotal} onChange={e => editItem(item.id, { lineTotal:e.target.value })}/></label></div>
          {item.rawText && <p className="f-help f-receipt-raw">Read as: {item.rawText}</p>}
          <button type="button" className="f-button danger-action" onClick={() => onChange({ ...receipt, items:receipt.items.filter(other => other.id !== item.id) })}>Remove item {index + 1}</button>
        </fieldset>)}
        <button type="button" className="f-button" onClick={() => onChange({ ...receipt, items:[...receipt.items, { id:crypto.randomUUID(), name:'', rawText:'', quantity:'', unit:'', unitPrice:'', lineTotal:'' }] })}>Add receipt item</button>
        <p className="font-bold">Item sum: {formatMoney(structured.items.reduce((sum, item) => sum + (item.lineTotal || 0), 0), currency)}</p>
        {!!warnings.length && <div className="f-alert" role="status"><p>Check before saving ({currency})</p><ul>{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
      </>}
    </div>
  </section>;
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
