const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`); });
    await page.route('**/src/contexts/AuthContext.jsx*', route => route.fulfill({
      contentType: 'application/javascript',
      body: `export const useAuth=()=>({user:{id:'finance-browser-test'},isAuthenticated:true,isLoading:false,displayName:'Test'});export const AuthProvider=({children})=>children;`,
    }));
    await page.route('**/src/services/dataMigrationService.js*', route => route.fulfill({ contentType: 'application/javascript', body: 'export async function migrateLocalStorageData(){}' }));
    await page.route('**/src/services/financeService.js*', route => route.fulfill({
      contentType: 'application/javascript',
      body: `
        const key='finance-ui-check';
        const cats=[['Salary','income'],['Groceries','expense'],['Charity','donation'],['Portfolio','investment'],['Repayment','debt']].map((x,i)=>({id:'c'+i,name:x[0],type:x[1],color:'#c5ff6f',archived:false,order:i}));
        const fresh=()=>({version:1,settings:{configured:false,currency:'GBP',monthlyIncome:0,budgetStartDay:1},categories:cats,transactions:[],budgets:{},budgetPresets:[],goals:[],goalContributions:[],investments:[],debts:[],debtPayments:[],recurring:[],transactionPresets:[]});
        export async function loadFinance(){return{state:JSON.parse(localStorage.getItem(key)||JSON.stringify(fresh())),version:localStorage.getItem(key)?'v':null,userId:'finance-browser-test'}}
        export async function saveFinance(state){localStorage.setItem(key,JSON.stringify(state));return new Date().toISOString()}
      `,
    }));
    await page.goto('http://localhost:5173/cboard/finance');
    await page.getByRole('heading', { name: 'Make your money easier to see.' }).waitFor();
    await page.getByLabel('Expected monthly income').fill('3000');
    await page.getByRole('button', { name: 'Start using Finance' }).click();
    await page.getByRole('heading', { name: 'Finance Manager' }).waitFor();
    await page.getByRole('button', { name: /Add transaction/ }).first().click();
    await page.getByLabel('Amount').fill('2500');
    await page.getByLabel('Merchant or title').fill('Salary');
    await page.getByLabel('Type').selectOption('income');
    await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
    await page.getByRole('button', { name: /Add transaction/ }).first().click();
    await page.getByLabel('Amount').fill('75.50');
    await page.getByLabel('Merchant or title').fill('Weekly groceries');
    await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
    await page.getByText('£2,424.50', { exact: true }).first().waitFor();
    const sections = [['Transactions','Transactions'],['Monthly Budget','Monthly Budget'],['Goals','Savings Goals'],['Investments','Investments'],['Money to Pay Back','Money to Pay Back'],['Donations','Donations'],['Categories','Categories']];
    for (const [name, heading] of sections) {
      await page.getByRole('button', { name, exact: true }).click();
      await page.getByRole('heading', { name: heading, exact: true }).first().waitFor();
    }
    await page.reload();
    await page.getByRole('heading', { name: 'Finance Manager' }).waitFor();
    await page.getByText('£2,424.50', { exact: true }).first().waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    console.log('PASS: setup, income, expense, all sections, refresh persistence, mobile width, and no browser errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
