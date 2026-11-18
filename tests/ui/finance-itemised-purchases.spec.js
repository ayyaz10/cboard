import { test, expect } from '@playwright/test';

test('manual itemised purchase saves one paid total with independent item categories and mobile layout', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/cboard/tests/ui/fixtures/finance.html');
  await page.getByRole('button',{name:'Open Add Transaction'}).click();
  const form=page.getByRole('dialog',{name:'Add transaction'});
  await form.getByLabel('Merchant or title').fill('Aldi');
  await form.getByRole('button',{name:'Itemise purchase'}).click();
  const names=['Greek yogurt','Frozen berries','Bread','Eggs'], prices=['3.50','2.50','1.50','2.50'];
  for(let i=0;i<4;i++){
    if(i)await form.getByRole('button',{name:'+ Add item'}).click();
    await form.getByLabel(`Item name`).nth(i).fill(names[i]);
    await form.getByLabel(`Line total for item ${i+1}`).fill(prices[i]);
    await form.getByLabel(`Category for item ${i+1}`).selectOption({label:i<2?'Weight Loss':'Groceries'});
  }
  expect(await form.getByLabel('Amount',{exact:true}).inputValue()).toBe('10.00');
  await page.locator('output').evaluateAll(nodes=>nodes.forEach(node=>node.style.display='none'));
  const overflow=await page.evaluate(()=>({width:document.documentElement.scrollWidth, viewport:window.innerWidth, offenders:[...document.querySelectorAll('body *')].filter(node=>node.getBoundingClientRect().right>window.innerWidth+1).map(node=>({tag:node.tagName,cls:String(node.className).slice(0,100),right:Math.round(node.getBoundingClientRect().right)})).slice(0,12)})); expect(overflow.width<=overflow.viewport,JSON.stringify(overflow)).toBe(true);
  await form.getByLabel('Category for item 4').selectOption({label:'Weight Loss'});
  await form.getByLabel('Category for item 4').selectOption({label:'Groceries'});
  await form.getByLabel('Amount',{exact:true}).fill('10.01');
  await form.getByRole('button',{name:'Add transaction'}).click();
  await expect(form.getByRole('alert')).toContainText('subtotals must add up exactly');
  await form.getByLabel('Amount',{exact:true}).fill('10.00');
  await form.getByRole('button',{name:'Add transaction'}).click();
  const state=JSON.parse(await page.getByTestId('finance-state').textContent());
  expect(state.transactions).toHaveLength(1);
  expect(state.transactions[0].title).toBe('Aldi');
  expect(state.transactions[0].amount).toBe(1000);
  expect(state.transactions[0].purchaseItems.filter(item=>item.categoryId==='weight-loss').reduce((sum,item)=>sum+item.lineTotal,0)).toBe(600);
  expect(state.transactions[0].purchaseItems.filter(item=>item.categoryId===state.categories.find(category=>category.name==='Groceries').id).reduce((sum,item)=>sum+item.lineTotal,0)).toBe(400);
});
