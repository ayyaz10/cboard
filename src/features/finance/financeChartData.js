import { buildFinanceTimeline, transactionCashEffect } from './financeBalances.js';
export { transactionCashEffect };

export function buildCashTimeline(transactions, month, openingBalance = 0) {
  return buildFinanceTimeline({ transactions, goals: [], goalContributions: [], investments: [], debts: [] }, month, openingBalance)
    .map(point => ({ ...point, balance: point.availableCash, change: point.change }));
}

const merchantDomains = [
  [/(^|\s)aldi(\s|$)/i, 'aldi.co.uk'], [/(^|\s)tesco(\s|$)/i, 'tesco.com'],
  [/sainsbury/i, 'sainsburys.co.uk'], [/(^|\s)asda(\s|$)/i, 'asda.com'],
  [/(^|\s)lidl(\s|$)/i, 'lidl.co.uk'], [/morrisons/i, 'morrisons.com'],
  [/waitrose/i, 'waitrose.com'], [/amazon/i, 'amazon.co.uk'],
  [/netflix/i, 'netflix.com'], [/spotify/i, 'spotify.com'],
  [/(^|\s)uber(\s|$)/i, 'uber.com'], [/deliveroo/i, 'deliveroo.co.uk'],
  [/paypal/i, 'paypal.com'], [/(^|\s)ikea(\s|$)/i, 'ikea.com'],
  [/primark/i, 'primark.com'], [/mcdonald/i, 'mcdonalds.com'],
];

export function merchantDomain(title) {
  return merchantDomains.find(([pattern]) => pattern.test(title || ''))?.[1] || '';
}

export function merchantLogoUrl(title) {
  const domain = merchantDomain(title);
  return domain ? `https://${domain}/favicon.ico` : '';
}

export function parseOpeningBalance(value) {
  const text = String(value ?? '').trim().replace(/,/g, '');
  if (!/^\d+(?:\.\d{0,2})?$/.test(text)) throw new Error('Enter a valid opening balance with up to 2 decimal places.');
  const [whole, decimal = ''] = text.split('.');
  const amount = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Opening balance cannot be negative.');
  return amount;
}
