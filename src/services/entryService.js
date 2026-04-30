import {
  assertSupabaseResult,
  getUserScopedClient,
  normalizeLegacyUuid,
  parseNullableNumber,
} from './supabaseCrud';
import { requireSupabase } from '../lib/supabaseClient';

const entrySelect = `
  id,
  user_id,
  goal_id,
  date,
  note,
  created_at,
  entry_values (
    id,
    entry_id,
    metric_id,
    value
  )
`;

export function toEntry(row) {
  return {
    id: row.id,
    userId: row.user_id,
    goalId: row.goal_id,
    date: row.date,
    note: row.note ?? '',
    createdAt: row.created_at,
    values: Object.fromEntries(
      (row.entry_values ?? [])
        .map((entryValue) => [
          entryValue.metric_id,
          parseNullableNumber(entryValue.value),
        ])
        .filter(([, value]) => Number.isFinite(value)),
    ),
  };
}

function toEntryPayload(entry, userId) {
  const id = normalizeLegacyUuid(entry.id, 'entry');

  return {
    ...(id ? { id } : {}),
    user_id: userId,
    goal_id: entry.goalId ?? entry.goal_id,
    date: entry.date,
    note: entry.note?.trim() ?? '',
    created_at: entry.createdAt ?? entry.created_at ?? new Date().toISOString(),
  };
}

function toEntryValueRows(entryId, values) {
  return Object.entries(values ?? {})
    .map(([metricId, value]) => ({
      entry_id: entryId,
      metric_id: metricId,
      value: parseNullableNumber(value),
    }))
    .filter((entryValue) => Number.isFinite(entryValue.value));
}

async function replaceEntryValues(client, entryId, values) {
  const deleteResult = await client
    .from('entry_values')
    .delete()
    .eq('entry_id', entryId);
  assertSupabaseResult(deleteResult);

  const valueRows = toEntryValueRows(entryId, values);

  if (valueRows.length === 0) {
    return;
  }

  const insertResult = await client.from('entry_values').insert(valueRows);
  assertSupabaseResult(insertResult);
}

export async function getEntries() {
  const { client } = await getUserScopedClient();
  const { data, error } = await client
    .from('entries')
    .select(entrySelect)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });

  assertSupabaseResult({ error });
  return (data ?? []).map(toEntry);
}

export async function getEntriesByGoal(goalId) {
  const { client } = await getUserScopedClient();
  const { data, error } = await client
    .from('entries')
    .select(entrySelect)
    .eq('goal_id', goalId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });

  assertSupabaseResult({ error });
  return (data ?? []).map(toEntry);
}

export async function createEntry(entry) {
  const { client, userId } = await getUserScopedClient();
  const entryPayload = toEntryPayload(entry, userId);
  const { data: entryRow, error: entryError } = await client
    .from('entries')
    .upsert(entryPayload, { onConflict: 'user_id,goal_id,date' })
    .select('id')
    .single();

  assertSupabaseResult({ error: entryError });
  await replaceEntryValues(client, entryRow.id, entry.values);
  return getEntryById(entryRow.id);
}

export async function getEntryById(entryId) {
  const { client } = await getUserScopedClient();
  const { data, error } = await client
    .from('entries')
    .select(entrySelect)
    .eq('id', entryId)
    .single();

  assertSupabaseResult({ error });
  return toEntry(data);
}

export async function updateEntry(entryId, entry) {
  const { client } = await getUserScopedClient();
  const updateResult = await client
    .from('entries')
    .update({
      goal_id: entry.goalId ?? entry.goal_id,
      date: entry.date,
      note: entry.note?.trim() ?? '',
    })
    .eq('id', entryId)
    .select('id')
    .single();

  assertSupabaseResult(updateResult);
  await replaceEntryValues(client, updateResult.data.id, entry.values);
  return getEntryById(updateResult.data.id);
}

export async function deleteEntry(entryId) {
  const { client } = await getUserScopedClient();
  const valuesResult = await client
    .from('entry_values')
    .delete()
    .eq('entry_id', entryId);
  assertSupabaseResult(valuesResult);

  const entryResult = await client.from('entries').delete().eq('id', entryId);
  assertSupabaseResult(entryResult);
}

export function subscribeToEntries(userId, onChange) {
  const client = requireSupabase();

  return client
    .channel(`entries:user:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'entries',
        filter: `user_id=eq.${userId}`,
      },
      onChange,
    )
    .subscribe();
}
