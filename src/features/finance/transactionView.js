import { isValidFinanceDate } from './transactionOrder.js';

export const emptyTransactionView = month => ({ period: 'this-month', month, from: '', to: '', query: '', type: 'all', category: 'all', source: 'all', linkedType: 'all', minAmount: '', maxAmount: '', reversed: 'active', sort: 'newest' });

export function readTransactionView(search, currentMonth) {
  const params = new URLSearchParams(search);
  const view = { ...emptyTransactionView(currentMonth), month: params.get('txMonth') || currentMonth };
  const allowed = {
    period: ['this-month', 'previous-month', 'year', 'all', 'custom', 'month'],
    type: ['all', 'income', 'expense', 'donation', 'transfer', 'debt', 'creditPayment', 'investment', 'savings', 'budget', 'goal'],
    sort: ['newest', 'oldest', 'highest', 'lowest'],
    reversed: ['active', 'all', 'reversed'],
    linkedType: ['all', 'debt', 'donation', 'credit', 'fund'],
  };
  for (const key of Object.keys(allowed)) if (allowed[key].includes(params.get(`tx${key[0].toUpperCase()}${key.slice(1)}`))) view[key] = params.get(`tx${key[0].toUpperCase()}${key.slice(1)}`);
  for (const key of ['query', 'category', 'source']) view[key] = params.get(`tx${key[0].toUpperCase()}${key.slice(1)}`) || view[key];
  view.from = params.get('txFrom') || '';
  view.to = params.get('txTo') || '';
  view.minAmount = params.get('txMin') || '';
  view.maxAmount = params.get('txMax') || '';
  if (!/^\d{4}-\d{2}$/.test(view.month)) view.month = currentMonth;
  if (view.period === 'custom' && (!isValidFinanceDate(view.from) || !isValidFinanceDate(view.to) || view.from > view.to)) {
    const lastDay = new Date(Number(currentMonth.slice(0, 4)), Number(currentMonth.slice(5, 7)), 0).getDate();
    return { ...view, period: 'custom', from: `${currentMonth}-01`, to: `${currentMonth}-${String(lastDay).padStart(2, '0')}` };
  }
  return view;
}

export function writeTransactionView(search, view) {
  const params = new URLSearchParams(search);
  const entries = [['txPeriod', view.period], ['txMonth', view.month], ['txFrom', view.from], ['txTo', view.to], ['txQuery', view.query], ['txType', view.type], ['txCategory', view.category], ['txSource', view.source], ['txLinkedType', view.linkedType], ['txMin', view.minAmount], ['txMax', view.maxAmount], ['txReversed', view.reversed], ['txSort', view.sort]];
  for (const [key, value] of entries) {
    if (!value || (key === 'txPeriod' && value === 'this-month') || (key === 'txType' && value === 'all') || (key === 'txCategory' && value === 'all') || (key === 'txSource' && value === 'all') || (key === 'txLinkedType' && value === 'all') || (key === 'txReversed' && value === 'active') || (key === 'txSort' && value === 'newest')) params.delete(key);
    else params.set(key, value);
  }
  return params.toString();
}

export function transactionViewDateRange(view, currentMonth) {
  if (view.period === 'all') return { from: '', to: '' };
  if (view.period === 'custom') return { from: view.from, to: view.to };
  if (view.period === 'year') return { from: `${view.month.slice(0, 4)}-01-01`, to: `${view.month.slice(0, 4)}-12-31` };
  const month = view.period === 'this-month' ? currentMonth : view.month;
  if (view.period === 'previous-month') {
    const [year, monthNumber] = month.split('-').map(Number);
    const first = new Date(year, monthNumber - 2, 1);
    const key = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}`;
    return { from: `${key}-01`, to: `${key}-${String(new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()).padStart(2, '0')}` };
  }
  return { from: `${month}-01`, to: `${month}-${String(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()).padStart(2, '0')}` };
}

export function activeTransactionFilterCount(view) {
  return [view.type !== 'all', view.category !== 'all', view.source !== 'all', view.linkedType !== 'all', view.minAmount !== '', view.maxAmount !== '', view.reversed !== 'active'].filter(Boolean).length;
}
