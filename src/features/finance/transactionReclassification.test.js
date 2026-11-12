import test from 'node:test';
import assert from 'node:assert/strict';
import { applyIncomeAllocations } from './financeAllocations.js';
import { reclassifySavedTransactionState } from './transactionReclassification.js';
import { linkExistingTransactionsAsTransferState } from './financeAccounts.js';
import { findImportDuplicate } from './transactionImport.js';
import { financeAccountBalance } from './financeAccounts.js';
import { autoAllocationEvents } from './autoAllocationHistory.js';

const base = () => ({
  settings:{currency:'GBP'}, transactions:[], allocationHistory:[], allocationRules:[], goals:[], goalContributions:[], investments:[], debts:[], debtPayments:[], debtAccruals:[], donationAccruals:[], donationTargets:[], donationCategories:[], categories:[], accounts:[], creditCards:[], financePeople:[], personalLiabilities:[], personalReceivables:[],
});
function withGoalIncome() {
  const state=base(); state.accounts=[{id:'bank',openingBalance:10000}]; state.goals=[{id:'goal',title:'Emergency',target:100000,saved:0,status:'active'}];
  state.allocationRules=[{id:'rule',targetType:'goal',targetId:'goal',mode:'amount',value:1000,timing:'income',active:true}];
  const income={id:'salary',type:'income',title:'Salary',amount:5000,date:'2026-11-10',accountId:'bank',sourceType:'file_import',importDirection:'income'};
  state.transactions.push(income); applyIncomeAllocations(state,income); return state;
}

test('Income to reimbursement reconciles allocations and round trip restores one allocation set',()=>{
  const state=withGoalIncome(); state.financePeople=[{id:'p',name:'Ahmed'}]; state.personalReceivables=[{id:'r',personId:'p',originalAmount:8000,remainingAmount:8000,history:[]}];
  reclassifySavedTransactionState(state,{transactionId:'salary',type:'reimbursement',receivableId:'r'});
  assert.equal(state.transactions.find(item=>item.id==='salary').type,'reimbursement'); assert.equal(state.transactions.find(item=>item.id==='salary').id,'salary');
  assert.equal(state.personalReceivables[0].remainingAmount,3000); assert.equal(state.transactions.some(item=>item.sourceIncomeId==='salary'),false); assert.equal(state.goalContributions.length,0);
  assert.equal(financeAccountBalance(state,'bank'),15000); assert.equal(state.transactions.filter(item=>item.id==='salary').length,1);
  assert.equal(findImportDuplicate({date:'2026-11-10',amount:5000,description:'Salary',direction:'income'},state.transactions).id,'salary');
  reclassifySavedTransactionState(state,{transactionId:'salary',type:'income'});
  assert.equal(state.transactions.find(item=>item.id==='salary').type,'income'); assert.equal(state.personalReceivables[0].remainingAmount,8000); assert.equal(state.personalReceivables[0].history.length,1); assert.ok(state.personalReceivables[0].history[0].reversedAt);
  assert.equal(state.transactions.filter(item=>item.sourceIncomeId==='salary').length,1); assert.equal(state.goalContributions.filter(item=>item.sourceIncomeId==='salary').length,1); assert.deepEqual(autoAllocationEvents(state).filter(item=>item.sourceIncomeId==='salary').map(item=>item.status).sort(),['Applied','Reversed']);
});

test('Income to Refund and Refund to Income keeps identity and reconciles exactly once',()=>{
  const state=withGoalIncome(); state.transactions.push({id:'purchase',type:'expense',title:'Laptop',amount:7000,date:'2026-11-01',accountId:'bank'});
  reclassifySavedTransactionState(state,{transactionId:'salary',type:'refund',originalTransactionId:'purchase'});
  const refund=state.transactions.find(item=>item.id==='salary'); assert.equal(refund.type,'refund'); assert.equal(refund.originalTransactionId,'purchase'); assert.equal(state.transactions.some(item=>item.sourceIncomeId==='salary'),false);
  reclassifySavedTransactionState(state,{transactionId:'salary',type:'income'});
  assert.equal(refund.type,'income'); assert.equal(refund.originalTransactionId,undefined); assert.equal(state.transactions.filter(item=>item.sourceIncomeId==='salary').length,1);
  assert.equal(findImportDuplicate({date:'2026-11-10',amount:5000,description:'Salary',direction:'income'},state.transactions).id,'salary');
});

test('linked transfer to Income preserves both rows and removes the transfer link',()=>{
  const state=withGoalIncome(); state.transactions.push({id:'out',type:'expense',title:'Transfer out',amount:5000,date:'2026-11-10',accountId:'bank2'});
  linkExistingTransactionsAsTransferState(state,{firstId:'salary',secondId:'out'});
  reclassifySavedTransactionState(state,{transactionId:'salary',type:'income'});
  assert.equal(state.transactions.find(item=>item.id==='salary').type,'income'); assert.equal(state.transactions.find(item=>item.id==='out').type,'expense');
  assert.equal(state.transactions.some(item=>item.linkedTransferId),false); assert.equal(state.transactions.filter(item=>item.sourceIncomeId==='salary').length,1);
});

test('Income to Borrowed money creates a liability and removes income allocations',()=>{
  const state=withGoalIncome(); state.financePeople=[{id:'p',name:'Ahmed'}];
  reclassifySavedTransactionState(state,{transactionId:'salary',type:'borrowedCash',personId:'p'});
  const borrowed=state.transactions.find(item=>item.id==='salary'); assert.equal(borrowed.type,'borrowedCash'); assert.equal(borrowed.id,'salary');
  assert.equal(state.personalLiabilities.length,1); assert.equal(state.personalLiabilities[0].remainingAmount,5000); assert.equal(state.transactions.some(item=>item.sourceIncomeId==='salary'),false); assert.equal(financeAccountBalance(state,'bank'),15000);
  reclassifySavedTransactionState(state,{transactionId:'salary',type:'income'});
  assert.equal(borrowed.type,'income'); assert.equal(state.personalLiabilities.length,1); assert.equal(state.personalLiabilities[0].remainingAmount,0); assert.ok(state.personalLiabilities[0].reversedAt); assert.equal(state.transactions.filter(item=>item.sourceIncomeId==='salary').length,1);
});

test('Income to Card Credit requires a card relationship and changes classification',()=>{
  const state=withGoalIncome(); state.creditCards.push({id:'card',name:'Card'});
  assert.throws(()=>reclassifySavedTransactionState(state,{transactionId:'salary',type:'cardCredit'}),/linked to a credit card/);
  assert.equal(state.transactions.find(item=>item.id==='salary').type,'income');
  state.transactions.find(item=>item.id==='salary').accountId='card';
  reclassifySavedTransactionState(state,{transactionId:'salary',type:'cardCredit'});
  assert.equal(state.transactions.find(item=>item.id==='salary').type,'cardCredit'); assert.equal(state.transactions.some(item=>item.sourceIncomeId==='salary'),false);
});
