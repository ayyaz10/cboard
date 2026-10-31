import { getUserScopedClient, assertSupabaseResult } from './supabaseCrud.js';
import { createInitialDrivingData, seedDrivingPresets, validateDrivingData } from '../features/drivingImprovement/drivingData.js';

async function scoped(userId) {
  const context = await getUserScopedClient();
  if (context.userId !== userId) throw new Error('Account changed. Reopen Driving Improvement.');
  return context;
}

export async function loadDrivingWorkspace(userId, attempt = 0) {
  const { client } = await scoped(userId);
  const result = await client.from('driving_workspaces').select('data,revision,updated_at').eq('user_id', userId).maybeSingle();
  assertSupabaseResult(result);
  if (result.data) {
    const current = validateDrivingData(result.data.data);
    if (current.presetVersion >= 1) return { data: current, revision: result.data.revision };
    const data = seedDrivingPresets(current, userId);
    try {
      const revision = await saveDrivingWorkspace(userId, data, result.data.revision);
      return { data, revision };
    } catch (error) {
      if (attempt < 2 && /changed on another device/i.test(error.message || '')) return loadDrivingWorkspace(userId, attempt + 1);
      throw error;
    }
  }
  const data = createInitialDrivingData(userId);
  const inserted = await client.from('driving_workspaces').insert({ user_id: userId, data, revision: 1 }).select('revision').maybeSingle();
  if (inserted.error?.code === '23505' && attempt < 2) return loadDrivingWorkspace(userId, attempt + 1);
  assertSupabaseResult(inserted);
  return { data, revision: inserted.data.revision };
}

export async function saveDrivingWorkspace(userId, data, revision) {
  validateDrivingData(data);
  const { client } = await scoped(userId);
  const result = await client.from('driving_workspaces').update({ data, revision: revision + 1, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('revision', revision).select('revision').maybeSingle();
  if (result.error?.code === '23505' || (!result.error && !result.data)) throw new Error('Driving Improvement changed on another device. Refresh before saving again.');
  assertSupabaseResult(result);
  return result.data.revision;
}
