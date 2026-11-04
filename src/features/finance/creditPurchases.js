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

export function archiveCreditAgreement(state, agreementId, date = new Date().toISOString().slice(0, 10)) {
  const agreement = (state.creditAgreements || []).find(item => item.id === agreementId);
  if (!agreement || agreement.archivedAt || !validDate(date)) throw new Error('This agreement cannot be archived.');
  agreement.archivedAt = date;
  agreement.history ||= [];
  agreement.history.push({ type: 'agreement_archived', date, createdAt: new Date().toISOString() });
  return agreement;
}

export function restoreCreditAgreement(state, agreementId) {
  const agreement = (state.creditAgreements || []).find(item => item.id === agreementId);
  if (!agreement || !agreement.archivedAt) throw new Error('This agreement is not archived.');
  agreement.history ||= [];
  agreement.history.push({ type: 'agreement_restored', date: new Date().toISOString().slice(0, 10), createdAt: new Date().toISOString() });
  delete agreement.archivedAt;
  return agreement;
}

export function deleteUnusedCreditAgreement(state, agreementId) {
  const agreement = (state.creditAgreements || []).find(item => item.id === agreementId);
  if (!agreement) throw new Error('This credit agreement could not be found.');
  const linked = (state.transactions || []).some(item => item.creditAgreementId === agreementId);
  if (linked || agreement.deposit > 0 || activeTransactions(state).some(item => item.creditAgreementId === agreementId)) throw new Error('This agreement has linked financial activity and cannot be safely deleted. Archive or cancel it instead.');
  state.creditAgreements = state.creditAgreements.filter(item => item.id !== agreementId);
  return agreement;
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
      instalment.extraPaymentIds ||= [];
      instalment.extraPaymentIds.push(transactionId);
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
  transaction.supersededInstalmentIds = [];
  for (const instalment of agreement.schedule || []) {
    const amounts = getCreditInstalmentAmounts(state, agreement, instalment);
    if (amounts.remaining > 0) { instalment.supersededAt = date; transaction.supersededInstalmentIds.push(instalment.id); }
  }
  return transaction;
}

export function reverseCreditPayment(state, transactionId, date = new Date().toISOString().slice(0, 10)) {
  const transaction = (state.transactions || []).find(item => item.id === transactionId && item.type === 'creditPayment');
  if (!transaction) throw new Error('The linked credit payment could not be found.');
  if (transaction.source === 'bank' || transaction.sourceType === 'bank_import' || transaction.providerStatus === 'BOOK') throw new Error('Bank-booked payments cannot be reversed here. Correct or unlink the bank record while keeping its provenance.');
  if (transaction.reversedAt) throw new Error('This payment has already been reversed.');
  if (!validDate(date)) throw new Error('Choose a valid reversal date.');
  const agreement = (state.creditAgreements || []).find(item => item.id === transaction.creditAgreementId);
  if (!agreement) throw new Error('The linked agreement could not be found.');
  if (transaction.creditPaymentKind === 'settlement' && agreement.settlement?.financeTransactionId !== transaction.id) throw new Error('The settlement linkage is inconsistent; it was not changed.');
  transaction.reversedAt = new Date().toISOString();
  transaction.reversalDate = date;
  transaction.reversalReason = 'credit_payment_marked_unpaid';
  transaction.reversalAmount = transaction.amount;
  transaction.reversalPaymentId = transaction.creditPaymentId;
  if (transaction.creditPaymentKind === 'settlement') {
    for (const id of transaction.supersededInstalmentIds || []) {
      const instalment = (agreement.schedule || []).find(item => item.id === id);
      if (instalment?.supersededAt === transaction.date) delete instalment.supersededAt;
    }
    delete agreement.settledEarlyAt;
    delete agreement.settlement;
  } else if (transaction.creditPaymentKind === 'extra') {
    const preserved = (agreement.schedule || []).filter(item => !item.supersededAt && (item.dueDate <= date || getCreditInstalmentAmounts(state, agreement, item).paid > 0));
    const preservedDue = preserved.map(item => ({ ...getCreditInstalmentAmounts(state, agreement, item) }));
    const preservedPrincipal = preservedDue.reduce((sum, item) => sum + item.principalRemaining, 0);
    const preservedCost = preservedDue.reduce((sum, item) => sum + item.financeCostRemaining, 0);
    const balances = getCreditAgreementBalances(state, agreement);
    const futurePrincipal = balances.principalRemaining - preservedPrincipal;
    const futureCost = balances.financeCostRemaining - preservedCost;
    if (futurePrincipal < 0 || futureCost < 0) {
      delete transaction.reversedAt;
      delete transaction.reversalDate;
      delete transaction.reversalReason;
      delete transaction.reversalAmount;
      delete transaction.reversalPaymentId;
      throw new Error('The saved payment history does not reconcile; this payment was not reversed.');
    }
    const futureRows = (agreement.schedule || []).filter(item => !preserved.includes(item) && !item.supersededAt && getCreditInstalmentAmounts(state, agreement, item).remaining > 0);
    const nextDate = futureRows.sort((left, right) => left.dueDate.localeCompare(right.dueDate))[0]?.dueDate || (agreement.frequency === 'monthly' ? addMonths(date, 1) : addDays(date, agreement.frequency === 'weekly' ? 7 : agreement.frequency === 'fortnightly' ? 14 : agreement.customDays || 30));
    const futureTerm = Math.max(1, futureRows.length);
    for (const item of agreement.schedule || []) if (!preserved.includes(item) && !item.supersededAt) item.supersededAt = date;
    const regenerated = futurePrincipal || futureCost ? generateCreditSchedule({ agreementId: agreement.id, principalAmount: futurePrincipal, financeCharge: futureCost, term: futureTerm, frequency: agreement.frequency, customDays: agreement.customDays, firstPaymentDate: nextDate }).map((item, index) => ({ ...item, id: `${agreement.id}:reversal:${transaction.id}:${index + 1}`, sequence: preserved.length + index + 1 })) : [];
    agreement.schedule = [...preserved, ...regenerated];
    agreement.term = agreement.schedule.filter(item => !item.supersededAt).length;
  }
  agreement.history ||= [];
  agreement.history.push({ type: 'payment_reversed', paymentId: transaction.creditPaymentId, transactionId: transaction.id, amount: transaction.amount, date, createdAt: transaction.reversedAt });
  return transaction;
}

export function updateCreditPayment(state, transactionId, changes) {
  const transaction = (state.transactions || []).find(item => item.id === transactionId && item.type === 'creditPayment');
  if (!transaction || transaction.reversedAt) throw new Error('Only an active credit payment can be corrected.');
  if (transaction.source === 'bank' || transaction.sourceType === 'bank_import' || transaction.providerStatus === 'BOOK') throw new Error('Bank-booked payments cannot be edited here. Correct or unlink the bank record while keeping its provenance.');
  const agreement = (state.creditAgreements || []).find(item => item.id === transaction.creditAgreementId);
  if (!agreement) throw new Error('The linked agreement could not be found.');
  const amount = changes.amount ?? transaction.amount;
  const date = changes.date ?? transaction.date;
  if (!Number.isSafeInteger(amount) || amount <= 0 || !validDate(date)) throw new Error('Enter a valid payment amount and date.');
  if (amount !== transaction.amount && transaction.creditPaymentKind !== 'scheduled' && !transaction.scheduledInstalmentId) throw new Error('To change an extra payment or settlement amount, reverse it and record the corrected payment.');
  if (transaction.scheduledInstalmentId && amount !== transaction.amount) {
    const instalment = (agreement.schedule || []).find(item => item.id === transaction.scheduledInstalmentId && !item.supersededAt);
    if (!instalment) throw new Error('This payment is linked to a superseded instalment; reverse and re-record it instead.');
    const others = activeTransactions(state).filter(item => item.id !== transaction.id && item.creditAgreementId === agreement.id && item.scheduledInstalmentId === instalment.id);
    const due = instalment.amount - others.reduce((sum, item) => sum + item.amount, 0);
    if (amount > due) throw new Error('The corrected payment cannot exceed the remaining instalment amount.');
    const feeAvailable = Math.max(0, instalment.financeCostAmount - others.reduce((sum, item) => sum + (item.creditFinanceCostAmount || 0), 0));
    const principalAvailable = Math.max(0, instalment.principalAmount - others.reduce((sum, item) => sum + (item.creditPrincipalAmount || 0), 0));
    const fee = amount === due ? feeAvailable : Math.min(feeAvailable, Math.floor(amount * feeAvailable / due));
    const principal = amount - fee;
    if (principal > principalAvailable) throw new Error('The corrected amount does not reconcile with this instalment’s principal and finance cost.');
    transaction.creditPrincipalAmount = principal;
    transaction.creditFinanceCostAmount = fee;
    transaction.creditPaymentKind = amount < due ? 'partial' : 'scheduled';
  }
  const before = { amount: transaction.amount, date: transaction.date, paidFromFundId: transaction.paidFromFundId || '', note: transaction.note || '' };
  transaction.amount = amount;
  transaction.date = date;
  transaction.paidFromFundId = String(changes.paidFromFundId ?? transaction.paidFromFundId ?? '');
  transaction.note = String(changes.note ?? transaction.note ?? '').trim();
  transaction.corrections ||= [];
  transaction.corrections.push({ ...before, updatedAt: new Date().toISOString() });
  agreement.history ||= [];
  agreement.history.push({ type: 'payment_corrected', paymentId: transaction.creditPaymentId, transactionId: transaction.id, before, after: { amount, date, paidFromFundId: transaction.paidFromFundId, note: transaction.note }, createdAt: new Date().toISOString() });
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
  agreement.history ||= [];
  agreement.history.push({ type: 'agreement_cancelled', date, createdAt: new Date().toISOString() });
  return agreement;
}

export function updateCreditAgreement(state, agreementId, changes, asOfDate = new Date().toISOString().slice(0, 10)) {
  const agreement = (state.creditAgreements || []).find(item => item.id === agreementId);
  if (!agreement || getCreditAgreementStatus(state, agreement) !== 'active') throw new Error('Only an active credit agreement can be updated.');
  const hasPayments = activeTransactions(state).some(item => item.creditAgreementId === agreementId);
  const hasPaymentHistory = (state.transactions || []).some(item => item.type === 'creditPayment' && item.creditAgreementId === agreementId);
  const nextCashPrice = changes.cashPrice ?? agreement.cashPrice;
  const nextDeposit = changes.deposit ?? agreement.deposit;
  const purchaseTermsChanged = nextCashPrice !== agreement.cashPrice || nextDeposit !== agreement.deposit;
  const depositDetailsChanged = (changes.depositDate ?? agreement.depositDate ?? agreement.purchaseDate) !== (agreement.depositDate ?? agreement.purchaseDate) || (changes.depositPaidFromFundId ?? agreement.depositPaidFromFundId ?? '') !== (agreement.depositPaidFromFundId || '') || (changes.categoryId ?? agreement.categoryId ?? '') !== (agreement.categoryId || '');
  if (!cents(nextCashPrice) || nextCashPrice <= 0 || !cents(nextDeposit) || nextDeposit >= nextCashPrice) throw new Error('Enter a purchase price and a smaller valid deposit.');
  if (purchaseTermsChanged && hasPaymentHistory) throw new Error('Purchase price and deposit cannot be changed after payment history exists. Correct the linked deposit transaction and future agreement terms separately.');
  const nextPurchaseDate = changes.purchaseDate ?? agreement.purchaseDate;
  const nextDepositDate = changes.depositDate ?? agreement.depositDate ?? nextPurchaseDate;
  if (!validDate(nextPurchaseDate) || !validDate(nextDepositDate)) throw new Error('Choose valid purchase and deposit dates.');
  const nextDepositFundId = String(changes.depositPaidFromFundId ?? agreement.depositPaidFromFundId ?? '');
  const nextCategoryId = String(changes.categoryId ?? agreement.categoryId ?? '');
  const existingDeposit = (state.transactions || []).find(item => item.creditAgreementId === agreementId && item.creditPaymentKind === 'deposit' && !item.reversedAt);
  if ((purchaseTermsChanged || depositDetailsChanged) && existingDeposit && (existingDeposit.source === 'bank' || existingDeposit.sourceType === 'bank_import')) throw new Error('Bank-imported deposits cannot be edited here. Correct or unlink the bank record while keeping its provenance.');
  if (purchaseTermsChanged && nextDeposit > 0 && !existingDeposit && !changes.depositTransactionId) throw new Error('A transaction ID is required to add the corrected deposit to Finance.');
  const previousTerms = { cashPrice: agreement.cashPrice, deposit: agreement.deposit, financedAmount: agreement.financedAmount, depositDate: agreement.depositDate || agreement.purchaseDate, depositPaidFromFundId: agreement.depositPaidFromFundId || '', categoryId: agreement.categoryId || '', financeCharge: agreement.financeCharge, term: agreement.term, frequency: agreement.frequency, customDays: agreement.customDays, firstPaymentDate: agreement.firstPaymentDate };
  if (purchaseTermsChanged || depositDetailsChanged) {
    if (existingDeposit && nextDeposit > 0) {
      existingDeposit.corrections ||= [];
      existingDeposit.corrections.push({ amount: existingDeposit.amount, date: existingDeposit.date, paidFromFundId: existingDeposit.paidFromFundId || '', categoryId: existingDeposit.categoryId || '', updatedAt: new Date().toISOString() });
      existingDeposit.amount = nextDeposit;
      existingDeposit.date = nextDepositDate;
      existingDeposit.paidFromFundId = nextDepositFundId;
      existingDeposit.categoryId = nextCategoryId;
      existingDeposit.title = `Deposit for ${String(changes.title ?? agreement.title).trim()}`;
    } else if (purchaseTermsChanged && existingDeposit && nextDeposit === 0) {
      existingDeposit.reversedAt = new Date().toISOString();
      existingDeposit.reversalDate = asOfDate;
      existingDeposit.reversalReason = 'credit_deposit_corrected';
      existingDeposit.reversalAmount = existingDeposit.amount;
    } else if (purchaseTermsChanged && nextDeposit > 0) {
      const sequence = Math.max(0, ...(state.transactions || []).map((item, index) => item.sequence ?? index + 1)) + 1;
      state.transactions.push({ id: changes.depositTransactionId, sequence, title: `Deposit for ${String(changes.title ?? agreement.title).trim()}`, type: 'expense', amount: nextDeposit, categoryId: nextCategoryId, date: nextDepositDate, paidFromFundId: nextDepositFundId, note: 'Credit purchase deposit', creditAgreementId: agreement.id, creditPaymentKind: 'deposit' });
    }
    if (purchaseTermsChanged) {
      agreement.cashPrice = nextCashPrice;
      agreement.deposit = nextDeposit;
      agreement.financedAmount = nextCashPrice - nextDeposit;
    }
    agreement.depositDate = nextDepositDate;
    agreement.depositPaidFromFundId = nextDepositFundId;
    agreement.categoryId = nextCategoryId;
    agreement.history ||= [];
    agreement.history.push({ type: 'deposit_corrected', transactionId: existingDeposit?.id || changes.depositTransactionId || '', before: { cashPrice: previousTerms.cashPrice, deposit: previousTerms.deposit, depositDate: previousTerms.depositDate, paidFromFundId: previousTerms.depositPaidFromFundId, categoryId: previousTerms.categoryId }, after: { cashPrice: nextCashPrice, deposit: nextDeposit, depositDate: nextDepositDate, paidFromFundId: nextDepositFundId, categoryId: nextCategoryId }, date: asOfDate, createdAt: new Date().toISOString() });
  }
  agreement.purchaseDate = nextPurchaseDate;
  const frequency = changes.frequency || agreement.frequency;
  const customDays = changes.customDays ?? agreement.customDays;
  const activeFuture = (agreement.schedule || []).filter(item => !item.supersededAt && item.dueDate > asOfDate && getCreditInstalmentAmounts(state, agreement, item).remaining > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const firstPaymentDate = changes.firstPaymentDate || activeFuture[0]?.dueDate || agreement.firstPaymentDate;
  const futureTerm = changes.term ?? activeFuture.length;
  const priorBalances = getCreditAgreementBalances(state, agreement);
  const nextFinanceCharge = changes.financeCharge ?? agreement.financeCharge;
  const nextProductUrl = cleanProductUrl(changes.productUrl ?? agreement.productUrl);
  const nextTitle = String(changes.title ?? agreement.title).trim();
  if (!nextTitle) throw new Error('Enter a name for this purchase.');
  const scheduleChanged = purchaseTermsChanged || nextFinanceCharge !== agreement.financeCharge || futureTerm !== activeFuture.length || frequency !== agreement.frequency || customDays !== agreement.customDays || firstPaymentDate !== (activeFuture[0]?.dueDate || agreement.firstPaymentDate);
  if (!scheduleChanged) {
    agreement.title = nextTitle;
    agreement.merchant = String(changes.merchant ?? agreement.merchant).trim();
    agreement.reference = String(changes.reference ?? agreement.reference).trim();
    agreement.productUrl = nextProductUrl;
    agreement.notes = String(changes.notes ?? agreement.notes).trim();
    for (const transaction of (state.transactions || []).filter(item => item.creditAgreementId === agreementId && item.creditPaymentKind === 'deposit' && !item.reversedAt)) transaction.title = `Deposit for ${nextTitle}`;
    agreement.updatedAt = new Date().toISOString();
    return agreement;
  }
  const preserved = (agreement.schedule || []).filter(item => !item.supersededAt && (getCreditInstalmentAmounts(state, agreement, item).paid > 0 || (hasPayments && item.dueDate <= asOfDate)));
  const preservedDue = preserved.map(item => ({ item, ...getCreditInstalmentAmounts(state, agreement, item) }));
  const preservedPrincipal = preservedDue.reduce((sum, item) => sum + item.principalRemaining, 0);
  const preservedCost = preservedDue.reduce((sum, item) => sum + item.financeCostRemaining, 0);
  if (!cents(nextFinanceCharge) || nextFinanceCharge < priorBalances.paidFinanceCost) throw new Error('The updated finance charge cannot be lower than finance costs already paid.');
  const futurePrincipal = priorBalances.principalRemaining - preservedPrincipal;
  const futureCost = nextFinanceCharge - priorBalances.paidFinanceCost - preservedCost;
  if (futurePrincipal < 0 || futureCost < 0) throw new Error('The saved payment history does not reconcile with this agreement; future terms were not changed.');
  if (!nextTitle || !Number.isInteger(futureTerm) || futureTerm < 1 || futureTerm > 600 || !validDate(firstPaymentDate) || firstPaymentDate < asOfDate) throw new Error('Enter a name, a future first payment date, and 1 to 600 future payments.');
  const newSchedule = futurePrincipal > 0 || futureCost > 0 ? generateCreditSchedule({ agreementId: agreement.id, principalAmount: futurePrincipal, financeCharge: futureCost, term: futureTerm, frequency, customDays, firstPaymentDate }).map((item, index) => ({ ...item, id: `${agreement.id}:revised:${Date.now()}:${index + 1}`, sequence: preserved.length + index + 1 })) : [];
  for (const item of agreement.schedule || []) if (!preserved.includes(item) && !item.supersededAt) item.supersededAt = asOfDate;
  agreement.schedule = [...preserved, ...newSchedule];
  agreement.title = nextTitle;
  agreement.merchant = String(changes.merchant ?? agreement.merchant).trim();
  agreement.reference = String(changes.reference ?? agreement.reference).trim();
  agreement.productUrl = nextProductUrl;
  agreement.notes = String(changes.notes ?? agreement.notes).trim();
  for (const transaction of (state.transactions || []).filter(item => item.creditAgreementId === agreementId && item.creditPaymentKind === 'deposit' && !item.reversedAt)) transaction.title = `Deposit for ${nextTitle}`;
  agreement.frequency = frequency;
  agreement.customDays = customDays;
  agreement.firstPaymentDate = firstPaymentDate;
  agreement.financeCharge = nextFinanceCharge;
  agreement.totalRepayable = agreement.financedAmount + nextFinanceCharge;
  agreement.term = preserved.length + newSchedule.length;
  agreement.termsUpdatedAt = new Date().toISOString();
  agreement.history ||= [];
  agreement.history.push({ type: 'schedule_updated', date: asOfDate, previous: previousTerms, next: { cashPrice: agreement.cashPrice, deposit: agreement.deposit, financedAmount: agreement.financedAmount, financeCharge: nextFinanceCharge, term: agreement.term, frequency, customDays, firstPaymentDate }, historicalPaymentsUnchanged: true, createdAt: agreement.termsUpdatedAt });
  return agreement;
}

export function updateCreditInstalment(state, agreementId, instalmentId, changes, asOfDate = new Date().toISOString().slice(0, 10)) {
  const agreement = (state.creditAgreements || []).find(item => item.id === agreementId);
  const instalment = agreement?.schedule?.find(item => item.id === instalmentId && !item.supersededAt);
  if (!agreement || !instalment || getCreditAgreementStatus(state, agreement) !== 'active') throw new Error('This future instalment is no longer editable.');
  const current = getCreditInstalmentAmounts(state, agreement, instalment);
  const before = { dueDate: instalment.dueDate, amount: instalment.amount };
  if (instalment.dueDate <= asOfDate || current.paid > 0 || current.remaining !== instalment.amount) throw new Error('Only a fully unpaid future instalment can be edited.');
  const dueDate = changes.dueDate ?? instalment.dueDate;
  if (!validDate(dueDate) || dueDate <= asOfDate) throw new Error('Choose a future payment date.');
  const future = (agreement.schedule || []).filter(item => !item.supersededAt && item.dueDate > asOfDate && getCreditInstalmentAmounts(state, agreement, item).paid === 0);
  const targetAmount = changes.amount ?? instalment.amount;
  const principalTotal = future.reduce((sum, item) => sum + item.principalAmount, 0);
  const feeTotal = future.reduce((sum, item) => sum + item.financeCostAmount, 0);
  const total = principalTotal + feeTotal;
  if (!Number.isSafeInteger(targetAmount) || targetAmount <= 0 || targetAmount > total) throw new Error('The edited amount must be positive and cannot exceed the remaining future schedule.');
  const remainingRows = future.filter(item => item.id !== instalment.id);
  if (!remainingRows.length && targetAmount !== total) throw new Error('This is the only future instalment; change the agreement terms to keep the total repayable amount reconciled.');
  const minPrincipal = Math.max(0, targetAmount - feeTotal);
  const maxPrincipal = Math.min(principalTotal, targetAmount);
  const principal = Math.max(minPrincipal, Math.min(maxPrincipal, instalment.principalAmount));
  const fee = targetAmount - principal;
  const otherPrincipals = distribute(principalTotal - principal, remainingRows.length);
  const otherFees = distribute(feeTotal - fee, remainingRows.length);
  instalment.dueDate = dueDate;
  instalment.principalAmount = principal;
  instalment.financeCostAmount = fee;
  instalment.amount = targetAmount;
  remainingRows.forEach((item, index) => { item.principalAmount = otherPrincipals[index]; item.financeCostAmount = otherFees[index]; item.amount = item.principalAmount + item.financeCostAmount; });
  agreement.history ||= [];
  agreement.history.push({ type: 'instalment_updated', instalmentId, before, after: { dueDate, amount: targetAmount }, createdAt: new Date().toISOString() });
  return instalment;
}
