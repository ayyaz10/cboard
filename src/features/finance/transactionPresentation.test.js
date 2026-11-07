import test from 'node:test';
import assert from 'node:assert/strict';
import { canDeleteTransaction, canEditTransaction, canOpenLinkedRecord, canReclassifyTransaction, getTransactionDisplayType, getTransactionLinkedContext, summarizeTransactions } from './transactionPresentation.js';

test('transactions summary excludes internal transfers and non-cash allocations', () => {
  const data={categories:[{id:'charity',type:'donation'}]};
  const transactions=[
    {type:'income',amount:185000},
    {type:'expense',amount:4320,categoryId:'groceries'},
    {type:'expense',amount:2200,categoryId:'charity'},
    {type:'transfer',amount:10000},
    {type:'debt',amount:5000},
    {type:'creditPayment',amount:2900},
    {type:'savings',amount:20000,allocationStatus:'allocated'},
    {type:'expense',amount:1000,reversedAt:'2026-11-04'},
  ];
  assert.deepEqual(summarizeTransactions(transactions,data),{income:185000,spent:14420,net:170580});
});

test('display semantics identify internal movement and donation category events', () => {
  const data={categories:[{id:'charity',type:'donation'}]};
  assert.equal(getTransactionDisplayType({type:'transfer'},data),'Transfer');
  assert.equal(getTransactionDisplayType({type:'expense',categoryId:'charity'},data),'Donation payment');
  assert.equal(getTransactionDisplayType({type:'debt'},data),'Debt payment');
});

test('linked transaction details resolve debt, donation, credit, goal, and investment names without exposing identifiers', () => {
  const data={debts:[{id:'debt-1',name:'Wasik Malik'}],creditAgreements:[{id:'credit-1',title:'Philips Trimmer'}],donationTargets:[{id:'donation-1',name:'Local Charity'}],goals:[{id:'goal-1',title:'Emergency Fund'}],investments:[{id:'investment-1',name:'Index Fund'}]};
  const cases=[
    [{type:'debt',debtId:'debt-1'},{kind:'debt',id:'debt-1',label:'Wasik Malik'}],
    [{type:'donation',donationTargetId:'donation-1'},{kind:'donation',id:'donation-1',label:'Local Charity'}],
    [{type:'creditPayment',creditAgreementId:'credit-1'},{kind:'credit',id:'credit-1',label:'Philips Trimmer'}],
    [{type:'goal',goalId:'goal-1'},{kind:'goal',id:'goal-1',label:'Emergency Fund'}],
    [{type:'investment',targetId:'investment-1'},{kind:'investment',id:'investment-1',label:'Index Fund'}],
  ];
  for(const [transaction,expected] of cases){const linked=getTransactionLinkedContext(transaction,data);assert.deepEqual(linked,expected);assert.ok(canOpenLinkedRecord(linked));}
});

test('linked history blocks generic edit and delete while manual expenses remain eligible for safe correction', () => {
  const data={categories:[],debts:[{id:'debt-1',name:'Personal debt'}]};
  const linked={id:'linked',type:'debt',debtId:'debt-1',amount:100};
  const manual={id:'manual',type:'expense',amount:100};
  assert.equal(canEditTransaction(linked,data),false);
  assert.equal(canDeleteTransaction(linked,data),false);
  assert.equal(canEditTransaction(manual,data),true);
  assert.equal(canReclassifyTransaction(manual,data),true);
});
