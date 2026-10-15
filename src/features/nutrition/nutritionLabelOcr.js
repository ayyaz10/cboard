import { createImageOcrSession, prepareOcrImage } from '../../services/ocr/imageOcr.js';
import { parseNutritionLabel, scoreNutritionCandidate, nutritionBasisConsistency, nutritionConsistency } from './nutritionLabelParser.js';
import { nutritionCandidatesAgree, finalizeNutritionCandidates } from './nutritionCandidateSelection.js';
import { paddleDocumentToNutritionInput } from './nutritionOcrDocument.js';
import { supabase } from '../../lib/supabaseClient.js';

const ADVANCED_TIMEOUT_MS=15*60*1000;
export function nutritionOcrServiceUrl(){
  return (import.meta.env.VITE_NUTRITION_OCR_URL||(import.meta.env.DEV?'http://localhost:8765/api/nutrition-ocr':'')).trim();
}

function createPaddleSession(onProgress=()=>{}) {
  let controller=null,disposed=false;
  return {
    mode:'advanced',
    async scan(file,rotation,{crop,debug=false}={}){
      const url=nutritionOcrServiceUrl();
      if(!url)throw new Error('Advanced nutrition scanner is unavailable. Try basic scan or enter values manually.');
      if(disposed)throw new Error('Scan cancelled.');
      const canvas=await prepareOcrImage(file,rotation,crop);
      if(disposed)throw new Error('Scan cancelled.');
      const image=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not prepare the image for scanning.')),'image/png'));
      controller=new AbortController();
      const timeout=setTimeout(()=>controller?.abort(new Error('Advanced nutrition scan timed out. Try basic scan or enter values manually.')),ADVANCED_TIMEOUT_MS);
      const form=new FormData();form.append('image',image,'nutrition-label.png');
      onProgress({status:'Sending image to nutrition scanner',progress:.08});
      try{
        const headers={};
        if(supabase){
          const {data,error}=await supabase.auth.getSession();
          if(error)throw new Error('Could not read your CBoard session. Sign in again and retry.');
          if(data.session?.access_token)headers.Authorization=`Bearer ${data.session.access_token}`;
        }
        const response=await fetch(url,{method:'POST',body:form,headers,signal:controller.signal});
        const body=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(response.status===503?'Advanced nutrition scanner is unavailable. Try basic scan or enter values manually.':body.detail||'Advanced nutrition scan failed. Try basic scan or enter values manually.');
        if(disposed)throw new Error('Scan cancelled.');
        onProgress({status:'Reading table and nutrition columns',progress:.78});
        const normalized=paddleDocumentToNutritionInput(body);
        const parsed=parseNutritionLabel({text:normalized.text,lines:normalized.lines});
        if(!parsed.columns.length)throw new Error('The advanced scanner could not map the table values. Crop the full table and rescan, try basic scan, or enter values manually.');
        for(const column of parsed.columns)for(const issue of nutritionConsistency(column)){
          const field=column.nutrients[issue.field];
          if(field){field.uncertain=true;field.confidence=Math.min(field.confidence??55,55);field.reasons=[...new Set([...(field.reasons||[]),issue.message])];}
          parsed.warnings.push(issue.message);
        }
        const basisIssues=nutritionBasisConsistency(parsed.columns);
        parsed.warnings.push(...basisIssues.map(issue=>issue.message));
        onProgress({status:'Checking detected values',progress:1});
        return {parsed,confidence:null,name:'PaddleOCR-VL 1.6',provider:'paddleocr-vl',...(debug?{debug:{provider:body.provider,tableCount:normalized.tableCount,rawDocument:normalized.document,rawTable:normalized.rawText,normalizedRows:normalized.lines,basisIssues}}:{})};
      }catch(error){
        if(error.name==='AbortError'||controller?.signal.aborted)throw new Error(disposed?'Scan cancelled.':error.message||'Advanced nutrition scan timed out. Try basic scan or enter values manually.');
        if(error instanceof TypeError)throw new Error('Advanced nutrition scanner is unavailable. Try basic scan or enter values manually.');
        throw error;
      }finally{clearTimeout(timeout);controller=null;canvas.width=canvas.height=0;}
    },
    dispose(){disposed=true;controller?.abort(new Error('Scan cancelled.'));controller=null;},
  };
}

export function createNutritionOcrSession(onProgress,mode='advanced') {
  if(mode==='basic')return {...createImageOcrSession({
    layout:'nutrition', languages:'eng+spa+por', parse:parseNutritionLabel, score:scoreNutritionCandidate,
    shouldStop:nutritionCandidatesAgree,
    finalize:finalizeNutritionCandidates,
  },onProgress),mode:'basic'};
  return createPaddleSession(onProgress);
}
