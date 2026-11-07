const labels = { income: 'Income', expense: 'Expense', donation: 'Donation payment', investment: 'Investment', debt: 'Debt payment', creditPayment: 'Credit payment', savings: 'Savings', budget: 'Budget allocation', goal: 'Goal contribution', transfer: 'Transfer' };
const outflowTypes = new Set(['expense', 'donation', 'debt', 'creditPayment']);

export function getTransactionDisplayType(transaction, data) {
  const donation = transaction.type === 'donation'
    || transaction.financeGroup === 'donation'
    || Boolean(transaction.donationCategoryId)
    || (data.categories || []).some(category => category.id === transaction.categoryId && category.type === 'donation');
  return donation ? 'Donation payment' : labels[transaction.type] || 'Finance activity';
}

export function getTransactionMoneyEffect(transaction, data) {
  if (transaction.reversedAt || ['allocated', 'planned', 'cancelled'].includes(transaction.allocationStatus)) return 0;
  if (transaction.source && transaction.providerStatus !== 'BOOK') return 0;
  if (transaction.type === 'income') return transaction.amount;
  if (outflowTypes.has(transaction.type)) return -transaction.amount;
  if (transaction.type === 'expense' && (transaction.financeGroup === 'donation' || (data.categories || []).some(category => category.id === transaction.categoryId && category.type === 'donation'))) return -transaction.amount;
  return 0;
}

export function getTransactionAmountPresentation(transaction) {
  if (transaction.type === 'income') return { prefix: '+', tone: 'positive' };
  if (transaction.type === 'transfer') return { prefix: '', tone: 'neutral' };
  return ['expense', 'donation', 'debt', 'creditPayment'].includes(transaction.type)
    ? { prefix: '-', tone: 'negative' }
    : { prefix: '', tone: 'neutral' };
}

export function getTransactionLinkedContext(transaction, data) {
  const debt = (data.debts || []).find(item => item.id === (transaction.debtId || transaction.targetId));
  if (transaction.type === 'debt' && debt) return { kind: 'debt', id: debt.id, label: debt.name };
  const credit = (data.creditAgreements || []).find(item => item.id === transaction.creditAgreementId);
  if (credit) return { kind: 'credit', id: credit.id, label: credit.title || credit.name || 'Credit purchase' };
  const goal = (data.goals || []).find(item => item.id === (transaction.goalId || transaction.targetId));
  if (goal) return { kind: 'goal', id: goal.id, label: goal.title };
  const investment = (data.investments || []).find(item => item.id === transaction.targetId);
  if (investment) return { kind: 'investment', id: investment.id, label: investment.name };
  const donation = (data.donationTargets || []).find(item => item.id === (transaction.donationTargetId || transaction.linkedDonationTargetId));
  if (donation) return { kind: 'donation', id: donation.id, label: donation.name || donation.title };
  if (transaction.donationCategoryId) {
    const category = (data.donationCategories || []).find(item => item.id === transaction.donationCategoryId);
    if (category) return { kind: 'donation', id: category.id, label: category.name };
  }
  if (transaction.type === 'donation' || transaction.financeGroup === 'donation') return { kind: 'donation', id: '', label: transaction.title || 'Donation' };
  return null;
}

export function canOpenLinkedRecord(linked) {
  return Boolean(linked && ['debt', 'credit', 'donation', 'goal', 'investment'].includes(linked.kind) && (linked.id || linked.kind === 'donation'));
}

const isBankTransaction = transaction => transaction.source === 'bank' || transaction.sourceType === 'bank_import';
export function canEditTransaction(transaction, data) {
  if (!transaction || transaction.reversedAt || transaction.donationPaymentId || transaction.creditPaymentId) return false;
  if (transaction.type === 'debt' || transaction.type === 'creditPayment' || ['goal', 'investment', 'savings', 'budget'].includes(transaction.type)) return false;
  if (isBankTransaction(transaction)) return false;
  return ['expense', 'income', 'transfer', 'donation'].includes(transaction.type);
}
export function canDeleteTransaction(transaction, data) {
  if (!transaction || transaction.reversedAt || isBankTransaction(transaction)) return false;
  if (transaction.donationPaymentId || transaction.creditPaymentId || transaction.type === 'debt' || transaction.type === 'creditPayment' || ['goal', 'investment', 'savings', 'budget'].includes(transaction.type)) return false;
  if (getTransactionDisplayType(transaction, data) === 'Donation payment') return false;
  return ['expense', 'income', 'transfer'].includes(transaction.type);
}
export function canDuplicateTransaction(transaction, data) {
  return canEditTransaction(transaction, data) && !isBankTransaction(transaction) && ['expense', 'income'].includes(transaction.type);
}
export function canReclassifyTransaction(transaction, data) {
  if (!transaction || transaction.reversedAt || transaction.type !== 'expense' || transaction.donationPaymentId || transaction.creditPaymentId) return false;
  return isBankTransaction(transaction) || !getTransactionLinkedContext(transaction, data);
}

export function summarizeTransactions(transactions, data) {
  return transactions.reduce((summary, transaction) => {
    const effect = getTransactionMoneyEffect(transaction, data);
    if (effect > 0) summary.income += effect;
    if (effect < 0) summary.spent -= effect;
    summary.net += effect;
    return summary;
  }, { income: 0, spent: 0, net: 0 });
}
