import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultMerchants, makeMerchant, matchMerchant, normalizeMerchantName, resolveMerchant } from './merchantDirectory.js';

test('merchant normalization ignores punctuation, accents, and case',()=>{
  assert.equal(normalizeMerchantName('  McDonald’s! '),'mcdonald s');
  assert.equal(normalizeMerchantName('CAFÉ & Co.'),'cafe and co');
});

test('built-in merchants match store suffixes and common aliases',()=>{
  assert.equal(matchMerchant('ALDI STORES')?.displayName,'Aldi');
  assert.equal(matchMerchant('Aldi Kirkcaldy')?.displayName,'Aldi');
  assert.equal(matchMerchant('Aldi - Weight loss')?.displayName,'Aldi');
  assert.equal(matchMerchant('McDonalds')?.displayName,"McDonald's");
  assert.ok(defaultMerchants.length>=20);
});

test('custom exact names and aliases take priority over built-ins',()=>{
  const custom={id:'custom-aldi',displayName:'My Aldi',aliases:['aldi stores'],logoType:'custom',logoData:'data:image/webp;base64,AA=='};
  assert.equal(matchMerchant('ALDI STORES',[custom]).id,'custom-aldi');
  assert.equal(resolveMerchant({title:'ALDI STORES'},[custom]).id,'custom-aldi');
  assert.equal(resolveMerchant({title:'Anything',merchantId:'custom-aldi'},[custom]).id,'custom-aldi');
});

test('uncertain and unrelated merchant names are not force-matched',()=>{
  assert.equal(matchMerchant('Random local shop'),null);
  assert.equal(matchMerchant('Al'),null);
});

test('new merchant profiles include normalized reusable aliases',()=>{
  const merchant=makeMerchant('Spice of India','spice india, spice-of-india','data:image/webp;base64,AA==');
  assert.equal(matchMerchant('Spice India',[merchant]).id,merchant.id);
  assert.equal(merchant.logoType,'custom');
});
