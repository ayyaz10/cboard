import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveFinancePosition, inspectFinanceIntegrity } from './financeLedger.js';

const goal = { id: 'emergency', title: 'Emergency Fund', target: 100_000, saved: 20_000 };
const income = { id: 'income', type: 'income', title: 'Pay', amount: 100_000, date: '2026-10-01' };

test('moving money to a goal lowers spendable but preserves total owned', () => {
  const result = deriveFinancePosition({ goals: [goal], transactions: [income, { id: 'move', type: 'goal', targetId: goal.id, title: 'Goal: Emergency Fund', amount: 20_000, date: '2026-10-02' }] });
  assert.equal(result.spendable, 80_000);
  assert.equal(result.protected, 20_000);
  assert.equal(result.totalOwned, 100_000);
});

test('an expense from a protected goal reduces that fund and total owned, not spendable', () => {
  const result = deriveFinancePosition({ goals: [goal], transactions: [income, { id: 'move', type: 'goal', targetId: goal.id, title: 'Goal: Emergency Fund', amount: 20_000, date: '2026-10-02' }, { id: 'repair', type: 'expense', paidFromFundId: 'goal:emergency', amount: 5_000, title: 'Car repair', date: '2026-10-03' }] });
  assert.equal(result.spendable, 80_000);
  assert.equal(result.protected, 15_000);
  assert.equal(result.totalOwned, 95_000);
});

test('releasing fund money returns it to spendable without changing total owned', () => {
  const result = deriveFinancePosition({ goals: [goal], transactions: [income, { id: 'move', type: 'goal', targetId: goal.id, title: 'Goal: Emergency Fund', amount: 20_000, date: '2026-10-02' }, { id: 'release', type: 'goal', targetId: goal.id, goalMovement: 'release', amount: 3_000, title: 'Release fund', date: '2026-10-03' }] });
  assert.equal(result.spendable, 83_000);
  assert.equal(result.protected, 17_000);
  assert.equal(result.totalOwned, 100_000);
});

test('moving money from a fund back to spendable is an internal transfer', () => {
  const result = deriveFinancePosition({ goals: [goal], transactions: [income, { id: 'move', type: 'goal', targetId: goal.id, title: 'Goal: Emergency Fund', amount: 20_000, date: '2026-10-02' }, { id: 'back', type: 'transfer', fromFundId: 'goal:emergency', toFundId: '', transferKind: 'internal', amount: 3_000, title: 'Move back', date: '2026-10-03' }] });
  assert.equal(result.spendable, 83_000);
  assert.equal(result.protected, 17_000);
  assert.equal(result.totalOwned, 100_000);
});

test('allocated payment reserves reduce spendable; a paid donation reduces owned once', () => {
  const state = { goals: [], transactions: [income, { id: 'donation', type: 'donation', amount: 5_000, date: '2026-10-02', allocationStatus: 'allocated' }] };
  const reserved = deriveFinancePosition(state);
  assert.equal(reserved.spendable, 95_000);
  assert.equal(reserved.protected, 5_000);
  assert.equal(reserved.totalOwned, 100_000);
  state.transactions[1] = { ...state.transactions[1], allocationStatus: 'paid', allocatedOn: '2026-10-02', paymentDate: '2026-10-03', date: '2026-10-03' };
  const paid = deriveFinancePosition(state);
  assert.equal(paid.spendable, 95_000);
  assert.equal(paid.protected, 0);
  assert.equal(paid.totalOwned, 95_000);
});

test('current backup derives the simple balances without mutating legacy side ledgers', async () => {
  const fs = await import('node:fs');
  const backupPath = 'C:/Users/Ayyaz/Downloads/CBoard-Finance-Recipes-meal-planning-Grocery-Food-diary-Goals-progress-Notes-2026-10-14-1055.cboardbackup';
  if (!fs.existsSync(backupPath)) return;
  const { normalizeFinanceState } = await import('./financeData.js');
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  const state = normalizeFinanceState(backup.data.finance.data.workspace.state);
  const before = JSON.stringify({ goals: state.goals, contributions: state.goalContributions, debts: state.debts, payments: state.debtPayments });
  const result = deriveFinancePosition(state);
  assert.deepEqual({ spendable: result.spendable, protected: result.protected, totalOwned: result.totalOwned, debtOutstanding: result.debtOutstanding }, { spendable: 1_930, protected: 41_203, totalOwned: 43_133, debtOutstanding: 17_794 });
  assert.ok(inspectFinanceIntegrity(state).some(issue => issue.type === 'goal-balance-mismatch'));
  assert.equal(JSON.stringify({ goals: state.goals, contributions: state.goalContributions, debts: state.debts, payments: state.debtPayments }), before);
});
