import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCashTimeline, merchantDomain, parseOpeningBalance, transactionCashEffect } from './financeChartData.js';

test('cash timeline sorts transactions and applies every real cash movement', () => {
  const items = [
    { id: 'expense', title: 'Aldi', type: 'expense', amount: 1_000, date: '2026-09-03', createdAt: 'b' },
    { id: 'income', title: 'Salary', type: 'income', amount: 5_000, date: '2026-09-02', createdAt: 'a' },
    { id: 'goal', title: 'Holiday', type: 'goal', amount: 500, date: '2026-09-03', createdAt: 'a' },
    { id: 'other-month', title: 'Old', type: 'expense', amount: 9_999, date: '2026-08-01' },
  ];
  const timeline = buildCashTimeline(items, '2026-09', 2_000);
  assert.deepEqual(timeline.map((point) => point.balance), [2_000, 7_000, 6_500, 5_500]);
  assert.deepEqual(timeline.slice(1).map((point) => point.transaction.id), ['income', 'goal', 'expense']);
});

test('transfers do not invent spending while tracked allocations reduce available cash', () => {
  assert.equal(transactionCashEffect({ type: 'transfer', amount: 100 }), 0);
  for (const type of ['expense', 'donation', 'investment', 'debt', 'savings', 'budget', 'goal']) assert.equal(transactionCashEffect({ type, amount: 100 }), -100);
});

test('merchant recognition is conservative and opening balances allow zero', () => {
  assert.equal(merchantDomain('Weekly shop at ALDI'), 'aldi.co.uk');
  assert.equal(merchantDomain('Local corner shop'), '');
  assert.equal(parseOpeningBalance('0'), 0);
  assert.equal(parseOpeningBalance('1,234.56'), 123_456);
  assert.throws(() => parseOpeningBalance('-2'));
});
