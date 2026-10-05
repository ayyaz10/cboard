import { useEffect, useId, useRef, useState } from 'react';
import { NUTRIENTS } from './nutrients.js';
import { applyNutritionReview, currentAtBasis } from './nutritionLabelReview.js';
import { createNutritionOcrSession } from './nutritionLabelOcr.js';
import { validateOcrImage } from '../../services/ocr/imageOcr.js';
import { notify } from '../../lib/notifications.js';
import './nutritionLabelScan.css';

const blankColumn=()=>({id:'manual',label:'Basis not identified',kind:'unknown',quantity:null,unit:'g',confirmed:false,nutrients:{},values:{},selected:[]});
const reviewColumn=column=>({...column,values:Object.fromEntries(Object.entries(column.nutrients).map(([key,field])=>[key,field.value])),selected:Object.keys(column.nutrients)});
const display=value=>value==null?'Unknown':new Intl.NumberFormat(undefined,{maximumFractionDigits:4}).format(value);

export function NutritionLabelScan({current=null,onApply,disabled=false,initialOpen=false,basisUnits=['g','ml','pieces','servings']}) {
  const id=useId(),session=useRef(null),job=useRef(0),fileRef=useRef(null),urlRef=useRef(null);
  const [open,setOpen]=useState(initialOpen),[photo,setPhoto]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [progress,setProgress]=useState(null),[rotation,setRotation]=useState(0),[crop,setCrop]=useState({left:0,top:0,right:100,bottom:100});
  const [columns,setColumns]=useState([]),[active,setActive]=useState(''),[warnings,setWarnings]=useState([]),[raw,setRaw]=useState('');
  const [clearIncompatible,setClearIncompatible]=useState(false);
  const [diagnostics,setDiagnostics]=useState(null);
  const debugEnabled=import.meta.env.DEV&&new URLSearchParams(window.location.search).has('nutritionOcrDebug');
  const column=columns.find(value=>value.id===active);
  const converted=column?currentAtBasis(current,column):null;
  function stop(){job.current++;session.current?.dispose();session.current=null;setBusy(false);setProgress(null);}
  function discard(){stop();setOpen(false);setColumns([]);setRaw('');setDiagnostics(null);setError('');fileRef.current=null;if(urlRef.current)URL.revokeObjectURL(urlRef.current);urlRef.current=null;setPhoto('');}
  useEffect(()=>()=>{job.current++;session.current?.dispose();if(urlRef.current)URL.revokeObjectURL(urlRef.current);},[]);
  async function scan(file=fileRef.current,nextRotation=rotation,nextCrop=crop) {
    if(!file)return;
    const run=++job.current;setBusy(true);setError('');setProgress({status:'Loading scanner',progress:0});setColumns([]);setRaw('');setDiagnostics(null);setWarnings([]);
    try {
      validateOcrImage(file);
      if(!session.current)session.current=createNutritionOcrSession(message=>setProgress(message));
      // One live session reports progress across rescans; disposal suppresses late updates.
      const result=await session.current.scan(file,nextRotation,{crop:nextCrop,debug:debugEnabled});
      if(run!==job.current)return;
      const next=result.parsed.columns.length?result.parsed.columns.map(reviewColumn):[blankColumn()];
      setColumns(next);setActive(next[0].id);setWarnings(result.parsed.warnings);setRaw(result.parsed.text);setClearIncompatible(false);
      if (result.parsed.columns.length) notify.info('Nutrition label scanned. Review the values before applying.');
      if(debugEnabled)setDiagnostics({selected:result.name,candidates:result.debug?.candidates.map(({image,...candidate})=>candidate)});
    }catch(err){if(run===job.current){setError(err.message||'Could not scan this label. Try a clearer image.');notify.error(err.message||'Could not scan nutrition label');session.current?.dispose();session.current=null;}}
    finally{if(run===job.current){setBusy(false);setProgress(null);}}
  }
  function upload(file){if(!file)return;try{validateOcrImage(file);}catch(err){setError(err.message);return;}fileRef.current=file;if(urlRef.current)URL.revokeObjectURL(urlRef.current);urlRef.current=URL.createObjectURL(file);setPhoto(urlRef.current);setRotation(0);const full={left:0,top:0,right:100,bottom:100};setCrop(full);void scan(file,0,full);}
  function update(patch){setColumns(previous=>previous.map(value=>value.id===active?{...value,...patch}:value));setError('');}
  function field(key,label,unit){const found=column.nutrients[key];return <div className="nscan-field" key={key}>
    <label className="nscan-check"><input type="checkbox" checked={column.selected.includes(key)} onChange={event=>update({selected:event.target.checked?[...column.selected,key]:column.selected.filter(value=>value!==key)})}/><span>{label} ({unit})</span></label>
    {current && <span className="nscan-current">Current: {display((converted||current)[key])}{!converted?' (existing basis)':''}</span>}
    <label><span className="nscan-sr">Scanned {label} ({unit})</span><input type="number" min="0" step="any" value={column.values[key]??''} placeholder="Unknown" onChange={event=>update({values:{...column.values,[key]:event.target.value===''?null:Number(event.target.value)},nutrients:{...column.nutrients,[key]:{...column.nutrients[key],uncertain:false,confidence:100,reasons:[]}},selected:[...new Set([...column.selected,key])]})}/></label>
    {found && (found.uncertain||found.confidence<70) && <small className="nscan-warning">{found.reasons?.length?[...new Set(found.reasons)].join(' '):'Low OCR confidence. Compare with the image.'}</small>}
  </div>;}
  return <section className="nscan" aria-label="Nutrition label scanner">
    {!open?<button type="button" disabled={disabled} onClick={()=>setOpen(true)}>Scan nutrition label</button>:<>
      <div className="nscan-actions"><strong id={`${id}-title`}>Nutrition label scan</strong><button type="button" onClick={discard}>Close scanner</button></div>
      <p>Scan on this device. Include the column headings and serving size. JPEG, PNG or WEBP, up to 15 MB. Review before applying; the image is temporary.</p>
      <div className="nscan-actions">
        <label>Upload nutrition label<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy||disabled} onChange={event=>{upload(event.target.files?.[0]);event.target.value='';}}/></label>
        <label>Take nutrition photo<input type="file" capture="environment" accept="image/jpeg,image/png,image/webp" disabled={busy||disabled} onChange={event=>{upload(event.target.files?.[0]);event.target.value='';}}/></label>
      </div>
      {photo&&<details><summary>Original image, crop and rotation</summary><img src={photo} alt="Nutrition label to review"/>
        <p>Crop bounds are percentages of the original image. Keep every heading for the columns you want to read.</p>
        <div className="nscan-grid">{['left','top','right','bottom'].map(edge=><label key={edge}>Crop {edge} (%)<input type="number" min="0" max="100" disabled={busy} value={crop[edge]} onChange={event=>setCrop({...crop,[edge]:Number(event.target.value)})}/></label>)}
        <label>Scan rotation<select value={rotation} disabled={busy} onChange={event=>setRotation(Number(event.target.value))}>{[0,90,180,270].map(value=><option key={value} value={value}>{value}°</option>)}</select></label></div>
        <button type="button" disabled={busy||disabled} onClick={()=>scan()}>Rescan label</button>
      </details>}
      {busy&&<div role="status"><p>{progress?.status}{progress?.pass?` · pass ${progress.pass}`:''}</p><progress max="1" value={progress?.progress||0}/><button type="button" onClick={stop}>Cancel scan</button></div>}
      {error&&<p role="alert" className="nscan-warning">{error}</p>}
      {warnings.map(message=><p className="nscan-warning" key={message}>{message}</p>)}
      {column&&!busy&&<div>
        {photo&&<details className="nscan-image-review"><summary>View nutrition image</summary><img src={photo} alt="Original nutrition image for comparison"/></details>}
        <label>Nutrition column<select aria-label="Nutrition column" value={active} onChange={event=>{setActive(event.target.value);setClearIncompatible(false);}}>{columns.map(value=><option key={value.id} value={value.id}>{columns.some(other=>other.tableId!==value.tableId)?`${value.tableId}: `:''}{value.label}</option>)}</select></label>
        {!column.confirmed&&<p className="nscan-warning">{column.basisStatus==='unreadable'?'A basis heading may be present, but it could not be read reliably. Check the full image or rescan with the heading included.':'No basis heading was detected in this image. It may be outside the screenshot or unreadable. Check the source and choose the basis below; none has been assumed.'}</p>}
        {column.warnings?.map(message=><p key={message} className="nscan-warning">{message}</p>)}
        <div className="nscan-grid">
          <label>Nutrition basis<select aria-label="Nutrition basis" value={column.kind} onChange={event=>{const kind=event.target.value;update({kind,confirmed:kind!=='unknown',label:kind==='100g'?'Per 100g':kind==='100ml'?'Per 100ml':`Per ${kind}`,quantity:kind.startsWith('100')?100:column.quantity||1,unit:kind==='100g'?'g':kind==='100ml'?'ml':column.kind==='unknown'?'pieces':column.unit});}}>{[['unknown','Choose basis'],['100g','Per 100g'],['100ml','Per 100ml'],['serving','Per serving'],['portion','Per portion'],['item','Per item'],['pack','Per pack'],['slice','Per slice'],['scoop','Per scoop'],['container','Per container'],['pot','Per pot']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          <label>Values per quantity<input type="number" min="0.0001" step="any" value={column.quantity??''} onChange={event=>update({quantity:event.target.value===''?null:Number(event.target.value)})}/></label>
          <label>Basis unit<select aria-label="Basis unit" value={column.unit} onChange={event=>update({unit:event.target.value})}>{basisUnits.map(unit=><option key={unit}>{unit}</option>)}</select></label>
        </div>
        {column.serving&&<p>Serving information: {column.serving.description} · {column.serving.quantity} {column.serving.unit}</p>}
        {current&&<p>Existing values: per {current.quantity} {current.unit}. {converted?'Current values below are scaled to the selected basis for comparison.':'Different units cannot be converted automatically.'} Unchecked fields are kept when compatible.</p>}
        <div className="nscan-actions"><button type="button" onClick={()=>update({selected:Object.keys(column.values).filter(key=>column.values[key]!=null)})}>Select all scanned fields</button><button type="button" onClick={()=>update({selected:[]})}>Keep existing values</button></div>
        <div className="nscan-grid">{NUTRIENTS.filter(([key])=>column.values[key]!=null||current?.[key]!=null||column.selected.includes(key)).map(([key,label,unit])=>field(key,label,unit))}</div>
        <details><summary>Add missing nutrient values</summary><div className="nscan-grid">{NUTRIENTS.filter(([key])=>column.values[key]==null&&current?.[key]==null&&!column.selected.includes(key)).map(([key,label,unit])=>field(key,label,unit))}</div></details>
        {current&&!converted&&NUTRIENTS.some(([key])=>current[key]!=null&&!column.selected.includes(key))&&<label className="nscan-check"><input type="checkbox" checked={clearIncompatible} onChange={event=>setClearIncompatible(event.target.checked)}/>Clear unchecked existing values that cannot be converted to this basis</label>}
        <p>Check highlighted values and units against the image. Applying fills the editor; save the food or recipe normally.</p>
        <button type="button" disabled={disabled||!column.confirmed||!column.selected.length} onClick={()=>{try{onApply(applyNutritionReview(current,column,column.selected,{clearIncompatible}));discard();}catch(err){setError(err.message);}}}>Apply nutrition</button>
        <details><summary>Extracted text (temporary)</summary><pre>{raw}</pre></details>
        {debugEnabled&&diagnostics&&<details><summary>Development OCR diagnostics</summary><pre>{JSON.stringify(diagnostics,null,2)}</pre></details>}
      </div>}
    </>}
  </section>;
}
