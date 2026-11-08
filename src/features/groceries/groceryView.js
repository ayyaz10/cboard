import { convert, normalizeName, stockStatus } from './groceryData.js';

export function filterGroceryItems(items, {
  query = '',
  category = 'All',
  status = 'All',
  recipeUsage = 'all',
  shoppingFilter = 'all',
  shopping = [],
  sort = 'category',
  tab = 'stock',
  categoryNames = [],
} = {}) {
  const normalizedQuery = query.trim().toLowerCase();
  const shoppingUnits = new Map();
  for (const need of shopping) {
    const name = normalizeName(need.name);
    if (!shoppingUnits.has(name)) shoppingUnits.set(name, []);
    shoppingUnits.get(name).push(need.unit);
  }
  return items.filter(item => {
    const searchable = [item.name, item.brand, item.category, ...(item.tags || []), ...(item.recipeRefs || []).map(recipe => recipe.title)]
      .filter(Boolean).join(' ').toLowerCase();
    return searchable.includes(normalizedQuery)
      && (category === 'All' || item.category === category)
      && (tab !== 'stock' || recipeUsage === 'all' || (recipeUsage === 'used' ? Boolean(item.recipeRefs?.length) : !item.recipeRefs?.length))
      && (tab !== 'stock' || status === 'All' || (status === 'Needs attention' ? ['Low stock', 'Out of stock'].includes(stockStatus(item)) : stockStatus(item) === status))
      && (tab !== 'stock' || shoppingFilter === 'all' || (shoppingUnits.get(normalizeName(item.name)) || []).some(unit => convert(1, item.unit, unit) != null) === (shoppingFilter === 'on'));
  }).sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'stock') return ['Out of stock', 'Low stock', 'In stock', 'Unknown'].indexOf(stockStatus(a)) - ['Out of stock', 'Low stock', 'In stock', 'Unknown'].indexOf(stockStatus(b));
    if (sort === 'lowest') return (a.quantity ?? Number.POSITIVE_INFINITY) - (b.quantity ?? Number.POSITIVE_INFINITY);
    return categoryNames.indexOf(a.category) - categoryNames.indexOf(b.category) || a.name.localeCompare(b.name);
  });
}

export function summarizeCategoryStock(items) {
  const summary = { count: items.length, out: 0, low: 0, inStock: 0, unknown: 0 };
  for (const item of items) {
    const status = stockStatus(item);
    if (status === 'Out of stock') summary.out++;
    else if (status === 'Low stock') summary.low++;
    else if (status === 'In stock') summary.inStock++;
    else summary.unknown++;
  }
  return summary;
}

export function isGroceryCategoryExpanded(expandedCategories, category, hasActiveFilters) {
  return Object.hasOwn(expandedCategories, category) ? expandedCategories[category] : hasActiveFilters;
}
