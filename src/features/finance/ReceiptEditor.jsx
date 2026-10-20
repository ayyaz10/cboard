import { useEffect, useRef, useState } from 'react';
import { createCloudReceiptOcrSession, createReceiptOcrSession, validateReceiptImage } from './receiptOcr.js';
import { parseReceipt, receiptWarnings, reconcileReceipt } from './receiptParser.js';
import { optionalReceiptMoney } from './receiptData.js';
import { formatMoney } from './financeMath.js';
import { getFoodCatalog } from '../../services/foodCatalogService.js';
import { normalizeFoodText } from '../nutrition/foodIdentity.js';

const readMoney = value => { try { return optionalReceiptMoney(value); } catch { return null; } };

export function ReceiptEditor({ receipt, onChange, onExtract, total, currency, onBusy, manualEntryRef }) {
  const [file, setFile] = useState(null), [image, setImage] = useState(''), [rotation, setRotation] = useState(0);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(''), [error, setError] = useState(''), [raw, setRaw] = useState('');
  const [debugData, setDebugData] = useState(null), [foods, setFoods] = useState([]), [foodLoadError, setFoodLoadError] = useState(''), [copyStatus, setCopyStatus] = useState('');
  const debugEnabled = import.meta.env.DEV && new URLSearchParams(window.location.search).get('receiptDebug') === '1';
  const session = useRef(null), job = useRef(0), locked = useRef(false);
  useEffect(() => () => { job.current++; session.current?.dispose(); }, []);
  useEffect(() => {
    if (!file) { setImage(''); return; }
    const url = URL.createObjectURL(file); setImage(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (!receipt) { setFoods([]); return; }
    let active = true;
    getFoodCatalog().then(items => { if (active) { setFoods(items); setFoodLoadError(''); } })
      .catch(loadError => { if (active) setFoodLoadError(loadError.message || 'Could not load All Food Items.'); });
    return () => { active = false; };
  }, [Boolean(receipt)]);
  useEffect(() => {
    if (!receipt?.items?.length || !foods.length || !receipt.merchantName) return;
    let changed = false;
    const items = receipt.items.map(item => {
      if (item.canonicalFoodId || item.foodMappingReviewed || !item.retailerProductCode) return item;
      const matches = foods.filter(food => (food.receiptMappings || []).some(mapping => mapping.productCode === item.retailerProductCode && normalizeFoodText(mapping.retailer) === normalizeFoodText(receipt.merchantName)));
      if (matches.length !== 1) return item;
      changed = true;
      return { ...item, canonicalFoodId:matches[0].id };
    });
    if (changed) onChange({ ...receipt, items });
  }, [receipt?.items, receipt?.merchantName, foods]);

  function cancel() {
    job.current++; session.current?.dispose(); session.current = null; locked.current = false;
    setBusy(false); onBusy(false); setProgress('Scan cancelled. Nothing was saved.');
  }
  function choose(event) {
    const selected = event.target.files?.[0]; event.target.value = '';
    if (!selected) return;
    try { validateReceiptImage(selected); setFile(selected); setRotation(0); setError(''); setProgress(''); void scan(selected, 'cloud'); }
    catch (scanError) { setError(scanError.message); }
  }
  async function scan(selectedFile = file, preferredMode = 'cloud') {
    if (!selectedFile || locked.current) return;
    locked.current = true;
    const current = ++job.current;
    setBusy(true); onBusy(true); setError(''); setProgress('Preparing receipt image...');
    const localProgress = message => setProgress(message.status === 'recognizing text' ? `Scanning receipt with local OCR... pass ${message.pass || 1}, ${Math.round(message.progress * 100)}%` : `${message.status || 'Preparing local receipt scanner'}...`);
    const getSession = mode => {
      if (!session.current || session.current.mode !== mode) {
        session.current?.dispose();
        session.current = mode === 'cloud' ? createCloudReceiptOcrSession(message => setProgress(`${message.status || 'Scanning receipt'}...`)) : createReceiptOcrSession(localProgress);
      }
      return session.current;
    };
    const run = mode => getSession(mode).scan(selectedFile, rotation, { debug:debugEnabled });
    const timeout = setTimeout(() => {
      if (current !== job.current) return;
      cancel(); setError('Scanning took too long. Try a smaller, clearer image and check your connection for the initial scanner download.');
    }, 120000);
    let cloudError = '';
    try {
      let result, usedMode = preferredMode;
      try {
        result = await run(preferredMode);
        if (preferredMode === 'cloud' && !result.parsed.items.length && result.parsed.total == null) throw new Error('OCR.Space could not find receipt items or a total.');
      } catch (scanError) {
        if (preferredMode !== 'cloud' || current !== job.current || /cancelled/i.test(scanError.message || '')) throw scanError;
        cloudError = scanError.message || 'OCR.Space could not complete this scan.';
        setProgress('OCR.Space could not complete this scan. Trying your existing local OCR...');
        usedMode = 'local'; result = await run('local');
      }
      if (current !== job.current) return;
      const parsed = result.parsed || parseReceipt(result);
      setRaw(result.rawText || result.lines?.map(line => line.text).join('\n') || result.text || '');
      setDebugData(result.debug ? { ...result.debug, parsed } : { parsed });
      onExtract(parsed);
      setProgress(cloudError ? `Local OCR completed. Review the transaction; OCR.Space issue: ${cloudError}` : `${usedMode === 'cloud' ? 'OCR.Space' : 'Local OCR'} scan complete. Review and correct the transaction before saving.`);
      if (!result.text?.trim() && !result.rawText?.trim()) setError('No text detected. Try a brighter, sharper photo, rotate the image, or enter the items manually.');
    } catch (scanError) {
      if (current === job.current) { setError(scanError.message || 'Could not scan this image. Try a clear JPEG, PNG or WEBP, check your connection, or enter items manually.'); session.current?.dispose(); session.current = null; }
    } finally {
      clearTimeout(timeout);
      if (current === job.current) { locked.current = false; setBusy(false); onBusy(false); }
    }
  }

  const structured = receipt && { ...receipt, items:receipt.items.map(item => ({ ...item, quantity:item.quantity === '' ? null : Number(item.quantity), unitPrice:readMoney(item.unitPrice), lineTotal:readMoney(item.lineTotal) })) };
  const rawToShow = raw || receipt?.rawText || '';
  const warnings = structured ? receiptWarnings(structured, readMoney(total)) : [];
  const reconciliation = structured ? reconcileReceipt(structured, readMoney(total)) : null;
  const changeReceipt = (patch, field) => onChange({ ...receipt, ...patch, editedFields:field ? [...new Set([...(receipt.editedFields || []), field])] : receipt.editedFields || [] });
  const editItem = (itemId, patch) => onChange({ ...receipt, items:receipt.items.map(item => item.id === itemId ? { ...item, ...patch,
    editedFields:[...new Set([...(item.editedFields || []), ...Object.keys(patch)])],
    confidence:{ ...item.confidence, ...Object.fromEntries(Object.keys(patch).map(key => [key, 100])) } } : item) });
  const addUnresolved = line => {
    const item = { id:crypto.randomUUID(), name:line.rawText, rawName:line.rawText, rawText:line.rawText, lineIndex:line.lineIndex, bbox:line.bbox,
      manuallyAdded:true, confidence:{ name:line.confidence, lineTotal:0, quantity:0, unitPrice:0 }, quantity:'', unit:'', packSize:'', packUnit:'', unitPrice:'', lineTotal:'' };
    onChange({ ...receipt, items:[...receipt.items, item], classifiedLines:(receipt.classifiedLines || []).map(candidate=>candidate.lineIndex===line.lineIndex?{...candidate,type:'PRODUCT_ITEM',confidence:90}:candidate), unresolvedLines:(receipt.unresolvedLines || []).filter(candidate => candidate.lineIndex !== line.lineIndex) });
  };
  async function copyDiagnostics() {
    const data = { parsed:debugData?.parsed || receipt, reconciliation, warnings,
      ocr:debugData ? { selected:debugData.selected || 'OCR.Space', region:Boolean(debugData.region), angle:debugData.angle || 0,
        rowCount:debugData.rowDeskew?.length || 0, candidates:debugData.candidates?.map(({ name, psm, score, elapsedMs, parsed }) => ({ name, psm, score, elapsedMs, parsed })) || [] } : null };
    try { await navigator.clipboard.writeText(JSON.stringify(data, null, 2)); setCopyStatus('Redacted receipt diagnostics copied.'); }
    catch { setCopyStatus('Clipboard access is unavailable in this browser.'); }
  }

  return <section className="f-receipt" aria-label="Receipt scanning and items">
    <div className="f-between"><div><h3 className="font-bold">Start with a receipt</h3><p className="f-help">OCR.Space scans first. If it cannot read enough, CBoard tries the existing local OCR. You can also enter the transaction manually below.</p></div><button type="button" className="f-button" onClick={() => { manualEntryRef?.current?.scrollIntoView({ behavior:'smooth', block:'center' }); manualEntryRef?.current?.focus(); }}>Enter manually</button></div>
    <div className="f-form mt-3">
      <p className="f-help">Choose a photo or open the camera. OCR.Space processes the image online. CBoard does not save or attach the photo. Choose “Try existing local OCR” to scan on this device.</p>
      <div className="f-actions f-receipt-choices">
        <label className="f-primary f-receipt-pick">Take receipt photo<input aria-label="Take receipt photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={choose}/></label>
        <label className="f-button f-receipt-pick">Choose receipt photo<input aria-label="Choose receipt photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={choose}/></label>
      </div>
      {image && <details><summary>View original receipt</summary><img className="f-receipt-image" src={image} alt="Original receipt for comparison"/></details>}
      {file && <div className="f-actions"><label>Scan rotation<select value={rotation} disabled={busy} onChange={event => setRotation(Number(event.target.value))}>{[0,90,180,270].map(value => <option key={value} value={value}>{value}°</option>)}</select></label><button type="button" className="f-button" disabled={busy} onClick={() => scan(file,'cloud')}>{receipt ? 'Rescan with OCR.Space' : 'Scan with OCR.Space'}</button><button type="button" className="f-button" disabled={busy} onClick={() => scan(file,'local')}>Try existing local OCR</button></div>}
      {progress && <p role="status">{progress}</p>}{busy && <button type="button" className="f-button" onClick={cancel}>Cancel scan</button>}{error && <p role="alert" className="f-alert">{error}</p>}
      {rawToShow && <details><summary>{raw ? 'Extracted text (temporary)' : 'Saved receipt OCR text'}</summary><pre className="f-receipt-raw">{rawToShow}</pre></details>}
      {debugEnabled && debugData && <details><summary>Developer OCR and parser diagnostics (temporary)</summary>
        <p>Selected: {debugData.selected || 'OCR.Space'}. Crop: {debugData.region ? 'detected' : 'original fallback'}; deskew: {debugData.angle || 0}°; local row alignment: {debugData.rowDeskew?.length || 0} rows.</p>
        {debugData.cropped && <img className="f-receipt-image" src={debugData.cropped} alt="Cropped receipt before thermal processing"/>}
        {debugData.candidates?.map(candidate => <details key={candidate.name}><summary>{candidate.name} · PSM {candidate.psm} · score {candidate.score.toFixed(1)} · {candidate.elapsedMs} ms</summary><img className="f-receipt-image" src={candidate.image} alt={`${candidate.name} processed OCR image`}/><pre className="f-receipt-raw">{JSON.stringify({ text:candidate.text, lines:candidate.lines, parsed:candidate.parsed }, null, 2)}</pre></details>)}
        <pre className="f-receipt-raw">{JSON.stringify({ classifiedLines:debugData.parsed?.classifiedLines, unresolvedLines:debugData.parsed?.unresolvedLines, reconciliation:reconcileReceipt(debugData.parsed || {}) }, null, 2)}</pre>
        <button type="button" className="f-button" onClick={copyDiagnostics}>Copy redacted receipt diagnostics</button>{copyStatus && <p role="status" className="f-help">{copyStatus}</p>}
      </details>}
      {!receipt && <button type="button" className="f-button" disabled={busy} onClick={() => onExtract({ merchantName:'', date:'', time:'', currency:'', subtotal:null, tax:null, discounts:null, total:null, items:[], classifiedLines:[], unresolvedLines:[] }, false)}>Enter receipt items manually</button>}
      {receipt && <>
        <p className="f-help">Merchant, date and total use the transaction fields above. Existing manual corrections are preserved when rescanning matching product codes. Unresolved lines stay visible until you review them.</p>
        <div className="f-row"><label>Receipt time<input type="time" value={receipt.time || ''} onChange={event => changeReceipt({ time:event.target.value },'time')}/></label><label>Receipt currency<input maxLength={3} value={receipt.currency || currency} onChange={event => changeReceipt({ currency:event.target.value.toUpperCase() },'currency')}/></label></div>
        {receipt.currency && receipt.currency !== currency && <p className="f-alert">Receipt currency differs from Finance ({currency}). Convert the amounts yourself and set the receipt currency to {currency} before saving. No automatic conversion is applied.</p>}
        <div className="f-row">{[['subtotal','Subtotal'],['tax','Tax / VAT'],['discounts','Discounts']].map(([key,label]) => <label key={key}>{label}<input inputMode="decimal" value={receipt[key] ?? ''} onChange={event => changeReceipt({ [key]:event.target.value },key)}/></label>)}</div>
        <h3 className="font-bold">Receipt items ({receipt.items.length})</h3>
        {receipt.confidence && Object.values(receipt.confidence).some(value => value < 70) && <p className="f-help">Check receipt fields: {Object.entries(receipt.confidence).filter(([,value]) => value < 70).map(([key]) => key).join(', ')}. Other detected fields have stronger evidence.</p>}
        {foodLoadError && <p className="f-alert" role="status">{foodLoadError} Receipt items can still be saved without food links.</p>}
        {receipt.items.map((item,index) => {
          const linkedFood = foods.find(food => food.id === item.canonicalFoodId);
          const codeMatch = item.retailerProductCode && foods.flatMap(food => (food.receiptMappings || []).filter(mapping => mapping.productCode === item.retailerProductCode && mapping.retailer.toLowerCase() === (receipt.merchantName || '').toLowerCase()).map(() => food));
          const exactNameMatch = foods.filter(food => [food.name,...(food.aliases || [])].some(alias => normalizeFoodText(alias) === normalizeFoodText(item.name || '')));
          const suggestion = codeMatch?.length === 1 ? codeMatch[0] : exactNameMatch.length === 1 ? exactNameMatch[0] : null;
          return <details className="f-item f-receipt-item" key={item.id}>
            <summary className="f-receipt-item-summary"><strong>{item.name || `Item ${index + 1}`}</strong><span>{item.quantity || '?'} {item.unit || ''}{item.packSize ? ` · pack ${item.packSize}${item.packUnit}` : ''}</span><strong>{item.lineTotal === '' || item.lineTotal == null ? 'Price unknown' : formatMoney(readMoney(item.lineTotal),currency)}</strong></summary>
            <fieldset className="f-form f-receipt-item-edit"><legend>Item {index + 1}</legend>
              {item.retailerProductCode && <p className="f-help">Product code: {item.retailerProductCode}</p>}
              {suggestion && !linkedFood && <p className="f-help">Possible All Food Items match: <strong>{suggestion.name}</strong>. Review and select it below to link.</p>}
              {item.confidence && Object.values(item.confidence).some(value => value < 70) && <p className="f-receipt-check">Check: {Object.entries(item.confidence).filter(([,value]) => value < 70).map(([key]) => ({ name:'item name', quantity:'quantity', unitPrice:'unit price', lineTotal:'line total' }[key] || key)).join(', ')}.</p>}
              <label>Item name<input maxLength={200} value={item.name} onChange={event => editItem(item.id,{ name:event.target.value })}/></label>
              <div className="f-row"><label>Purchased quantity<input inputMode="decimal" placeholder="Unknown" value={item.quantity} onChange={event => editItem(item.id,{ quantity:event.target.value })}/></label><label>Purchase unit<input maxLength={30} placeholder="each, kg, g, L, ml" value={item.unit} onChange={event => editItem(item.id,{ unit:event.target.value })}/></label><label>Unit price<input inputMode="decimal" value={item.unitPrice} onChange={event => editItem(item.id,{ unitPrice:event.target.value })}/></label><label>Line total<input inputMode="decimal" value={item.lineTotal} onChange={event => editItem(item.id,{ lineTotal:event.target.value })}/></label></div>
              <div className="f-row"><label>Pack size<input inputMode="decimal" placeholder="Not shown" value={item.packSize ?? ''} onChange={event => editItem(item.id,{ packSize:event.target.value })}/></label><label>Pack unit<input maxLength={20} placeholder="kg, g, L, ml" value={item.packUnit || ''} onChange={event => editItem(item.id,{ packUnit:event.target.value })}/></label></div>
              <label>Link to All Food Items<select value={item.canonicalFoodId || ''} onChange={event => editItem(item.id,{ canonicalFoodId:event.target.value || null, foodMappingReviewed:true, rememberFoodMapping:false })}><option value="">No food link</option>{foods.map(food => <option key={food.id} value={food.id}>{food.name}{food.groceryTrackingEnabled === false ? ' · grocery tracking off' : ''}</option>)}</select></label>
              {item.canonicalFoodId && !linkedFood && <p className="f-receipt-check">The linked food was removed. Choose another food or clear this link.</p>}
              {linkedFood?.groceryTrackingEnabled === false && <p className="f-help">Grocery tracking is disabled for this food, so receipt saves will not change stock or the shopping list.</p>}
              {item.retailerProductCode && linkedFood && <label className="f-receipt-map"><input type="checkbox" checked={item.rememberFoodMapping === true} onChange={event => editItem(item.id,{ rememberFoodMapping:event.target.checked })}/> Remember this {receipt.merchantName || 'retailer'} product code for the selected food after saving.</label>}
              {item.rawText && <p className="f-help f-receipt-raw">Read as: {item.rawText}</p>}
              <button type="button" className="f-button danger-action" onClick={() => onChange({ ...receipt, items:receipt.items.filter(other => other.id !== item.id) })}>Remove item {index + 1}</button>
            </fieldset>
          </details>;
        })}
        {!!receipt.unresolvedLines?.length && <section className="f-receipt-unresolved" aria-label="Receipt lines to review"><h4 className="font-bold">Receipt lines to review ({receipt.unresolvedLines.length})</h4><p className="f-help">These lines were kept because CBoard could not classify them safely. Add a line as an item only if it is a purchase.</p>{receipt.unresolvedLines.map(line => <div className="f-receipt-unresolved-line" key={`${line.lineIndex}-${line.rawText}`}><code>{line.rawText}</code><span>Line {line.lineIndex + 1} · confidence {Math.round(line.confidence)}%</span><button type="button" className="f-button" onClick={() => addUnresolved(line)}>Review as item</button></div>)}</section>}
        <button type="button" className="f-button" onClick={() => onChange({ ...receipt, items:[...receipt.items,{ id:crypto.randomUUID(), name:'', rawText:'', manuallyAdded:true, quantity:'', unit:'', packSize:'', packUnit:'', unitPrice:'', lineTotal:'' }] })}>Add receipt item</button>
        <p className="font-bold">Product lines: {reconciliation.productLineCount} · purchased units: {reconciliation.computedUnitCount} · item sum: {formatMoney(reconciliation.computedItemsTotal,currency)}</p>
        {!!warnings.length && <div className="f-alert" role="status"><p>Check before saving ({currency})</p><ul>{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
      </>}
    </div>
  </section>;
}

export function ReceiptItems({ receipt, currency }) {
  if (!receipt) return null;
  const money = value => value == null ? 'Unknown' : formatMoney(value,receipt.currency || currency);
  return <details className="f-receipt-saved"><summary>Items ({receipt.items?.length || 0})</summary>
    {receipt.time && <p className="f-meta">Receipt time: {receipt.time}</p>}
    <ul>{receipt.items?.map(item => <li key={item.id}><strong>{item.name}</strong><br/>{item.quantity ?? '?'} {item.unit || ''} × {money(item.unitPrice)} = {money(item.lineTotal)}{item.canonicalFoodId ? ' · linked to All Food Items' : ''}</li>)}</ul>
    {receipt.subtotal != null && <p>Subtotal: {money(receipt.subtotal)}</p>}{receipt.tax != null && <p>Tax / VAT: {money(receipt.tax)}</p>}{receipt.discounts != null && <p>Discounts: {money(receipt.discounts)}</p>}
    {receipt.rawText && <details><summary>Original redacted OCR text</summary><pre className="f-receipt-raw">{receipt.rawText}</pre></details>}
    {!!receipt.unresolvedLines?.length && <details><summary>Unresolved receipt lines ({receipt.unresolvedLines.length})</summary><ul>{receipt.unresolvedLines.map(line=><li key={`${line.lineIndex}-${line.rawText}`}>{line.rawText}</li>)}</ul></details>}
  </details>;
}
