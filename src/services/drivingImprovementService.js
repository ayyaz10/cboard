import { getUserScopedClient, assertSupabaseResult } from './supabaseCrud.js';
import { createInitialHabitData, migrateHabitData, validateHabitData } from '../features/drivingImprovement/drivingData.js';

async function scoped(userId) {
  const context = await getUserScopedClient();
  if (context.userId !== userId) throw new Error('Account changed. Reopen Habit Improvement.');
  return context;
}

export async function loadDrivingWorkspace(userId, attempt = 0) {
  const { client } = await scoped(userId);
  const result = await client.from('driving_workspaces').select('data,revision,updated_at').eq('user_id', userId).maybeSingle();
  assertSupabaseResult(result);
  if (result.data) {
    const { data, changed } = migrateHabitData(result.data.data);
    if (!changed) return { data, revision: result.data.revision };
    try {
      const revision = await saveDrivingWorkspace(userId, data, result.data.revision);
      return { data, revision };
    } catch (error) {
      if (attempt < 2 && /changed on another device/i.test(error.message || '')) return loadDrivingWorkspace(userId, attempt + 1);
      throw error;
    }
  }
  const data = createInitialHabitData();
  const inserted = await client.from('driving_workspaces').insert({ user_id: userId, data, revision: 1 }).select('revision').maybeSingle();
  if (inserted.error?.code === '23505' && attempt < 2) return loadDrivingWorkspace(userId, attempt + 1);
  assertSupabaseResult(inserted);
  return { data, revision: inserted.data.revision };
}

export async function saveDrivingWorkspace(userId, data, revision) {
  validateHabitData(data);
  const { client } = await scoped(userId);
  const result = await client.from('driving_workspaces').update({ data, revision: revision + 1, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('revision', revision).select('revision').maybeSingle();
  if (result.error?.code === '23505' || (!result.error && !result.data)) throw new Error('Habit Improvement changed on another device. Refresh before saving again.');
  assertSupabaseResult(result);
  return result.data.revision;
}
