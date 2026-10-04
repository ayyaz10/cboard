// Real in-browser OCR regression for the Aldi nutrition screenshot.
// Set NUTRITION_TEST_IMAGE to the supplied local image to test that exact file.
// If omitted, creates a website-style synthetic label with the same text and
// distant left/right columns; this never claims to test the supplied image.
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const base=process.env.NUTRITION_TEST_URL||'http://127.0.0.1:5177/cboard/';
const original=process.env.NUTRITION_TEST_IMAGE;
const expected={energyKJ:'162.8',calories:'38.9',fat:'0.5',saturatedFat:'0',sugars:'6.1',fiber:'3.8',protein:'0.6',salt:'0',carbs:'6.1'};
const harness=`import React from 'react';import{createRoot}from'react-dom/client';import{NutritionLabelScan}from'/cboard/src/features/nutrition/NutritionLabelScan.jsx';import'/cboard/src/styles/index.css';
function App(){const[review,setReview]=React.useState(null);return <main style={{maxWidth:720,margin:'1rem auto'}}><NutritionLabelScan onApply={setReview}/>{review&&<pre id="saved">{JSON.stringify(review)}</pre>}</main>}createRoot(document.getElementById('root')).render(<App/>);`;
(async()=>{
 const image=original?fs.readFileSync(original):null;
 fs.writeFileSync('src/__nutrition_image_qa__.jsx',harness);
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/src/main.jsx*',route=>route.fulfill({contentType:'application/javascript',body:"import '/cboard/src/__nutrition_image_qa__.jsx';"}));
  await page.goto(base+'nutrition-image-qa?nutritionOcrDebug');await page.getByRole('button',{name:'Scan nutrition label'}).click();
  const upload=image||Buffer.from(await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=720;canvas.height=1600;const x=canvas.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,720,1600);x.fillStyle='#1f2630';x.font='bold 25px Arial';x.fillText('ALDI',28,62);x.font='22px Arial';x.fillStyle='#293d59';x.fillText('Help Centre   Store Locator   Sign Up To Emails',190,63);x.fillStyle='#f1f3f7';x.fillRect(24,170,672,56);x.fillStyle='#555';x.fillText('Which product can we help you find?',46,207);x.fillStyle='#202020';x.font='bold 20px Arial';x.fillText('Nutritional information',24,316);const rows=[['Energy kJ','162.8 kJ'],['Energy kcal','38.9 kcal'],['Fat','0.5 g'],['Saturates','0 g'],['Sugars','6.1 g'],['Fibre','3.8 g'],['Protein','0.6 g'],['Salt','0 g'],['Carbohydrate','6.1 g']];rows.forEach(([name,amount],i)=>{const y=365+i*78;x.fillStyle=i%2?'#fff':'#e9edf4';x.fillRect(24,y-33,672,68);x.fillStyle='#111';x.font='bold 20px Arial';x.fillText(name,40,y+8);x.font='20px Arial';x.textAlign='right';x.fillText(amount,675,y+8);x.textAlign='left';});x.fillStyle='#333';x.font='16px Arial';x.fillText('Product information may vary by supplier. Check the packaging.',24,1095);x.font='bold 23px Arial';x.fillText('YOU MAY ALSO LIKE',24,1280);return canvas.toDataURL('image/png').split(',')[1];}),'base64');
  if(!original)fs.writeFileSync(path.join(os.tmpdir(),'cboard-aldi-website-synthetic.png'),upload);
  const mimeType=original?({'.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[path.extname(original).toLowerCase()]||'image/png'):'image/png';
  await page.getByLabel('Upload nutrition label').setInputFiles({name:original||'aldi-website-layout.png',mimeType,buffer:upload});
  await page.getByRole('button',{name:'Apply nutrition'}).waitFor({timeout:120000});
  const actual={};for(const key of Object.keys(expected))actual[key]=await page.getByLabel(`Scanned ${key==='energyKJ'?'Energy (kJ)':key==='calories'?'Calories (kcal)':key==='saturatedFat'?'Saturated fat (g)':key==='fiber'?'Fibre (g)':key==='carbs'?'Carbs (g)':key[0].toUpperCase()+key.slice(1)+' (g)'}`,{exact:true}).inputValue();
  if(Object.keys(expected).some(key=>actual[key]!==expected[key])){
   const d=JSON.parse(await page.locator('details').filter({hasText:'Development OCR diagnostics'}).locator('pre').textContent());
   const first=d.candidates[0],amountRows=first.lines.filter(line=>/^(?:Fat|Fibre|Protein|Sugars|Carbohydrate)\b/.test(line.text));
   const pixels=await page.evaluate(async rows=>{const img=document.querySelector('.nscan img');await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const data=ctx.getImageData(0,0,c.width,c.height).data,s=Math.min(2,3200/Math.max(c.width,c.height),Math.sqrt(4000000/(c.width*c.height)));return rows.map(line=>{const w=line.words.find(word=>/^[\dOIlS]/.test(word.text)&&word.bbox.x0>(line.bbox.x0+line.bbox.x1)/2);if(!w)return {text:line.text};const x0=Math.max(0,Math.floor(w.bbox.x0/s)),x1=Math.min(c.width,Math.ceil(w.bbox.x1/s)),y0=Math.max(0,Math.floor(w.bbox.y0/s)),y1=Math.min(c.height,Math.ceil(w.bbox.y1/s)),ww=x1-x0,hh=y1-y0,seen=new Uint8Array(ww*hh),comps=[];for(let y=0;y<hh;y++)for(let x=0;x<ww;x++){const i=y*ww+x,px=((y0+y)*c.width+x0+x)*4;if(seen[i]||(.299*data[px]+.587*data[px+1]+.114*data[px+2])>190)continue;let q=[i],n=0,minX=x,maxX=x,minY=y,maxY=y;seen[i]=1;for(let j=0;j<q.length;j++){const p=q[j],cx=p%ww,cy=Math.floor(p/ww);n++;minX=Math.min(minX,cx);maxX=Math.max(maxX,cx);minY=Math.min(minY,cy);maxY=Math.max(maxY,cy);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const ax=cx+dx,ay=cy+dy,z=ay*ww+ax;if(ax>=0&&ax<ww&&ay>=0&&ay<hh&&!seen[z]){const k=((y0+ay)*c.width+x0+ax)*4;if(.299*data[k]+.587*data[k+1]+.114*data[k+2]<=190){seen[z]=1;q.push(z);}}}}comps.push({n,x:(minX+maxX)/2,y:(minY+maxY)/2,w:maxX-minX+1,h:maxY-minY+1});}return{text:line.text,word:w.text,box:[ww,hh],components:comps.sort((a,b)=>a.x-b.x)};});},amountRows);
   console.error('OCR diagnostics:',JSON.stringify({passes:d.candidates.map(c=>({name:c.name,score:c.score,values:Object.fromEntries(Object.entries(c.parsed.columns[0]?.nutrients||{}).map(([k,v])=>[k,{value:v.value,raw:v.rawValue,confidence:v.confidence}]))})),pixelChecks:amountRows.map(line=>({text:line.text,words:line.words.filter(word=>word.pixelCheck).map(word=>({text:word.text,check:word.pixelCheck}))})),amountPixels:pixels},null,2));
  }
  assert.deepEqual(actual,expected,'values shown in the nutrition review');
  assert.equal(await page.getByLabel('Nutrition basis').inputValue(),'unknown');
  await page.getByLabel('Nutrition basis').selectOption('100g');await page.getByRole('button',{name:'Apply nutrition'}).click();
  const saved=await page.locator('#saved').textContent(),nutrition=JSON.parse(saved);
  assert.equal(nutrition.calories,38.9);assert.equal(nutrition.protein,.6);assert.equal(nutrition.fat,.5);assert.equal(nutrition.quantity,100);assert.deepEqual(errors,[]);
  console.log(`PASS: ${original?'supplied local image':'synthetic website-style fixture'} produced all nine expected nutrient values in mobile review and saved them after explicitly selecting a basis.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{try{fs.unlinkSync('src/__nutrition_image_qa__.jsx');}catch{}});
