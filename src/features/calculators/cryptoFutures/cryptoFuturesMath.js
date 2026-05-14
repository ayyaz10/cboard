export const initialCryptoFuturesForm = {
  assetSymbol: 'BTCUSDT',
  side: 'long',
  entryPrice: '',
  takeProfitPrice: '',
  stopLossPrice: '',
  partialTakeProfits: [],
  marginUsed: '',
  leverage: '10',
};

export const quickLeverages = [1, 2, 5, 10, 20, 50];

function parsePositiveNumber(value) {
  const parsedValue = Number.parseFloat(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null;
}

function normalizeAssetSymbol(value) {
  const nextValue = String(value ?? '').trim().toUpperCase();
  return nextValue || 'MARKET';
}

function isValidTakeProfitForSide(side, entryPrice, takeProfitPrice) {
  return side === 'long'
    ? takeProfitPrice > entryPrice
    : takeProfitPrice < entryPrice;
}

function calculateProfitForExit(side, entryPrice, exitPrice, quantity) {
  return side === 'long'
    ? (exitPrice - entryPrice) * quantity
    : (entryPrice - exitPrice) * quantity;
}

function normalizePartialTakeProfits(form) {
  return (form.partialTakeProfits ?? [])
    .map((partial) => ({
      id: partial.id,
      price: parsePositiveNumber(partial.price),
      closePercent: parsePositiveNumber(partial.closePercent),
    }))
    .filter((partial) => partial.price && partial.closePercent);
}

export function validateCryptoFuturesForm(form) {
  const entryPrice = parsePositiveNumber(form.entryPrice);
  const takeProfitPrice = parsePositiveNumber(form.takeProfitPrice);
  const stopLossPrice = parsePositiveNumber(form.stopLossPrice);
  const marginUsed = parsePositiveNumber(form.marginUsed);
  const leverage = parsePositiveNumber(form.leverage);
  const errors = {};
  const partialTakeProfits = form.partialTakeProfits ?? [];

  if (!String(form.assetSymbol ?? '').trim()) {
    errors.assetSymbol = 'Required market.';
  }
  if (!entryPrice) errors.entryPrice = 'Required positive number.';
  if (!takeProfitPrice) errors.takeProfitPrice = 'Required positive number.';
  if (!stopLossPrice) errors.stopLossPrice = 'Required positive number.';
  if (!marginUsed) errors.marginUsed = 'Required positive number.';
  if (!leverage) errors.leverage = 'Required positive number.';

  if (Object.keys(errors).length > 0) {
    return errors;
  }

  if (form.side === 'long') {
    if (!isValidTakeProfitForSide(form.side, entryPrice, takeProfitPrice)) {
      errors.takeProfitPrice = 'TP must be above entry.';
    }

    if (stopLossPrice >= entryPrice) {
      errors.stopLossPrice = 'SL must be below entry.';
    }
  } else {
    if (!isValidTakeProfitForSide(form.side, entryPrice, takeProfitPrice)) {
      errors.takeProfitPrice = 'TP must be below entry.';
    }

    if (stopLossPrice <= entryPrice) {
      errors.stopLossPrice = 'SL must be above entry.';
    }
  }

  const partialCloseTotal = partialTakeProfits.reduce((sum, partial, index) => {
    const price = parsePositiveNumber(partial.price);
    const closePercent = parsePositiveNumber(partial.closePercent);

    if (!partial.price && !partial.closePercent) {
      return sum;
    }

    if (!price) {
      errors[`partialPrice_${index}`] = 'Required price.';
    } else if (!isValidTakeProfitForSide(form.side, entryPrice, price)) {
      errors[`partialPrice_${index}`] = form.side === 'long'
        ? 'Must be above entry.'
        : 'Must be below entry.';
    }

    if (!closePercent) {
      errors[`partialClose_${index}`] = 'Required %.';
    } else if (closePercent > 100) {
      errors[`partialClose_${index}`] = 'Max 100%.';
    }

    return sum + (closePercent || 0);
  }, 0);

  if (partialCloseTotal > 100) {
    errors.partialTakeProfits = 'Partial close total cannot exceed 100%.';
  }

  return errors;
}

export function calculateCryptoFuturesTrade(form) {
  const assetSymbol = normalizeAssetSymbol(form.assetSymbol);
  const side = form.side;
  const entryPrice = parsePositiveNumber(form.entryPrice);
  const takeProfitPrice = parsePositiveNumber(form.takeProfitPrice);
  const stopLossPrice = parsePositiveNumber(form.stopLossPrice);
  const marginUsed = parsePositiveNumber(form.marginUsed);
  const leverage = parsePositiveNumber(form.leverage);
  const positionSize = marginUsed * leverage;
  const quantity = positionSize / entryPrice;
  const partialTakeProfits = normalizePartialTakeProfits(form);
  const partialCloseTotal = partialTakeProfits.reduce(
    (sum, partial) => sum + partial.closePercent,
    0,
  );
  const remainingClosePercent = Math.max(0, 100 - partialCloseTotal);
  const calculatedPartials = partialTakeProfits.map((partial) => {
    const partialQuantity = quantity * (partial.closePercent / 100);

    return {
      ...partial,
      quantity: partialQuantity,
      profit: calculateProfitForExit(side, entryPrice, partial.price, partialQuantity),
    };
  });
  const partialProfitTotal = calculatedPartials.reduce(
    (sum, partial) => sum + partial.profit,
    0,
  );
  const finalTakeProfitQuantity = quantity * (remainingClosePercent / 100);
  const finalTakeProfitProfit = calculateProfitForExit(
    side,
    entryPrice,
    takeProfitPrice,
    finalTakeProfitQuantity,
  );
  const profitAtTakeProfit = partialProfitTotal + finalTakeProfitProfit;
  const lossAtStopLoss = side === 'long'
    ? (entryPrice - stopLossPrice) * quantity
    : (stopLossPrice - entryPrice) * quantity;
  const profitRoi = (profitAtTakeProfit / marginUsed) * 100;
  const lossRoi = (lossAtStopLoss / marginUsed) * 100;
  const takeProfitMove = side === 'long'
    ? ((takeProfitPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - takeProfitPrice) / entryPrice) * 100;
  const stopLossMove = side === 'long'
    ? ((entryPrice - stopLossPrice) / entryPrice) * 100
    : ((stopLossPrice - entryPrice) / entryPrice) * 100;

  return {
    assetSymbol,
    side,
    entryPrice,
    takeProfitPrice,
    stopLossPrice,
    marginUsed,
    leverage,
    positionSize,
    quantity,
    partialTakeProfits: calculatedPartials,
    partialCloseTotal,
    remainingClosePercent,
    partialProfitTotal,
    finalTakeProfitProfit,
    profitAtTakeProfit,
    lossAtStopLoss,
    profitRoi,
    lossRoi,
    takeProfitMove,
    stopLossMove,
    riskRewardRatio: profitAtTakeProfit / lossAtStopLoss,
  };
}

export function formatUsd(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatQuantity(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(value);
}

export function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  return `${value.toFixed(2)}%`;
}

export function formatRatio(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  return `1:${value.toFixed(2)}`;
}
