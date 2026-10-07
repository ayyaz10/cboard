import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllTransactions, pendingBookingMatch, transactionIdentity, transactionProjection } from './handler.js';

test('transaction pagination continues across an empty page with a continuation key', async () => {
  const pages = [
    { transactions: [{ entry_reference: 'one' }], continuation_key: 'page-2' },
    { transactions: [], continuation_key: 'page-3' },
    { transactions: [{ entry_reference: 'two' }] },
  ];
  const requests = [];
  const all = await fetchAllTransactions({}, 'bank-account-uid', null, '2026-10-01', async (_config, path) => {
    requests.push(path);
    return pages.shift();
  });
  assert.deepEqual(all.map(item => item.entry_reference), ['one', 'two']);
  assert.match(requests[0], /date_from=2026-10-01/);
  assert.match(requests[1], /continuation_key=page-2/);
  assert.match(requests[2], /continuation_key=page-3/);
});

test('pagination fails closed if the provider repeats a continuation key', async () => {
  await assert.rejects(fetchAllTransactions({}, 'account', null, null, async () => ({ transactions: [], continuation_key: 'same' })), /repeated/);
});

test('entry_reference is primary identity and never transaction_id', () => {
  const first = transactionIdentity({ entry_reference: 'entry-1', transaction_id: 'volatile-a' });
  const second = transactionIdentity({ entry_reference: 'entry-1', transaction_id: 'volatile-b' });
  assert.deepEqual(first, second);
});

test('fallback identity refuses to merge amount/date-only lookalikes', () => {
  const tx = { transaction_amount: { amount: '10.00', currency: 'GBP' }, credit_debit_indicator: 'DBIT', transaction_date: '2026-10-01' };
  assert.equal(transactionIdentity(tx).fallback, null);
  assert.equal(transactionIdentity({ ...tx, creditor: { name: 'Tesco' } }).fallback, null);
  assert.notEqual(transactionIdentity({ ...tx, creditor: { name: 'Tesco' }, remittance_information: ['CARD PURCHASE 1234'] }).fallback, null);
});

test('pending to booked reconciliation requires exact attributes and close dates', () => {
  const pending = { status: 'PDNG', transaction: { status: 'PDNG', transaction_amount: { amount: '34.72', currency: 'GBP' }, credit_debit_indicator: 'DBIT', transaction_date: '2026-10-01', creditor: { name: 'Tesco' } } };
  const booked = { status: 'BOOK', transaction_amount: { amount: '34.72', currency: 'GBP' }, credit_debit_indicator: 'DBIT', booking_date: '2026-10-03', creditor: { name: 'Tesco' } };
  assert.equal(pendingBookingMatch(pending, booked), true);
  assert.equal(pendingBookingMatch(pending, { ...booked, transaction_amount: { amount: '35.00', currency: 'GBP' } }), false);
  assert.equal(pendingBookingMatch(pending, { ...booked, debtor: { name: 'Different merchant' }, creditor: undefined }), false);
});

test('transaction projection maps CRDT to positive income and excludes unsettled amounts from reports', () => {
  const row = { id: 'row-1', connection_id: 'connection', bank_account_id: 'account', entry_reference: 'ref', status: 'PDNG', created_at: '2026-10-01T00:00:00Z', last_synced_at: '2026-10-01T00:00:00Z', transaction: { transaction_amount: { amount: '500.00', currency: 'GBP' }, credit_debit_indicator: 'CRDT', status: 'PDNG', transaction_date: '2026-10-01', debtor: { name: 'Employer' } } };
  const projected = transactionProjection(row);
  assert.equal(projected.type, 'income');
  assert.equal(projected.amount, 50000);
  assert.equal(projected.title, 'Employer');
  assert.equal(projected.providerStatus, 'PDNG');
});

test('two same-merchant same-day transactions with distinct entry references remain distinct', () => {
  const first = transactionIdentity({ entry_reference: 'purchase-a', transaction_id: 'change-1' });
  const second = transactionIdentity({ entry_reference: 'purchase-b', transaction_id: 'change-2' });
  assert.notEqual(first.entryReference, second.entryReference);
});
