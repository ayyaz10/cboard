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

export function summarizeTransactions(transactions, data) {
  return transactions.reduce((summary, transaction) => {
    const effect = getTransactionMoneyEffect(transaction, data);
    if (effect > 0) summary.income += effect;
    if (effect < 0) summary.spent -= effect;
    summary.net += effect;
    return summary;
  }, { income: 0, spent: 0, net: 0 });
}
