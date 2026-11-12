import { useEffect, useId, useRef, useState } from 'react';
import { NUTRIENTS, nutritionFieldDefinitions } from './nutrients.js';
import { buildFoodLookupPrompt, buildLabelExtractionPrompt, canFillMissingNutrition, createNutritionJsonApplication, hasExistingNutrition, NUTRITION_BASIS_UNITS, parseNutritionJson } from './nutritionJsonImport.js';
import { applyNutritionReview, currentAtBasis } from './nutritionLabelReview.js';
import { createNutritionOcrSession } from './nutritionLabelOcr.js';
import { validateOcrImage } from '../../services/ocr/imageOcr.js';
import { notify } from '../../lib/notifications.js';
import { createPendingNutritionImport, formatNutritionFoodName, isPendingNutritionImportExpired, nutritionJsonMatchesFood } from './nutritionClipboardImport.js';
import './nutritionLabelScan.css';

const blankColumn=()=>({id:'manual',label:'Basis not identified',kind:'unknown',quantity:null,unit:'g',confirmed:false,nutrients:{},values:{},selected:[]});
const reviewColumn=column=>({...column,values:Object.fromEntries(Object.entries(column.nutrients).map(([key,field])=>[key,field.value])),selected:Object.keys(column.nutrients)});
const display=value=>value==null?'Unknown':new Intl.NumberFormat(undefined,{maximumFractionDigits:4}).format(value);
const jsonFieldGroups=[['energy','Energy'],['macros','Macros'],['fat','Fat details'],['vitamins','Vitamins'],['bVitamins','B vitamins'],['minerals','Minerals'],['other','Other']];

export function NutritionLabelScan({current=null,onApply,disabled=false,initialOpen=false,basisUnits=['g','ml','pieces','servings'],foodName:controlledFoodName,amount:controlledAmount,unit:controlledUnit,onFoodNameChange,draftId:ownerDraftId}) {
  const id=useId(),session=useRef(null),job=useRef(0),fileRef=useRef(null),urlRef=useRef(null),imageDialog=useRef(null),jsonDialog=useRef(null),jsonTextarea=useRef(null),pendingImportRef=useRef(null),clipboardReadInProgress=useRef(false),autoReadAttempt=useRef(''),contextRef=useRef(null),popupBlocked=useRef(false);
  const [open,setOpen]=useState(initialOpen),[photo,setPhoto]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[basicMode,setBasicMode]=useState(false),[fallbackMessage,setFallbackMessage]=useState('');
  const [showImage,setShowImage]=useState(false);
  const [progress,setProgress]=useState(null),[rotation,setRotation]=useState(0),[crop,setCrop]=useState({left:0,top:0,right:100,bottom:100});
  const [columns,setColumns]=useState([]),[active,setActive]=useState(''),[warnings,setWarnings]=useState([]),[raw,setRaw]=useState('');
  const [clearIncompatible,setClearIncompatible]=useState(false);
  const [diagnostics,setDiagnostics]=useState(null);
  const [jsonOpen,setJsonOpen]=useState(false),[jsonMode,setJsonMode]=useState('food_reference'),[jsonText,setJsonText]=useState(''),[jsonPreview,setJsonPreview]=useState(null),[jsonError,setJsonError]=useState(''),[jsonConflict,setJsonConflict]=useState(false),[jsonCopied,setJsonCopied]=useState(''),[promptText,setPromptText]=useState(''),[lookupFoodDraft,setLookupFoodDraft]=useState(''),[lookupAmountDraft,setLookupAmountDraft]=useState('100'),[lookupUnitDraft,setLookupUnitDraft]=useState('g'),[pendingImport,setPendingImport]=useState(null),[importMessage,setImportMessage]=useState(''),[clipboardFallback,setClipboardFallback]=useState(false),[clipboardReading,setClipboardReading]=useState(false),[jsonFoodMismatch,setJsonFoodMismatch]=useState(null);
  const [ocrSource,setOcrSource]=useState({provider:'local-tesseract',model:''});
  useEffect(()=>{
    const dialog=jsonDialog.current;
    if(!dialog)return;
    if(jsonOpen&&!dialog.open)dialog.showModal();
    else if(!jsonOpen&&dialog.open)dialog.close();
  },[jsonOpen]);
  useEffect(()=>{if(!jsonOpen){setJsonPreview(null);setJsonError('');setJsonConflict(false);setJsonCopied('');setJsonFoodMismatch(null);}},[jsonOpen]);
  useEffect(()=>{
    if(!pendingImport)return;
    const onReturn=()=>{
      if(document.visibilityState!=='visible')return;
      const pending=pendingImportRef.current;
      if(!pending||autoReadAttempt.current===pending.id)return;
      autoReadAttempt.current=pending.id;
      void readPendingClipboard();
    };
    window.addEventListener('focus',onReturn);
    document.addEventListener('visibilitychange',onReturn);
    return()=>{window.removeEventListener('focus',onReturn);document.removeEventListener('visibilitychange',onReturn);};
  },[pendingImport?.id]);
  useEffect(()=>{
    const dialog=imageDialog.current;
    if(!dialog)return;
    if(showImage&&!dialog.open)dialog.showModal();
    else if(!showImage&&dialog.open)dialog.close();
  },[showImage]);
  const lookupFood=controlledFoodName===undefined?lookupFoodDraft:controlledFoodName;
  const lookupAmount=controlledAmount===undefined?lookupAmountDraft:controlledAmount;
  const lookupUnit=controlledUnit===undefined?lookupUnitDraft:controlledUnit;
  const lookupIsControlled=controlledFoodName!==undefined;
  const activeDraftId=ownerDraftId??id;
  contextRef.current={foodName:lookupFood,current,draftId:activeDraftId,onApply};
  const debugEnabled=import.meta.env.DEV&&new URLSearchParams(window.location.search).has('nutritionOcrDebug');
  const column=columns.find(value=>value.id===active);
  const converted=column?currentAtBasis(current,column):null;
  const hasCurrentNutrition=hasExistingNutrition(current);
  const fillMissingAllowed=jsonPreview?canFillMissingNutrition(current,jsonPreview):false;
  function updatePendingImport(value){pendingImportRef.current=value;setPendingImport(value);}
  function cancelPendingImport(){updatePendingImport(null);setClipboardFallback(false);setClipboardReading(false);setImportMessage('');}
  function changeLookupFood(value){if(controlledFoodName!==undefined)onFoodNameChange?.(value);else setLookupFoodDraft(value);setJsonCopied('');setPromptText('');}
  function promptFor(kind){return kind==='nutrition_label'?buildLabelExtractionPrompt():buildFoodLookupPrompt({foodName:String(lookupFood||'').trim(),amount:Number(lookupAmount),unit:lookupUnit});}
  function openChatGPTWithPrompt(kind='food_reference'){
    const food=String(lookupFood||'').trim();
    const labelMode=kind==='nutrition_label';
    if(!labelMode){if(controlledFoodName!==undefined)onFoodNameChange?.(food);else setLookupFoodDraft(food);}
    const amount=Number(lookupAmount);
    if(!labelMode&&!food){setImportMessage('Enter a food name.');return;}
    if(!labelMode&&(!Number.isFinite(amount)||amount<=0||!NUTRITION_BASIS_UNITS.includes(lookupUnit))){setImportMessage('Enter a valid nutrition amount and unit first.');return;}
    const prompt=promptFor(kind);
    let pending;
    try{pending=createPendingNutritionImport({foodName:food||'Nutrition label',amount:Number.isFinite(amount)&&amount>0?amount:100,unit:NUTRITION_BASIS_UNITS.includes(lookupUnit)?lookupUnit:'g',draftId:activeDraftId,mode:kind});}
    catch(err){setImportMessage(err.message||'Check the food name and nutrition basis.');return;}
    updatePendingImport(pending);
    autoReadAttempt.current='';popupBlocked.current=false;
    setPromptText(prompt);
    setJsonCopied('');
    setClipboardFallback(false);
    setImportMessage('Copying prompt…');
    try{
      if(!navigator.clipboard?.writeText)throw new Error('Clipboard access is unavailable.');
      void navigator.clipboard.writeText(prompt).then(()=>{
        if(pendingImportRef.current?.id===pending.id)setImportMessage('Prompt copied — paste it into ChatGPT.');
      }).catch(()=>{
        if(pendingImportRef.current?.id===pending.id)setImportMessage(popupBlocked.current?'Prompt copy failed and the ChatGPT tab was blocked. Use Copy Prompt, then open ChatGPT manually.':'Prompt could not be copied. Use Copy Prompt to copy it, then paste it into ChatGPT.');
      });
    }catch{setImportMessage('Prompt could not be copied. Use Copy Prompt to copy it, then paste it into ChatGPT.');}
    try{
      const chatTab=window.open('https://chatgpt.com/','_blank');
      if(chatTab)chatTab.opener=null;
      else{popupBlocked.current=true;setImportMessage('The browser blocked the ChatGPT tab. The prompt is still available to copy.');}
    }catch{popupBlocked.current=true;setImportMessage('ChatGPT could not be opened. The prompt is still available to copy.');}
  }
  function preferredImportFoodName(importedName,pending){
    if(pending?.mode==='nutrition_label')return importedName;
    const currentName=String(contextRef.current.foodName||'').trim();
    if(currentName)return currentName;
    if(pending?.mode!=='nutrition_label'&&pending?.foodName)return pending.foodName;
    return importedName;
  }
  function applyPendingImport(parsed,pending){
    const context=contextRef.current;
    const result={...createNutritionJsonApplication(parsed,context.current,'replace'),foodName:preferredImportFoodName(parsed.food.name,pending)};
    context.onApply(result);
    updatePendingImport(null);
    setClipboardFallback(false);
    const importedName=pending.mode==='nutrition_label'?parsed.food.name:pending.foodName;
    setImportMessage(`Nutrition imported for ${importedName}.`);
    notify.success(`Nutrition imported for ${importedName}.`);
  }
  function showNutritionReview(raw,parsed,pending,{mismatch=null,existing=false}={}){
    setJsonText(raw);
    setJsonPreview(parsed);
    setJsonConflict(existing);
    setJsonError('');
    setJsonFoodMismatch(mismatch);
    if(mismatch){updatePendingImport(null);setClipboardFallback(false);setImportMessage('Nutrition JSON does not match the requested food or basis. Review it before importing.');}
    else if(existing){setClipboardFallback(true);setImportMessage('Nutrition already exists. Choose Replace, Fill missing only, or Cancel.');}
    setJsonOpen(true);
  }
  async function readPendingClipboard(){
    const pending=pendingImportRef.current;
    if(!pending||!pending.awaitingNutritionJson||clipboardReadInProgress.current)return;
    const context=contextRef.current;
    if(isPendingNutritionImportExpired(pending)){
      updatePendingImport(null);setClipboardFallback(false);setImportMessage('This nutrition lookup expired. Start a new ChatGPT lookup.');return;
    }
    if(pending.draftId!==context.draftId||(pending.mode!=='nutrition_label'&&!nutritionJsonMatchesFood(pending.foodName,{name:context.foodName}))){
      updatePendingImport(null);setClipboardFallback(false);setImportMessage('The food name changed while ChatGPT was open. Start a new lookup before importing.');return;
    }
    if(!navigator.clipboard?.readText){setClipboardFallback(true);setImportMessage('Nutrition JSON ready? Use Paste from clipboard, or paste it manually.');return;}
    clipboardReadInProgress.current=true;setClipboardReading(true);
    try{
      const raw=await navigator.clipboard.readText();
      if(pendingImportRef.current?.id!==pending.id)return;
      let parsed;
      try{parsed=parseNutritionJson(raw);}
      catch{setClipboardFallback(true);setImportMessage("Clipboard doesn't contain valid CBoard nutrition JSON. Paste manually or try Paste from clipboard again.");return;}
      const freshContext=contextRef.current;
      if(pending.draftId!==freshContext.draftId||(pending.mode!=='nutrition_label'&&!nutritionJsonMatchesFood(pending.foodName,{name:freshContext.foodName}))){
        updatePendingImport(null);setClipboardFallback(false);setImportMessage('The food name changed while ChatGPT was open. Start a new lookup before importing.');return;
      }
      const foodMismatch=pending.mode!=='nutrition_label'&&!nutritionJsonMatchesFood(pending.foodName,parsed.food);
      const basisMismatch=pending.mode!=='nutrition_label'&&(parsed.quantity!==pending.amount||parsed.unit!==pending.unit);
      if(foodMismatch||basisMismatch){
        showNutritionReview(raw,parsed,pending,{mismatch:{type:foodMismatch?'food':'basis',requested:foodMismatch?pending.foodName:`${pending.amount} ${pending.unit}`,found:foodMismatch?formatNutritionFoodName(parsed.food):`${parsed.quantity} ${parsed.unit}`},existing:hasExistingNutrition(freshContext.current)});return;
      }
      if(hasExistingNutrition(freshContext.current)){
        showNutritionReview(raw,parsed,pending,{existing:true});return;
      }
      try{applyPendingImport(parsed,pending);}
      catch(err){setClipboardFallback(true);setImportMessage(err.message||'Could not apply nutrition JSON. Paste manually to review it.');}
    }catch{
      setClipboardFallback(true);
      setImportMessage('Nutrition JSON ready? Use Paste from clipboard, or paste it manually.');
    }finally{clipboardReadInProgress.current=false;setClipboardReading(false);}
  }
  function previewNutritionJson(){
    try{
      const parsed=parseNutritionJson(jsonText);
      const pending=pendingImportRef.current;
      if(pending){
        const foodMismatch=pending.mode!=='nutrition_label'&&!nutritionJsonMatchesFood(pending.foodName,parsed.food);
        const basisMismatch=pending.mode!=='nutrition_label'&&(parsed.quantity!==pending.amount||parsed.unit!==pending.unit);
        if(foodMismatch||basisMismatch){
          setJsonFoodMismatch({type:foodMismatch?'food':'basis',requested:foodMismatch?pending.foodName:`${pending.amount} ${pending.unit}`,found:foodMismatch?formatNutritionFoodName(parsed.food):`${parsed.quantity} ${parsed.unit}`});
          updatePendingImport(null);setClipboardFallback(false);
        }else setJsonFoodMismatch(null);
      }else setJsonFoodMismatch(null);
      setJsonPreview(parsed);setJsonMode(parsed.source.sourceType);setJsonConflict(false);setJsonError('');
    }catch(err){setJsonPreview(null);setJsonFoodMismatch(null);setJsonError(err.message||'Nutrition JSON is not valid.');jsonTextarea.current?.focus();}
  }
  function applyJsonImport(strategy){
    try{
      const pending=pendingImportRef.current;
      const imported=createNutritionJsonApplication(jsonPreview,current,strategy);
      onApply({...imported,foodName:preferredImportFoodName(jsonPreview.food.name,pending)});
      updatePendingImport(null);setClipboardFallback(false);setJsonFoodMismatch(null);setImportMessage(`Nutrition imported for ${pending?.foodName||jsonPreview.food.name}.`);
      setJsonOpen(false);setJsonText('');setJsonPreview(null);setJsonConflict(false);
      notify.success(`Nutrition imported for ${pending?.foodName||jsonPreview.food.name}.`);
    }catch(err){setJsonError(err.message||'Could not apply nutrition JSON.');}
  }
  function cancelFoodMismatch(){setJsonFoodMismatch(null);setJsonOpen(false);setJsonText('');setJsonPreview(null);setJsonConflict(false);cancelPendingImport();}
  function stop(){job.current++;session.current?.dispose();session.current=null;setBusy(false);setProgress(null);}
  function discard(){stop();setOpen(false);setShowImage(false);setColumns([]);setRaw('');setDiagnostics(null);setOcrSource({provider:'local-tesseract',model:''});setError('');setBasicMode(false);setFallbackMessage('');fileRef.current=null;if(urlRef.current)URL.revokeObjectURL(urlRef.current);urlRef.current=null;setPhoto('');}
  useEffect(()=>()=>{job.current++;session.current?.dispose();pendingImportRef.current=null;if(urlRef.current)URL.revokeObjectURL(urlRef.current);},[]);
  async function scan(file=fileRef.current,nextRotation=rotation,nextCrop=crop,mode=basicMode?'basic':'cloud') {
    if(!file)return;
    const run=++job.current;setBusy(true);setError('');setProgress({status:'Loading scanner',progress:0});setColumns([]);setRaw('');setDiagnostics(null);setWarnings([]);
    try {
      validateOcrImage(file);
      if(!session.current||session.current.mode!==mode){session.current?.dispose();session.current=createNutritionOcrSession(message=>setProgress(message),mode);}
      // One live session reports progress across rescans; disposal suppresses late updates.
      const result=await session.current.scan(file,nextRotation,{crop:nextCrop,debug:debugEnabled});
      if(run!==job.current)return;
      setOcrSource({provider:result.provider==='ocr-space'?'ocr-space':'local-tesseract',model:result.name||''});
      const next=result.parsed.columns.length?result.parsed.columns.map(reviewColumn):[blankColumn()];
      setColumns(next);setActive(next[0].id);setWarnings(result.parsed.warnings);setRaw(result.parsed.text);setClearIncompatible(false);
      if (result.parsed.columns.length) notify.info('Nutrition label scanned. Review the values before applying.');
      if(debugEnabled&&result.provider==='ocr-space'){
        const doc=result.debug?.rawDocument;
        const mappedRows=result.parsed.columns.flatMap(column=>Object.entries(column.nutrients).map(([canonicalNutrient,field])=>({source:{label:field.rawLabel,rawValue:field.rawNumericToken,rawUnit:field.rawUnit},extracted:{nutrientId:canonicalNutrient,value:field.value,unit:field.unit},normalizedLabel:field.normalizedLabel,matchedAlias:field.matchedAlias,matchType:field.matchType,nutrientMatchConfidence:field.nutrientMatchConfidence,ocrConfidence:field.confidence,bbox:field.bbox,tableCells:field.rawCells})));
        setDiagnostics({engine:result.name,provider:result.debug?.provider,timings:result.debug?.timings,processingStatus:result.debug?.processingStatus,detectedTables:result.debug?.tableCount||0,tableCount:result.debug?.tableCount,rawRows:result.debug?.normalizedRows,rawText:doc?.pages?.map(page=>page.rawText).join('\n'),rawDocument:doc,rejectedCandidates:[],validationErrors:result.debug?.basisIssues||[],mappedRows,finalValues:result.parsed.columns.map(value=>({basis:value.label,values:value.nutrients}))});
      }else if(debugEnabled)setDiagnostics({selected:result.name,candidates:result.debug?.candidates?.map(({image,...candidate})=>candidate)||[]});
    }catch(err){if(run===job.current){
      const cancelled=/cancelled/i.test(err.message||'');
      const unavailable=mode==='cloud'&&!cancelled;
      session.current?.dispose();session.current=null;
      if(unavailable&&fileRef.current){
        setBasicMode(true);
        const reason=/429|limit|quota/i.test(err.message||'')?'Cloud OCR is temporarily limited.':/401|403|auth|key not configured/i.test(err.message||'')?'Cloud OCR could not authenticate.':'Cloud OCR could not complete this scan.';
        setFallbackMessage(`${reason} CBoard is trying the local scanner.`);
        if(import.meta.env.DEV)console.info('OCR.Space unavailable:',err.message||'request failed');
        notify.info('Cloud OCR unavailable. Trying the local scanner.');
        void scan(file,nextRotation,nextCrop,'basic');
      }else{
        setError(err.message||'Could not scan this label. Try a clearer image.');
        notify.error(err.message||'Could not scan nutrition label');
      }
    }}
    finally{if(run===job.current){setBusy(false);setProgress(null);}}
  }
  function upload(file){if(!file)return;try{validateOcrImage(file);}catch(err){setError(err.message);return;}setError('');setFallbackMessage('');setBasicMode(false);fileRef.current=file;if(urlRef.current)URL.revokeObjectURL(urlRef.current);urlRef.current=URL.createObjectURL(file);setPhoto(urlRef.current);setRotation(0);const full={left:0,top:0,right:100,bottom:100};setCrop(full);void scan(file,0,full,'cloud');}
  function tryBasicScan(){setBasicMode(true);void scan(fileRef.current,rotation,crop,'basic');}
  function pasteImage(event){
    if(busy||disabled)return;
    const items=Array.from(event.clipboardData?.items||[]);
    const item=items.find(value=>value.kind==='file'&&value.type.startsWith('image/'));
    const file=item?.getAsFile()||Array.from(event.clipboardData?.files||[]).find(value=>value.type.startsWith('image/'));
    if(!file)return;
    event.preventDefault();
    const image=file instanceof File?file:new File([file],`pasted-nutrition-label.${file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg'}`,{type:file.type});
    upload(image);
  }
  function update(patch){setColumns(previous=>previous.map(value=>value.id===active?{...value,...patch}:value));setError('');}
  function field(key,label,unit){const found=column.nutrients[key];return <div className="nscan-field" key={key}>
    <label className="nscan-check"><input type="checkbox" checked={column.selected.includes(key)} onChange={event=>update({selected:event.target.checked?[...column.selected,key]:column.selected.filter(value=>value!==key)})}/><span>{label} ({unit})</span></label>
    {current && <span className="nscan-current">Current: {display((converted||current)[key])}{!converted?' (existing basis)':''}</span>}
    <label><span className="nscan-sr">Scanned {label} ({unit})</span><input type="number" min="0" step="any" value={column.values[key]??''} placeholder="Unknown" onChange={event=>update({values:{...column.values,[key]:event.target.value===''?null:Number(event.target.value)},nutrients:{...column.nutrients,[key]:{...column.nutrients[key],uncertain:false,confidence:100,reasons:[]}},selected:[...new Set([...column.selected,key])]})}/></label>
    {found && (found.uncertain||found.confidence<70) && <small className="nscan-warning">{found.reasons?.length?[...new Set(found.reasons)].join(' '):'Low OCR confidence. Compare with the image.'}</small>}
    {found?.rawLabel&&found.rawLabel!==label&&<small className="nscan-source-label">Source label: {found.rawLabel} · matched as {label}</small>}
  </div>;}
  return <section className="nscan" aria-label="Nutrition import">
    {!open?<div className="nscan-launch-actions"><button type="button" disabled={disabled} onClick={()=>setOpen(true)}>Scan nutrition label</button><button type="button" disabled={disabled} onClick={()=>{setJsonMode('food_reference');setJsonOpen(true);}}>Import with ChatGPT</button></div>:<>
      <div className="nscan-actions"><strong id={`${id}-title`}>Scan nutrition label</strong><button type="button" onClick={discard}>Close scanner</button></div>
      <p>CBoard tries secure cloud OCR first and switches to the local scanner if needed. Cloud scan processes this temporary image with OCR.Space. Include the column headings and serving size. JPEG, PNG or WEBP, up to 15 MB. Review before applying; the image is not saved.</p>
      <div className="nscan-actions">
        <label>Upload nutrition label<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy||disabled} onChange={event=>{upload(event.target.files?.[0]);event.target.value='';}}/></label>
        <label>Take nutrition photo<input type="file" capture="environment" accept="image/jpeg,image/png,image/webp" disabled={busy||disabled} onChange={event=>{upload(event.target.files?.[0]);event.target.value='';}}/></label>
      </div>
      <div className="nscan-chatgpt-label"><button type="button" disabled={disabled} onClick={()=>{setJsonMode('nutrition_label');setJsonOpen(true);setImportMessage('');}}>Use ChatGPT to read this label</button><small>Attach this label image in ChatGPT, then return here. CBoard checks the clipboard for this pending label import.</small></div>
      <div className={`nscan-paste${busy||disabled?' is-disabled':''}`} tabIndex={busy||disabled?-1:0} role="group" aria-label="Paste nutrition label image" onPaste={pasteImage}>
        <strong>Paste nutrition label image</strong>
        <span>Click here, then paste an image with Ctrl+V or ⌘V</span>
      </div>
      {photo&&<>
        <button type="button" className="nscan-thumbnail" onClick={()=>setShowImage(true)} aria-label="Open nutrition label image full size">
          <img src={photo} alt=""/><span>View nutrition image</span>
        </button>
        <dialog ref={imageDialog} className="nscan-image-dialog" aria-label="Nutrition label image" onClose={()=>setShowImage(false)} onClick={event=>{if(event.target===event.currentTarget)setShowImage(false);}}>
          <div className="nscan-image-dialog__content">
            <button type="button" className="nscan-image-dialog__close" onClick={()=>setShowImage(false)}>Close image</button>
            <img src={photo} alt="Full-size nutrition label image"/>
          </div>
        </dialog>
        <details><summary>Crop and rotation tools</summary>
        <p>Crop bounds are percentages of the original image. Keep every heading for the columns you want to read.</p>
        <div className="nscan-grid">{['left','top','right','bottom'].map(edge=><label key={edge}>Crop {edge} (%)<input type="number" min="0" max="100" disabled={busy} value={crop[edge]} onChange={event=>setCrop({...crop,[edge]:Number(event.target.value)})}/></label>)}
        <label>Scan rotation<select value={rotation} disabled={busy} onChange={event=>setRotation(Number(event.target.value))}>{[0,90,180,270].map(value=><option key={value} value={value}>{value}°</option>)}</select></label></div>
        <button type="button" disabled={busy||disabled} onClick={()=>{setBasicMode(false);void scan(fileRef.current,rotation,crop,'cloud');}}>Rescan label</button>
        </details>
      </>}
      {busy&&<div role="status"><p>{progress?.status}{progress?.pass?` · pass ${progress.pass}`:''}</p><progress max="1" value={progress?.progress||0}/><button type="button" onClick={stop}>Cancel scan</button></div>}
      {fallbackMessage&&<p role="status" className="nscan-warning">{fallbackMessage}</p>}
      {error&&<p role="alert" className="nscan-warning">{error}</p>}
      {error&&!basicMode&&<div className="nscan-actions"><button type="button" disabled={busy||disabled||!fileRef.current} onClick={tryBasicScan}>Try basic scan</button><button type="button" disabled={busy} onClick={discard}>Close scanner and enter manually</button></div>}
      {warnings.map(message=><p className="nscan-warning" key={message}>{message}</p>)}
      {column&&!busy&&<div>
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
        <button type="button" disabled={disabled||!column.confirmed||!column.selected.length} onClick={()=>{try{onApply(applyNutritionReview(current,column,column.selected,{clearIncompatible,ocrProvider:ocrSource.provider,ocrModel:ocrSource.model}));discard();}catch(err){setError(err.message);}}}>Apply nutrition</button>
        <details><summary>Extracted text (temporary)</summary><pre>{raw}</pre></details>
        {debugEnabled&&diagnostics&&<details><summary>Development OCR diagnostics</summary><pre>{JSON.stringify(diagnostics,null,2)}</pre></details>}
      </div>}
    </>}
    <dialog ref={jsonDialog} className="njson-dialog" aria-labelledby={`${id}-json-title`} onClose={()=>setJsonOpen(false)} onClick={event=>{if(event.target===event.currentTarget)setJsonOpen(false);}}>
      <div className="njson-dialog__body">
        <header className="njson-header"><div><span className="njson-eyebrow">Nutrition import</span><h2 id={`${id}-json-title`}>Import with ChatGPT</h2></div><button type="button" onClick={()=>setJsonOpen(false)}>Close</button></header>
        <p>Copy the prompt, ask ChatGPT, then return here. Imported values fill this draft; save the food separately.</p>
        {jsonMode==='nutrition_label'?<section className="njson-guide" aria-label="ChatGPT label extraction">
          <strong>Read the label image</strong><p>Use the image uploaded in Scan nutrition label. Attach it to ChatGPT, then paste or copy its returned CBoard JSON below.</p>
          <button type="button" disabled={disabled} onClick={()=>openChatGPTWithPrompt('nutrition_label')}>Copy label prompt &amp; open ChatGPT</button>
          {promptText&&<details className="njson-prompt-copy"><summary>Show prompt for manual copying</summary><textarea readOnly rows={8} value={promptText}/></details>}
          {importMessage&&<p role="status" className="nscan-warning">{importMessage}</p>}
          {pendingImport&&clipboardFallback&&<div className="njson-actions" role="group" aria-label="Clipboard import fallback"><button type="button" disabled={clipboardReading} onClick={()=>void readPendingClipboard()}>{clipboardReading?'Reading clipboard?':'Paste from clipboard'}</button><button type="button" onClick={()=>jsonTextarea.current?.focus()}>Paste manually</button><button type="button" onClick={cancelPendingImport}>Cancel lookup</button></div>}
          {pendingImport&&!clipboardFallback&&<button type="button" onClick={cancelPendingImport}>Cancel lookup</button>}
          <details><summary>How this works</summary><p>The prompt only reads displayed label values. Unknown nutrients stay null. On return, CBoard checks the clipboard only for this pending label import.</p></details>
        </section>:<section className="njson-guide" aria-label="Nutrition lookup details">
          <label className="njson-name-label">Food / preparation{lookupIsControlled&&<small>Uses the food name above and updates that same item.</small>}<input value={lookupFood} maxLength={160} placeholder="e.g. raw uncooked chickpeas" onChange={event=>changeLookupFood(event.target.value)} onBlur={()=>changeLookupFood(String(lookupFood||'').trim())}/></label>
          <div className="njson-basis-grid njson-basis-compact"><label>Nutrition basis amount<input type="number" min="0.0001" step="any" value={lookupAmount} onChange={event=>{setLookupAmountDraft(event.target.value);setJsonCopied('');setPromptText('');}}/></label><label>Unit<select value={lookupUnit} onChange={event=>{setLookupUnitDraft(event.target.value);setJsonCopied('');setPromptText('');}}>{NUTRITION_BASIS_UNITS.map(unit=><option key={unit}>{unit}</option>)}</select></label></div>
          <button type="button" disabled={disabled||!String(lookupFood||'').trim()||!(Number(lookupAmount)>0)} onClick={()=>openChatGPTWithPrompt()}>Copy prompt &amp; open ChatGPT</button>
          {jsonCopied==='food_reference'&&<span role="status">Prompt copied</span>}
          {promptText&&<details className="njson-prompt-copy"><summary>Show prompt for manual copying</summary><textarea readOnly rows={8} value={promptText}/></details>}
          {importMessage&&<p role="status" className="nscan-warning">{importMessage}</p>}
          {pendingImport&&clipboardFallback&&<div className="njson-actions" role="group" aria-label="Clipboard import fallback"><button type="button" disabled={clipboardReading} onClick={()=>void readPendingClipboard()}>{clipboardReading?'Reading clipboard?':'Paste from clipboard'}</button><button type="button" onClick={()=>jsonTextarea.current?.focus()}>Paste manually</button><button type="button" onClick={cancelPendingImport}>Cancel lookup</button></div>}
          {pendingImport&&!clipboardFallback&&<button type="button" onClick={cancelPendingImport}>Cancel lookup</button>}
          <details><summary>How this works</summary><p>CBoard copies a schema-based prompt and opens ChatGPT. When you return, it checks the clipboard only for this pending import. If clipboard access is blocked, use Paste from clipboard or paste the JSON below.</p></details>
        </section>}
        <label className="njson-paste-label">Paste returned nutrition JSON<textarea ref={jsonTextarea} value={jsonText} rows={5} spellCheck="false" autoCapitalize="off" autoCorrect="off" aria-invalid={!!jsonError} aria-describedby={jsonError?`${id}-json-error`:undefined} placeholder="Paste JSON or one JSON code block" onChange={event=>{setJsonText(event.target.value);setJsonPreview(null);setJsonConflict(false);setJsonFoodMismatch(null);setJsonError('');}} /></label>
        {jsonError&&<p id={`${id}-json-error`} aria-live="polite" className="nscan-warning">{jsonError}</p>}
        <div className="njson-actions"><button type="button" disabled={!jsonText.trim()} onClick={previewNutritionJson}>Validate JSON</button></div>
        {jsonPreview&&<section className="njson-preview" aria-label="Nutrition JSON preview">
          {jsonFoodMismatch&&<div className="njson-conflict" role="alert"><strong>This JSON may describe a different food or basis.</strong><p>JSON describes {jsonFoodMismatch.found}; you requested {jsonFoodMismatch.requested}.</p><div className="njson-actions"><button type="button" onClick={()=>setJsonFoodMismatch(null)}>Review JSON anyway</button><button type="button" onClick={cancelFoodMismatch}>Cancel</button></div></div>}
          <h3>{jsonPreview.food.name}{jsonPreview.food.state?`  ? ${jsonPreview.food.state}`:''}</h3><p>Basis: {jsonPreview.quantity} {jsonPreview.unit} ? Source: {jsonPreview.source.name} ({jsonPreview.source.sourceType==='nutrition_label'?'label extraction':'food reference'})</p>
          {jsonFieldGroups.map(([group,title])=>{const fields=nutritionFieldDefinitions.filter(field=>field.group===group&&jsonPreview.nutrition[field.key]!==null);return fields.length?<div className="njson-preview-group" key={group}><strong>{title}</strong><div>{fields.map(field=><span key={field.key}>{field.label}<b>{display(jsonPreview.nutrition[field.key])} {field.unit}</b></span>)}</div></div>:null;})}
          <small>{nutritionFieldDefinitions.filter(field=>jsonPreview.nutrition[field.key]===null).length} nutrients unavailable or not provided. They remain unknown.</small>
          {!jsonConflict?<button type="button" disabled={!!jsonFoodMismatch} onClick={()=>hasCurrentNutrition?setJsonConflict(true):applyJsonImport('replace')}>{hasCurrentNutrition?'Choose how to apply':'Apply nutrition to draft'}</button>:<div className="njson-conflict" role="group" aria-label="Choose how to apply imported nutrition"><strong>Existing nutrition found</strong><p>Replace clears values the JSON leaves null. Fill missing only keeps every existing number, including zero. Cancel returns to the preview.</p><div className="njson-actions"><button type="button" onClick={()=>applyJsonImport('replace')}>Replace nutrition</button><button type="button" disabled={!fillMissingAllowed} onClick={()=>applyJsonImport('fill-missing')}>Fill missing only</button><button type="button" onClick={()=>setJsonConflict(false)}>Cancel</button></div>{!fillMissingAllowed&&<small>Existing values use a different basis, so they cannot be safely merged. Replace or cancel.</small>}</div>}
        </section>}
      </div>
    </dialog>
  </section>;
}
