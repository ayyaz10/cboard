// OCR-independent UK receipt heuristics. Money is always integer minor units.
export const normalizedName = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const redactPaymentData = value => String(value || '').replace(/(?:\d[ -]?){13,19}/g, '[redacted]');
const noise = /\b(?:vat\s*(?:no|number|reg)|tel|telephone|phone|www|https|cashier|operator|receipt\s*(?:no|number|#)|transaction|terminal|loyalty|clubcard|nectar|points|visa|mastercard|amex|debit|credit|card|auth(?:orisation|orization)?|approved|contactless|thank\s*you|opening\s*hours|cash\s*(?:tendered|paid)|change|payment|aid|tid|mid|pin|postcode|store\s*(?:no|number)|served by)\b/i;
const address = /\b(?:street|road|avenue|lane|postcode)\b|\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
const moneyEnd = /(?:[£€$]\s*)?(-?\d+(?:,\d{3})*[.,]\d{2})(?:\s*[AB*])?\s*$/i;
const number = value => Number(value.replace(',', '.'));
const minor = value => Math.round(Number(value.replace(/,(?=\d{3}(?:\D|$))/g, '').replace(',', '.')) * 100);

export function receiptDate(text) {
  const match = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/) || text.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})\b/);
  if (!match) return '';
  let [, a, b, c] = match;
  let [year, month, day] = a.length === 4 ? [+a, +b, +c] : [+c + (c.length === 2 ? 2000 : 0), +b, +a];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
}

function itemLine(rawText) {
  const countOnly = rawText.match(/^(.*?)\s+(\d+(?:[.,]\d+)?)\s*[x@×]\s*[£€$]?\s*(\d+[.,]\d{2})\s*$/i);
  if (countOnly && /[a-z]/i.test(countOnly[1])) return {
    rawText: redactPaymentData(rawText), name: countOnly[1], normalizedName: normalizedName(countOnly[1]),
    quantity: number(countOnly[2]), unit: '', unitPrice: minor(countOnly[3]), lineTotal: null,
  };
  const price = rawText.match(moneyEnd);
  if (!price) return null;
  let name = rawText.slice(0, price.index).trim();
  let quantity = null, unit = '', unitPrice = null;
  const weighted = name.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b(?:\s*@\s*[£€$]?\s*(\d+[.,]\d{2})\s*\/\s*(kg|g|ml|l))?/i);
  const counted = name.match(/(\d+(?:[.,]\d+)?)\s*[x@×]\s*[£€$]?\s*(\d+[.,]\d{2})/i);
  const pattern = weighted || counted;
  if (weighted) {
    quantity = number(weighted[1]); unit = weighted[2].toLowerCase();
    if (weighted[3]) {
      unitPrice = minor(weighted[3]);
      const base = { kg: 1000, g: 1, l: 1000, ml: 1 };
      const priceUnit = weighted[4].toLowerCase();
      if (unit !== priceUnit) { quantity = quantity * base[unit] / base[priceUnit]; unit = priceUnit; }
    }
  } else if (counted) { quantity = number(counted[1]); unitPrice = minor(counted[2]); }
  if (pattern) name = `${name.slice(0, pattern.index)} ${name.slice(pattern.index + pattern[0].length)}`.trim();
  name = name.replace(/\s+/g, ' ');
  if (!/[a-z]/i.test(name)) return null;
  return { rawText: redactPaymentData(rawText), name, normalizedName: normalizedName(name), quantity, unit, unitPrice, lineTotal: minor(price[1]) };
}

export function parseReceipt(text) {
  const lines = String(text || '').slice(0, 100000).split(/\r?\n/).map(line => line.trim().replace(/\s+/g, ' ')).filter(Boolean);
  const result = { merchantName: '', date: receiptDate(lines.join('\n')), time: '', currency: '', subtotal: null, tax: null, discounts: null, total: null, items: [] };
  result.time = lines.join('\n').match(/\b(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/)?.[0]?.slice(0, 5) || '';
  result.currency = /£|\bGBP\b/.test(text) ? 'GBP' : /€|\bEUR\b/.test(text) ? 'EUR' : /\bUSD\b/.test(text) ? 'USD' : '';
  const known = lines.slice(0, 8).find(line => /\b(?:tesco|asda|aldi|lidl|sainsbury'?s|morrisons|iceland|farmfoods)\b/i.test(line) && !moneyEnd.test(line));
  result.merchantName = known || lines.slice(0, 5).find(line => /[a-z]{3}/i.test(line) && !noise.test(line) && !address.test(line) && !/\d|welcome|receipt/i.test(line)) || '';
  let afterTotal = false, rank = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const price = line.match(moneyEnd);
    const label = (price ? line.slice(0, price.index) : line).replace(/[:=]/g, '').trim();
    const nextPrice = lines[index + 1]?.match(/^[£€$]?\s*(\d+[.,]\d{2})$/);
    const amount = price ? minor(price[1]) : nextPrice ? minor(nextPrice[1]) : null;
    if (/^(?:sub\s*total|net total)\b/i.test(label)) { result.subtotal = amount; continue; }
    if (/^(?:total\s*)?(?:vat|tax)\b/i.test(label)) { if (!/\d|%/.test(label)) result.tax = amount; continue; }
    if (/^(?:total\s+)?(?:discounts?|coupons?|savings?|promotion|multibuy)\b/i.test(label)) { if (amount !== null) result.discounts = /^total/i.test(label) ? Math.abs(amount) : (result.discounts || 0) + Math.abs(amount); continue; }
    if (/^(?:grand total|total(?: due| paid| to pay)?|amount due|balance(?: due)?|amount paid)$/i.test(label)) {
      const priority = /^balance/i.test(label) ? 0 : /grand|due|paid|to pay/i.test(label) ? 2 : 1;
      if (amount !== null && priority >= rank) { result.total = amount; rank = priority; }
      afterTotal = true; continue;
    }
    if (afterTotal || line === result.merchantName || noise.test(line) || address.test(line) || receiptDate(line) || /^(?:cash|tender|vat|tax|rate|net|gross|you saved)\b|^[A-Z]?\s*\d+(?:[.,]\d+)?\s*%/i.test(line) || /(?:\d[ -]?){13,19}/.test(line) || /^[\d\s*#-]+$/.test(line)) continue;
    // Common two-line layout: product name followed by quantity/weight and prices.
    const next = lines[index + 1];
    if (!price && /[a-z]/i.test(line) && next && /^\d+(?:[.,]\d+)?\s*(?:[x@×]|kg\b|g\b|ml\b|l\b)/i.test(next)) {
      const item = itemLine(`${line} ${next}`);
      if (item) { result.items.push(item); index++; continue; }
    }
    const item = itemLine(line);
    if (item) result.items.push(item);
  }
  return result;
}

export function receiptWarnings(receipt, total = receipt.total) {
  const warnings = [];
  if (total == null) warnings.push('Receipt total is missing. Enter it before saving.');
  if (!receipt.items.length) warnings.push("We could read the receipt, but couldn't reliably identify the items. Review the extracted text or add items manually.");
  if (receipt.items.some(item => item.quantity == null)) warnings.push('Some quantities are unclear. Leave them blank or correct them.');
  if (receipt.items.some(item => item.lineTotal == null)) warnings.push('Some items have no price.');
  const sum = receipt.items.reduce((value, item) => value + (item.lineTotal || 0), 0);
  if (total != null && Math.abs(sum - total) > 1) warnings.push(`Extracted items total ${(sum / 100).toFixed(2)}, but receipt total is ${(total / 100).toFixed(2)}. Check discounts, tax and missed items.`);
  const names = receipt.items.map(item => `${normalizedName(item.name)}:${item.lineTotal}`);
  if (new Set(names).size < names.length) warnings.push('Repeated item lines detected. Check whether these are separate purchases.');
  if (receipt.items.some(item => item.quantity != null && item.unitPrice != null && item.lineTotal != null && Math.abs(Math.round(item.quantity * item.unitPrice) - item.lineTotal) > 1)) warnings.push('Some quantities × unit prices do not match their line totals.');
  return warnings;
}
