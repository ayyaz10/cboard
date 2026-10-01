import test from 'node:test';
import assert from 'node:assert/strict';
import { orderedTransactions, filterTransactions } from './transactionOrder.js';
import { applyIncomeAllocations } from './financeAllocations.js';
import { buildCashTimeline } from './financeChartData.js';

test('simultaneous allocations follow their income deterministically in history and timeline', () => {
  const income={id:'z-income',date:'2026-09-01',createdAt:'2026-09-01T12:00:00Z',title:'Salary',type:'income',amount:10000,sequence:1};
  const state={transactions:[income],allocationRules:[{id:'r1',active:true,timing:'income',targetType:'savings',mode:'amount',value:1000},{id:'r2',active:true,timing:'income',targetType:'donation',mode:'amount',value:500}]};
  applyIncomeAllocations(state,income);
  assert.ok(state.transactions[1].createdAt>income.createdAt);
  assert.ok(state.transactions[2].createdAt>state.transactions[1].createdAt);
  const sameTime=state.transactions.map(item=>({...item,createdAt:income.createdAt})).reverse();
  assert.deepEqual(orderedTransactions(sameTime).map(item=>item.type),['income','savings','donation']);
  assert.deepEqual(buildCashTimeline(sameTime,'2026-09').slice(1).map(point=>point.transaction.type),['income','savings','donation']);
  applyIncomeAllocations(state,income); assert.equal(state.transactions.length,3);
});
test('category, month and title filters produce the correct selected spending', () => {
  const rows=[{id:'a',date:'2026-09-01',type:'expense',title:'Gym',amount:3000,categoryId:'fitness'},{id:'b',date:'2026-09-02',type:'expense',title:'Gym shoes',amount:5000,categoryId:'fitness'},{id:'c',date:'2026-08-01',type:'expense',title:'Gym',amount:3000,categoryId:'fitness'},{id:'d',date:'2026-09-01',type:'expense',title:'Food',amount:1000,categoryId:'groceries'}];
  const selected=filterTransactions(rows,{month:'2026-09',category:'fitness'});
  assert.equal(selected.length,2); assert.equal(selected.reduce((sum,row)=>sum+row.amount,0),8000);
  assert.equal(filterTransactions(rows,{month:'2026-09',category:'fitness',query:'shoes'}).length,1);
});
