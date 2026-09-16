import test from 'node:test';
import assert from 'node:assert/strict';
import { weightInKg, displayWeight, validateEntry, weightSummary, localDate } from './weightData.js';
test('kg and lb records remain comparable with precise canonical storage', () => {
  assert.equal(weightInKg('100', 'kg'), 100);
  assert.equal(displayWeight(100, 'lb'), 220.46);
  assert.ok(Math.abs(weightInKg('220.46226218','lb') - 100) < 0.000001);
  assert.equal(displayWeight(weightInKg('185.5','lb'),'lb'),185.5);
});
test('blank, negative and invalid weights and dates are rejected', () => {
  for(const value of ['', ' ', 'abc', 'Infinity', '0', '-1', '1001']) assert.throws(()=>weightInKg(value,'kg'));
  assert.throws(()=>weightInKg(85,'stones'));
  const entry={date:localDate(),weight_kg:85,note:''};
  assert.doesNotThrow(()=>validateEntry(entry));
  for(const date of ['2026-02-30','not a date','2999-01-01']) assert.throws(()=>validateEntry({...entry,date}));
  assert.throws(()=>validateEntry({...entry,note:'x'.repeat(1001)}));
});
test('summary follows entry dates rather than insertion order, without mutating history', () => {
  const entries=[{date:'2026-09-16',weight_kg:'82.5'},{date:'2026-09-01',weight_kg:'85'},{date:'2026-09-10',weight_kg:'84'}];
  assert.deepEqual(weightSummary(entries),{start:85,latest:82.5,change:-2.5,count:3});
  assert.equal(entries[0].date,'2026-09-16');
  assert.equal(weightSummary([]),null);
  assert.equal(weightSummary([entries[0]]).change,0);
});
