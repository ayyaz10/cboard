import test from 'node:test';
import assert from 'node:assert/strict';
import { initialFinanceState, normalizeFinanceState } from './financeData.js';
import { financeSummary } from './financeMath.js';
import { deriveFinancePosition } from './financeLedger.js';
import { creditCardLiability } from './creditCards.js';
import { expenseCategoryReport } from './financeReports.js';
import { addFinancePerson, createPersonLiabilityState, createReceivableState, flexibleBalanceSummary, recordBorrowedCashState, repayPersonState, receiveReimbursementState, validateFunding } from './flexiblePayments.js';

const base = () => { const state=initialFinanceState(); state.categories=[{id:'food',name:'Food',type:'expense'}]; state.transactions=[{id:'opening',type:'income',amount:100000,date:'2026-11-01'},{id:'purchase',type:'expense',amount:12000,categoryId:'food',title:'Dinner',date:'2026-11-02',fundingSources:[{kind:'person',amount:12000,personId:'ahmed'}]}]; state.financePeople=[{id:'ahmed',name:'Ahmed',archived:false}]; return state; };

test('funding validation requires an exact sum and preserves distinct source amounts',()=>{
 assert.deepEqual(validateFunding(50000,[{kind:'owned',amount:10000},{kind:'bnpl',sourceId:'klarna',amount:30000},{kind:'person',sourceId:'ahmed',amount:10000}]).map(x=>x.amount),[10000,30000,10000]);
 assert.throws(()=>validateFunding(50000,[{kind:'owned',amount:48000}]),/20.00 still needs/);
 assert.throws(()=>validateFunding(50000,[{kind:'owned',amount:51000}]),/exceed/);
});

test('someone else paid purchase leaves cash unchanged and creates a person payable; repayment is not spending',()=>{
 const state=base(); createPersonLiabilityState(state,{personId:'ahmed',amount:12000,transactionId:'purchase',date:'2026-11-02'});
 const cash=deriveFinancePosition(state).totalOwned;
 const liability=state.personalLiabilities[0]; repayPersonState(state,liability.id,{amount:5000,date:'2026-11-10'});
 assert.equal(deriveFinancePosition(state).totalOwned,cash-5000);
 assert.equal(liability.remainingAmount,7000);
 assert.equal(financeSummary(state,'2026-11').expenses,12000);
 assert.equal(financeSummary(state,'2026-11').income,100000);
 assert.equal(flexibleBalanceSummary(state).liabilities,7000);
 assert.equal(liability.history.length,2);
});

test('borrowed cash increases owned cash and a payable without adding income',()=>{
 const state=initialFinanceState(); const person=addFinancePerson(state,'Ahmed');
 const before=deriveFinancePosition(state).totalOwned; recordBorrowedCashState(state,{personId:person.id,amount:20000,date:'2026-11-10'});
 assert.equal(deriveFinancePosition(state).totalOwned,before+20000);
 assert.equal(financeSummary(state,'2026-11').income,0);
 assert.equal(flexibleBalanceSummary(state).liabilities,20000);
});

test('shared purchase reimbursement reduces net expense and its receipt is not income',()=>{
 const state=base(); createReceivableState(state,{personId:'ahmed',amount:4000,transactionId:'purchase',date:'2026-11-02'});
 const before=deriveFinancePosition(state).totalOwned; receiveReimbursementState(state,state.personalReceivables[0].id,{amount:1500,date:'2026-11-12'});
 assert.equal(deriveFinancePosition(state).totalOwned,before+1500);
 assert.equal(state.personalReceivables[0].remainingAmount,2500);
 assert.equal(financeSummary(state,'2026-11').expenses,10500);
 assert.equal(financeSummary(state,'2026-11').income,100000);
 assert.equal(flexibleBalanceSummary(state).receivables,2500);
 assert.equal(expenseCategoryReport(state,{mode:'month',month:'2026-11'}).total,10500);
});

test('people and payment relationships survive workspace backup-shaped normalization',()=>{
 const state=base(); createPersonLiabilityState(state,{personId:'ahmed',amount:12000,transactionId:'purchase',date:'2026-11-02'});
 const restored=normalizeFinanceState(JSON.parse(JSON.stringify(state)));
 assert.equal(restored.personalLiabilities[0].transactionId,'purchase');
 assert.equal(restored.financePeople[0].id,'ahmed');
});

test('split purchase is one expense with owned, card, and person balances recorded once',()=>{
 const state=initialFinanceState();state.categories=[{id:'food',name:'Food',type:'expense'}];state.transactions=[{id:'salary',type:'income',amount:100000,date:'2026-11-01'},{id:'dinner',type:'expense',title:'Dinner',amount:50000,date:'2026-11-02',categoryId:'food',paymentSourceType:'split',fundingSources:[{kind:'owned',amount:10000},{kind:'creditCard',sourceId:'card-1',amount:30000},{kind:'person',sourceId:'ahmed',personId:'ahmed',amount:10000}]}];state.creditCards=[{id:'card-1',name:'Card',openingLiability:0}];state.financePeople=[{id:'ahmed',name:'Ahmed',archived:false}];createPersonLiabilityState(state,{personId:'ahmed',amount:10000,transactionId:'dinner',date:'2026-11-02'});
 assert.equal(financeSummary(state,'2026-11').expenses,50000);assert.equal(deriveFinancePosition(state).totalOwned,60000);assert.equal(deriveFinancePosition(state).totalOwned+creditCardLiability(state,'card-1'),90000);assert.equal(creditCardLiability(state,'card-1'),30000);assert.equal(flexibleBalanceSummary(state).liabilities,10000);
});
