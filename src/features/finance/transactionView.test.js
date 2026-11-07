import test from 'node:test';
import assert from 'node:assert/strict';
import { activeTransactionFilterCount, readTransactionView, transactionViewDateRange, writeTransactionView } from './transactionView.js';

test('transaction URL state round-trips search, filters, sort, and custom dates', () => {
  const view={period:'custom',month:'2026-11',from:'2026-11-03',to:'2026-11-17',query:'Aldi',type:'expense',category:'groceries',source:'card',linkedType:'all',minAmount:'5.00',maxAmount:'100',reversed:'active',sort:'oldest'};
  const search=writeTransactionView('section=transactions&keep=1',view);
  assert.equal(new URLSearchParams(search).get('keep'),'1');
  assert.deepEqual(readTransactionView(search,'2026-11'),view);
  assert.deepEqual(transactionViewDateRange(view,'2026-11'),{from:'2026-11-03',to:'2026-11-17'});
  assert.equal(activeTransactionFilterCount(view),5);
});

test('invalid custom URL ranges fall back to a valid local current-month range', () => {
  const view=readTransactionView('?txPeriod=custom&txFrom=2026-11-30&txTo=2026-11-01','2026-11');
  assert.deepEqual([view.period,view.from,view.to],['custom','2026-11-01','2026-11-30']);
});

test('date periods use local calendar boundaries without timestamp arithmetic', () => {
  assert.deepEqual(transactionViewDateRange({period:'previous-month',month:'2026-03'},'2026-03'),{from:'2026-02-01',to:'2026-02-28'});
  assert.deepEqual(transactionViewDateRange({period:'year',month:'2024-02'},'2026-11'),{from:'2024-01-01',to:'2024-12-31'});
  assert.deepEqual(transactionViewDateRange({period:'all',month:'2026-11'},'2026-11'),{from:'',to:''});
});
