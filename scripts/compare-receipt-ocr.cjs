// Local development diagnostic. Never commit the private photo or generated output.
// PLAYWRIGHT_PATH=... node scripts/compare-receipt-ocr.cjs /path/to/receipt.png
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
(async()=>{
  if(!process.argv[2])throw new Error('Pass the local receipt image path.');
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage();
    page.on('pageerror',error=>console.error(error.message));
    await page.route('**/ocr-benchmark',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Local receipt diagnostic</title>'}));
    for(const [routeName,file] of [['baseline-ocr','receiptOcr.js'],['baseline-parser','receiptParser.js']])await page.route(`**/${routeName}.js`,route=>route.fulfill({contentType:'application/javascript',body:execFileSync('git',['show',`35304ca:src/features/finance/${file}`],{encoding:'utf8'})}));
    await page.goto('http://127.0.0.1:5177/cboard/ocr-benchmark');
    const output=await page.evaluate(async({base64,baseline})=>{
      const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),file=new File([bytes],'receipt.png',{type:'image/png'});
      const {createReceiptOcrSession,prepareReceiptImage}=await import('/cboard/src/features/finance/receiptOcr.js');
      let old=null;
      if(baseline){
        const {default:{createWorker}}=await import('/cboard/node_modules/tesseract.js/dist/tesseract.esm.min.js');
        const root=location.origin+'/cboard/ocr/';
        const worker=await createWorker('eng',1,{workerPath:root+'worker.min.js',corePath:root,langPath:root.slice(0,-1)});
        try{const {prepareReceiptImage:oldPrepare}=await import('/cboard/baseline-ocr.js');const {parseReceipt:oldParse}=await import('/cboard/baseline-parser.js');await worker.setParameters({preserve_interword_spaces:'1',user_defined_dpi:'300'});const canvas=await oldPrepare(file);old=(await worker.recognize(canvas)).data;old.parsed=oldParse(old.text);canvas.width=canvas.height=0;}finally{await worker.terminate();}
      }
      const session=createReceiptOcrSession(()=>{});
      const started=performance.now();
      try{const result=await session.scan(file,0,{debug:true});return {baseline:old,result,elapsedMs:Math.round(performance.now()-started)};}finally{session.dispose();}
    },{base64:fs.readFileSync(process.argv[2]).toString('base64'),baseline:process.argv.includes('--baseline')});
    const dir=process.env.RECEIPT_REPORT_DIR||path.join(os.tmpdir(),'cboard-receipt-comparison');fs.mkdirSync(dir,{recursive:true});
    if(output.baseline)fs.writeFileSync(path.join(dir,'baseline.json'),JSON.stringify(output.baseline,null,2));
    for(const candidate of output.result.debug.candidates){fs.writeFileSync(path.join(dir,candidate.name+'.png'),Buffer.from(candidate.image.split(',')[1],'base64'));delete candidate.image;}
    if(output.result.debug.cropped)fs.writeFileSync(path.join(dir,'cropped.png'),Buffer.from(output.result.debug.cropped.split(',')[1],'base64'));
    delete output.result.image;delete output.result.debug.original;delete output.result.debug.cropped;
    fs.writeFileSync(path.join(dir,'comparison.json'),JSON.stringify(output,null,2));
    console.log(JSON.stringify({directory:dir,elapsedMs:output.elapsedMs,region:output.result.debug.region,angle:output.result.debug.angle,selected:output.result.name,candidates:output.result.debug.candidates.map(({name,score,confidence,elapsedMs,parsed})=>({name,score,confidence,elapsedMs,total:parsed.total,items:parsed.items.map(item=>({name:item.name,price:item.lineTotal,quantity:item.quantity}))}))},null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
