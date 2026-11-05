import test from 'node:test';
import assert from 'node:assert/strict';
import { orderedTransactions, filterTransactions } from './transactionOrder.js';
import { applyIncomeAllocations } from './financeAllocations.js';
import { buildCashTimeline } from './financeChartData.js';
import { donationDue } from './donationAccounting.js';

test('simultaneous allocations follow their income deterministically in history and timeline', () => {
  const income={id:'z-income',date:'2026-09-01',createdAt:'2026-09-01T12:00:00Z',title:'Salary',type:'income',amount:10000,sequence:1};
  const state={transactions:[income],allocationRules:[{id:'r1',active:true,timing:'income',targetType:'savings',mode:'amount',value:1000},{id:'r2',active:true,timing:'income',targetType:'donation',mode:'amount',value:500}]};
  applyIncomeAllocations(state,income);
  assert.ok(state.transactions[1].createdAt>income.createdAt);
  assert.equal(donationDue(state), 500);
  const sameTime=state.transactions.map(item=>({...item,createdAt:income.createdAt})).reverse();
  assert.deepEqual(orderedTransactions(sameTime).map(item=>item.type),['income','savings']);
  assert.deepEqual(buildCashTimeline(sameTime,'2026-09').slice(1).map(point=>point.transaction.type),['income','savings']);
  applyIncomeAllocations(state,income); assert.equal(state.transactions.length,2); assert.equal(state.donationAccruals.length,1);
});

test('confirmed allocations sort on their actual settlement date', () => {
  const rows=[
    {id:'salary',date:'2026-09-01',type:'income',amount:10000},
    {id:'reserve',date:'2026-09-05',allocatedOn:'2026-09-01',paymentDate:'2026-09-05',type:'savings',amount:1000,allocationStatus:'transferred',sourceIncomeId:'salary'},
    {id:'later',date:'2026-09-03',type:'expense',amount:500},
  ];
  assert.deepEqual(orderedTransactions(rows,false).map(item=>item.id),['salary','later','reserve']);
});
test('category, month and title filters produce the correct selected spending', () => {
  const rows=[{id:'a',date:'2026-09-01',type:'expense',title:'Gym',amount:3000,categoryId:'fitness'},{id:'b',date:'2026-09-02',type:'expense',title:'Gym shoes',amount:5000,categoryId:'fitness'},{id:'c',date:'2026-08-01',type:'expense',title:'Gym',amount:3000,categoryId:'fitness'},{id:'d',date:'2026-09-01',type:'expense',title:'Food',amount:1000,categoryId:'groceries'}];
  const selected=filterTransactions(rows,{month:'2026-09',category:'fitness'});
  assert.equal(selected.length,2); assert.equal(selected.reduce((sum,row)=>sum+row.amount,0),8000);
  assert.equal(filterTransactions(rows,{month:'2026-09',category:'fitness',query:'shoes'}).length,1);
});

test('all-month history includes previous years while retaining search and category filters', () => {
  const rows=[
    {id:'old',date:'2025-12-31',type:'expense',title:'Gym membership',categoryId:'fitness'},
    {id:'new',date:'2026-01-01',type:'expense',title:'Gym membership',categoryId:'fitness'},
    {id:'food',date:'2026-01-02',type:'expense',title:'Food',categoryId:'groceries'},
  ];
  assert.deepEqual(filterTransactions(rows,{month:null}).map(row=>row.id),['food','new','old']);
  assert.deepEqual(filterTransactions(rows,{month:null,query:'GYM',type:'expense',category:'fitness'}).map(row=>row.id),['new','old']);
  assert.deepEqual(filterTransactions(rows,{month:'2026-01',category:'fitness'}).map(row=>row.id),['new']);
  assert.deepEqual(filterTransactions(rows,{month:'2026-02'}),[]);
});

test('transaction search includes notes, references, categories, receipt items, and linked names', () => {
  const rows=[
    {id:'receipt',date:'2026-11-04',type:'expense',title:'ALDI',note:'Weekly shop',reference:'ref-204',categoryId:'groceries',receipt:{vendor:'ALDI',items:[{name:'Oat milk'}]}},
    {id:'credit',date:'2026-11-03',type:'creditPayment',title:'Monthly repayment',creditAgreementId:'agreement-1'},
  ];
  const options={categories:[{id:'groceries',name:'Groceries'}],linkedNamesById:{credit:['Philips trimmer']}};
  for (const query of ['weekly shop','ref-204','groceries','oat milk','Philips trimmer']) {
    assert.equal(filterTransactions(rows,{month:null,query,...options}).length,1,query);
  }
  assert.equal(filterTransactions(rows,{month:null,query:'  ALDI  ',...options})[0].id,'receipt');
});
