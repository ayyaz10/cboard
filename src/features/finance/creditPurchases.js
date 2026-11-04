const validDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};
const cents = value => Number.isSafeInteger(value) && value >= 0;
const creditPaymentTransactions = state => (state.transactions || []).filter(item => item.type === 'creditPayment' && (!item.source || item.providerStatus === 'BOOK'));
const activeTransactions = state => creditPaymentTransactions(state).filter(item => !item.reversedAt);

export function mutateCreditState(state, mutation) {
  mutation(state);
  return state;
}

function cleanProductUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length > 2048) throw new Error('Product links must be 2,048 characters or fewer.');
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('Enter a valid product link starting with https:// or http://.'); }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Product links must use HTTP or HTTPS and cannot contain sign-in credentials.');
  return parsed.href;
}

function addDays(date, days) {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function addMonths(date, count) {
  const [year, month, day] = date.split('-').map(Number);
  const targetMonth = month - 1 + count;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = (targetMonth % 12 + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, normalizedMonth, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

function distribute(total, count) {
  const base = Math.floor(total / count), remainder = total % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function generateCreditSchedule({ agreementId, principalAmount, financeCharge = 0, term, frequency = 'monthly', customDays = 30, firstPaymentDate }) {
  if (!agreementId || !cents(principalAmount) || !cents(financeCharge) || (principalAmount <= 0 && financeCharge <= 0) || !Number.isInteger(term) || term < 1 || term > 600 || !validDate(firstPaymentDate)) throw new Error('Enter valid credit agreement terms.');
  if (!['monthly', 'weekly', 'fortnightly', 'custom'].includes(frequency)) throw new Error('Choose a supported payment frequency.');
  if (frequency === 'custom' && (!Number.isInteger(customDays) || customDays < 1 || customDays > 365)) throw new Error('Custom payment intervals must be from 1 to 365 days.');
  const total = principalAmount + financeCharge;
  if (!Number.isSafeInteger(total) || total < principalAmount) throw new Error('The total repayable amount is outside the supported range.');
  const amounts = distribute(total, term), principals = distribute(principalAmount, term);
  return amounts.map((amount, index) => ({
    id: `${agreementId}:instalment:${index + 1}`,
    sequence: index + 1,
    dueDate: frequency === 'monthly' ? addMonths(firstPaymentDate, index) : addDays(firstPaymentDate, index * (frequency === 'weekly' ? 7 : frequency === 'fortnightly' ? 14 : customDays)),
    amount,
    principalAmount: principals[index],
    financeCostAmount: amount - principals[index],
  }));
}

export function getCreditPaymentTransactions(state, agreementId) {
  return creditPaymentTransactions(state).filter(item => item.creditAgreementId === agreementId);
}

export function getCreditAgreementBalances(state, agreement) {
  if (!agreement) return { principalRemaining: 0, financeCostRemaining: 0, totalRemaining: 0, paidPrincipal: 0, paidFinanceCost: 0, paidTotal: 0 };
  const payments = activeTransactions(state).filter(item => item.creditAgreementId === agreement.id);
  const paidPrincipal = payments.reduce((sum, item) => sum + (Number.isSafeInteger(item.creditPrincipalAmount) ? item.creditPrincipalAmount : 0), 0);
  const paidFinanceCost = payments.reduce((sum, item) => sum + (Number.isSafeInteger(item.creditFinanceCostAmount) ? item.creditFinanceCostAmount : 0), 0);
  const paidTotal = payments.reduce((sum, item) => sum + item.amount, 0);
  if (agreement.settledEarlyAt || agreement.status === 'cancelled') return { principalRemaining: 0, financeCostRemaining: 0, totalRemaining: 0, paidPrincipal, paidFinanceCost, paidTotal };
  const principalRemaining = Math.max(0, agreement.financedAmount - paidPrincipal);
  const financeCostRemaining = Math.max(0, agreement.financeCharge - paidFinanceCost);
  return { principalRemaining, financeCostRemaining, totalRemaining: principalRemaining + financeCostRemaining, paidPrincipal, paidFinanceCost, paidTotal };
}

export function getCreditInstalmentAmounts(state, agreement, instalment) {
  const payments = activeTransactions(state).filter(item => item.creditAgreementId === agreement.id && item.scheduledInstalmentId === instalment.id);
  const paid = payments.reduce((sum, item) => sum + item.amount, 0);
  const paidPrincipal = payments.reduce((sum, item) => sum + (item.creditPrincipalAmount || 0), 0);
  const paidFinanceCost = payments.reduce((sum, item) => sum + (item.creditFinanceCostAmount || 0), 0);
  return {
    paid,
    paidPrincipal,
    paidFinanceCost,
    remaining: Math.max(0, instalment.amount - paid),
    principalRemaining: Math.max(0, instalment.principalAmount - paidPrincipal),
    financeCostRemaining: Math.max(0, instalment.financeCostAmount - paidFinanceCost),
  };
}

export function getCreditInstalmentStatus(state, agreement, instalment, asOfDate = new Date().toISOString().slice(0, 10)) {
  if (instalment.supersededAt) return 'superseded';
  const amounts = getCreditInstalmentAmounts(state, agreement, instalment);
  if (!amounts.remaining) return 'paid';
  if (instalment.dueDate < asOfDate) return amounts.paid ? 'partial_overdue' : 'overdue';
  if (amounts.paid) return 'partial';
  if (instalment.dueDate === asOfDate) return 'due';
  if (instalment.dueDate <= addDays(asOfDate, 7)) return 'due_soon';
  return 'upcoming';
}

export function getCreditAgreementStatus(state, agreement) {
  if (agreement.settledEarlyAt) return 'settled_early';
  if (agreement.status === 'cancelled') return 'cancelled';
  const balances = getCreditAgreementBalances(state, agreement);
  return balances.totalRemaining === 0 ? 'paid_off' : 'active';
}

function scheduledRows(state, agreement) {
  return (agreement.schedule || []).filter(item => !item.supersededAt).map(instalment => ({ agreement, instalment, ...getCreditInstalmentAmounts(state, agreement, instalment) }));
}

export function getNextCreditPayment(state, asOfDate = new Date().toISOString().slice(0, 10)) {
  return (state.creditAgreements || []).filter(item => getCreditAgreementStatus(state, item) === 'active')
    .flatMap(agreement => scheduledRows(state, agreement).filter(row => row.remaining > 0).map(row => ({ ...row, status: getCreditInstalmentStatus(state, agreement, row.instalment, asOfDate) })))
    .sort((left, right) => left.instalment.dueDate.localeCompare(right.instalment.dueDate) || left.instalment.sequence - right.instalment.sequence)[0] || null;
}

export function getOverdueCreditPayments(state, asOfDate = new Date().toISOString().slice(0, 10)) {
  return (state.creditAgreements || []).filter(item => getCreditAgreementStatus(state, item) === 'active')
    .flatMap(agreement => scheduledRows(state, agreement).filter(row => row.remaining > 0 && row.instalment.dueDate < asOfDate).map(row => ({ ...row, status: getCreditInstalmentStatus(state, agreement, row.instalment, asOfDate) })))
    .sort((left, right) => left.instalment.dueDate.localeCompare(right.instalment.dueDate));
}

export function getCreditDueSoon(state, asOfDate = new Date().toISOString().slice(0, 10)) {
  return (state.creditAgreements || []).filter(item => getCreditAgreementStatus(state, item) === 'active')
    .flatMap(agreement => scheduledRows(state, agreement).filter(row => row.remaining > 0 && row.instalment.dueDate >= asOfDate && row.instalment.dueDate <= addDays(asOfDate, 7)).map(row => ({ ...row, status: getCreditInstalmentStatus(state, agreement, row.instalment, asOfDate) })))
    .sort((left, right) => left.instalment.dueDate.localeCompare(right.instalment.dueDate));
}

export function getMonthlyCreditCommitment(state) {
  return (state.creditAgreements || []).filter(item => getCreditAgreementStatus(state, item) === 'active').reduce((sum, agreement) => {
    const first = (agreement.schedule || []).find(item => !item.supersededAt);
    if (!first) return sum;
    const numerator = agreement.frequency === 'weekly' ? 52 : agreement.frequency === 'fortnightly' ? 26 : agreement.frequency === 'custom' ? Math.round(36500 / agreement.customDays) : 12;
    return sum + Math.round(first.amount * numerator / 12);
  }, 0);
}

export function getCreditOverview(state, asOfDate = new Date().toISOString().slice(0, 10)) {
  const active = (state.creditAgreements || []).filter(item => getCreditAgreementStatus(state, item) === 'active');
  const nextPayment = getNextCreditPayment(state, asOfDate);
  const dueSoon = getCreditDueSoon(state, asOfDate), overdue = getOverdueCreditPayments(state, asOfDate);
  return {
    outstanding: active.reduce((sum, item) => sum + getCreditAgreementBalances(state, item).totalRemaining, 0),
    principalOutstanding: active.reduce((sum, item) => sum + getCreditAgreementBalances(state, item).principalRemaining, 0),
    financeCostRemaining: active.reduce((sum, item) => sum + getCreditAgreementBalances(state, item).financeCostRemaining, 0),
    monthlyCommitment: getMonthlyCreditCommitment(state),
    activePlans: active.length,
    completedPlans: (state.creditAgreements || []).filter(item => ['paid_off', 'settled_early'].includes(getCreditAgreementStatus(state, item))).length,
    nextPayment,
    dueSoon,
    dueSoonAmount: dueSoon.reduce((sum, item) => sum + item.remaining, 0),
    overdue,
    overdueAmount: overdue.reduce((sum, item) => sum + item.remaining, 0),
  };
}

export function createCreditAgreement(state, agreement, { transactionId = '', dateCreated = new Date().toISOString().slice(0, 10) } = {}) {
  state.creditAgreements ||= [];
  if (state.creditAgreements.some(item => item.id === agreement.id)) throw new Error('This credit agreement already exists.');
  const cashPrice = agreement.cashPrice, deposit = agreement.deposit || 0, financedAmount = cashPrice - deposit;
  if (!agreement.id || !String(agreement.title || '').trim() || !validDate(agreement.purchaseDate) || !cents(cashPrice) || cashPrice <= 0 || !cents(deposit) || deposit >= cashPrice || !cents(agreement.financeCharge || 0) || !Number.isSafeInteger(financedAmount + (agreement.financeCharge || 0))) throw new Error('Enter a purchase price, a smaller deposit, and a valid finance charge.');
  const schedule = generateCreditSchedule({ agreementId: agreement.id, principalAmount: financedAmount, financeCharge: agreement.financeCharge || 0, term: agreement.term, frequency: agreement.frequency, customDays: agreement.customDays, firstPaymentDate: agreement.firstPaymentDate });
  const result = { ...agreement, title: String(agreement.title).trim(), merchant: String(agreement.merchant || '').trim(), reference: String(agreement.reference || '').trim(), productUrl: cleanProductUrl(agreement.productUrl), notes: String(agreement.notes || '').trim(), cashPrice, deposit, financedAmount, totalRepayable: financedAmount + (agreement.financeCharge || 0), schedule, createdAt: agreement.createdAt || new Date().toISOString(), status: 'active' };
  if (deposit > 0) {
    if (!transactionId || !validDate(agreement.depositDate || dateCreated)) throw new Error('A deposit must be recorded as a dated Finance transaction.');
    if ((state.transactions || []).some(item => item.id === transactionId)) throw new Error('This Finance transaction identifier is already in use.');
    state.transactions.push({ id: transactionId, title: `Deposit for ${result.title}`, type: 'expense', amount: deposit, categoryId: agreement.categoryId || '', date: agreement.depositDate || dateCreated, paidFromFundId: agreement.depositPaidFromFundId || '', note: 'Credit purchase deposit', creditAgreementId: agreement.id, creditPaymentKind: 'deposit' });
  }
  state.creditAgreements.push(result);
  return result;
}

export function recordCreditPayment(state, { agreementId, amount, date, paidFromFundId = '', note = '', instalmentId = '', paymentId, transactionId }) {
  state.creditAgreements ||= [];
  if (!paymentId || !transactionId || !Number.isSafeInteger(amount) || amount <= 0 || !validDate(date)) throw new Error('Enter a valid payment amount and date.');
  const existing = (state.transactions || []).find(item => item.type === 'creditPayment' && item.creditPaymentId === paymentId);
  if (existing) {
    if (existing.creditAgreementId !== agreementId) throw new Error('This payment identifier is already linked to another agreement.');
    return existing;
  }
  if ((state.transactions || []).some(item => item.id === transactionId)) throw new Error('This Finance transaction identifier is already in use.');
  const agreement = state.creditAgreements.find(item => item.id === agreementId);
  if (!agreement || getCreditAgreementStatus(state, agreement) !== 'active') throw new Error('This credit agreement is no longer active.');
  const balances = getCreditAgreementBalances(state, agreement);
  let principalAmount = 0, financeCostAmount = 0, scheduledInstalmentId = '';
  if (instalmentId) {
    const instalment = (agreement.schedule || []).find(item => item.id === instalmentId && !item.supersededAt);
    if (!instalment) throw new Error('Choose an active scheduled instalment.');
    const due = getCreditInstalmentAmounts(state, agreement, instalment);
    if (amount > due.remaining) throw new Error('The payment cannot exceed the remaining amount for this instalment. Use Extra payment for additional principal.');
    financeCostAmount = amount === due.remaining ? due.financeCostRemaining : Math.min(due.financeCostRemaining, Math.floor(amount * due.financeCostRemaining / due.remaining));
    principalAmount = amount - financeCostAmount;
    if (principalAmount > balances.principalRemaining || financeCostAmount > balances.financeCostRemaining) throw new Error('This payment exceeds the remaining agreement balance.');
    scheduledInstalmentId = instalment.id;
  } else {
    if (amount > balances.principalRemaining) throw new Error('An extra payment can only reduce the remaining principal. Use Settle early to clear the agreement.');
    let principalToReschedule = amount;
    const futurePrincipalRows = (agreement.schedule || []).filter(item => !item.supersededAt && item.dueDate > date && getCreditInstalmentAmounts(state, agreement, item).paid === 0).sort((left, right) => right.dueDate.localeCompare(left.dueDate) || right.sequence - left.sequence);
    const eligiblePrincipal = futurePrincipalRows.reduce((sum, item) => sum + item.principalAmount, 0);
    if (amount > eligiblePrincipal) throw new Error('This extra payment is larger than the principal in future instalments. Use Settle early for a payoff quote.');
    for (const instalment of futurePrincipalRows) {
      const reduction = Math.min(principalToReschedule, instalment.principalAmount);
      instalment.principalAmount -= reduction;
      instalment.amount -= reduction;
      principalToReschedule -= reduction;
      if (!instalment.amount) instalment.supersededAt = date;
      if (!principalToReschedule) break;
    }
    principalAmount = amount;
  }
  const transaction = { id: transactionId, sequence: Math.max(0, ...(state.transactions || []).map((item, index) => item.sequence ?? index + 1)) + 1, title: `${agreement.title} credit payment`, type: 'creditPayment', amount, date, paidFromFundId, note: String(note || '').trim(), creditAgreementId: agreement.id, creditPaymentId: paymentId, creditPaymentKind: scheduledInstalmentId ? (amount < getCreditInstalmentAmounts(state, agreement, (agreement.schedule || []).find(item => item.id === instalmentId)).remaining ? 'partial' : 'scheduled') : 'extra', scheduledInstalmentId, creditPrincipalAmount: principalAmount, creditFinanceCostAmount: financeCostAmount };
  state.transactions.push(transaction);
  return transaction;
}

export function settleCreditAgreement(state, { agreementId, settlementAmount, settlementFee = 0, date, paidFromFundId = '', note = '', paymentId, transactionId }) {
  const existing = (state.transactions || []).find(item => item.type === 'creditPayment' && item.creditPaymentId === paymentId);
  if (existing && paymentId) {
    if (existing.creditAgreementId !== agreementId) throw new Error('This payment identifier is already linked to another agreement.');
    return existing;
  }
  const agreement = (state.creditAgreements || []).find(item => item.id === agreementId);
  if (!agreement || getCreditAgreementStatus(state, agreement) !== 'active') throw new Error('This credit agreement is no longer active.');
  const balances = getCreditAgreementBalances(state, agreement);
  if (!Number.isSafeInteger(settlementAmount) || settlementAmount <= 0 || !Number.isSafeInteger(settlementFee) || settlementFee < 0 || !validDate(date) || !paymentId || !transactionId) throw new Error('Enter a valid settlement amount, fee, and date.');
  if (!Number.isSafeInteger(settlementAmount + settlementFee)) throw new Error('The settlement amount is outside the supported range.');
  if ((state.transactions || []).some(item => item.id === transactionId)) throw new Error('This Finance transaction identifier is already in use.');
  const principalAmount = Math.min(balances.principalRemaining, Math.max(0, settlementAmount - balances.financeCostRemaining));
  const financeCostAmount = settlementAmount + settlementFee - principalAmount;
  const amount = settlementAmount + settlementFee;
  const transaction = { id: transactionId, sequence: Math.max(0, ...(state.transactions || []).map((item, index) => item.sequence ?? index + 1)) + 1, title: `${agreement.title} early settlement`, type: 'creditPayment', amount, date, paidFromFundId, note: String(note || '').trim(), creditAgreementId: agreement.id, creditPaymentId: paymentId, creditPaymentKind: 'settlement', creditPrincipalAmount: principalAmount, creditFinanceCostAmount: financeCostAmount };
  state.transactions.push(transaction);
  agreement.settledEarlyAt = date;
  agreement.settlement = { date, settlementAmount, settlementFee, financeTransactionId: transactionId, note: String(note || '').trim() };
  for (const instalment of agreement.schedule || []) {
    const amounts = getCreditInstalmentAmounts(state, agreement, instalment);
    if (amounts.remaining > 0) instalment.supersededAt = date;
  }
  return transaction;
}

export function cancelCreditAgreement(state, agreementId, date = new Date().toISOString().slice(0, 10)) {
  const agreement = (state.creditAgreements || []).find(item => item.id === agreementId);
  if (!agreement || getCreditAgreementStatus(state, agreement) !== 'active') throw new Error('Only an active credit agreement can be cancelled.');
  if (activeTransactions(state).some(item => item.creditAgreementId === agreementId)) throw new Error('An agreement with recorded payments cannot be cancelled. Keep it active or settle it with the lender.');
  if (!validDate(date)) throw new Error('Enter a valid cancellation date.');
  agreement.status = 'cancelled';
  agreement.cancelledAt = date;
  for (const instalment of agreement.schedule || []) if (!instalment.supersededAt) instalment.supersededAt = date;
  return agreement;
}

export function updateCreditAgreement(state, agreementId, changes, asOfDate = new Date().toISOString().slice(0, 10)) {
  const agreement = (state.creditAgreements || []).find(item => item.id === agreementId);
  if (!agreement || getCreditAgreementStatus(state, agreement) !== 'active') throw new Error('Only an active credit agreement can be updated.');
  const frequency = changes.frequency || agreement.frequency;
  const customDays = changes.customDays ?? agreement.customDays;
  const firstPaymentDate = changes.firstPaymentDate || agreement.firstPaymentDate;
  const futureTerm = changes.term ?? (agreement.schedule || []).filter(item => !item.supersededAt && item.dueDate > asOfDate && getCreditInstalmentAmounts(state, agreement, item).remaining > 0).length;
  const priorBalances = getCreditAgreementBalances(state, agreement);
  const preserved = (agreement.schedule || []).filter(item => !item.supersededAt && (item.dueDate <= asOfDate || getCreditInstalmentAmounts(state, agreement, item).paid > 0));
  const preservedDue = preserved.map(item => ({ item, ...getCreditInstalmentAmounts(state, agreement, item) }));
  const preservedPrincipal = preservedDue.reduce((sum, item) => sum + item.principalRemaining, 0);
  const preservedCost = preservedDue.reduce((sum, item) => sum + item.financeCostRemaining, 0);
  const nextFinanceCharge = changes.financeCharge ?? agreement.financeCharge;
  const nextProductUrl = cleanProductUrl(changes.productUrl ?? agreement.productUrl);
  if (!cents(nextFinanceCharge) || nextFinanceCharge < priorBalances.paidFinanceCost) throw new Error('The updated finance charge cannot be lower than finance costs already paid.');
  const futurePrincipal = priorBalances.principalRemaining - preservedPrincipal;
  const futureCost = nextFinanceCharge - priorBalances.paidFinanceCost - preservedCost;
  if (futurePrincipal < 0 || futureCost < 0) throw new Error('The saved payment history does not reconcile with this agreement; future terms were not changed.');
  const nextTitle = String(changes.title ?? agreement.title).trim();
  if (!nextTitle || !Number.isInteger(futureTerm) || futureTerm < 1 || futureTerm > 600 || !validDate(firstPaymentDate) || firstPaymentDate < asOfDate) throw new Error('Enter a name, a future first payment date, and 1 to 600 future payments.');
  const newSchedule = futurePrincipal > 0 || futureCost > 0 ? generateCreditSchedule({ agreementId: agreement.id, principalAmount: futurePrincipal, financeCharge: futureCost, term: futureTerm, frequency, customDays, firstPaymentDate }).map((item, index) => ({ ...item, id: `${agreement.id}:revised:${Date.now()}:${index + 1}`, sequence: preserved.length + index + 1 })) : [];
  for (const item of agreement.schedule || []) if (!preserved.includes(item) && !item.supersededAt) item.supersededAt = asOfDate;
  agreement.schedule = [...preserved, ...newSchedule];
  agreement.title = nextTitle;
  agreement.merchant = String(changes.merchant ?? agreement.merchant).trim();
  agreement.reference = String(changes.reference ?? agreement.reference).trim();
  agreement.productUrl = nextProductUrl;
  agreement.notes = String(changes.notes ?? agreement.notes).trim();
  agreement.frequency = frequency;
  agreement.customDays = customDays;
  agreement.firstPaymentDate = firstPaymentDate;
  agreement.financeCharge = nextFinanceCharge;
  agreement.totalRepayable = agreement.financedAmount + nextFinanceCharge;
  agreement.term = preserved.length + newSchedule.length;
  agreement.termsUpdatedAt = new Date().toISOString();
  return agreement;
}
