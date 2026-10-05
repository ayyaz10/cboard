// Keep each income and its dependent allocations together, with income first.
// The persisted sequence breaks ties even when timestamps are identical.
export function orderedTransactions(transactions, newestFirst = true) {
  const byId = new Map(transactions.map(item => [item.id, item]));
  const position = new Map(transactions.map((item, index) => [item.id, index]));
  // Pending allocations belong with their income. A confirmed payment is a
  // separate real event and must sort on its actual payment date.
  const root = item => item.allocationStatus === 'paid' ? item : byId.get(item.sourceIncomeId) || item;
  const sequence = item => item.sequence ?? position.get(item.id) ?? 0;
  return [...transactions].sort((a, b) => {
    if (a.id === b.id) return 0;
    const ar = root(a), br = root(b);
    if (ar.id === br.id) return a.id === ar.id ? -1 : b.id === br.id ? 1 : sequence(a) - sequence(b) || a.id.localeCompare(b.id);
    const order = ar.date.localeCompare(br.date) || (ar.createdAt || '').localeCompare(br.createdAt || '') || sequence(ar) - sequence(br) || ar.id.localeCompare(br.id);
    return newestFirst ? -order : order;
  });
}
export const nextTransactionSequence = state => Math.max(0, ...state.transactions.map((item, index) => item.sequence ?? index + 1)) + 1;
export function filterTransactions(transactions, { month, query = '', type = 'all', category = 'all' }) {
  return orderedTransactions(transactions).filter(item => (!month || item.date.slice(0, 7) === month) && item.title.toLowerCase().includes(query.toLowerCase()) && (type === 'all' || item.type === type) && (category === 'all' || (category === 'uncategorized' ? !item.categoryId : item.categoryId === category)));
}
