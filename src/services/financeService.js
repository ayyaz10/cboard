import { normalizeFinanceState } from '../features/finance/financeData.js';
import { assertSupabaseResult, getUserScopedClient } from './supabaseCrud.js';
import { loadBankData } from './bankingService.js';

export async function loadFinance() {
  const { client, userId } = await getUserScopedClient();
  const result = await client.from('finance_workspaces').select('state,updated_at').eq('user_id', userId).maybeSingle();
  assertSupabaseResult(result);
  const state = normalizeFinanceState(result.data?.state);
  let bankData = { connections: [], accounts: [], transactions: [] };
  let bankError = '';
  try { bankData = await loadBankData(); } catch (error) { bankError = error.message || 'Bank connections are temporarily unavailable.'; }
  const savedById = new Map(state.transactions.map(item => [item.id, item]));
  const bankTransactions = (bankData.transactions || []).filter(item => !item.hiddenAt).map(item => {
    const saved = savedById.get(item.id);
    const prior = state.transactions.find(candidate => candidate.type === item.type && candidate.categoryId && candidate.title?.trim().toLowerCase() === item.title.trim().toLowerCase());
    const category = saved?.categoryId || prior?.categoryId || '';
    // Bank values and identity are provider-owned; user classification remains editable.
    return { ...item, title: saved?.title || item.title, note: saved?.note || '', categoryId: category, tags: saved?.tags || [], userNote: saved?.note || '', sequence: saved?.sequence || 0, bankIncomeAllocationsApplied: Boolean(saved?.bankIncomeAllocationsApplied) };
  });
  state.transactions = [...state.transactions.filter(item => !String(item.id).startsWith('bank-')), ...bankTransactions];
  return { state, version: result.data?.updated_at || null, userId, bankData, bankError };
}

export async function saveFinance(state, version, expectedUserId) {
  const { client, userId } = await getUserScopedClient();
  if (userId !== expectedUserId) throw new Error('Your account changed. Reload Finance before saving.');
  const updatedAt = new Date().toISOString();
  const query = version
    ? client.from('finance_workspaces').update({ state, updated_at: updatedAt }).eq('user_id', userId).eq('updated_at', version)
    : client.from('finance_workspaces').insert({ user_id: userId, state, updated_at: updatedAt });
  const result = await query.select('updated_at').maybeSingle();
  if (result.error?.code === '23505' || (!result.error && !result.data)) throw new Error('Finance changed in another tab. Reload before trying again.');
  assertSupabaseResult(result);
  return result.data.updated_at;
}

export async function parseFinanceEntry(body) {
  const { client, userId } = await getUserScopedClient();
  const { data, error } = await client.functions.invoke('parse-finance', { body });
  if (error) {
    let message = 'AI quick add is unavailable. Use Add transaction instead.';
    if (error.context instanceof Response) {
      try { message = (await error.context.json()).error || message; } catch { /* non-JSON failure */ }
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  const current = await getUserScopedClient();
  if (current.userId !== userId) throw new Error('Your account changed. Prepare this transaction again.');
  return data;
}
