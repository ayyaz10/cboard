const amount = value => Math.max(0, Math.round(Number(value) || 0));
const hasIncomeSnapshot = record => record.sourceIncomeAmount != null || Boolean(record.sourceIncomeDescription || record.sourceIncomeDate);

function allocationStatus(record, plannedAmount, appliedAmount) {
  if (record.reversedAt || record.status === 'reversed') return 'Reversed';
  if (record.reconciliationRequired) return 'Partial';
  if (appliedAmount >= plannedAmount && plannedAmount > 0) return 'Applied';
  if (appliedAmount > 0) return 'Partial';
  return 'Allocated';
}

/** A read-only view over Finance's canonical allocation records. */
export function autoAllocationEvents(state) {
  const transactions = Array.isArray(state?.transactions) ? state.transactions : [];
  const incomes = new Map(transactions.filter(item => item.type === 'income').map(item => [item.id, item]));
  const rules = new Map((state?.allocationRules || []).map(item => [item.id, item]));
  const goals = new Map((state?.goals || []).map(item => [item.id, item]));
  const debts = new Map((state?.debts || []).map(item => [item.id, item]));
  const targets = new Map((state?.donationTargets || []).map(item => [item.id, item]));
  const categories = new Map((state?.donationCategories || []).map(item => [item.id, item]));
  const events = [];
  const base = (income, record, allocationRuleId, allocationType, targetId, targetName, plannedAmount, appliedAmount, status, recordKind) => ({
    id: `${recordKind}:${record.id}`, sourceTransactionId: income.id, sourceIncomeId: income.id, sourceIncomeAvailable: Boolean(incomes.has(income.id)),
    sourceIncomeDate: record.sourceIncomeDate || income.date || record.effectiveDate || record.date || '', sourceIncomeDescription: record.sourceIncomeDescription || income.title || 'Deleted income', sourceIncomeAmount: amount(record.sourceIncomeAmount ?? income.amount),
    allocationRuleId, allocationType, targetId: targetId || '', targetName: targetName || allocationType,
    plannedAmount, appliedAmount, status, createdAt: record.createdAt || '', appliedAt: record.updatedAt || record.date || '',
    reason: record.reconciliationNote || record.reason || '', recordId: record.id, recordKind,
  });

  for (const record of state?.donationAccruals || []) {
    if (!record.automationRuleId || !record.linkedIncomeTransactionId) continue;
    const income = incomes.get(record.linkedIncomeTransactionId) || { id: record.linkedIncomeTransactionId };
    if (!incomes.has(record.linkedIncomeTransactionId) && !hasIncomeSnapshot(record)) continue;
    const planned = amount(record.accruedAmount ?? record.amount), applied = Math.min(planned, amount(record.paidAmount));
    const label = targets.get(record.linkedDonationTargetId)?.name || categories.get(record.categoryId)?.name || rules.get(record.automationRuleId)?.name || 'Donation';
    events.push(base(income, record, record.automationRuleId, 'donation', record.linkedDonationTargetId, label, planned, applied, allocationStatus(record, planned, applied), 'donation'));
  }
  for (const record of state?.debtAccruals || []) {
    const sourceId = record.linkedIncomeTransactionId || record.originalSourceIncomeId;
    if (!record.repaymentRuleId || !sourceId) continue;
    const income = incomes.get(sourceId) || { id: sourceId };
    if (!incomes.has(sourceId) && !hasIncomeSnapshot(record)) continue;
    const planned = amount(record.accruedAmount ?? record.amount), applied = Math.min(planned, amount(record.paidAmount));
    events.push(base(income, record, record.repaymentRuleId, 'debt', record.debtId, debts.get(record.debtId)?.name || record.note || 'Debt', planned, applied, allocationStatus(record, planned, applied), 'debt'));
  }
  const represented = new Set();
  for (const record of state?.goalContributions || []) {
    if (!record.sourceIncomeId || !record.allocationRuleId) continue;
    const income = incomes.get(record.sourceIncomeId) || { id: record.sourceIncomeId };
    if (!incomes.has(record.sourceIncomeId) && !hasIncomeSnapshot(record)) continue;
    if (record.transactionId) represented.add(record.transactionId);
    const value = amount(record.amount);
    events.push(base(income, record, record.allocationRuleId, 'goal', record.goalId, goals.get(record.goalId)?.title || rules.get(record.allocationRuleId)?.name || 'Goal', value, value, 'Applied', 'goal'));
  }
  for (const record of transactions) {
    const linkedIncomeId = record.sourceIncomeId || record.originalSourceIncomeId;
    if (!linkedIncomeId || !record.allocationRuleId || represented.has(record.id)) continue;
    const income = incomes.get(linkedIncomeId) || { id: linkedIncomeId };
    if (!incomes.has(linkedIncomeId) && !hasIncomeSnapshot(record)) continue;
    const type = ['donation', 'goal', 'debt'].includes(record.type) ? record.type : 'other';
    const label = type === 'goal' ? goals.get(record.targetId)?.title : type === 'debt' ? debts.get(record.targetId)?.name : type === 'donation' ? targets.get(record.linkedDonationTargetId)?.name : record.title;
    const value = amount(record.amount);
    events.push(base(income, record, record.allocationRuleId, type, record.targetId, label || record.title, value, record.reversedAt ? 0 : value, record.reversedAt ? 'Reversed' : record.allocationStatus === 'allocated' ? 'Allocated' : 'Applied', 'transaction'));
  }
  for (const record of state?.allocationHistory || []) {
    if (!['skipped', 'not_applicable', 'reversed'].includes(record.status) || !record.sourceIncomeId || !record.allocationRuleId) continue;
    const income = incomes.get(record.sourceIncomeId) || { id: record.sourceIncomeId };
    if (!incomes.has(record.sourceIncomeId) && !hasIncomeSnapshot(record)) continue;
    events.push(base(income, record, record.allocationRuleId, record.allocationType || 'other', record.targetId, record.targetName, amount(record.plannedAmount), amount(record.appliedAmount), record.status === 'reversed' ? 'Reversed' : record.status === 'not_applicable' ? 'Not applicable' : 'Skipped', record.status === 'reversed' ? 'reversal' : 'skipped'));
  }
  return events.sort((a, b) => String(b.sourceIncomeDate).localeCompare(String(a.sourceIncomeDate)) || String(b.createdAt).localeCompare(String(a.createdAt)) || a.id.localeCompare(b.id));
}

export function groupAutoAllocationsByIncome(events) {
  const groups = new Map();
  for (const event of events || []) {
    let group = groups.get(event.sourceIncomeId);
    if (!group) {
      group = { id: event.sourceIncomeId, sourceTransactionId: event.sourceTransactionId, sourceIncomeAvailable: event.sourceIncomeAvailable, date: event.sourceIncomeDate, description: event.sourceIncomeDescription, incomeAmount: event.sourceIncomeAmount, events: [], allocatedAmount: 0 };
      groups.set(group.id, group);
    }
    group.events.push(event);
    if (!['Reversed', 'Skipped', 'Not applicable'].includes(event.status)) group.allocatedAmount += event.plannedAmount;
  }
  return [...groups.values()].map(group => ({ ...group, remainingAmount: Math.max(0, group.incomeAmount - group.allocatedAmount), statuses: [...new Set(group.events.map(event => event.status))] }));
}

export function filterAutoAllocationEvents(events, { type = 'all', targetId = '' } = {}) {
  return (events || []).filter(event => (type === 'all' || event.allocationType === type) && (!targetId || event.targetId === targetId));
}
