import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDueMonthlyAllocations, applyIncomeAllocations } from './financeAllocations.js';

function state() {
  return { settings:{monthlyIncome:300000}, transactions:[], allocationRules:[], goals:[], goalContributions:[], investments:[], debts:[], debtPayments:[] };
}

test('income rules create deductions once for each income transaction', () => {
  const value=state(),income={id:'pay-1',type:'income',amount:200000,date:'2026-09-25'};
  value.transactions.push(income);
  value.allocationRules=[{id:'save-1',name:'Payday savings',targetType:'savings',mode:'percent',value:1000,timing:'income',active:true}];
  applyIncomeAllocations(value,income);
  applyIncomeAllocations(value,income);
  assert.equal(value.transactions.length,2);
  assert.equal(value.transactions[1].amount,20000);
  assert.equal(value.transactions[1].sourceIncomeId,'pay-1');
});

test('goal, investment, and debt allocations update their tracked balances', () => {
  const value=state();
  value.goals=[{id:'g',title:'Holiday',target:50000,saved:45000,status:'active'}];
  value.investments=[{id:'i',name:'ISA',contributed:10000,currentValue:12000,date:'2026-08-01'}];
  value.debts=[{id:'d',name:'Family',remaining:3000,status:'active'}];
  value.allocationRules=[
    {id:'rg',targetType:'goal',targetId:'g',mode:'amount',value:10000,timing:'income',active:true},
    {id:'ri',targetType:'investment',targetId:'i',mode:'amount',value:2000,timing:'income',active:true},
    {id:'rd',targetType:'debt',targetId:'d',mode:'amount',value:5000,timing:'income',active:true},
  ];
  applyIncomeAllocations(value,{id:'pay',amount:100000,date:'2026-09-26'});
  assert.equal(value.goals[0].saved,50000);
  assert.equal(value.investments[0].contributed,12000);
  assert.equal(value.investments[0].currentValue,14000);
  assert.equal(value.debts[0].remaining,0);
  assert.deepEqual(value.transactions.map(x=>x.amount),[5000,2000,3000]);
});

test('monthly rules run once on or after their selected day', () => {
  const value=state();
  value.allocationRules=[{id:'monthly',name:'Savings',targetType:'savings',mode:'amount',value:25000,timing:'monthly',day:20,active:true}];
  applyDueMonthlyAllocations(value,'2026-09-19');
  assert.equal(value.transactions.length,0);
  applyDueMonthlyAllocations(value,'2026-09-20');
  applyDueMonthlyAllocations(value,'2026-09-26');
  assert.equal(value.transactions.length,1);
});
