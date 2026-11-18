import { test, expect } from '@playwright/test';

test('receipt OCR results open the shared item editor and save merchant plus categorized rows', async ({page}) => {
  await page.route('**/src/contexts/AuthContext.jsx*',route=>route.fulfill({contentType:'application/javascript',body:"export const useAuth=()=>({user:{id:'itemised-receipt-test'},isAuthenticated:true,isLoading:false,displayName:'Test'});export const AuthProvider=({children})=>children;"}));
  await page.route('**/src/services/dataMigrationService.js*',route=>route.fulfill({contentType:'application/javascript',body:'export async function migrateLocalStorageData(){}'}));
  await page.route('**/src/services/financeService.js*',route=>route.fulfill({contentType:'application/javascript',body:`import {initialFinanceState} from '/cboard/src/features/finance/financeData.js';export async function loadFinance(){const state=JSON.parse(localStorage.getItem('receipt-test')||'null')||initialFinanceState();state.settings.configured=true;state.settings.currency='GBP';if(!state.categories.some(category=>category.id==='weight-loss'))state.categories.push({id:'weight-loss',name:'Weight Loss',type:'expense',color:'#a8d5ff'});return{state,version:'v',userId:'itemised-receipt-test'}}export async function saveFinance(state){localStorage.setItem('receipt-test',JSON.stringify(state));return'v'}export async function parseFinanceEntry(){throw new Error('unused')}`}));
  await page.route('**/src/features/finance/receiptOcr.js*',route=>route.fulfill({contentType:'application/javascript',body:`export const validateReceiptImage=()=>{};export const createCloudReceiptOcrSession=()=>({scan:async()=>({parsed:{merchantName:'ALDI',date:'2026-11-17',currency:'GBP',subtotal:1000,tax:null,discounts:null,total:1000,items:[{id:'ocr-yogurt',name:'Greek yogurt',rawName:'Greek yogurt',quantity:1,unitPrice:350,lineTotal:350},{id:'ocr-berries',name:'Frozen berries',rawName:'Frozen berries',quantity:1,unitPrice:650,lineTotal:650}],classifiedLines:[],unresolvedLines:[]},rawText:'ALDI Greek yogurt 3.50 Frozen berries 6.50 TOTAL 10.00',text:'ALDI'}),dispose(){}});export const createReceiptOcrSession=()=>createCloudReceiptOcrSession();`}));
  await page.goto('/cboard/finance?section=transactions');
  await page.getByRole('heading',{name:'Finance Manager'}).waitFor();
  await page.getByRole('button',{name:'Scan receipt',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Choose receipt photo').setInputFiles({name:'receipt.png',mimeType:'image/png',buffer:Buffer.from('image')});
  await expect(dialog.getByLabel('Merchant or title')).toHaveValue('ALDI');
  await expect(dialog.getByLabel('Item name',{exact:true}).nth(1)).toHaveValue('Frozen berries');
  await expect(dialog.getByLabel('Amount',{exact:true})).toHaveValue('10.00');
  await dialog.getByLabel('Category for item 1').selectOption({label:'Weight Loss'});
  await dialog.getByLabel('Category for item 2').selectOption({label:'Groceries'});
  await dialog.getByRole('button',{name:'Add transaction',exact:true}).click();
  await expect(dialog).toBeHidden();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('receipt-test')));
  expect(saved.transactions).toHaveLength(1);
  expect(saved.transactions[0].title).toBe('ALDI');
  expect(saved.transactions[0].purchaseItems.map(item=>[item.name,item.lineTotal,item.categoryId])).toEqual([['Greek yogurt',350,'weight-loss'],['Frozen berries',650,saved.categories.find(category=>category.name==='Groceries').id]]);
  await page.reload();
  await page.getByRole('heading',{name:'Finance Manager'}).waitFor();
  await expect(page.getByRole('button',{name:/ALDI.*?10.00/})).toBeVisible();
  const reloaded=await page.evaluate(()=>JSON.parse(localStorage.getItem('receipt-test')));
  expect(reloaded.transactions[0].purchaseItems.map(item=>item.name)).toEqual(['Greek yogurt','Frozen berries']);
});
