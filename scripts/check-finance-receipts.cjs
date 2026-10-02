// Run against Vite dev with PLAYWRIGHT_PATH pointing to an installed Playwright.
// Auth and persistence are isolated test doubles; OCR is the real local worker.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel:'chrome', headless:true });
  try {
    const page = await browser.newPage({ viewport:{ width:1280, height:900 } });
    const errors = [], ocrRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/ocr\/|tesseract|traineddata/.test(request.url())) ocrRequests.push(request.url()); });
    await page.route('**/src/contexts/AuthContext.jsx*', route => route.fulfill({ contentType:'application/javascript', body:"export const useAuth=()=>({user:{id:'receipt-test'},isAuthenticated:true,isLoading:false,displayName:'Test'});export const AuthProvider=({children})=>children;" }));
    await page.route('**/src/services/dataMigrationService.js*', route => route.fulfill({ contentType:'application/javascript', body:'export async function migrateLocalStorageData(){}' }));
    await page.route('**/src/services/financeService.js*', route => route.fulfill({ contentType:'application/javascript', body:`
      import { initialFinanceState } from '/cboard/src/features/finance/financeData.js';
      export async function loadFinance(){const state=JSON.parse(localStorage.getItem('receipt-ui-test')||'null')||initialFinanceState();state.settings.configured=true;state.settings.currency='GBP';return{state,version:'v',userId:'receipt-test'}}
      export async function saveFinance(state){localStorage.setItem('receipt-ui-test',JSON.stringify(state));return 'v'}
      export async function parseFinanceEntry(){throw new Error('AI is not used by this test')}
    ` }));
    await page.goto(process.env.RECEIPT_TEST_URL || 'http://127.0.0.1:5177/cboard/finance?section=transactions');
    await page.getByRole('heading', { name:'Finance Manager' }).waitFor();
    const png = Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width=1000; canvas.height=1000;
      const context=canvas.getContext('2d'); context.fillStyle='white'; context.fillRect(0,0,1000,1000); context.fillStyle='black'; context.font='32px monospace';
      ['TESCO','02/10/2026 14:52','OATS                    2.30','MILK 2 x 1.45           2.90','BANANAS 0.850kg         1.02','SUBTOTAL                6.22','TOTAL                   6.22','VISA **** 1234','THANK YOU'].forEach((line,index)=>context.fillText(line,50,85+index*80));
      return canvas.toDataURL('image/png').split(',')[1];
    }), 'base64');
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('receipt-ui-test') || '{"transactions":[]}'));
    await page.getByRole('button',{ name:'Scan receipt', exact:true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Upload receipt', { exact:true }).setInputFiles({ name:'receipt.png', mimeType:'image/png', buffer:png });
    await dialog.getByRole('button',{ name:'Scan receipt', exact:true }).click();
    await dialog.getByText('Scan complete. Review and correct the transaction before saving.').waitFor({ timeout:120000 });
    assert.equal((await saved()).transactions.length,0);
    assert.equal(await dialog.getByLabel('Merchant or title').inputValue(),'TESCO');
    assert.equal(await dialog.getByLabel('Amount',{ exact:true }).inputValue(),'6.22');
    assert.equal(await dialog.getByLabel('Date',{ exact:true }).inputValue(),'2026-10-02');
    assert.equal(await dialog.getByLabel('Item name',{ exact:true }).count(),3);
    const workersBeforeRescan=ocrRequests.filter(url=>url.endsWith('/ocr/worker.min.js')).length;
    await dialog.getByRole('button',{ name:'Rescan and replace items', exact:true }).click();
    await dialog.getByText('Scan complete. Review and correct the transaction before saving.').waitFor({ timeout:120000 });
    assert.equal(ocrRequests.filter(url=>url.endsWith('/ocr/worker.min.js')).length,workersBeforeRescan);
    await dialog.getByLabel('Item name',{ exact:true }).first().fill('Rolled oats');
    await dialog.getByLabel('Quantity',{ exact:true }).first().fill('1');
    await dialog.getByRole('button',{ name:'Add receipt item', exact:true }).click();
    await dialog.getByLabel('Item name',{ exact:true }).last().fill('Bag');
    await dialog.getByRole('button',{ name:'Remove item 4', exact:true }).click();
    await page.setViewportSize({ width:390,height:844 });
    assert.equal(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth),true);
    await dialog.screenshot({ path:process.env.TEMP+'/cboard-receipt-review.png' });
    await dialog.getByRole('button',{ name:'Add transaction', exact:true }).click();
    await dialog.waitFor({ state:'hidden' });
    const first=(await saved()).transactions[0];
    assert.equal(first.receipt.items.length,3); assert.equal(first.receipt.items[0].name,'Rolled oats');
    assert.equal(first.receipt.image,undefined); assert.equal(first.receipt.rawText,undefined);
    await page.getByRole('button',{name:'All transactions',exact:true}).click();
    await page.getByText('Items (3)',{exact:true}).click();
    await page.getByText('Rolled oats',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Edit',exact:true}).first().click();
    await dialog.getByLabel('Item name',{exact:true}).first().fill('Organic oats');
    await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
    await dialog.waitFor({ state:'hidden' });
    const edited=(await saved()).transactions[0];
    assert.equal(edited.receipt.items[0].id,first.receipt.items[0].id); assert.equal(edited.receipt.items.length,3);
    await page.reload();
    await page.getByRole('button',{name:'All transactions',exact:true}).click();
    await page.getByText('Items (3)',{exact:true}).click();
    await page.getByText('Organic oats',{exact:true}).waitFor();
    // Existing transaction flow and attaching items without changing its amount.
    await page.getByRole('button',{name:/Add transaction/}).first().click();
    await dialog.getByLabel('Merchant or title').fill('Existing purchase');
    await dialog.getByLabel('Amount',{exact:true}).fill('10.00');
    await dialog.getByRole('button',{name:'Add transaction',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    assert.equal((await saved()).transactions.length,2);
    const row=page.getByRole('row').filter({hasText:'Existing purchase'});
    await row.getByRole('button',{name:'Edit',exact:true}).click();
    await dialog.getByText('Receipt scan & items',{exact:true}).click();
    await dialog.getByLabel('Upload receipt',{exact:true}).setInputFiles({name:'receipt.png',mimeType:'image/png',buffer:png});
    await dialog.getByRole('button',{name:'Scan receipt',exact:true}).click();
    await dialog.getByText('Scan complete. Review and correct the transaction before saving.').waitFor({timeout:120000});
    assert.equal(await dialog.getByLabel('Amount',{exact:true}).inputValue(),'10.00');
    await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    assert.equal((await saved()).transactions.length,2);
    assert.equal((await saved()).transactions[1].receipt.items.length,3);
    // Corrupt input, retry and cancellation leave persisted state untouched.
    await page.getByRole('button',{name:'Scan receipt',exact:true}).click();
    await dialog.getByLabel('Upload receipt',{exact:true}).setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('invalid')});
    await dialog.getByRole('button',{name:'Scan receipt',exact:true}).click();
    await dialog.getByRole('alert').waitFor();
    await dialog.getByLabel('Upload receipt',{exact:true}).setInputFiles({name:'receipt.png',mimeType:'image/png',buffer:png});
    await dialog.getByRole('button',{name:'Scan receipt',exact:true}).click();
    await dialog.getByRole('button',{name:'Cancel scan',exact:true}).click();
    await dialog.getByText('Scan cancelled. Nothing was saved.').waitFor();
    await dialog.getByRole('button',{name:'Scan receipt',exact:true}).click();
    await dialog.getByText('Scan complete. Review and correct the transaction before saving.').waitFor({timeout:120000});
    await dialog.getByRole('button',{name:'Close dialog'}).click();
    assert.equal((await saved()).transactions.length,2);
    assert.ok(ocrRequests.some(url=>url.includes('/ocr/eng.traineddata.gz')));
    assert.ok(ocrRequests.every(url=>new URL(url).hostname==='127.0.0.1'));
    assert.deepEqual(errors,[]);
    console.log('PASS: real OCR, parse, review, edit/add/delete items, mobile layout, save/reload, stable IDs, normal transaction, attach, failure, cancel, local-only assets.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
