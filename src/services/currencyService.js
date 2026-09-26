const PRIMARY = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies';
const FALLBACK = 'https://latest.currency-api.pages.dev/v1/currencies';
const cache = new Map();

export const financeCurrencies = [
  ['GBP', 'British pound'], ['PKR', 'Pakistani rupee'], ['INR', 'Indian rupee'],
  ['USD', 'US dollar'], ['EUR', 'Euro'], ['AED', 'UAE dirham'],
  ['SAR', 'Saudi riyal'], ['CAD', 'Canadian dollar'], ['AUD', 'Australian dollar'],
  ['BDT', 'Bangladeshi taka'], ['JPY', 'Japanese yen'], ['CNY', 'Chinese yuan'],
];

async function fetchRates(base, fetcher) {
  const code = base.toLowerCase();
  if (cache.has(code)) return cache.get(code);
  let lastError;
  for (const root of [PRIMARY, FALLBACK]) {
    try {
      const response = await fetcher(`${root}/${code}.min.json`);
      if (!response.ok) throw new Error(`Rate service returned ${response.status}.`);
      const body = await response.json();
      if (!body || typeof body[code] !== 'object') throw new Error('Rate service returned an invalid response.');
      const result = { date: body.date || '', rates: body[code], provider: 'Currency API' };
      cache.set(code, result);
      return result;
    } catch (error) { lastError = error; }
  }
  throw new Error(lastError?.message || 'Latest exchange rates are unavailable. Try again shortly.');
}

export async function getCurrencyQuote(from, to, fetcher = fetch) {
  const source = String(from).toUpperCase(), target = String(to).toUpperCase();
  if (source === target) return { from: source, to: target, rate: 1, date: new Date().toISOString().slice(0, 10), provider: 'Same currency' };
  const result = await fetchRates(source, fetcher);
  const rate = Number(result.rates[target.toLowerCase()]);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`No ${source} to ${target} rate is available.`);
  return { from: source, to: target, rate, date: result.date, provider: result.provider };
}

export function convertMinorUnits(amount, rate) {
  const converted = Math.round(Number(amount) * Number(rate));
  if (!Number.isSafeInteger(converted) || converted < 0) throw new Error('Converted amount is outside the supported range.');
  return converted;
}

export function clearCurrencyCache() { cache.clear(); }
