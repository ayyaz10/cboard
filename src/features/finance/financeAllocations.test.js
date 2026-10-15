import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDueMonthlyAllocations, applyIncomeAllocations, reconcileIncomeAllocations, settleAllocation } from './financeAllocations.js';

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

test('goal allocations reserve goal progress while investment balances wait for transfer confirmation', () => {
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
  assert.equal(value.investments[0].contributed,10000);
  assert.equal(value.investments[0].currentValue,12000);
  assert.equal(value.debts[0].remaining,3000);
  assert.equal(value.transactions.find(x=>x.type==='debt').allocationStatus,'allocated');
  assert.equal(value.transactions.find(x=>x.type==='investment').allocationStatus,'allocated');
  assert.deepEqual(value.transactions.map(x=>x.amount),[5000,2000,3000]);
});

test('only a started debt plan can reserve an automatic payment', () => {
  const value=state();
  value.debts=[{id:'waiting',remaining:3000,status:'open',repaymentPlanStatus:'not_started'}];
  value.allocationRules=[{id:'rule',targetType:'debt',targetId:'waiting',mode:'amount',value:2000,timing:'income',active:true}];
  const income={id:'payday',type:'income',amount:10000,date:'2026-10-16'};value.transactions.push(income);
  applyIncomeAllocations(value,income);
  assert.equal(value.transactions.length,1);
  assert.equal(value.debts[0].remaining,3000);
});

test('debt automatic reserve is capped at the remaining balance and payoff completes the plan', () => {
  const value=state();
  value.debts=[{id:'loan',remaining:800,status:'open',repaymentPlanStatus:'active'}];
  value.allocationRules=[{id:'rule',targetType:'debt',targetId:'loan',mode:'amount',value:2000,timing:'income',active:true}];
  const income={id:'payday',type:'income',amount:10000,date:'2026-10-16'};value.transactions.push(income);
  applyIncomeAllocations(value,income);
  const payment=value.transactions.find(item=>item.type==='debt');
  assert.equal(payment.amount,800);
  assert.equal(settleAllocation(value,payment.id,'2026-10-16'),true);
  assert.equal(value.debts[0].remaining,0);
  assert.equal(value.debts[0].status,'paid');
  assert.equal(value.debts[0].repaymentPlanStatus,'completed');
  assert.equal(value.allocationRules[0].active,false);
});

test('settling a savings reserve transfers it without losing total owned money', () => {
  const value=state();
  value.transactions.push({id:'save',type:'savings',amount:2000,date:'2026-09-01',allocationStatus:'allocated'});
  assert.equal(settleAllocation(value,'save','2026-09-03'),true);
  assert.equal(value.transactions[0].allocationStatus,'transferred');
  assert.equal(value.transactions[0].allocatedOn,'2026-09-01');
  assert.equal(value.transactions[0].paymentDate,'2026-09-03');
});

test('settling a goal allocation releases its reserve and reopens a completed goal', () => {
  const value=state();
  value.goals=[{id:'holiday',target:5000,saved:5000,status:'completed'}];
  value.transactions.push({id:'goal-payment',type:'goal',targetId:'holiday',amount:5000,date:'2026-09-01',allocationStatus:'allocated'});
  assert.equal(settleAllocation(value,'goal-payment','2026-09-04'),true);
  assert.equal(value.goals[0].saved,0);
  assert.equal(value.goals[0].status,'active');
  assert.equal(value.transactions[0].allocationStatus,'paid');
});

test('income reconciliation removes only its generated allocations and can recreate edited amounts', () => {
  const value=state();
  value.allocationRules=[{id:'don',targetType:'donation',name:'Gift',mode:'percent',value:1000,timing:'income',active:true}];
  const income={id:'salary',amount:22500,date:'2026-09-01'};value.transactions.push({...income,type:'income'});
  applyIncomeAllocations(value,income);
  const unrelated={id:'manual',type:'donation',amount:500,title:'Manual gift'};value.transactions.push(unrelated);
  reconcileIncomeAllocations(value,income,true);
  assert.deepEqual(value.transactions.map(x=>x.id),['salary','manual']);
  const edited={...income,amount:30000};
  reconcileIncomeAllocations(value,income,true);value.transactions[0]={...edited,type:'income'};applyIncomeAllocations(value,edited);
  assert.equal(value.transactions.filter(x=>x.sourceIncomeId==='salary').length,1);
  assert.equal(value.transactions.find(x=>x.sourceIncomeId==='salary').amount,3000);
  assert.equal(value.transactions.some(x=>x.id==='manual'),true);
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
