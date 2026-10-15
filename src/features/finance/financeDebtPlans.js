const PLAN_STATUSES = new Set(['not_started', 'scheduled', 'active', 'paused', 'completed']);

export function plannedDebtPayment(debt) {
  const requested = debt?.plannedPaymentMode === 'percentage'
    ? Math.round(Number(debt.original || 0) * Number(debt.plannedPaymentPercent || 0) / 10_000)
    : Number(debt?.plannedAmount || 0);
  return Math.max(0, Math.min(Number(debt?.remaining || 0), Math.round(requested)));
}

export function debtPlanStatus(debt, rules = [], asOfDate = new Date().toISOString().slice(0, 10)) {
  if (!debt || debt.status === 'paid' || Number(debt.remaining) <= 0) return 'completed';
  const rulesForDebt = rules.filter(rule => rule.targetType === 'debt' && rule.targetId === debt.id);
  if (debt.repaymentPlanStatus && PLAN_STATUSES.has(debt.repaymentPlanStatus)) {
    if (debt.repaymentPlanStatus === 'scheduled' && debt.repaymentStartDate <= asOfDate) return 'active';
    return debt.repaymentPlanStatus;
  }
  // Legacy `status: active` meant the debt was open. Only actual plan evidence
  // (an existing linked deduction or a future plan date) migrates as a plan.
  const activeRule = rulesForDebt.find(rule => rule.active);
  if (activeRule) {
    const startDate = debt.repaymentStartDate || activeRule.startedOn;
    return startDate && startDate > asOfDate ? 'scheduled' : 'active';
  }
  if (rulesForDebt.length) return 'paused';
  if (debt.repaymentStartDate && debt.repaymentStartDate > asOfDate) return 'scheduled';
  return 'not_started';
}

export function migrateDebtPlanStatuses(debts = [], rules = [], asOfDate = new Date().toISOString().slice(0, 10)) {
  for (const debt of debts) {
    debt.status = Number(debt.remaining) <= 0 || debt.status === 'paid' ? 'paid' : 'open';
    debt.repaymentStartDate ||= rules.find(rule => rule.targetType === 'debt' && rule.targetId === debt.id && rule.active)?.startedOn || '';
    debt.repaymentPlanStatus = debtPlanStatus(debt, rules, asOfDate);
    if (debt.repaymentPlanStatus === 'completed') debt.status = 'paid';
  }
  for (const rule of rules) {
    if (rule.targetType !== 'debt') continue;
    const debt = debts.find(item => item.id === rule.targetId);
    if (!debt || debt.status === 'paid' || ['paused', 'not_started', 'completed'].includes(debt.repaymentPlanStatus)) rule.active = false;
  }
  return debts;
}

export function debtPlanSummary(debts = [], rules = [], asOfDate = new Date().toISOString().slice(0, 10)) {
  const statuses = debts.map(debt => debtPlanStatus(debt, rules, asOfDate));
  return {
    openDebtCount: debts.filter(debt => debt.status !== 'paid' && Number(debt.remaining) > 0).length,
    activePlanCount: statuses.filter(status => status === 'active').length,
  };
}
