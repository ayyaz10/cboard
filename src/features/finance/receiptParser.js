// OCR-independent UK receipt heuristics. Money is always integer minor units.
export const normalizedName = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const redactPaymentData = value => String(value || '').replace(/(?:\d[ -]?){13,19}/g, '[redacted]');
const noise = /\b(?:vat\s*(?:no|number|reg)|tel|telephone|phone|www|https|cashier|operator|receipt\s*(?:no|number|#)|transaction|terminal|loyalty|clubcard|nectar|points|visa|mastercard|amex|debit|credit|card|auth(?:orisation|orization)?|approved|contactless|thank\s*you|opening\s*hours|cash\s*(?:tendered|paid)|change|payment|aid|tid|mid|pin|postcode|store\s*(?:no|number)|served by)\b/i;
const address = /\b(?:street|road|avenue|lane|postcode)\b|\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
const moneyEnd = /(?:[£€$]\s*)?(-?\d+(?:,\d{3})*[.,]\d{2})(?:\s*(?:[A-D*&]|[14][A-D]))?\s*[|;:]?\s*$/i;
const number = value => Number(value.replace(',', '.'));
const minor = value => Math.round(Number(value.replace(/,(?=\d{3}(?:\D|$))/g, '').replace(',', '.')) * 100);

// Only repair a decimal-shaped amount at the price end of a line, never names.
export function normalizeReceiptPrice(line) {
  return line.replace(/(^|\s)([£€$]?\s*-?[\dOIlS]+[.,][\dOIlS]{2})(?=\s*(?:[A-D*])?\s*$)/g, (whole, gap, value) =>
    /\d/.test(value) ? gap + value.replace(/O/g, '0').replace(/[Il]/g, '1').replace(/S/g, '5') : whole);
}
const compactLabel = value => value.toLowerCase().replace(/[1|]/g,'l').replace(/[^a-z]/g, '');
const totalLabel = value => /^(?:grandtotal|total|totaldue|totalpaid|totaltopay|amountdue|balancedue|balance|amountpaid)$/.test(compactLabel(value));
const metadata = line => noise.test(line) || address.test(line) || /\b(?:vat|net|gross|eft|merchant\s*id|sale|items?)\b|\b\d+(?:[.,]\d+)?\s*%|^(?:GBP|EUR|USD)$/i.test(line);

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

export function parseReceipt(input) {
  const text = typeof input === 'string' ? input : input?.text || '';
  const sources = Array.isArray(input?.lines) ? input.lines : String(text || '').slice(0, 100000).split(/\r?\n/).map(text => ({ text }));
  const sourceLines = sources.filter(line => line.text?.trim()).slice(0, 2000);
  const rawLines = sourceLines.map(line => line.text.trim().replace(/\s+/g, ' '));
  const lines = rawLines.map(normalizeReceiptPrice);
  const result = { merchantName: '', date: receiptDate(lines.join('\n')), time: '', currency: '', subtotal: null, tax: null, discounts: null, total: null, items: [] };
  result.time = lines.join('\n').match(/\b(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/)?.[0]?.slice(0, 5) || '';
  result.currency = /£|\bGBP\b/.test(text) ? 'GBP' : /€|\bEUR\b/.test(text) ? 'EUR' : /\bUSD\b/.test(text) ? 'USD' : '';
  const known = lines.slice(0, 8).find(line => /\b(?:tesco|asda|aldi|lidl|sainsbury'?s|morrisons|iceland|farmfoods)\b/i.test(line) && !moneyEnd.test(line));
  result.merchantName = known || lines.slice(0, 5).find(line => /[a-z]{3}/i.test(line) && !noise.test(line) && !address.test(line) && !/\d|welcome|receipt/i.test(line)) || '';
  const aldi = /\baldi\b/i.test(result.merchantName);
  const codeLine = /^\d{5,8}\s+\S/;
  const firstProduct = lines.findIndex(line => codeLine.test(line) && moneyEnd.test(line));
  let afterTotal = false, rank = -1, paymentAmount = null;
  result.itemCount = null;
  result.confidence = { merchant: result.merchantName ? 85 : 0, date: result.date ? 90 : 0, total: 0 };
  const addItem = (item, index) => {
    const line = sourceLines[index];
    const code = item.name.match(/^(\d{5,8})\s+(.+)$/);
    if (code) { item.retailerProductCode = code[1]; item.name = code[2]; }
    item.name = item.name.replace(/\s+(?:[=~°*:'"|+©]\s*)+$/g,'').trim();
    item.rawName = item.name;
    item.normalizedName = normalizedName(item.name);
    item.rawText = redactPaymentData(rawLines[index]);
    const nameWords = line.words?.filter(word => /[a-z]{2}/i.test(word.text) && !moneyEnd.test(word.text)) || [];
    const priceWords = line.words?.filter(word => moneyEnd.test(normalizeReceiptPrice(word.text))) || [];
    const mean = words => words.length ? words.reduce((sum, word) => sum + (word.confidence ?? 50), 0) / words.length : line.confidence ?? 65;
    item.confidence = { name: mean(nameWords), lineTotal: lines[index] === rawLines[index] ? mean(priceWords) : 55,
      quantity: item.quantity != null ? 85 : 0, unitPrice: item.unitPrice != null ? 85 : 0 };
    if (aldi && code && item.quantity == null) { item.quantity = 1; item.unit = 'each'; item.unitPrice = item.lineTotal; item.confidence.quantity = 75; item.confidence.unitPrice = item.confidence.lineTotal; }
    // Aldi prints quantity and unit price BEFORE the product, occasionally split.
    let preceding = lines[index - 1] || '';
    if (/^\d+\s*[x×]$/i.test(lines[index - 2] || '') && /^[£€$]?\s*\d+[.,]\d{2}$/.test(preceding)) preceding = `${lines[index - 2]} ${preceding}`;
    const quantity = preceding.match(/^(\d+)\s*[x×@]\s*[£€$]?\s*(\d+[.,]\d{2})$/i);
    if (quantity && (aldi || code)) {
      const count = Number(quantity[1]), unitPrice = minor(quantity[2]);
      if (count > 0 && item.lineTotal != null && Math.abs(count * unitPrice - item.lineTotal) <= 1) {
        item.quantity = count; item.unitPrice = unitPrice; item.unit = 'each'; item.quantityRawText = redactPaymentData(preceding);
        item.confidence.quantity = 95; item.confidence.unitPrice = 95;
      } else { item.quantity = null; item.unitPrice = null; item.confidence.quantity = 0; item.confidence.unitPrice = 0; }
    }
    result.items.push(item);
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const price = line.match(moneyEnd);
    const label = (price ? line.slice(0, price.index) : line).replace(/[:=]/g, '').trim();
    const nextPrice = lines[index + 1]?.match(/^[£€$]?\s*(\d+[.,]\d{2})$/);
    const amount = price ? minor(price[1]) : nextPrice ? minor(nextPrice[1]) : null;
    const count = line.match(/\b(\d+)\s+[iItT]tems?\b/i);
    if (count) { result.itemCount = Number(count[1]); afterTotal = true; continue; }
    if (/^[a-z]\s+[iItT]tems?\b/i.test(line)) { result.itemCountUncertain = true; afterTotal = true; continue; }
    if (/\b(?:card\s*sales|amount\s*paid)\b/i.test(line)) { if (amount != null) paymentAmount = amount; afterTotal = true; continue; }
    if (/\bnet\b.*\bvat\b|\bvat\b.*\bnet\b|\d[.,]\d+\s*%/i.test(line)) {
      const tax = line.match(/\bvat\s+(\d+[.,]\d{2})/i); if (tax) result.tax = minor(tax[1]);
      if (result.items.length) afterTotal = true;
      continue;
    }
    if (/^(?:sub\s*total|net total)\b/i.test(label)) { result.subtotal = amount; continue; }
    if (/^(?:total\s*)?(?:vat|tax)\b/i.test(label)) { if (!/\d|%/.test(label)) result.tax = amount; continue; }
    if (/^(?:total\s+)?(?:discounts?|coupons?|savings?|promotion|multibuy)\b/i.test(label)) { if (amount !== null) result.discounts = /^total/i.test(label) ? Math.abs(amount) : (result.discounts || 0) + Math.abs(amount); continue; }
    if (totalLabel(label)) {
      const priority = /^balance/i.test(label) ? 0 : /grand|due|paid|to pay/i.test(label) ? 2 : 1;
      if (amount !== null && priority >= rank) { result.total = amount; rank = priority; result.confidence.total = 85; }
      afterTotal = true; continue;
    }
    // Corrupted/letter-spaced totals just above item count or payment are footer,
    // even when the word cannot be recovered. Payment can corroborate the amount.
    if (price && !codeLine.test(line) && /^(?:[\da]\s+[iItT]tems?|card\s*sales)\b/i.test(lines[index + 1] || '') && /\b[tToO][a-z]?\b/.test(label)) { afterTotal = true; continue; }
    if (afterTotal || (aldi && firstProduct >= 0 && index < firstProduct) || line === result.merchantName || metadata(line) || receiptDate(line) || /^(?:cash|tender|vat|tax|rate|net|gross|you saved)\b|^[A-Z]?\s*\d+(?:[.,]\d+)?\s*%/i.test(line) || /(?:\d[ -]?){13,19}/.test(line) || /^[\d\s*#-]+$/.test(line)) continue;
    // Common two-line layout: product name followed by quantity/weight and prices.
    const next = lines[index + 1];
    if (!price && /[a-z]/i.test(line) && next && /^\d+(?:[.,]\d+)?\s*(?:[x@×]|kg\b|g\b|ml\b|l\b)/i.test(next)) {
      const item = itemLine(`${line} ${next}`);
      if (item) { addItem(item, index); result.items.at(-1).rawText = redactPaymentData(`${rawLines[index]}\n${rawLines[index + 1]}`); index++; continue; }
    }
    const item = itemLine(line);
    if (item && /[a-z]{2}/i.test(item.name) && !totalLabel(item.name) && (!aldi || firstProduct < 0 || codeLine.test(line))) addItem(item, index);
  }
  if (result.total == null && paymentAmount != null) { result.total = paymentAmount; result.confidence.total = 75; }
  result.totalConfirmed = result.total != null && paymentAmount === result.total;
  if (result.totalConfirmed) result.confidence.total = 98;
  return result;
}

export function receiptWarnings(receipt, total = receipt.total) {
  const warnings = [];
  if (total == null) warnings.push('Receipt total is missing. Enter it before saving.');
  if (!receipt.items.length) warnings.push("We could read the receipt, but couldn't reliably identify the items. Review the extracted text or add items manually.");
  if (receipt.items.some(item => item.quantity == null)) warnings.push('Some quantities are unclear. Leave them blank or correct them.');
  if (receipt.items.some(item => item.lineTotal == null)) warnings.push('Some items have no price.');
  if (receipt.itemCountUncertain && receipt.itemCount == null) warnings.push('The printed item count was unclear. Compare the product lines and quantities with the receipt.');
  const units = receipt.items.reduce((sum, item) => sum + (item.quantity || 1), 0);
  if (receipt.itemCount != null && receipt.itemCount !== units && receipt.itemCount !== receipt.items.length) warnings.push(`Receipt says ${receipt.itemCount} items; extracted ${receipt.items.length} product lines / ${units} units. Check for missed or misread items.`);
  const sum = receipt.items.reduce((value, item) => value + (item.lineTotal || 0), 0);
  if (total != null && Math.abs(sum - total) > 1) warnings.push(`Extracted items total ${(sum / 100).toFixed(2)}, but receipt total is ${(total / 100).toFixed(2)}. Check discounts, tax and missed items.`);
  const names = receipt.items.map(item => `${normalizedName(item.name)}:${item.lineTotal}`);
  if (new Set(names).size < names.length) warnings.push('Repeated item lines detected. Check whether these are separate purchases.');
  if (receipt.items.some(item => item.quantity != null && item.unitPrice != null && item.lineTotal != null && Math.abs(Math.round(item.quantity * item.unitPrice) - item.lineTotal) > 1)) warnings.push('Some quantities × unit prices do not match their line totals.');
  return warnings;
}
