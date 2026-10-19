import { createImageOcrSession, prepareOcrImage } from '../../services/ocr/imageOcr.js';
import { parseNutritionLabel, scoreNutritionCandidate, nutritionBasisConsistency, nutritionConsistency } from './nutritionLabelParser.js';
import { nutritionCandidatesAgree, finalizeNutritionCandidates } from './nutritionCandidateSelection.js';
import { ocrSpaceDocumentToNutritionInput } from './nutritionOcrDocument.js';
import { supabase } from '../../lib/supabaseClient.js';
import { createOcrProvider } from '../../services/ocr/ocrProvider.js';

const CLOUD_TIMEOUT_MS=35*1000;
export function nutritionOcrServiceUrl(){
  const root=(import.meta.env.VITE_SUPABASE_URL||'').replace(/\/$/,'');
  return root?`${root}/functions/v1/nutrition-ocr`:'';
}

function createOcrSpaceSession(onProgress=()=>{}) {
  let controller=null,disposed=false;
  return {
    mode:'cloud',
    async scan(file,rotation,{crop,debug=false}={}){
      const scanStarted=performance.now();
      const url=nutritionOcrServiceUrl();
      if(!url)throw new Error('OCR.Space unavailable: Supabase is not configured.');
      if(typeof navigator!=='undefined'&&navigator.onLine===false)throw new Error('Offline; switching to the local scanner.');
      if(disposed)throw new Error('Scan cancelled.');
      const canvas=await prepareOcrImage(file,rotation,crop);
      const imagePreparedMs=Math.round(performance.now()-scanStarted);
      if(disposed)throw new Error('Scan cancelled.');
      const image=await prepareOcrSpaceImage(canvas);
      controller=new AbortController();
      const timeout=setTimeout(()=>controller?.abort(new Error('Cloud OCR timed out.')),CLOUD_TIMEOUT_MS);
      const form=new FormData();form.append('image',image,'nutrition-label.jpg');
      onProgress({status:'Reading nutrition label',progress:.08});
      try{
        const headers={};
        if(supabase){
          const {data,error}=await supabase.auth.getSession();
          if(error)throw new Error('Could not read your CBoard session. Sign in again and retry.');
          if(data.session?.access_token)headers.Authorization=`Bearer ${data.session.access_token}`;
        }
        if(!headers.Authorization)throw new Error('Sign in to use cloud OCR.');
        const requestStarted=performance.now();
        const response=await fetch(url,{method:'POST',body:form,headers,signal:controller.signal});
        const networkMs=Math.round(performance.now()-requestStarted);
        const body=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(body.error||'OCR.Space request failed.');
        if(disposed)throw new Error('Scan cancelled.');
        onProgress({status:'Understanding nutrition values',progress:.78});
        const normalizeStarted=performance.now();
        const normalized=ocrSpaceDocumentToNutritionInput(body.document||body);
        const parsed=parseNutritionLabel({text:normalized.text,lines:normalized.lines});
        const parserMs=Math.round(performance.now()-normalizeStarted);
        if(!parsed.columns.length)throw new Error('The cloud scanner could not map the table values. Crop the full table and rescan, try local scan, or enter values manually.');
        for(const column of parsed.columns)for(const issue of nutritionConsistency(column)){
          const field=column.nutrients[issue.field];
          if(field){field.uncertain=true;field.confidence=Math.min(field.confidence??55,55);field.reasons=[...new Set([...(field.reasons||[]),issue.message])];}
          parsed.warnings.push(issue.message);
        }
        const basisIssues=nutritionBasisConsistency(parsed.columns);
        parsed.warnings.push(...basisIssues.map(issue=>issue.message));
        onProgress({status:'Checking detected values',progress:1});
        return {parsed,confidence:null,name:`OCR.Space Engine ${body.document?.engine||'2'}`,provider:'ocr-space',...(debug?{debug:{provider:'ocr-space',engine:body.document?.engine||'2',tableCount:normalized.tableCount,rawDocument:normalized.document,rawTable:normalized.rawText,normalizedRows:normalized.lines,basisIssues,timings:{imagePreparedMs,networkMs,providerMs:body.timings?.providerMs??null,parserMs},processingStatus:body.document?.processingStatus}}:{})};
      }catch(error){
        if(error.name==='AbortError'||controller?.signal.aborted)throw new Error(disposed?'Scan cancelled.':error.message||'Cloud OCR timed out.');
        if(error instanceof TypeError)throw new Error('OCR.Space service is unavailable.');
        throw error;
      }finally{clearTimeout(timeout);controller=null;canvas.width=canvas.height=0;}
    },
    dispose(){disposed=true;controller?.abort(new Error('Scan cancelled.'));controller=null;},
  };
}

async function prepareOcrSpaceImage(canvas){
  let width=canvas.width,height=canvas.height,quality=.88;
  for(let attempt=0;attempt<5;attempt++){
    const output=document.createElement('canvas');output.width=width;output.height=height;
    output.getContext('2d').drawImage(canvas,0,0,width,height);
    const blob=await new Promise((resolve,reject)=>output.toBlob(value=>value?resolve(value):reject(new Error('Could not prepare the image for cloud scanning.')),'image/jpeg',quality));
    output.width=output.height=0;
    if(blob.size<=900_000){canvas.width=canvas.height=0;return blob;}
    width=Math.max(1,Math.round(width*.78));height=Math.max(1,Math.round(height*.78));quality=Math.max(.62,quality-.06);
  }
  canvas.width=canvas.height=0;
  throw new Error('This image is too large for the cloud scanner. Try local scan or crop the label.');
}

export function createNutritionOcrSession(onProgress,mode='cloud') {
  const session=mode==='basic'?createImageOcrSession({
    layout:'nutrition', languages:'eng+spa+por', parse:parseNutritionLabel, score:scoreNutritionCandidate,
    shouldStop:nutritionCandidatesAgree,
    finalize:finalizeNutritionCandidates,
  },onProgress):createOcrSpaceSession(onProgress);
  const provider=createOcrProvider({
    name:mode==='basic'?'local-tesseract':'ocr-space',
    capabilities:{imageInput:true,tableExtraction:mode!=='basic',wordBoxes:mode!=='basic',confidence:false,offline:mode==='basic'},
    available:()=>mode==='basic'||Boolean(nutritionOcrServiceUrl()&&supabase),
    recognizeImage:(file,options={})=>session.scan(file,options.rotation||0,options),
    dispose:()=>session.dispose(),
  });
  // Keep the existing scanner call shape while all engines share the provider contract.
  return {...provider,mode,scan:(file,rotation,options={})=>provider.recognizeImage(file,{...options,rotation})};
}
