export const leverages = [1, 2, 5, 10, 20, 30, 40, 50];
export const defaults = {
  wallet: '1000', mode: 'futures', side: 'long', leverage: '10',
  entry: '65000', stop: '63700', target: '67600', openTrades: '0',
  allocation: '5', margin: '',
};

export function recommendedPercent(leverage) {
  return leverage === 50 ? 0.25 : leverage >= 30 ? 0.5 : 1;
}

export function calculatePosition(form) {
  const errors = {};
  const positive = (key) => {
    const value = Number(form[key]);
    if (!Number.isFinite(value) || value <= 0) errors[key] = 'Enter a positive number.';
    return value;
  };
  const wallet = positive('wallet');
  if (!['spot', 'futures'].includes(form.mode)) errors.mode = 'Choose a trading mode.';
  const warnings = [];
  if (form.mode === 'spot') {
    const allocation = positive('allocation');
    if (allocation >= 100) errors.allocation = 'Keep a wallet reserve. Allocation must be below 100%.';
    if (allocation > 10) warnings.push('Allocation exceeds the strategy maximum of 10% per coin.');
    warnings.push('Diversify funds across multiple coins and keep a wallet reserve.');
    if (Object.keys(errors).length) return { errors, warnings };
    return { errors, warnings, allocationAmount: wallet * allocation / 100, remaining: wallet * (1 - allocation / 100) };
  }
  const leverage = positive('leverage');
  if (!leverages.includes(leverage)) errors.leverage = 'Choose a supported leverage.';
  const openTrades = Number(form.openTrades);
  if (String(form.openTrades).trim() === '' || !Number.isInteger(openTrades) || openTrades < 0) errors.openTrades = 'Enter a whole number of zero or more.';
  const entry = positive('entry');
  const stop = positive('stop');
  const target = positive('target');
  if (!['long', 'short'].includes(form.side)) errors.side = 'Choose long or short.';
  if (!errors.entry && !errors.stop && (form.side === 'long' ? stop >= entry : stop <= entry)) errors.stop = `Stop-loss must be ${form.side === 'long' ? 'below' : 'above'} entry.`;
  if (!errors.entry && !errors.target && (form.side === 'long' ? target <= entry : target >= entry)) errors.target = `Take-profit must be ${form.side === 'long' ? 'above' : 'below'} entry.`;
  const marginPercent = recommendedPercent(leverage);
  const recommendedMargin = wallet * marginPercent / 100;
  const margin = String(form.margin).trim() === '' ? recommendedMargin : positive('margin');
  if (margin >= wallet) errors.margin = 'Never use the whole wallet. Margin must be below wallet balance.';
  if (leverage > 20) warnings.push('High leverage: above 20x, small price moves have a larger impact on your margin.');
  if (openTrades > 2) warnings.push('More than two leveraged trades are open. Consider reducing simultaneous exposure.');
  if (margin > recommendedMargin) warnings.push(`Your margin exceeds the recommended ${marginPercent}% of your wallet.`);
  if (Object.keys(errors).length) return { errors, warnings };
  const notional = margin * leverage;
  const stopPercent = Math.abs(stop - entry) / entry * 100;
  const loss = notional * (stopPercent / 100);
  const profit = notional * (Math.abs(target - entry) / entry);
  const values = { marginPercent, recommendedMargin, margin, notional, stopPercent, loss, profit, ratio: profit / loss, walletRisk: loss / wallet * 100 };
  if (!Object.values(values).every(Number.isFinite) || loss <= 0 || profit <= 0) return { errors: { entry: 'These inputs exceed the supported numeric range. Use smaller values.' }, warnings };
  if (loss >= margin) warnings.push('Estimated stop-loss loss reaches or exceeds margin. Liquidation may occur before your stop executes.');
  return { errors, warnings, ...values };
}
