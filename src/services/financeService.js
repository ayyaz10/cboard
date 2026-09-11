import { normalizeFinanceState } from '../features/finance/financeData.js';
import { assertSupabaseResult, getUserScopedClient } from './supabaseCrud.js';

export async function loadFinance() {
  const { client, userId } = await getUserScopedClient();
  const result = await client.from('finance_workspaces').select('state,updated_at').eq('user_id', userId).maybeSingle();
  assertSupabaseResult(result);
  return { state: normalizeFinanceState(result.data?.state), version: result.data?.updated_at || null, userId };
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
