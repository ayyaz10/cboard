import { createImageOcrSession, prepareOcrImage } from '../../services/ocr/imageOcr.js';
import { createOcrProvider } from '../../services/ocr/ocrProvider.js';
import { supabase } from '../../lib/supabaseClient.js';
import { scoreReceiptCandidate } from './receiptLayout.js';
import { parseReceipt } from './receiptParser.js';
import { parseOcrSpaceReceipt } from './receiptOcrDocument.js';
export { validateOcrImage as validateReceiptImage, prepareOcrImage as prepareReceiptImage } from '../../services/ocr/imageOcr.js';

export function createReceiptOcrSession(onProgress) {
  const session=createImageOcrSession({
    layout: 'receipt', parse: parseReceipt, score: scoreReceiptCandidate,
    shouldStop(results) {
      const latest=results.at(-1), {parsed,confidence}=latest;
      const corroborated=results.slice(0,-1).some(other=>other.parsed.total===parsed.total&&other.parsed.date===parsed.date&&other.parsed.merchantName===parsed.merchantName);
      return latest.complete&&(!parsed.itemCount||latest.countMatches)&&((parsed.items.every(item=>item.confidence.name>=75&&item.confidence.lineTotal>=75)&&confidence>=80)||(corroborated&&confidence>=70));
    },
    finalize(best,results) {
      for(const item of best.parsed.items) {
        const other=results.slice(1).flatMap(result=>result.parsed.items).filter(candidate=>item.retailerProductCode?candidate.retailerProductCode===item.retailerProductCode:candidate.normalizedName===item.normalizedName);
        if(other.some(candidate=>candidate.lineTotal!==item.lineTotal))item.confidence.lineTotal=Math.min(55,item.confidence.lineTotal);
      }
    },
  },onProgress);
  return createProviderSession(session,'local-tesseract','local');
}

const CLIENT_TIMEOUT_MS=35_000;
const MAX_CLOUD_IMAGE_BYTES=900_000;

function receiptOcrServiceUrl(){
  const root=(import.meta.env.VITE_SUPABASE_URL||'').replace(/\/$/,'');
  return root?`${root}/functions/v1/receipt-ocr`:'';
}

function createProviderSession(session,name,mode){
  const provider=createOcrProvider({
    name,
    capabilities:{imageInput:true,wordBoxes:mode==='cloud',offline:mode==='local'},
    available:()=>mode==='local'||Boolean(receiptOcrServiceUrl()&&supabase),
    recognizeImage:(file,options={})=>session.scan(file,options.rotation||0,options),
    dispose:()=>session.dispose(),
  });
  return {...provider,mode,scan:(file,rotation,options={})=>provider.recognizeImage(file,{...options,rotation})};
}

async function compressReceiptImage(canvas){
  let width=canvas.width,height=canvas.height,quality=.88;
  for(let attempt=0;attempt<5;attempt++){
    const output=document.createElement('canvas');output.width=width;output.height=height;
    const context=output.getContext('2d');
    if(!context){output.width=output.height=0;break;}
    context.drawImage(canvas,0,0,width,height);
    const blob=await new Promise((resolve,reject)=>output.toBlob(value=>value?resolve(value):reject(new Error('Could not prepare the receipt image for cloud scanning.')),'image/jpeg',quality));
    output.width=output.height=0;
    if(blob.size<=MAX_CLOUD_IMAGE_BYTES)return blob;
    width=Math.max(1,Math.round(width*.78));height=Math.max(1,Math.round(height*.78));quality=Math.max(.62,quality-.06);
  }
  throw new Error('This image is too large for cloud scanning. Crop it or use local OCR.');
}

function createOcrSpaceReceiptSession(onProgress=()=>{}){
  let controller=null,disposed=false;
  return {
    async scan(file,rotation,{debug=false,crop}={}){
      const url=receiptOcrServiceUrl();
      if(!url)throw new Error('OCR.Space receipt scanning is not configured.');
      if(typeof navigator!=='undefined'&&navigator.onLine===false)throw new Error('Offline; switching to the local receipt scanner.');
      if(disposed)throw new Error('Scan cancelled.');
      let canvas;
      try{
        canvas=await prepareOcrImage(file,rotation,crop);
        if(disposed)throw new Error('Scan cancelled.');
        const image=await compressReceiptImage(canvas);
        if(disposed)throw new Error('Scan cancelled.');
        controller=new AbortController();
        const timeout=setTimeout(()=>controller?.abort(new Error('Cloud receipt scan timed out.')),CLIENT_TIMEOUT_MS);
        try{
          const headers={apikey:import.meta.env.VITE_SUPABASE_ANON_KEY};
          if(supabase){
            const {data,error}=await supabase.auth.getSession();
            if(error)throw new Error('Could not read your CBoard session. Sign in again and retry.');
            if(data.session?.access_token)headers.Authorization=`Bearer ${data.session.access_token}`;
          }
          if(!headers.Authorization)throw new Error('Sign in to scan receipts with OCR.Space.');
          const form=new FormData();form.append('image',image,'receipt.jpg');
          onProgress({status:'Sending receipt to OCR.Space',progress:.12});
          const response=await fetch(url,{method:'POST',headers,body:form,signal:controller.signal});
          const body=await response.json().catch(()=>({}));
          if(!response.ok)throw new Error(body.error||'OCR.Space could not scan this receipt.');
          if(disposed)throw new Error('Scan cancelled.');
          onProgress({status:'Reading receipt items',progress:.78});
          const result=parseOcrSpaceReceipt(body.document||body);
          const {parsed}=result;
          if(!parsed.items.length&&parsed.total==null)throw new Error('OCR.Space could not find receipt items or a total.');
          onProgress({status:'Receipt scan complete',progress:1});
          return {...result,parsed,confidence:null,name:`OCR.Space Engine ${body.document?.engine||'3'}`,provider:'ocr-space',...(debug?{debug:{provider:'ocr-space',engine:body.document?.engine||'3',timings:body.timings||null,processingStatus:body.document?.processingStatus||'unknown'}}:{})};
        }catch(error){
          if(error.name==='AbortError'||controller?.signal.aborted)throw new Error(disposed?'Scan cancelled.':error.message||'Cloud receipt scan timed out.');
          if(error instanceof TypeError)throw new Error('OCR.Space service is unavailable.');
          throw error;
        }finally{clearTimeout(timeout);controller=null;}
      }finally{if(canvas){canvas.width=0;canvas.height=0;}}
    },
    dispose(){disposed=true;controller?.abort(new Error('Scan cancelled.'));controller=null;},
  };
}

export function createCloudReceiptOcrSession(onProgress){
  return createProviderSession(createOcrSpaceReceiptSession(onProgress),'ocr-space','cloud');
}
