import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudFetch } from './network.js';

function network(t, online, fetch) {
  const savedNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const savedFetch=globalThis.fetch;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:online}});
  globalThis.fetch=fetch;
  t.after(()=>{Object.defineProperty(globalThis,'navigator',savedNavigator);globalThis.fetch=savedFetch;});
}

test('offline cloud requests fail clearly without queueing or fetching', async t => {
  let calls=0;
  network(t,false,()=>{calls++;throw new Error('Should not fetch');});
  await assert.rejects(cloudFetch('https://example.test'), /offline.*not queued/);
  assert.equal(calls,0);
});
test('online requests preserve credentials and propagate server responses', async t => {
  const input='https://example.test';
  const options={method:'POST',body:'data',headers:{Authorization:'Bearer example'}};
  network(t,true,async (url,init)=>{assert.equal(url,input);assert.equal(init,options);return new Response('result',{status:409});});
  assert.equal((await cloudFetch(input,options)).status,409);
});
