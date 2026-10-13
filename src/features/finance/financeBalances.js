import { orderedTransactions } from './transactionOrder.js';

export const balanceComponents = [
  { id: 'savings', label: 'Savings' },
  { id: 'goal', label: 'Goals' },
  { id: 'investment', label: 'Investments' },
  { id: 'donation', label: 'Donations' },
  { id: 'debt', label: 'Debt' },
  { id: 'budget', label: 'Budget pots' },
];

const reservationTypes = new Set(balanceComponents.map(item => item.id));
const cashOutTypes = new Set(['expense', 'donation', 'investment', 'debt', 'savings', 'budget', 'goal']);
const zeroComponents = () => Object.fromEntries(balanceComponents.map(({ id }) => [id, 0]));
const componentTotal = values => Object.values(values).reduce((sum, amount) => sum + amount, 0);

function isIncome(transaction) { return transaction.type === 'income'; }
function isCancelled(transaction) { return ['cancelled', 'planned'].includes(transaction.allocationStatus); }
function isReserved(transaction) {
  return transaction.allocationStatus === 'allocated'
    || (transaction.allocationStatus === 'completed' && transaction.accountingKind === 'allocation');
}
function isInternalTransfer(transaction) {
  return transaction.type === 'transfer' && transaction.transferKind !== 'external-in' && transaction.transferKind !== 'external-out';
}

export function transactionCashEffect(transaction) {
  if (!transaction || isCancelled(transaction) || isReserved(transaction) || isInternalTransfer(transaction)) return 0;
  if (isIncome(transaction)) return transaction.amount;
  if (transaction.type === 'transfer') return transaction.transferKind === 'external-in' ? transaction.amount : -transaction.amount;
  return cashOutTypes.has(transaction.type) ? -transaction.amount : 0;
}

function eventDate(value, fallback) {
  const date = String(value || fallback || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function transactionEvents(transaction) {
  if (isCancelled(transaction)) return [];
  const allocationDate = eventDate(transaction.allocatedOn, transaction.date);
  const paymentDate = eventDate(transaction.paymentDate, transaction.date);
  if (transaction.goalMovement === 'spend' && transaction.goalId) return [{ date: paymentDate, kind: 'goal-spend', transaction }];
  if (transaction.allocationStatus === 'allocated' || (transaction.accountingKind === 'allocation' && transaction.allocationStatus === 'completed')) {
    return [{ date: allocationDate, kind: 'reserve', transaction }];
  }
  if (['paid', 'transferred'].includes(transaction.allocationStatus) && transaction.allocatedOn) {
    return [
      { date: allocationDate, kind: 'reserve', transaction },
      { date: paymentDate, kind: 'payment', transaction },
    ];
  }
  const kind = transaction.allocationStatus === 'transferred' ? 'transfer' : 'cash';
  return [{ date: paymentDate, kind, transaction }];
}

function goalEvents(state, existingTransactionIds) {
  return (state.goalContributions || []).filter(item => !item.transactionId || !existingTransactionIds.has(item.transactionId)).map(item => ({
    date: eventDate(item.date),
    kind: item.kind === 'withdrawal' || item.kind === 'release' ? 'release' : 'reserve',
    transaction: { ...item, type: 'goal', targetId: item.goalId, title: state.goals?.find(goal => goal.id === item.goalId)?.title || 'Goal', amount: item.amount },
  }));
}

function eventOrder(events) {
  return events.filter(event => event.date).sort((a, b) => a.date.localeCompare(b.date));
}

function applyEvent(event, balances) {
  const { transaction, kind } = event;
  if (kind === 'reserve') {
    if (reservationTypes.has(transaction.type)) balances.reserved[transaction.type] += transaction.amount;
  } else if (kind === 'release') {
    balances.reserved.goal = Math.max(0, balances.reserved.goal - transaction.amount);
  } else if (kind === 'goal-spend') {
    balances.actualCash += transactionCashEffect(transaction);
    balances.reserved.goal = Math.max(0, balances.reserved.goal - transaction.amount);
  } else if (kind === 'payment') {
    balances.actualCash += transactionCashEffect({ ...transaction, allocationStatus: transaction.allocationStatus === 'transferred' ? 'transferred' : 'paid' });
    if (reservationTypes.has(transaction.type)) balances.reserved[transaction.type] = Math.max(0, balances.reserved[transaction.type] - transaction.amount);
    if (transaction.type === 'savings' && transaction.allocationStatus === 'transferred') balances.savingsAsset += transaction.amount;
  } else if (kind === 'cash' || kind === 'transfer') {
    balances.actualCash += transactionCashEffect(transaction);
    if (transaction.type === 'savings' && !['allocated', 'cancelled'].includes(transaction.allocationStatus) && transaction.accountingKind !== 'allocation') balances.savingsAsset += transaction.amount;
  }
  balances.reservedTotal = componentTotal(balances.reserved);
  balances.availableCash = balances.actualCash - balances.reservedTotal;
}

function ownedAssetsAt(state, date) {
  return (state.investments || []).filter(item => item.date && item.date <= date).reduce((sum, item) => sum + Number(item.currentValue || 0), 0);
}

function liabilitiesAt(state, date) {
  const paidByDebt = new Map();
  for (const payment of state.debtPayments || []) {
    if (payment.date && payment.date <= date) paidByDebt.set(payment.debtId, (paidByDebt.get(payment.debtId) || 0) + payment.amount);
  }
  return (state.debts || []).filter(debt => {
    const started = eventDate(debt.startedOn || debt.createdAt);
    return started && started <= date;
  }).reduce((sum, debt) => sum + Math.max(0, Number(debt.original || 0) - (paidByDebt.get(debt.id) || 0)), 0);
}

/** Shared accounting timeline. It starts cash from the selected opening balance and replays
 * dated cash movements and reservations; prior reservations seed a monthly view without
 * reapplying prior cash movements to that month's opening balance. */
export function buildFinanceTimeline(state, month = null, openingBalance = 0, includeCurrentGoalSnapshot = month === null || month === new Date().toISOString().slice(0, 7)) {
  const transactions = orderedTransactions(state.transactions || [], false).filter(item => !item.source || item.providerStatus === 'BOOK');
  const ids = new Set(transactions.map(item => item.id));
  const events = eventOrder([...transactions.flatMap(transactionEvents), ...goalEvents(state, ids)]);
  const startDate = month ? `${month}-01` : '';
  const endDate = month ? `${month}-31` : '9999-12-31';
  const periodEvents = month ? events.filter(event => event.date >= startDate && event.date <= endDate) : events;
  const balances = { actualCash: Number.isSafeInteger(openingBalance) ? openingBalance : 0, reserved: zeroComponents(), reservedTotal: 0, availableCash: 0, savingsAsset: 0 };
  if (month) {
    // Replay only the pre-period reservation state. The month opening balance already
    // accounts for prior bank movements, so carry the reserved components separately.
    const seed = { actualCash: 0, reserved: zeroComponents(), reservedTotal: 0, availableCash: 0, savingsAsset: 0 };
    for (const event of events) if (event.date < startDate) applyEvent(event, seed);
    balances.reserved = seed.reserved;
    balances.savingsAsset = seed.savingsAsset;
    balances.reservedTotal = seed.reservedTotal;
    balances.availableCash = balances.actualCash - balances.reservedTotal;
  }
  balances.reservedTotal = componentTotal(balances.reserved);
  balances.availableCash = balances.actualCash - balances.reservedTotal;
  const initialDate = month ? startDate : (periodEvents[0]?.date || '');
  const point = (index, date, transaction, change = 0, eventKind = '') => ({
    index, date, transaction, change, eventKind,
    actualCash: balances.actualCash,
    reserved: { ...balances.reserved },
    reservedTotal: balances.reservedTotal,
    availableCash: balances.availableCash,
    overallOwned: balances.actualCash + balances.savingsAsset + ownedAssetsAt(state, date) - liabilitiesAt(state, date),
  });
  const points = [point(0, initialDate, null)];
  for (const event of periodEvents) {
    const beforeCash = balances.actualCash;
    applyEvent(event, balances);
    const cashChange = balances.actualCash - beforeCash;
    if (event.kind === 'reserve' || event.kind === 'release') balances.availableCash = balances.actualCash - balances.reservedTotal;
    points.push(point(points.length, event.date, event.transaction, cashChange, event.kind));
  }
  if (includeCurrentGoalSnapshot) {
    const date = new Date().toISOString().slice(0, 10);
    const snapshotDateIsInPeriod = !month || date.startsWith(month);
    const currentGoalReserve = (state.goals || []).reduce((sum, goal) => sum + Number(goal.saved || 0), 0);
    if (snapshotDateIsInPeriod && date >= (points.at(-1)?.date || '')) {
      const snapshotReserve = Math.max(balances.reserved.goal, currentGoalReserve);
      balances.reserved.goal = snapshotReserve;
      balances.reservedTotal = componentTotal(balances.reserved);
      balances.availableCash = balances.actualCash - balances.reservedTotal;
      const currentOwned = balances.actualCash + balances.savingsAsset
        + (state.investments || []).reduce((sum, item) => sum + Number(item.currentValue || 0), 0)
        - (state.debts || []).reduce((sum, item) => sum + Number(item.remaining || 0), 0);
      const snapshot = point(points.length, date, null, 0, 'snapshot');
      snapshot.overallOwned = currentOwned;
      if (snapshot.reserved.goal !== points.at(-1)?.reserved.goal || snapshot.overallOwned !== points.at(-1)?.overallOwned) points.push(snapshot);
    }
  }
  return points;
}

export function calculateFinanceBalances(state, { month = null, openingBalance = 0, includeCurrentGoalSnapshot = month === null || month === new Date().toISOString().slice(0, 7) } = {}) {
  const points = buildFinanceTimeline(state, month, openingBalance, includeCurrentGoalSnapshot);
  const last = points.at(-1);
  const today = new Date().toISOString().slice(0, 10);
  const asOfDate = month && month !== today.slice(0, 7) ? `${month}-31` : today;
  const isCurrentMonth = month === today.slice(0, 7);
  const investments = (state.investments || []).filter(item => !month || (isCurrentMonth ? (!item.date || item.date <= asOfDate) : (item.date && item.date <= asOfDate))).reduce((sum, item) => sum + Number(item.currentValue || 0), 0);
  const liabilities = month && month !== today.slice(0, 7) ? liabilitiesAt(state, asOfDate) : (state.debts || []).reduce((sum, item) => sum + Number(item.remaining || 0), 0);
  const savingsAssets = (state.transactions || []).filter(item => item.type === 'savings' && !['allocated', 'cancelled'].includes(item.allocationStatus) && item.accountingKind !== 'allocation').reduce((sum, item) => sum + item.amount, 0);
  const reserved = { ...last.reserved };
  // Goal.saved includes both manual and automatic contributions. Use the larger of its
  // current balance and transaction-ledger reserves to avoid counting one envelope twice.
  const transactionGoalReserve = reserved.goal;
  const goalSaved = includeCurrentGoalSnapshot ? (state.goals || []).reduce((sum, goal) => sum + Number(goal.saved || 0), 0) : 0;
  reserved.goal = Math.max(transactionGoalReserve, goalSaved);
  const reservedTotal = componentTotal(reserved);
  const actualCash = last.actualCash;
  return {
    actualCash,
    reserved,
    reservedTotal,
    availableCash: actualCash - reservedTotal,
    overallOwned: includeCurrentGoalSnapshot && (month === null || month === new Date().toISOString().slice(0, 7))
      ? last.overallOwned
      : actualCash + (month ? last.savingsAsset : savingsAssets) + investments - liabilities,
    investments,
    liabilities,
    timeline: points,
  };
}

export function balanceViewValue(balances, view, included = new Set()) {
  if (view === 'actual') return balances.actualCash;
  if (view === 'overall') return balances.overallOwned;
  return balances.availableCash + balanceComponents.reduce((sum, item) => sum + (included.has(item.id) ? balances.reserved[item.id] : 0), 0);
}
