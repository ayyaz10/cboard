import { toMetric } from './metricService';
import {
  assertSupabaseResult,
  getUserScopedClient,
  normalizeLegacyUuid,
  parseNullableNumber,
} from './supabaseCrud';

const goalSelect = `
  id,
  user_id,
  title,
  type,
  target_value,
  unit,
  deadline,
  created_at,
  metrics (
    id,
    goal_id,
    name,
    unit,
    color_key,
    created_at
  )
`;

export function toGoal(row) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    type: row.type,
    targetValue: parseNullableNumber(row.target_value),
    unit: row.unit ?? '',
    deadline: row.deadline ?? '',
    createdAt: row.created_at,
    metrics: (row.metrics ?? [])
      .map(toMetric)
      .sort((leftMetric, rightMetric) =>
        leftMetric.createdAt.localeCompare(rightMetric.createdAt),
      ),
  };
}

function toGoalInsert(goal, userId) {
  const id = normalizeLegacyUuid(goal.id, 'goal');

  return {
    ...(id ? { id } : {}),
    user_id: userId,
    title: goal.title.trim(),
    type: goal.type,
    target_value: parseNullableNumber(goal.targetValue ?? goal.target_value),
    unit: goal.unit?.trim() ?? '',
    deadline: goal.deadline || null,
    created_at: goal.createdAt ?? goal.created_at ?? new Date().toISOString(),
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

export async function getGoals() {
  const { client } = await getUserScopedClient();
  const { data, error } = await client
    .from('goals')
    .select(goalSelect)
    .order('created_at', { ascending: false });

  assertSupabaseResult({ error });
  return (data ?? []).map(toGoal);
}

export async function createGoal(goal) {
  const { client, userId } = await getUserScopedClient();
  const { data: goalRow, error: goalError } = await client
    .from('goals')
    .insert(toGoalInsert(goal, userId))
    .select('id, user_id, title, type, target_value, unit, deadline, created_at')
    .single();

  assertSupabaseResult({ error: goalError });

  const metricRows = (goal.metrics ?? [])
    .filter((metric) => metric.name?.trim())
    .map((metric) => toMetricInsert(metric, goalRow.id));

  if (metricRows.length > 0) {
    const metricResult = await client.from('metrics').insert(metricRows);
    assertSupabaseResult(metricResult);
  }

  return getGoalById(goalRow.id);
}

export async function upsertGoal(goal) {
  const { client, userId } = await getUserScopedClient();
  const goalPayload = toGoalInsert(goal, userId);
  const { data: goalRow, error: goalError } = await client
    .from('goals')
    .upsert(goalPayload, { onConflict: 'id' })
    .select('id')
    .single();

  assertSupabaseResult({ error: goalError });

  const metricRows = (goal.metrics ?? [])
    .filter((metric) => metric.name?.trim())
    .map((metric) => toMetricInsert(metric, goalRow.id));

  if (metricRows.length > 0) {
    const metricResult = await client
      .from('metrics')
      .upsert(metricRows, { onConflict: 'id' });
    assertSupabaseResult(metricResult);
  }

  return getGoalById(goalRow.id);
}

export async function getGoalById(goalId) {
  const { client } = await getUserScopedClient();
  const { data, error } = await client
    .from('goals')
    .select(goalSelect)
    .eq('id', goalId)
    .single();

  assertSupabaseResult({ error });
  return toGoal(data);
}

export async function updateGoal(goalId, updates) {
  const { client } = await getUserScopedClient();
  const goalUpdates = {
    ...(updates.title !== undefined ? { title: updates.title.trim() } : {}),
    ...(updates.type !== undefined ? { type: updates.type } : {}),
    ...(updates.targetValue !== undefined
      ? { target_value: parseNullableNumber(updates.targetValue) }
      : {}),
    ...(updates.unit !== undefined ? { unit: updates.unit.trim() } : {}),
    ...(updates.deadline !== undefined ? { deadline: updates.deadline || null } : {}),
  };

  if (Object.keys(goalUpdates).length > 0) {
    const result = await client.from('goals').update(goalUpdates).eq('id', goalId);
    assertSupabaseResult(result);
  }

  return getGoalById(goalId);
}

export async function deleteGoal(goalId) {
  const { client } = await getUserScopedClient();
  const result = await client.from('goals').delete().eq('id', goalId);
  assertSupabaseResult(result);
}
