import test from 'node:test';
import assert from 'node:assert/strict';
import { createNutritionOcrHandler, normalizeOcrSpaceResponse } from './handler.js';

const png=new Blob([new Uint8Array(1200)],{type:'image/png'});
const request=(token='valid',file=png)=>{const form=new FormData();form.append('image',file,'nutrition-label.png');return new Request('https://supabase.test/functions/v1/nutrition-ocr',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:form});};
const providerPayload=(code=1)=>({OCRExitCode:code,IsErroredOnProcessing:false,ProcessingTimeInMilliseconds:'47',ParsedResults:[{FileParseExitCode:1,ParsedText:'Per 100g\nProtein 12.56 g',TextOverlay:{Lines:[{LineText:'Protein 12.56 g',MinTop:20,MaxHeight:15,Words:[{WordText:'Protein',Left:10,Top:20,Width:50,Height:15},{WordText:'12.56',Left:90,Top:20,Width:30,Height:15},{WordText:'g',Left:125,Top:20,Width:10,Height:15}]}]}}]});
const setup=({key='server-key',status=200,payload=providerPayload(),engine='2'}={})=>{
  let sent;
  const handler=createNutritionOcrHandler({
    createClient:()=>({auth:{getUser:async token=>({data:{user:token==='valid'?{id:'user-a'}:null},error:token==='valid'?null:new Error('invalid')})}}),
    env:name=>({OCR_SPACE_API_KEY:key,OCR_SPACE_ENGINE:engine,SUPABASE_URL:'https://supabase.test',SUPABASE_ANON_KEY:'anon'}[name]),
    fetchImpl:async(url,options)=>{sent={url,headers:options.headers,form:options.body};return new Response(JSON.stringify(payload),{status});},
  });
  return {handler,getSent:()=>sent};
};

test('normalizes OCR.Space status, lines, word boxes and geometry',()=>{
  const normalized=normalizeOcrSpaceResponse(providerPayload(),2);
  assert.equal(normalized.provider,'ocr-space');assert.equal(normalized.engine,'2');assert.equal(normalized.processingStatus,'success');
  assert.equal(normalized.pages[0].lines[0].words[1].bbox.x1,120);
  assert.equal(normalized.pages[0].lines[0].bbox.y0,20);
  assert.equal(normalized.pages[0].rawText,'Per 100g\nProtein 12.56 g');
});

test('rejects provider-declared processing failures even when HTTP succeeded',()=>{
  assert.throws(()=>normalizeOcrSpaceResponse({OCRExitCode:3,IsErroredOnProcessing:true,ErrorMessage:'No readable text'},2),/could not read/);
  assert.throws(()=>normalizeOcrSpaceResponse({OCRExitCode:4,IsErroredOnProcessing:true,ErrorMessage:'Quota limit exceeded'},2),/rate limit/);
});

test('requires authenticated user and configured secret; never calls provider on rejection',async()=>{
  const missing=setup({key:''});assert.equal((await missing.handler(request())).status,503);assert.equal(missing.getSent(),undefined);
  const unauthorized=setup();assert.equal((await unauthorized.handler(request('invalid'))).status,401);assert.equal(unauthorized.getSent(),undefined);
});

test('uses POST multipart, server-side key header, selected engine, table, auto language and overlay',async()=>{
  const {handler,getSent}=setup({engine:'3'});const response=await handler(request());const body=await response.json();const sent=getSent();
  assert.equal(response.status,200);assert.equal(sent.url,'https://api.ocr.space/parse/image');
  assert.equal(sent.headers.apikey,'server-key');assert.equal(sent.form.get('OCREngine'),'3');assert.equal(sent.form.get('isTable'),'true');
  assert.equal(sent.form.get('language'),'auto');assert.equal(sent.form.get('isOverlayRequired'),'true');assert.equal(sent.form.get('detectOrientation'),'true');
  assert.equal(body.document.provider,'ocr-space');assert.equal(JSON.stringify(body).includes('server-key'),false);
});

test('normalizes HTTP key errors and rate limits for automatic fallback',async()=>{
  assert.equal((await setup({status:403}).handler(request())).status,502);
  assert.equal((await setup({status:429}).handler(request())).status,429);
});
