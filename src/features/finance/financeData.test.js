import test from 'node:test';
import assert from 'node:assert/strict';
import { initialFinanceState, normalizeFinanceState } from './financeData.js';

test('migration reclassifies only linked legacy Savings, Goal, and Budget deductions as reserves', () => {
  const legacy = initialFinanceState();
  legacy.allocationRules = [{ id: 'rule' }];
  legacy.transactions = [
    { id: 'auto-goal', type: 'goal', amount: 1000, date: '2026-08-01', allocationRuleId: 'rule', allocationStatus: 'completed' },
    { id: 'auto-save', type: 'savings', amount: 2000, date: '2026-08-02', allocationRuleId: 'rule', allocationStatus: 'completed' },
    { id: 'manual-goal', type: 'goal', amount: 3000, date: '2026-08-03', allocationStatus: 'completed' },
    { id: 'invested', type: 'investment', amount: 4000, date: '2026-08-04', allocationRuleId: 'rule', allocationStatus: 'completed' },
  ];
  const migrated = normalizeFinanceState(legacy);
  assert.equal(migrated.transactions[0].allocationStatus, 'allocated');
  assert.equal(migrated.transactions[0].accountingKind, 'allocation');
  assert.equal(migrated.transactions[0].allocatedOn, '2026-08-01');
  assert.equal(migrated.transactions[1].allocationStatus, 'allocated');
  assert.equal(migrated.transactions[2].allocationStatus, 'completed');
  assert.equal(migrated.transactions[3].allocationStatus, 'completed');
});
