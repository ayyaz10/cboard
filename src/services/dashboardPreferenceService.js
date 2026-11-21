import { assertSupabaseResult, getUserScopedClient } from './supabaseCrud.js';
import { DASHBOARD_PREFERENCES_KEY, DEFAULT_DASHBOARD_LAYOUT, normalizeDashboardPreferences } from '../features/todayDashboard/dashboardWidgets.js';

export class DashboardPreferenceConflictError extends Error {
  constructor(message = 'Your dashboard changed on another device. Reload the latest layout before saving again.') {
    super(message);
    this.name = 'DashboardPreferenceConflictError';
    this.code = 'DASHBOARD_PREFERENCE_CONFLICT';
  }
}

async function readRow(client) {
  const result = await client.from('user_tool_preferences').select('value,updated_at')
    .eq('key', DASHBOARD_PREFERENCES_KEY).maybeSingle();
  assertSupabaseResult(result);
  return result.data || null;
}

export async function loadDashboardPreferences(calculators = []) {
  const { client } = await getUserScopedClient();
  const row = await readRow(client);
  return { preferences: normalizeDashboardPreferences(row?.value ?? DEFAULT_DASHBOARD_LAYOUT, calculators), updatedAt: row?.updated_at ?? null };
}

export async function saveDashboardPreferences(preferences, expectedUpdatedAt) {
  const { client, userId } = await getUserScopedClient();
  const current = await readRow(client);
  if ((current?.updated_at ?? null) !== (expectedUpdatedAt ?? null)) {
    if (current && JSON.stringify(current.value) === JSON.stringify(preferences)) return { preferences: current.value, updatedAt: current.updated_at };
    throw new DashboardPreferenceConflictError();
  }
  const updatedAt = new Date().toISOString();
  const payload = { user_id: userId, key: DASHBOARD_PREFERENCES_KEY, value: preferences, updated_at: updatedAt };
  if (!current) {
    const inserted = await client.from('user_tool_preferences').insert(payload).select('value,updated_at').maybeSingle();
    if (inserted.error?.code === '23505') {
      const latest = await readRow(client);
      if (latest && JSON.stringify(latest.value) === JSON.stringify(preferences)) return { preferences: latest.value, updatedAt: latest.updated_at };
      throw new DashboardPreferenceConflictError();
    }
    assertSupabaseResult(inserted);
    return { preferences: inserted.data?.value ?? preferences, updatedAt: inserted.data?.updated_at ?? updatedAt };
  }
  const result = await client.from('user_tool_preferences').update({ value: preferences, updated_at: updatedAt })
    .eq('user_id', userId).eq('key', DASHBOARD_PREFERENCES_KEY).eq('updated_at', expectedUpdatedAt)
    .select('value,updated_at').maybeSingle();
  assertSupabaseResult(result);
  if (!result.data) throw new DashboardPreferenceConflictError();
  return { preferences: result.data.value, updatedAt: result.data.updated_at };
}
