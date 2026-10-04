// Exercise the built/published site with real OCR assets and isolated auth/database responses.
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.NUTRITION_SITE_URL||'https://ayyaz10.github.io/cboard/';
const html=fs.readFileSync('docs/index.html','utf8');
const main=html.match(/<script[^>]+src="([^"]+)"/)[1];
const bundle=fs.readFileSync('docs'+main.replace('/cboard',''),'utf8');
const projects=[...new Set([...bundle.matchAll(/https:\/\/([a-z0-9-]+)\.supabase\.co/g)].map(match=>match[1]))];
assert.ok(projects.length,'Built site must contain its configured public Supabase URL');
const user={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'nutrition-qa@example.test',user_metadata:{username:'nutrition_qa'},app_metadata:{provider:'email'},created_at:new Date().toISOString()};
const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,exp:4102444800,role:'authenticated'})).toString('base64url')+'.test';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await context.addInitScript(({projects,user,token})=>{for(const project of projects)localStorage.setItem('sb-'+project+'-auth-token',JSON.stringify({access_token:token,refresh_token:'test',expires_at:4102444800,expires_in:360000,user,token_type:'bearer'}));},{projects,user,token});
 await context.route(/https:\/\/[^/]+\.supabase\.co\//,async route=>{
  const path=new URL(route.request().url()).pathname;let data=[];
  if(path.endsWith('/auth/v1/user'))data=user;
  else if(path.includes('/profiles'))data={id:user.id,username:'nutrition_qa'};
  else if(route.request().method()!=='GET')data=route.request().postDataJSON()||{};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 const page=await context.newPage(),errors=[],assets=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{if(response.url().includes('/ocr/'))assets.push([response.url(),response.status()]);});
 page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(60000);
 await page.goto(base+'calculators/calorie');
 await page.getByRole('button',{name:'Scan nutrition label',exact:true}).waitFor();
 const image=Buffer.from(await page.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=720;canvas.height=1600;const x=canvas.getContext('2d');x.fillStyle='white';x.fillRect(0,0,720,1600);x.fillStyle='#222';x.font='bold 20px Arial';x.fillText('Nutritional information',24,316);
  const rows=[['Energy kJ','162.8 kJ'],['Energy kcal','38.9 kcal'],['Fat','0.5 g'],['Saturates','0 g'],['Sugars','6.1 g'],['Fibre','3.8 g'],['Protein','0.6 g'],['Salt','0 g'],['Carbohydrate','6.1 g']];
  rows.forEach(([name,amount],i)=>{const y=365+i*78;x.fillStyle=i%2?'#fff':'#e9edf4';x.fillRect(24,y-33,672,68);x.fillStyle='#111';x.font='bold 20px Arial';x.fillText(name,40,y+8);x.font='20px Arial';x.textAlign='right';x.fillText(amount,675,y+8);x.textAlign='left';});return canvas.toDataURL('image/png').split(',')[1];
 }),'base64');
 await page.getByRole('button',{name:'Scan nutrition label',exact:true}).click();
 await page.getByLabel('Upload nutrition label',{exact:true}).setInputFiles({name:'label.png',mimeType:'image/png',buffer:image});
 await page.getByRole('button',{name:'Apply nutrition',exact:true}).waitFor({timeout:120000});
 const amounts={energyKJ:'162.8',calories:'38.9',fat:'0.5',saturatedFat:'0',sugars:'6.1',fiber:'3.8',protein:'0.6',salt:'0',carbs:'6.1'};
 for(const [key,amount] of Object.entries(amounts)){const label={energyKJ:'Energy (kJ)',calories:'Calories (kcal)',fat:'Fat (g)',saturatedFat:'Saturated fat (g)',sugars:'Sugars (g)',fiber:'Fibre (g)',protein:'Protein (g)',salt:'Salt (g)',carbs:'Carbs (g)'}[key];assert.equal(await page.getByLabel(`Scanned ${label}`,{exact:true}).inputValue(),amount,key);}
 assert.equal(await page.getByLabel('Nutrition basis').inputValue(),'unknown');await page.getByLabel('Nutrition basis').selectOption('100g');
 assert.equal(await page.locator('.nscan').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
 await page.getByLabel('Nutrition column',{exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:process.env.TEMP+'/cboard-nutrition-live.png'});
 await page.getByRole('button',{name:'Apply nutrition',exact:true}).click();
 assert.equal(await page.getByLabel('Total quantity',{exact:true}).inputValue(),'100');assert.equal(await page.getByLabel('Total calories',{exact:true}).inputValue(),'38.9');
 assert.ok(assets.some(([url])=>url.includes('worker.min.js')));assert.ok(assets.some(([url])=>url.includes('traineddata')));assert.ok(assets.every(([url,status])=>url.startsWith(new URL(base).origin)&&status===200));
 assert.deepEqual(errors,[]);
 console.log('PASS: deployed production bundle, mobile Aldi-style screenshot OCR, all nine nutrient values, basis confirmation, local OCR assets and apply-to-calculator. Auth/database isolated; no real account changed.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
