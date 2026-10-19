const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
const MIME_TYPES=new Set(["image/jpeg","image/png","image/webp"]);

export function normalizeOcrSpaceResponse(payload,engine){
  const parsed=Array.isArray(payload?.ParsedResults)?payload.ParsedResults:[];
  const pages=parsed.filter(result=>Number(result?.FileParseExitCode)===1&&typeof result?.ParsedText==="string"&&result.ParsedText.trim()).map(result=>{
    const rawText=result.ParsedText;
    const overlay=result.TextOverlay?.Lines;
    const lines=Array.isArray(overlay)&&overlay.length?overlay.map(line=>{
      const words=(Array.isArray(line.Words)?line.Words:[]).map(word=>{
        const left=Number(word.Left),top=Number(word.Top),width=Number(word.Width),height=Number(word.Height);
        if(!word.WordText||![left,top,width,height].every(Number.isFinite))return null;
        return {text:String(word.WordText),bbox:{x0:left,y0:top,x1:left+width,y1:top+height}};
      }).filter(Boolean);
      const bbox=words.length?{x0:Math.min(...words.map(word=>word.bbox.x0)),y0:Math.min(...words.map(word=>word.bbox.y0)),x1:Math.max(...words.map(word=>word.bbox.x1)),y1:Math.max(...words.map(word=>word.bbox.y1))}:null;
      return {text:String(line.LineText||words.map(word=>word.text).join(" ")).trim(),words,bbox,confidence:null};
    }).filter(line=>line.text):rawText.split(/\r?\n/).filter(line=>line.trim()).map(text=>({text:text.trim(),words:[],bbox:null,confidence:null}));
    return {rawText,lines,words:lines.flatMap(line=>line.words),boxes:lines.map(line=>line.bbox).filter(Boolean),tableData:null};
  });
  const exit=Number(payload?.OCRExitCode);
  if(payload?.IsErroredOnProcessing===true||![1,2].includes(exit)||!pages.length){
    const details=[payload?.ErrorMessage,payload?.ErrorDetails,...parsed.map(result=>result?.ErrorMessage||result?.ErrorDetails)].filter(value=>typeof value==="string").join(" ");
    const code=/quota|rate.?limit|too many requests|maximum.*request/i.test(details)?"quota":/api.?key|unauthori[sz]ed|invalid key/i.test(details)?"auth":"processing";
    throw Object.assign(new Error(code==="quota"?"OCR.Space rate limit reached.":code==="auth"?"OCR.Space authentication failed.":"OCR.Space could not read this image."),{code});
  }
  return {provider:"ocr-space",engine:String(engine),pages,processingStatus:exit===2?"partial":"success",processingTimeMs:Number(payload.ProcessingTimeInMilliseconds)||null};
}

export function createNutritionOcrHandler({createClient,env,fetchImpl,now=Date.now}){
  const requests=new Map();
  return async request=>{
    if(request.method==="OPTIONS")return new Response("ok",{headers:cors});
    if(request.method!=="POST")return json({error:"Method not allowed",code:"method"},405);
    try{
      const token=request.headers.get("Authorization")?.replace(/^Bearer\s+/i,"");
      if(!token)return json({error:"Sign in to use cloud OCR.",code:"auth"},401);
      const db=createClient(env("SUPABASE_URL"),env("SUPABASE_ANON_KEY"),{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
      const {data,error}=await db.auth.getUser(token);
      if(error||!data?.user)return json({error:"Sign in again to use cloud OCR.",code:"auth"},401);
      const contentLength=Number(request.headers.get("content-length")||0);
      if(contentLength>1_050_000)return json({error:"Prepared image is too large for cloud OCR. Use local scan or crop the label.",code:"size"},413);
      let incoming;try{incoming=await request.formData();}catch{return json({error:"Invalid image request.",code:"input"},400);}
      const image=incoming.get("image");
      if(!(image instanceof File)||!MIME_TYPES.has(image.type)||!image.size)return json({error:"Upload a valid JPG, PNG or WEBP label image.",code:"input"},400);
      if(image.size>950_000)return json({error:"Prepared image is too large for cloud OCR. Use local scan or crop the label.",code:"size"},413);
      const key=env("OCR_SPACE_API_KEY");
      if(!key)return json({error:"OCR.Space unavailable: API key not configured.",code:"configuration"},503);
      const history=(requests.get(data.user.id)||[]).filter(at=>now()-at<60_000);
      if(history.length>=6)return json({error:"Cloud OCR rate limit reached.",code:"quota"},429);
      history.push(now());requests.set(data.user.id,history);
      const configuredEngine=String(env("OCR_SPACE_ENGINE")||"3");
      const engine=["2","3"].includes(configuredEngine)?configuredEngine:"3";
      const scale=String(env("OCR_SPACE_SCALE")||"false").toLowerCase()==="true";
      const upstreamForm=new FormData();
      upstreamForm.append("file",image,"nutrition-label.jpg");
      upstreamForm.append("OCREngine",engine);
      upstreamForm.append("isTable","true");
      upstreamForm.append("isOverlayRequired","true");
      upstreamForm.append("detectOrientation","true");
      upstreamForm.append("language","auto");
      upstreamForm.append("scale",String(scale));
      const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),25_000);
      try{
        const providerStarted=now();
        const response=await fetchImpl("https://api.ocr.space/parse/image",{method:"POST",headers:{apikey:key},body:upstreamForm,signal:controller.signal});
        if(response.status===429)return json({error:"OCR.Space rate limit reached.",code:"quota"},429);
        if(response.status===401||response.status===403)return json({error:"OCR.Space authentication failed. Check the server key.",code:"auth"},502);
        if(!response.ok)return json({error:"OCR.Space is temporarily unavailable.",code:"provider"},503);
        const payload=await response.json().catch(()=>null);
        let document;try{document=normalizeOcrSpaceResponse(payload,engine);}catch(error){return json({error:error.message,code:error.code||"processing"},error.code==="quota"?429:error.code==="auth"?502:422);}
        return json({document,timings:{providerMs:Math.max(0,now()-providerStarted)}});
      }finally{clearTimeout(timeout);}
    }catch(error){
      if(error?.name==="AbortError")return json({error:"Cloud OCR timed out.",code:"timeout"},504);
      return json({error:"OCR.Space is temporarily unavailable.",code:"network"},503);
    }
  };
}
