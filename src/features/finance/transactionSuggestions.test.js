import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingTransactions } from './transactionSuggestions.js';

const transactions = [
  { id: 'old', title: 'Spice of India', amount: 30000, type: 'expense', date: '2026-01-05' },
  { id: 'newer', title: 'Spice of India Salary', amount: 30000, type: 'income', date: '2026-03-05' },
  { id: 'other', title: 'Tesco', amount: 1250, type: 'expense', date: '2026-03-10' },
];

test('suggestions match partial names and rank exact title matches first', () => {
  assert.deepEqual(matchingTransactions(transactions, 'Spice of India').map(item => item.id), ['old', 'newer']);
});

test('suggestions match multiple partial words and sort matching history newest first', () => {
  assert.deepEqual(matchingTransactions(transactions, 'spice ind').map(item => item.id), ['newer', 'old']);
});

test('suggestions omit the transaction being edited and enforce the result limit', () => {
  assert.deepEqual(matchingTransactions(transactions, 'spice', { excludeId: 'old', limit: 1 }).map(item => item.id), ['newer']);
});

test('suggestions appear from the first typed character and return no results for unrelated names', () => {
  assert.deepEqual(matchingTransactions(transactions, 's').map(item => item.id), ['newer', 'old', 'other']);
  assert.deepEqual(matchingTransactions(transactions, 'coffee'), []);
});
