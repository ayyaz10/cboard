import { normalizeMerchantName } from './merchantDirectory.js';

function matchesQuery(value, query) {
  const normalized = normalizeMerchantName(value);
  if (!normalized) return false;
  if (normalized.includes(query)) return true;
  const queryWords = query.split(' ').filter(Boolean);
  const valueWords = normalized.split(' ');
  return queryWords.length > 1 && queryWords.every(word => valueWords.some(valueWord => valueWord.startsWith(word)));
}

export function matchingTransactions(transactions, title, { excludeId = '', limit = 5 } = {}) {
  const query = normalizeMerchantName(title);
  if (query.length < 2) return [];

  return (Array.isArray(transactions) ? transactions : [])
    .filter(transaction => transaction?.id !== excludeId && transaction?.title && matchesQuery(transaction.title, query))
    .sort((a, b) => {
      const aName = normalizeMerchantName(a.title);
      const bName = normalizeMerchantName(b.title);
      const score = name => name === query ? 3 : name.startsWith(query) ? 2 : 1;
      return score(bName) - score(aName) || String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    })
    .slice(0, Math.max(0, limit));
}
