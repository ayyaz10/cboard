import { assertSupabaseResult, getUserScopedClient, normalizeLegacyUuid } from './supabaseCrud';

export function toMetric(row) {
  return {
    id: row.id,
    goalId: row.goal_id,
    name: row.name,
    unit: row.unit ?? '',
    colorKey: row.color_key,
    createdAt: row.created_at,
  };
}

function toMetricInsert(metric, goalId) {
  const id = normalizeLegacyUuid(metric.id, 'metric');

  return {
    ...(id ? { id } : {}),
    goal_id: goalId,
    name: metric.name.trim(),
    unit: metric.unit?.trim() ?? '',
    color_key: metric.colorKey || metric.color_key || 'lime',
    created_at: metric.createdAt ?? metric.created_at ?? new Date().toISOString(),
  };
}

export async function getMetricsByGoal(goalId) {
  const { client } = await getUserScopedClient();
  const { data, error } = await client
    .from('metrics')
    .select('id, goal_id, name, unit, color_key, created_at')
    .eq('goal_id', goalId)
    .order('created_at', { ascending: true });

  assertSupabaseResult({ error });
  return (data ?? []).map(toMetric);
}

export async function createMetric(goalId, metric) {
  const { client } = await getUserScopedClient();
  const { data, error } = await client
    .from('metrics')
    .insert(toMetricInsert(metric, goalId))
    .select('id, goal_id, name, unit, color_key, created_at')
    .single();

  assertSupabaseResult({ error });
  return toMetric(data);
}

export async function updateMetric(metricId, updates) {
  const { client } = await getUserScopedClient();
  const metricUpdates = {
    ...(updates.name !== undefined ? { name: updates.name.trim() } : {}),
    ...(updates.unit !== undefined ? { unit: updates.unit.trim() } : {}),
    ...(updates.colorKey !== undefined ? { color_key: updates.colorKey } : {}),
  };

  const { data, error } = await client
    .from('metrics')
    .update(metricUpdates)
    .eq('id', metricId)
    .select('id, goal_id, name, unit, color_key, created_at')
    .single();

  assertSupabaseResult({ error });
  return toMetric(data);
}

export async function deleteMetric(metricId) {
  const { client } = await getUserScopedClient();
  const result = await client.from('metrics').delete().eq('id', metricId);
  assertSupabaseResult(result);
}

export async function replaceMetricsForGoal(goalId, metrics) {
  const { client } = await getUserScopedClient();
  const deleteResult = await client.from('metrics').delete().eq('goal_id', goalId);
  assertSupabaseResult(deleteResult);

  if (metrics.length === 0) {
    return [];
  }

  const { data, error } = await client
    .from('metrics')
    .insert(metrics.map((metric) => toMetricInsert(metric, goalId)))
    .select('id, goal_id, name, unit, color_key, created_at')
    .order('created_at', { ascending: true });

  assertSupabaseResult({ error });
  return (data ?? []).map(toMetric);
}
