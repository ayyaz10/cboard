import test from 'node:test';
import assert from 'node:assert/strict';
import { clearCurrencyCache, convertMinorUnits, getCurrencyQuote } from './currencyService.js';

test('currency quotes normalize codes and convert integer minor units', async () => {
  clearCurrencyCache();
  const quote = await getCurrencyQuote('GBP','PKR',async()=>({ok:true,json:async()=>({date:'2026-09-25',gbp:{pkr:375.25}})}));
  assert.deepEqual(quote,{from:'GBP',to:'PKR',rate:375.25,date:'2026-09-25',provider:'Currency API'});
  assert.equal(convertMinorUnits(100,quote.rate),37525);
});

test('currency service falls back and rejects missing pairs', async () => {
  clearCurrencyCache();
  let calls=0;
  const quote=await getCurrencyQuote('PKR','GBP',async()=>{calls++;if(calls===1)throw new Error('offline');return {ok:true,json:async()=>({date:'2026-09-25',pkr:{gbp:.002665}})}});
  assert.equal(quote.rate,.002665);
  assert.equal(calls,2);
  clearCurrencyCache();
  await assert.rejects(()=>getCurrencyQuote('GBP','ZZZ',async()=>({ok:true,json:async()=>({date:'2026-09-25',gbp:{pkr:375}})})),/No GBP to ZZZ rate/);
});

test('same-currency quotes do not call the network', async () => {
  const quote=await getCurrencyQuote('GBP','GBP',async()=>{throw new Error('should not fetch')});
  assert.equal(quote.rate,1);
});
