// Keep an income and its generated allocations together. History lists the
// allocations first; the chronological timeline lists the income first.
export function orderedTransactions(transactions, newestFirst = true) {
  const byId = new Map(transactions.map(item => [item.id, item]));
  const position = new Map(transactions.map((item, index) => [item.id, index]));
  // Pending allocations belong with their income. A confirmed payment is a
  // separate real event and must sort on its actual payment date.
  const root = item => ['paid', 'transferred'].includes(item.allocationStatus) ? item : byId.get(item.sourceIncomeId) || item;
  const sequence = item => item.sequence ?? position.get(item.id) ?? 0;
  return [...transactions].sort((a, b) => {
    if (a.id === b.id) return 0;
    const ar = root(a), br = root(b);
    if (ar.id === br.id) {
      // Keep the triggering income first, followed by its generated allocations.
      // This preserves the real event flow in both recent and chronological views.
      if (a.id === ar.id) return -1;
      if (b.id === br.id) return 1;
      return sequence(a) - sequence(b) || a.id.localeCompare(b.id);
    }
    const order = ar.date.localeCompare(br.date) || (ar.createdAt || '').localeCompare(br.createdAt || '') || sequence(ar) - sequence(br) || ar.id.localeCompare(br.id);
    return newestFirst ? -order : order;
  });
}
export const nextTransactionSequence = state => Math.max(0, ...state.transactions.map((item, index) => item.sequence ?? index + 1)) + 1;
const receiptSearchText = receipt => {
  if (!receipt || typeof receipt !== 'object') return '';
  return [receipt.vendor, receipt.merchant, receipt.store, ...(receipt.items || []).flatMap(item => [item.name, item.description, item.category])]
    .filter(Boolean).join(' ');
};

export function transactionSearchText(item, { categories = [], donationCategories = [], linkedNames = [] } = {}) {
  const category = categories.find(value => value.id === item.categoryId)?.name;
  const donationCategory = donationCategories.find(value => value.id === item.donationCategoryId)?.name;
  return [item.title, item.rawMerchantText, item.resolvedMerchantName, item.merchantName, item.note, item.reference, item.paymentMethod, item.providerStatus,
    category, donationCategory, receiptSearchText(item.receipt), ...linkedNames]
    .filter(value => typeof value === 'string').join(' ').toLocaleLowerCase();
}

export function isValidFinanceDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function dateRangeForPeriod(period, month) {
  if (period === 'all') return { from: '', to: '' };
  if (period === 'year') return { from: `${month.slice(0, 4)}-01-01`, to: `${month.slice(0, 4)}-12-31` };
  if (period === 'previous-month') {
    const [year, value] = month.split('-').map(Number);
    const prior = new Date(year, value - 2, 1);
    const key = `${prior.getFullYear()}-${String(prior.getMonth() + 1).padStart(2, '0')}`;
    return { from: `${key}-01`, to: `${key}-${String(new Date(prior.getFullYear(), prior.getMonth() + 1, 0).getDate()).padStart(2, '0')}` };
  }
  return { from: `${month}-01`, to: `${month}-${String(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()).padStart(2, '0')}` };
}

export function filterTransactions(transactions, { month, from = '', to = '', query = '', type = 'all', category = 'all', source = 'all', linkedType = 'all', minAmount = '', maxAmount = '', reversed = 'all', categories = [], donationCategories = [], linkedNamesById = {} }) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return orderedTransactions(transactions).filter(item => (!month || String(item.date || '').slice(0, 7) === month)
    && (!from || String(item.date || '').slice(0, 10) >= from)
    && (!to || String(item.date || '').slice(0, 10) <= to)
    && (!normalizedQuery || transactionSearchText(item, { categories, donationCategories, linkedNames: linkedNamesById[item.id] || [] }).includes(normalizedQuery))
    && (type === 'all' || item.type === type)
    && (category === 'all' || (category === 'uncategorized' ? !item.categoryId : item.categoryId === category))
    && (source === 'all' || item.paidFromFundId === source || item.paymentMethod === source)
    && (linkedType === 'all' || (linkedType === 'donation' ? item.type === 'donation' || item.financeGroup === 'donation' || Boolean(item.donationCategoryId) : linkedType === 'fund' ? ['savings', 'goal', 'budget', 'investment', 'transfer'].includes(item.type) : linkedType === 'debt' ? item.type === 'debt' : linkedType === 'credit' ? item.type === 'creditPayment' : false))
    && (minAmount === '' || item.amount >= minAmount)
    && (maxAmount === '' || item.amount <= maxAmount)
    && (reversed === 'all' || (reversed === 'reversed' ? Boolean(item.reversedAt) : !item.reversedAt)));
}
