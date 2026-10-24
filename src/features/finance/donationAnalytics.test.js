import test from 'node:test';
import assert from 'node:assert/strict';
import { initialFinanceState, normalizeFinanceState } from './financeData.js';
import { donationSummary, refreshDonationTargetStatus, targetMonthlyAllocation } from './donationAnalytics.js';
import { financeSummary } from './financeMath.js';
import { deriveFinancePosition } from './financeLedger.js';

test('monthly donation totals and category totals use paid ledger transactions only', () => {
  const state=initialFinanceState();
  state.donationCategories.push({id:'education',name:'Education',archived:false});
  state.transactions=[
    {id:'one',type:'donation',amount:2000,date:'2026-10-02',donationCategoryId:'donation-default-general'},
    {id:'two',type:'donation',amount:3000,date:'2026-10-08',donationCategoryId:'education'},
    {id:'three',type:'donation',amount:5000,date:'2026-10-15',donationCategoryId:'donation-default-general'},
    {id:'reserved',type:'donation',amount:9000,date:'2026-10-16',allocatedOn:'2026-10-16',allocationStatus:'allocated'},
    {id:'future',type:'donation',amount:8000,date:'2026-09-30',donationCategoryId:'education'},
  ];
  const october=donationSummary(state,'2026-10');
  assert.equal(october.donated,10000);
  assert.equal(october.transactionCount,3);
  assert.deepEqual(october.categories.map(row=>[row.name,row.amount]),[['General Charity',7000],['Education',3000]]);
  assert.equal(october.lifetime,18000);
  assert.equal(october.reserved,9000);
  state.donationCategories.find(category=>category.id==='education').name='Education Support';
  assert.deepEqual(donationSummary(state,'2026-10').categories.map(row=>[row.name,row.amount]),[['General Charity',7000],['Education Support',3000]]);
});

test('donation dashboard reports selected-month and all-time recorded income', () => {
  const state=initialFinanceState();
  state.transactions=[
    {id:'salary-oct',type:'income',amount:250000,date:'2026-10-01'},
    {id:'bonus-oct',type:'income',amount:30000,date:'2026-10-20'},
    {id:'salary-sep',type:'income',amount:240000,date:'2026-09-01'},
    {id:'pending-bank-income',type:'income',amount:90000,date:'2026-10-15',source:'bank',providerStatus:'PDNG'},
  ];
  const october=donationSummary(state,'2026-10');
  assert.equal(october.income,280000);
  assert.equal(october.incomeLifetime,520000);
  const allTime=donationSummary(state,null);
  assert.equal(allTime.income,520000);
  assert.equal(allTime.monthlyIncome,520000);
  assert.equal(allTime.incomeLifetime,520000);
  const allTimeView=donationSummary(state,null,'2026-10');
  assert.equal(allTimeView.monthlyIncome,280000);
});

test('legacy paid donations receive a stable starter category on normalization', () => {
  const state=normalizeFinanceState({transactions:[{id:'legacy',type:'donation',amount:1250,date:'2026-10-01'}]});
  assert.equal(state.transactions[0].donationCategoryId,'donation-default-general');
  assert.equal(donationSummary(state,'2026-10').categories[0].id,'donation-default-general');
});

test('an Expense under the Donation finance category is a donation and reduces owned money once', () => {
  const state=initialFinanceState();
  state.settings.configured=true;
  state.transactions=[
    {id:'income',type:'income',amount:10000,date:'2026-10-01'},
    {id:'gift',type:'expense',amount:2500,date:'2026-10-02',categoryId:'default-20',financeGroup:'donation',donationCategoryId:'donation-default-general'},
  ];
  const summary=financeSummary(state,'2026-10');
  assert.equal(summary.expenses,0);
  assert.equal(summary.donations,2500);
  assert.equal(deriveFinancePosition(state).totalOwned,7500);
  state.transactions[1]={...state.transactions[1],categoryId:'default-4',financeGroup:'expense',donationCategoryId:'',linkedDonationTargetId:''};
  assert.equal(donationSummary(state,'2026-10').donated,0);
  assert.equal(financeSummary(state,'2026-10').expenses,2500);
});

test('target monthly plans account for linked payments already made and cap the last month', () => {
  assert.equal(targetMonthlyAllocation(50000,20000,{months:6}),5000);
  assert.equal(targetMonthlyAllocation(50000,20000,{percent:10}),5000);
  assert.equal(targetMonthlyAllocation(50000,49500,{months:1}),500);
  assert.equal(targetMonthlyAllocation(50000,50000,{months:6}),0);
});

test('removing a linked payment reopens a target and its target-paused rule', () => {
  const state=initialFinanceState();
  state.donationTargets=[{id:'school',targetAmount:5000,status:'active',active:true}];
  state.allocationRules=[{id:'rule',donationTargetId:'school',active:true}];
  state.transactions=[{id:'paid',type:'expense',amount:5000,date:'2026-10-04',financeGroup:'donation',linkedDonationTargetId:'school'}];
  refreshDonationTargetStatus(state,'2026-10-04');
  assert.equal(state.donationTargets[0].status,'completed');
  state.transactions=[];
  refreshDonationTargetStatus(state,'2026-10-05');
  assert.equal(state.donationTargets[0].status,'active');
  assert.equal(state.donationTargets[0].active,true);
  assert.equal(state.allocationRules[0].active,true);
});

