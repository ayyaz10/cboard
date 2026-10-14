#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeFinanceState } from '../src/features/finance/financeData.js';
import { deriveFinancePosition, inspectFinanceIntegrity } from '../src/features/finance/financeLedger.js';

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/audit-finance-backup.mjs <path-to-cboardbackup>');
  process.exit(2);
}
const backup = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
if (backup.format !== 'cboard-backup') throw new Error('This file is not a CBoard backup.');
const raw = backup.data?.finance?.data?.workspace?.state;
if (!raw) throw new Error('No Finance workspace state was found in this backup.');
const state = normalizeFinanceState(raw);
const pounds = amount => `£${(amount / 100).toFixed(2)}`;
const byType = Object.fromEntries([...new Set(state.transactions.map(item => item.type))].sort().map(type => {
  const records = state.transactions.filter(item => item.type === type);
  return [type, { count: records.length, total: pounds(records.reduce((sum, item) => sum + item.amount, 0)) }];
}));
const goals = state.goals.map(goal => ({
  name: goal.title,
  stored: pounds(goal.saved),
  contributionSideLedger: pounds(state.goalContributions.filter(item => item.goalId === goal.id).reduce((sum, item) => sum + item.amount, 0)),
  financeTransactions: pounds(state.transactions.filter(item => item.type === 'goal' && (item.targetId === goal.id || item.goalId === goal.id || item.title.toLowerCase() === `goal: ${goal.title}`.toLowerCase())).reduce((sum, item) => sum + item.amount, 0)),
}));
const debtPayments = state.debtPayments.reduce((sum, item) => sum + item.amount, 0);
const debtTransactions = state.transactions.filter(item => item.type === 'debt' && item.allocationStatus !== 'allocated').reduce((sum, item) => sum + item.amount, 0);
const report = {
  backup: { id: backup.backupId, createdAt: backup.createdAt, modified: false },
  transactions: { count: state.transactions.length, byType },
  goals,
  goalSideLedgerTotal: pounds(state.goalContributions.reduce((sum, item) => sum + item.amount, 0)),
  debtPayments: { sideLedger: pounds(debtPayments), transactionLedgerPaid: pounds(debtTransactions) },
  derivedPosition: Object.fromEntries(Object.entries(deriveFinancePosition(state)).filter(([key]) => ['spendable', 'protected', 'protectedFunds', 'reservedPayments', 'totalOwned', 'debtOutstanding'].includes(key)).map(([key, value]) => [key, pounds(value)])),
  integrityIssues: inspectFinanceIntegrity(state),
};
console.log(JSON.stringify(report, null, 2));
