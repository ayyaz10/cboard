import { test, expect } from '@playwright/test';

async function useFinanceStub(page) {
  await page.route('**/src/contexts/AuthContext.jsx*', route => route.fulfill({ contentType: 'application/javascript', body: "export const useAuth=()=>({user:{id:'receipt-import-test'},isAuthenticated:true,isLoading:false,displayName:'Test'});export const AuthProvider=({children})=>children;" }));
  await page.route('**/src/services/dataMigrationService.js*', route => route.fulfill({ contentType: 'application/javascript', body: 'export async function migrateLocalStorageData(){}' }));
  await page.route('**/src/services/financeService.js*', route => route.fulfill({ contentType: 'application/javascript', body: `import {initialFinanceState} from '/cboard/src/features/finance/financeData.js';export async function loadFinance(){const state=JSON.parse(localStorage.getItem('receipt-import-state')||'null')||initialFinanceState();state.settings.configured=true;state.settings.currency='GBP';return{state,version:'v',userId:'receipt-import-test'}}export async function saveFinance(state){localStorage.setItem('receipt-import-state',JSON.stringify(state));return'v'}export async function parseFinanceEntry(){throw new Error('unused')}` }));
  await page.goto('/cboard/finance?section=transactions');
  await page.getByRole('heading', { name: 'Finance Manager' }).waitFor();
}

test('receipt import reviews and saves one expense through Finance into the ledger', async ({ page }) => {
  await useFinanceStub(page);
  await page.getByRole('button', { name: 'Import from Receipt', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Paste receipt JSON').fill(JSON.stringify({ documentType: 'purchase_receipt', merchant: 'Corner Market', date: '2026-11-18', total: '12.34', currency: 'GBP' }));
  await dialog.getByRole('button', { name: 'Review Transaction' }).click();
  await expect(dialog.getByLabel('Merchant or title')).toHaveValue('Corner Market');
  await expect(dialog.getByRole('textbox', { name: 'Amount' })).toHaveValue('12.34');
  await expect(dialog.getByRole('textbox', { name: 'Date', exact: true })).toHaveValue('2026-11-18');
  expect(await page.evaluate(() => localStorage.getItem('receipt-import-state'))).toBeNull();
  await dialog.getByRole('button', { name: 'Save Transaction' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: /Corner Market.*12\.34/ })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('receipt-import-state')));
  expect(saved.transactions).toHaveLength(1);
  expect(saved.transactions[0]).toMatchObject({ title: 'Corner Market', type: 'expense', amount: 1234, date: '2026-11-18' });
  expect(JSON.stringify(saved)).not.toContain('purchase_receipt');
});

test('ChatGPT itemized receipt JSON fills the transaction receipt and per-item category editor', async ({ page }) => {
  await useFinanceStub(page);
  await page.getByRole('button', { name: 'Import from Receipt', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Paste receipt JSON').fill(JSON.stringify({
    store:{name:'ALDI',location:'McKenzie Street, Kirkcaldy'},
    date:'2026-11-17', time:'20:31', total:11.26, currency:'GBP', item_count:4,
    items:[
      {code:'586719',name:'CRUNCHY NUT 720G',quantity:1,unit:'each',unitPrice:3.99,amount:3.99,tax_code:'A'},
      {code:'386021',name:'MILLED/WHOLE CHIA',quantity:1,unit:'each',unitPrice:1.79,amount:1.79,tax_code:'A'},
      {code:'761542',name:'MILLED FLAXSEED',quantity:1,unit:'each',unitPrice:1.79,amount:1.79,tax_code:'A'},
      {code:'656970',name:'AUTH GREEK YOG 1KG',quantity:1,unit:'each',unitPrice:3.69,amount:3.69,tax_code:'A'}
    ]
  }));
  await dialog.getByRole('button', { name: 'Review Transaction' }).click();
  await expect(dialog.getByLabel('Merchant or title')).toHaveValue('ALDI');
  await expect(dialog.getByRole('textbox', { name:'Amount' })).toHaveValue('11.26');
  await expect(dialog.getByLabel('Date', { exact:true })).toHaveValue('2026-11-17');
  await expect(dialog.getByLabel('Receipt time')).toHaveValue('20:31');
  await expect(dialog.getByLabel('Line total for item 1')).toHaveValue('3.99');
  await expect(dialog.getByLabel('Line total for item 4')).toHaveValue('3.69');
  await expect(dialog.getByLabel('Category for item 1')).toHaveValue(/.+/);
  await dialog.getByLabel('Category for item 2').selectOption({ label:'Groceries' });
  await dialog.getByRole('button', { name: 'Save Transaction' }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('receipt-import-state')));
  expect(saved.transactions).toHaveLength(1);
  expect(saved.transactions[0].purchaseItems.map(item => [item.name,item.lineTotal])).toEqual([
    ['CRUNCHY NUT 720G',399], ['MILLED/WHOLE CHIA',179], ['MILLED FLAXSEED',179], ['AUTH GREEK YOG 1KG',369]
  ]);
  expect(saved.transactions[0].receipt.items.map(item => item.retailerProductCode)).toEqual(['586719','386021','761542','656970']);
  expect(saved.transactions[0].receipt.time).toBe('20:31');
});

test('manual transaction entry remains available from Add transaction', async ({ page }) => {
  await useFinanceStub(page);
  await page.getByRole('button', { name: /\+ Add transaction/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Import from Receipt' })).toBeVisible();
  await dialog.getByLabel('Merchant or title').fill('Manual Cafe');
  await dialog.getByRole('textbox', { name: 'Amount' }).fill('4.20');
  await dialog.getByRole('button', { name: 'Add transaction' }).click();
  await expect(dialog).toBeHidden();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('receipt-import-state')));
  expect(saved.transactions).toHaveLength(1);
  expect(saved.transactions[0]).toMatchObject({ title: 'Manual Cafe', amount: 420, type: 'expense' });
});



