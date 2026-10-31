import { getUserScopedClient, assertSupabaseResult } from './supabaseCrud.js';
import { createInitialDrivingData, validateDrivingData } from '../features/drivingImprovement/drivingData.js';

async function scoped(userId) {
  const context = await getUserScopedClient();
  if (context.userId !== userId) throw new Error('Account changed. Reopen Driving Improvement.');
  return context;
}

export async function loadDrivingWorkspace(userId) {
  const { client } = await scoped(userId);
  const result = await client.from('driving_workspaces').select('data,revision,updated_at').eq('user_id', userId).maybeSingle();
  assertSupabaseResult(result);
  if (result.data) return { data: validateDrivingData(result.data.data), revision: result.data.revision };
  const data = createInitialDrivingData();
  const inserted = await client.from('driving_workspaces').insert({ user_id: userId, data, revision: 1 }).select('revision').maybeSingle();
  if (inserted.error?.code === '23505') return loadDrivingWorkspace(userId);
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
