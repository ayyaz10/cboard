import test from 'node:test';
import assert from 'node:assert/strict';
import { updateReceiptPurchasesState } from '../features/groceries/receiptPurchases.js';

const food={id:'food-oats',name:'Oats',aliases:['Oat porridge'],quantity:100,unit:'g',groceryTrackingEnabled:true,shoppingListEnabled:true};
const baseState=()=>({items:[{id:'stock-oats',name:'Oats',foodId:'food-oats',quantity:500,unit:'g'}],shopping:[{id:'shop-oats',name:'Oats',foodId:'food-oats',quantity:1000,unit:'g'}],wishlist:[],settings:{currency:'GBP'}});
const transaction=(packSize=1,lineTotal=100)=>({id:'tx-aldi',type:'expense',date:'2026-10-19',amount:lineTotal,receipt:{total:lineTotal,itemCount:1,unresolvedLines:[],items:[{id:'item-oats',canonicalFoodId:'food-oats',packSize,packUnit:'kg',quantity:1,unit:'each',lineTotal}]}});

test('receipt grocery events apply once, replace edits by delta, and reverse on removal',()=>{
  const first=updateReceiptPurchasesState(baseState(),transaction(),[food]);
  assert.equal(first.applied,1);assert.equal(first.state.items[0].quantity,1500);assert.equal(first.state.shopping.length,0);
  const repeated=updateReceiptPurchasesState(first.state,transaction(),[food]);
  assert.equal(repeated.state.items[0].quantity,1500);assert.equal(repeated.state.shopping.length,0);
  const edited=updateReceiptPurchasesState(repeated.state,transaction(2,200),[food]);
  assert.equal(edited.state.items[0].quantity,2500);assert.equal(edited.state.shopping.length,0);
  const removed=updateReceiptPurchasesState(edited.state,{...transaction(),receipt:null},[food]);
  assert.equal(removed.state.items[0].quantity,500);assert.equal(removed.state.shopping[0].id,'shop-oats');assert.equal(removed.state.shopping[0].quantity,1000);
});

test('unreconciled receipt cannot change stock and an explicitly disabled food stays untouched',()=>{
  const mismatch={...transaction(),amount:200};
  const incomplete=updateReceiptPurchasesState(baseState(),mismatch,[food]);
  assert.equal(incomplete.state.items[0].quantity,500);assert.ok(incomplete.warnings.length);
  const disabled=updateReceiptPurchasesState(baseState(),transaction(),[{...food,groceryTrackingEnabled:false}]);
  assert.equal(disabled.state.items[0].quantity,500);assert.equal(disabled.applied,0);
});

test('reversing an already-used receipt clamps available stock and retains the unrecovered amount as shortage',()=>{
  const bought=updateReceiptPurchasesState(baseState(),transaction(),[food]);
  bought.state.items[0].quantity=300;
  const removed=updateReceiptPurchasesState(bought.state,{...transaction(),receipt:null},[food]);
  assert.equal(removed.state.items[0].quantity,0);
  assert.equal(removed.state.items[0].shortage,700);
});
