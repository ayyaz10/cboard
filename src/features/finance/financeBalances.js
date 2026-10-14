import { deriveFinancePosition } from './financeLedger.js';

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
export function buildFinanceTimeline(state, month = null, openingBalance = 0) {
  const cutoff = month ? `${month}-31` : '9999-12-31';
  const position = deriveFinancePosition(state, { asOfDate: cutoff, openingBalance });
  const start = month ? `${month}-01` : '';
  const prior = position.points.filter(point => point.date && point.date < start).at(-1);
  const visible = position.points.filter(point => !month || point.date >= start);
  const points = month && prior
    ? [{ ...prior, date: start, transaction: null }, ...visible]
    : visible;
  return points.map((point, index) => {
    const previous = points[index - 1];
    const funds = point.funds || {};
    const reserves = point.reserves || {};
    const reserved = zeroComponents();
    for (const [key, value] of Object.entries(funds)) {
      if (key.startsWith('savings:')) reserved.savings += value;
      else if (key.startsWith('investment:')) reserved.investment += value;
      else if (key.startsWith('asset:')) reserved.investment += value;
      else reserved.goal += value;
    }
    for (const [key, value] of Object.entries(reserves)) reserved[key] = (reserved[key] || 0) + value;
    return {
      index, date: point.date, transaction: point.transaction,
      change: previous ? point.spendable - previous.spendable : 0,
      eventKind: point.transaction?._reservePhase ? 'reserve' : point.transaction?._settlementPhase ? 'payment' : point.transaction?.goalMovement === 'release' ? 'release' : 'cash',
      actualCash: point.totalOwned, reserved, reservedTotal: point.protected,
      availableCash: point.spendable, overallOwned: point.totalOwned,
    };
  });
}
export function calculateFinanceBalances(state, { month = null, openingBalance = 0 } = {}) {
  const position = deriveFinancePosition(state, { asOfDate: month ? `${month}-31` : '9999-12-31', openingBalance });
  const reserved = zeroComponents();
  for (const [key, value] of Object.entries(position.funds)) {
    if (key.startsWith('savings:')) reserved.savings += value;
    else if (key.startsWith('investment:')) reserved.investment += value;
    else if (key.startsWith('asset:')) reserved.investment += value;
    else reserved.goal += value;
  }
  for (const [key, value] of Object.entries(position.reserves)) reserved[key] = (reserved[key] || 0) + value;
  const timeline = buildFinanceTimeline(state, month, openingBalance);
  const liabilities = position.debtOutstanding;
  return {
    actualCash: position.totalOwned,
    reserved,
    reservedTotal: position.protected,
    availableCash: position.spendable,
    overallOwned: position.totalOwned,
    investments: 0,
    liabilities,
    timeline,
  };
}
export function balanceViewValue(balances, view, included = new Set()) {
  if (view === 'actual') return balances.actualCash;
  if (view === 'overall') return balances.overallOwned;
  return balances.availableCash + balanceComponents.reduce((sum, item) => sum + (included.has(item.id) ? balances.reserved[item.id] : 0), 0);
}
