import { assertSupabaseResult, getUserScopedClient } from './supabaseCrud';

export async function getPreference(key, fallbackValue = null) {
  const { client } = await getUserScopedClient();
  const { data, error } = await client
    .from('user_tool_preferences')
    .select('value')
    .eq('key', key)
    .maybeSingle();

  assertSupabaseResult({ error });
  return data?.value ?? fallbackValue;
}

export async function setPreference(key, value) {
  const { client, userId } = await getUserScopedClient();
  const result = await client.from('user_tool_preferences').upsert(
    {
      user_id: userId,
      key,
      value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,key' },
  );

  assertSupabaseResult(result);
}
