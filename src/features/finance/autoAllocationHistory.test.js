import test from 'node:test';
import assert from 'node:assert/strict';
import { autoAllocationEvents, filterAutoAllocationEvents, groupAutoAllocationsByIncome } from './autoAllocationHistory.js';
import { applyIncomeAllocations, processIncomeTransactionChange } from './financeAllocations.js';
import { deriveFinancePosition } from './financeLedger.js';
import { normalizeFinanceState } from './financeData.js';

const data = () => ({
  transactions: [{ id: 'income-1', type: 'income', title: 'Salary', amount: 150000, date: '2026-11-10' }],
  allocationRules: [{ id: 'donation-rule', name: 'Giving' }, { id: 'goal-rule' }, { id: 'debt-rule' }],
  donationCategories: [{ id: 'charity', name: 'Charity' }], goals: [{ id: 'emergency', title: 'Emergency Fund' }], debts: [{ id: 'card', name: 'Card debt' }],
  donationAccruals: [{ id: 'd1', automationRuleId: 'donation-rule', linkedIncomeTransactionId: 'income-1', categoryId: 'charity', amount: 7500, accruedAmount: 7500, paidAmount: 0, status: 'outstanding' }],
  goalContributions: [{ id: 'g1', goalId: 'emergency', sourceIncomeId: 'income-1', allocationRuleId: 'goal-rule', transactionId: 'goal-tx', amount: 15000, date: '2026-11-10' }],
  transactions: [
    { id: 'income-1', type: 'income', title: 'Salary', amount: 150000, date: '2026-11-10' },
    { id: 'goal-tx', type: 'goal', targetId: 'emergency', sourceIncomeId: 'income-1', allocationRuleId: 'goal-rule', amount: 15000, allocationStatus: 'allocated' },
  ],
  debtAccruals: [{ id: 'debt-event', debtId: 'card', repaymentRuleId: 'debt-rule', linkedIncomeTransactionId: 'income-1', amount: 25000, accruedAmount: 25000, paidAmount: 0, status: 'outstanding' }],
});

test('shared history groups donation, goal, and debt allocations against the same income', () => {
  const state = data();
  const before = structuredClone(state);
  const events = autoAllocationEvents(state);
  assert.equal(events.length, 3);
  assert.ok(events.every(event => event.sourceIncomeId === 'income-1' && event.sourceTransactionId === 'income-1'));
  assert.deepEqual(events.map(event => [event.allocationType, event.targetId, event.plannedAmount]).sort(), [
    ['debt', 'card', 25000], ['donation', '', 7500], ['goal', 'emergency', 15000],
  ]);
  const [group] = groupAutoAllocationsByIncome(events);
  assert.equal(group.incomeAmount, 150000);
  assert.equal(group.allocatedAmount, 47500);
  assert.equal(group.remainingAmount, 102500);
  assert.deepEqual(state, before, 'building history does not change Finance state');
});

test('filtered views retain only matching allocation types and target IDs', () => {
  const events = autoAllocationEvents(data());
  assert.deepEqual(filterAutoAllocationEvents(events, { type: 'donation' }).map(event => event.plannedAmount), [7500]);
  assert.deepEqual(filterAutoAllocationEvents(events, { type: 'goal', targetId: 'emergency' }).map(event => event.targetId), ['emergency']);
  assert.deepEqual(filterAutoAllocationEvents(events, { type: 'debt', targetId: 'other-debt' }), []);
});

test('reconciled donation accrual shows partial and reversed lifecycle states', () => {
  const state = data();
  state.donationAccruals[0].paidAmount = 2000;
  assert.equal(autoAllocationEvents(state).find(event => event.allocationType === 'donation').status, 'Partial');
  state.donationAccruals[0].status = 'reversed';
  assert.equal(autoAllocationEvents(state).find(event => event.allocationType === 'donation').status, 'Reversed');
});

test('deleted source incomes retain auditable allocation snapshots without a broken source link', () => {
  const state = data();
  state.transactions = state.transactions.filter(item => item.id !== 'income-1');
  state.donationAccruals[0].sourceIncomeAmount = 150000;
  state.donationAccruals[0].sourceIncomeDescription = 'Salary';
  state.donationAccruals[0].sourceIncomeDate = '2026-11-10';
  state.donationAccruals[0].status = 'reversed';
  state.donationAccruals[0].linkedIncomeTransactionId = 'income-1';
  const event = autoAllocationEvents(state).find(item => item.allocationType === 'donation');
  assert.equal(event.sourceIncomeAvailable, false);
  assert.equal(event.sourceIncomeDescription, 'Salary');
  assert.equal(event.sourceIncomeAmount, 150000);
  assert.equal(event.status, 'Reversed');
  assert.equal(groupAutoAllocationsByIncome([event])[0].remainingAmount, 150000);
});

test('events without a valid source income or stable rule link are omitted', () => {
  const state = data();
  state.donationAccruals.push({ id: 'manual', amount: 500, linkedIncomeTransactionId: 'income-1' });
  state.debtAccruals.push({ id: 'orphan', amount: 500, repaymentRuleId: 'debt-rule', linkedIncomeTransactionId: 'deleted-income' });
  assert.equal(autoAllocationEvents(state).length, 3);
});


test('income allocation workflow creates one shared event per target without moving cash twice', () => {
  const state = {
    settings: { monthlyIncome: 0, currency: 'GBP' }, transactions: [{ id: 'income-1', type: 'income', title: 'Salary', amount: 150000, date: '2026-11-10' }],
    allocationRules: [
      { id: 'donation-rule', name: 'Giving', targetType: 'donation', donationCategoryId: 'charity', mode: 'percent', value: 500, timing: 'income', active: true },
      { id: 'goal-rule', name: 'Emergency', targetType: 'goal', targetId: 'emergency', mode: 'amount', value: 15000, timing: 'income', active: true },
      { id: 'debt-rule', name: 'Card', targetType: 'debt', targetId: 'card', mode: 'amount', value: 25000, timing: 'income', active: true },
    ], donationCategories: [{ id: 'charity', name: 'Charity' }], donationTargets: [], donationAccruals: [],
    goals: [{ id: 'emergency', title: 'Emergency Fund', target: 50000, saved: 0, status: 'active' }], goalContributions: [],
    debts: [{ id: 'card', name: 'Card debt', original: 100000, remaining: 100000, repaymentPlanStatus: 'active' }], debtAccruals: [], debtPayments: [],
    investments: [], categories: [], donationPayments: [], donationReversals: [], budgets: {}, accounts: [], creditCards: [], creditAgreements: [],
  };
  const before = deriveFinancePosition(state).spendable;
  applyIncomeAllocations(state, state.transactions[0]);
  const afterAllocation = deriveFinancePosition(state).spendable;
  const snapshot = structuredClone(state);
  const events = autoAllocationEvents(state);
  const [group] = groupAutoAllocationsByIncome(events);
  assert.equal(events.length, 3);
  assert.deepEqual(events.map(event => [event.allocationType, event.targetId, event.plannedAmount]).sort(), [
    ['debt', 'card', 25000], ['donation', '', 7500], ['goal', 'emergency', 15000],
  ]);
  assert.equal(group.allocatedAmount, 47500);
  assert.equal(group.remainingAmount, 102500);
  assert.equal(afterAllocation, before - 40000, 'canonical goal and debt reserves reduce spendable money without external payments');
  assert.deepEqual(state, snapshot, 'reading history never changes Finance state');
  const backupState = JSON.parse(JSON.stringify(state));
  const restoredEvents = autoAllocationEvents(backupState);
  assert.deepEqual(restoredEvents.map(event => [event.id, event.sourceIncomeId, event.allocationRuleId, event.targetId, event.status]), events.map(event => [event.id, event.sourceIncomeId, event.allocationRuleId, event.targetId, event.status]));  const restoredState = normalizeFinanceState(backupState);
  const restoredIncome = restoredState.transactions.find(item => item.id === 'income-1');
  const priorAllocationIds = restoredState.transactions.filter(item => item.sourceIncomeId === restoredIncome.id).map(item => item.id);
  processIncomeTransactionChange(restoredState, null, restoredIncome);
  assert.deepEqual(restoredState.transactions.filter(item => item.sourceIncomeId === restoredIncome.id).map(item => item.id), priorAllocationIds);
  assert.deepEqual(autoAllocationEvents(restoredState).map(event => event.id), events.map(event => event.id));
});


test('failed income rules retain a stable skipped history record without a Finance movement', () => {
  const state = {
    settings: { monthlyIncome: 0, currency: 'GBP' }, transactions: [{ id: 'income-skip', type: 'income', title: 'Pay', amount: 10000, date: '2026-11-10' }],
    allocationRules: [{ id: 'full-goal-rule', name: 'Emergency Fund', targetType: 'goal', targetId: 'goal-full', mode: 'amount', value: 5000, timing: 'income', active: true }],
    goals: [{ id: 'goal-full', title: 'Emergency Fund', target: 5000, saved: 5000, status: 'completed' }], goalContributions: [], transactionsArchive: [],
    debts: [], debtPayments: [], debtAccruals: [], donationAccruals: [], donationTargets: [], donationCategories: [],
  };
  const before = deriveFinancePosition(state).spendable;
  applyIncomeAllocations(state, state.transactions[0]);
  applyIncomeAllocations(state, state.transactions[0]);
  const events = autoAllocationEvents(state);
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'Skipped');
  assert.equal(events[0].targetId, 'goal-full');
  assert.equal(events[0].sourceIncomeDescription, 'Pay');
  assert.equal(groupAutoAllocationsByIncome(events)[0].allocatedAmount, 0);
  assert.equal(groupAutoAllocationsByIncome(events)[0].remainingAmount, 10000);
  assert.equal(state.transactions.length, 1);
  assert.equal(deriveFinancePosition(state).spendable, before);
});

test('legacy Finance workspaces normalize with an empty skipped allocation history', () => {
  const normalized = normalizeFinanceState({ transactions: [], allocationRules: [] });
  assert.deepEqual(normalized.allocationHistory, []);
});


test('income before a rule start is recorded as not applicable without changing balances', () => {
  const state = {
    settings: { monthlyIncome: 0, currency: 'GBP' }, transactions: [{ id: 'early-income', type: 'income', title: 'Pay', amount: 10000, date: '2026-11-10' }],
    allocationRules: [{ id: 'future-rule', name: 'Future reserve', targetType: 'savings', mode: 'amount', value: 2500, timing: 'income', startedOn: '2026-12-01', active: true }],
    goals: [], goalContributions: [], debts: [], debtPayments: [], debtAccruals: [], donationAccruals: [], donationTargets: [], donationCategories: [],
  };
  const before = deriveFinancePosition(state).spendable;
  applyIncomeAllocations(state, state.transactions[0]);
  const [event] = autoAllocationEvents(state);
  assert.equal(event.status, 'Not applicable');
  assert.equal(event.reason, 'Rule starts after this income.');
  assert.equal(groupAutoAllocationsByIncome([event])[0].allocatedAmount, 0);
  assert.equal(deriveFinancePosition(state).spendable, before);
});
