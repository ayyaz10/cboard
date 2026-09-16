import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinanceHandler } from './handler.js';
const body = { text:'spent 100 on travel', currency:'GBP', today:'2026-09-16', categories:[{id:'travel',name:'Travel',type:'expense'}] };
const request = (payload = body, token = 'test') => new Request('https://local', {method:'POST',headers:token?{Authorization:`Bearer ${token}`}:{},body:JSON.stringify(payload)});
const config = { env:()=> 'test', createClient:()=>({auth:{getUser:async()=>({data:{user:{id:'test'}}})},rpc:async()=>({data:true})}) };
test('one generation produces a preview without writing finance data', async () => {
  let calls=0;
  const handler=createFinanceHandler({...config,generate:async(context)=>{calls++;assert.deepEqual(context,body);return {status:'ready',amount:'100',currency:'GBP',date:'2026-09-16',title:'Trip',categoryId:'travel',type:'expense'};}});
  assert.equal((await handler(request(body,''))).status,401);
  assert.equal((await handler(request({...body,text:''}))).status,400);
  const response=await handler(request());assert.equal(response.status,200);assert.equal((await response.json()).transaction.amount,10000);assert.equal(calls,1);
});
test('quota failures and provider failures preserve manual entry', async () => {
  const quota=createFinanceHandler({...config,createClient:()=>({auth:{getUser:async()=>({data:{user:{id:'test'}}})},rpc:async()=>({data:false})}),generate:async()=>{throw new Error('must not run');}});
  assert.equal((await quota(request())).status,429);
  const failed=createFinanceHandler({...config,generate:async()=>{throw new Error('provider unavailable');}});
  assert.equal((await failed(request())).status,502);
});
