import { assertSupabaseResult, getUserScopedClient } from './supabaseCrud';

const tableName = 'crypto_futures_trades';

function toNumber(value) {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : 0;
}

function toTrade(row) {
  return {
    id: row.id,
    entryType: row.entry_type,
    assetSymbol: row.asset_symbol ?? 'MARKET',
    side: row.side,
    entryPrice: toNumber(row.entry_price),
    takeProfitPrice: toNumber(row.take_profit_price),
    stopLossPrice: toNumber(row.stop_loss_price),
    marginUsed: toNumber(row.margin_used),
    leverage: toNumber(row.leverage),
    positionSize: toNumber(row.position_size),
    quantity: toNumber(row.quantity),
    partialTakeProfits: Array.isArray(row.partial_take_profits)
      ? row.partial_take_profits
      : [],
    partialCloseTotal: toNumber(row.partial_close_total),
    remainingClosePercent: toNumber(row.remaining_close_percent),
    partialProfitTotal: toNumber(row.partial_profit_total),
    finalTakeProfitProfit: toNumber(row.final_take_profit_profit),
    profitAtTakeProfit: toNumber(row.profit_at_take_profit),
    lossAtStopLoss: toNumber(row.loss_at_stop_loss),
    profitRoi: toNumber(row.profit_roi),
    lossRoi: toNumber(row.loss_roi),
    takeProfitMove: toNumber(row.take_profit_move),
    stopLossMove: toNumber(row.stop_loss_move),
    riskRewardRatio: toNumber(row.risk_reward_ratio),
    createdAt: row.created_at,
  };
}

function toPayload(entryType, trade, userId) {
  return {
    user_id: userId,
    entry_type: entryType,
    asset_symbol: trade.assetSymbol ?? 'MARKET',
    side: trade.side,
    entry_price: trade.entryPrice,
    take_profit_price: trade.takeProfitPrice,
    stop_loss_price: trade.stopLossPrice,
    margin_used: trade.marginUsed,
    leverage: trade.leverage,
    position_size: trade.positionSize,
    quantity: trade.quantity,
    partial_take_profits: trade.partialTakeProfits ?? [],
    partial_close_total: trade.partialCloseTotal ?? 0,
    remaining_close_percent: trade.remainingClosePercent ?? 100,
    partial_profit_total: trade.partialProfitTotal ?? 0,
    final_take_profit_profit:
      trade.finalTakeProfitProfit ?? trade.profitAtTakeProfit,
    profit_at_take_profit: trade.profitAtTakeProfit,
    loss_at_stop_loss: trade.lossAtStopLoss,
    profit_roi: trade.profitRoi,
    loss_roi: trade.lossRoi,
    take_profit_move: trade.takeProfitMove,
    stop_loss_move: trade.stopLossMove,
    risk_reward_ratio: trade.riskRewardRatio,
    created_at: trade.createdAt ?? new Date().toISOString(),
  };
}

export async function getCryptoFuturesTrades(entryType) {
  const { client } = await getUserScopedClient();
  const result = await client
    .from(tableName)
    .select(`
      id,
      entry_type,
      asset_symbol,
      side,
      entry_price,
      take_profit_price,
      stop_loss_price,
      margin_used,
      leverage,
      position_size,
      quantity,
      partial_take_profits,
      partial_close_total,
      remaining_close_percent,
      partial_profit_total,
      final_take_profit_profit,
      profit_at_take_profit,
      loss_at_stop_loss,
      profit_roi,
      loss_roi,
      take_profit_move,
      stop_loss_move,
      risk_reward_ratio,
      created_at
    `)
    .eq('entry_type', entryType)
    .order('created_at', { ascending: false });

  assertSupabaseResult(result);
  return (result.data ?? []).map(toTrade);
}

export async function createCryptoFuturesTrade(entryType, trade) {
  const { client, userId } = await getUserScopedClient();
  const result = await client
    .from(tableName)
    .insert(toPayload(entryType, trade, userId))
    .select()
    .single();

  assertSupabaseResult(result);
  return toTrade(result.data);
}

export async function deleteCryptoFuturesTrade(tradeId) {
  const { client } = await getUserScopedClient();
  const result = await client.from(tableName).delete().eq('id', tradeId);
  assertSupabaseResult(result);
}

export async function clearCryptoFuturesTrades(entryType, assetSymbol = 'all') {
  const { client } = await getUserScopedClient();
  let query = client
    .from(tableName)
    .delete()
    .eq('entry_type', entryType);

  if (assetSymbol !== 'all') {
    query = query.eq('asset_symbol', assetSymbol);
  }

  const result = await query;

  assertSupabaseResult(result);
}
