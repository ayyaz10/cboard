import test from 'node:test';
import assert from 'node:assert/strict';
import { getTransactionDisplayType, summarizeTransactions } from './transactionPresentation.js';

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
