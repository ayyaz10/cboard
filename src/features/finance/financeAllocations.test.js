import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDueMonthlyAllocations, applyIncomeAllocations, reconcileIncomeAllocations, settleAllocation } from './financeAllocations.js';
import { financeSummary } from './financeMath.js';
import { deriveFinancePosition } from './financeLedger.js';

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

test('donation target allocations are capped at the remaining target and stop when reached', () => {
  const value=state();
  value.donationTargets=[{id:'school',name:'School fund',categoryId:'education',targetAmount:5000,active:true,status:'active'}];
  value.allocationRules=[{id:'target-rule',name:'School fund',targetType:'donation',donationTargetId:'school',donationCategoryId:'education',mode:'amount',value:3000,timing:'income',active:true}];
  const first={id:'pay-1',type:'income',amount:10000,date:'2026-10-01'};
  const second={id:'pay-2',type:'income',amount:10000,date:'2026-10-15'};
  value.transactions.push(first,second);
  applyIncomeAllocations(value,first);
  applyIncomeAllocations(value,first);
  applyIncomeAllocations(value,second);
  const reserves=value.transactions.filter(item=>item.type==='donation');
  assert.deepEqual(reserves.map(item=>item.amount),[3000,2000]);
  assert.ok(reserves.every(item=>item.allocationStatus==='allocated'&&item.donationCategoryId==='education'&&item.linkedDonationTargetId==='school'));
  assert.equal(value.donationTargets[0].status,'completed');
  assert.equal(value.allocationRules[0].active,false);
});

test('a donation income percentage reserves money once and does not count it as paid', () => {
  const value=state();
  value.settings={monthlyIncome:0};
  value.budgets={};
  const income={id:'payday',type:'income',amount:200000,date:'2026-10-01'};
  value.transactions.push(income);
  value.allocationRules=[{id:'give',targetType:'donation',donationCategoryId:'education',mode:'percent',value:500,timing:'income',active:true}];
  applyIncomeAllocations(value,income);
  applyIncomeAllocations(value,income);
  const allocation=value.transactions.find(item=>item.allocationRuleId==='give');
  assert.equal(allocation.amount,10000);
  assert.equal(allocation.allocationStatus,'allocated');
  assert.equal(allocation.donationCategoryId,'education');
  assert.equal(financeSummary(value,'2026-10').donations,0);
  const position=deriveFinancePosition(value);
  assert.equal(position.reserves.donation,10000);
  assert.equal(position.totalOwned,200000);
});

test('paying a donation reserve creates one Expense transaction and releases the reserve once', () => {
  const value=state();
  value.settings={monthlyIncome:0};
  value.budgets={};
  value.categories=[{id:'donation-group',type:'donation'}];
  value.donationCategories=[{id:'education',name:'Education'}];
  value.transactions=[
    {id:'salary',type:'income',amount:10000,date:'2026-10-01'},
    {id:'reserve',type:'donation',amount:5000,date:'2026-10-02',allocatedOn:'2026-10-02',allocationStatus:'allocated',donationCategoryId:'education',linkedDonationTargetId:'target'},
  ];
  assert.equal(settleAllocation(value,'reserve','2026-10-10'),true);
  const payment=value.transactions.find(item=>item.linkedReservationId==='reserve');
  assert.equal(payment.type,'expense');
  assert.equal(payment.financeGroup,'donation');
  assert.equal(payment.amount,5000);
  assert.equal(value.transactions.find(item=>item.id==='reserve').allocationStatus,'allocated');
  assert.equal(value.transactions.filter(item=>item.type==='expense'&&item.financeGroup==='donation').length,1);
  assert.equal(financeSummary(value,'2026-10').donations,5000);
  const position=deriveFinancePosition(value);
  assert.equal(position.reserves.donation,0);
  assert.equal(position.totalOwned,5000);
});
