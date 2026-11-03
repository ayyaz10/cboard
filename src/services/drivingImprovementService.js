import { getUserScopedClient, assertSupabaseResult } from './supabaseCrud.js';
import { createInitialHabitData, migrateHabitData, validateHabitData } from '../features/drivingImprovement/drivingData.js';

const workspaceCache = new Map();
const inFlightLoads = new Map();
const pendingWrites = new Map();
const CACHE_FRESH_MS = 30_000;
let cacheEpoch = 0;

export function getCachedDrivingWorkspace(userId) {
  const entry = workspaceCache.get(userId);
  return entry ? { data: structuredClone(entry.data), revision: entry.revision } : null;
}

export function publishCachedDrivingWorkspace(userId, data, revision) {
  const previous = workspaceCache.get(userId);
  workspaceCache.set(userId, { data: structuredClone(data), revision, validatedAt: Date.now(), pending: true, rollback: previous || null });
}

export function clearDrivingWorkspaceCache() {
  cacheEpoch += 1;
  workspaceCache.clear();
  inFlightLoads.clear();
  pendingWrites.clear();
}

async function scoped(userId) {
  const context = await getUserScopedClient();
  if (context.userId !== userId) throw new Error('Account changed. Reopen Habit Improvement.');
  return context;
}

export async function loadDrivingWorkspace(userId, attempt = 0, force = false) {
  const pending = pendingWrites.get(userId);
  if (pending) {
    try { await pending; } catch { /* the optimistic cache is rolled back by the write handler */ }
  }
  const cached = workspaceCache.get(userId);
  if (attempt === 0 && !force && cached && Date.now() - cached.validatedAt < CACHE_FRESH_MS) return { data: structuredClone(cached.data), revision: cached.revision };
  if (attempt === 0 && inFlightLoads.has(userId)) return inFlightLoads.get(userId);
  const request = loadDrivingWorkspaceUncached(userId, attempt, cacheEpoch);
  if (attempt === 0) inFlightLoads.set(userId, request);
  try { return await request; }
  finally { if (attempt === 0 && inFlightLoads.get(userId) === request) inFlightLoads.delete(userId); }
}

async function loadDrivingWorkspaceUncached(userId, attempt, epoch) {
  const { client } = await scoped(userId);
  const result = await client.from('driving_workspaces').select('data,revision,updated_at').eq('user_id', userId).maybeSingle();
  assertSupabaseResult(result);
  if (result.data) {
    const { data, changed } = migrateHabitData(result.data.data, userId);
    if (!changed) {
      if (cacheEpoch === epoch) workspaceCache.set(userId, { data: structuredClone(data), revision: result.data.revision, validatedAt: Date.now() });
      return { data, revision: result.data.revision };
    }
    try {
      const revision = await saveDrivingWorkspace(userId, data, result.data.revision, epoch);
      if (cacheEpoch === epoch) workspaceCache.set(userId, { data: structuredClone(data), revision, validatedAt: Date.now() });
      return { data, revision };
    } catch (error) {
      if (attempt < 2 && /changed on another device/i.test(error.message || '')) return loadDrivingWorkspaceUncached(userId, attempt + 1, epoch);
      throw error;
    }
  }
  const data = createInitialHabitData();
  const inserted = await client.from('driving_workspaces').insert({ user_id: userId, data, revision: 1 }).select('revision').maybeSingle();
  if (inserted.error?.code === '23505' && attempt < 2) return loadDrivingWorkspace(userId, attempt + 1);
  assertSupabaseResult(inserted);
  if (cacheEpoch === epoch) workspaceCache.set(userId, { data: structuredClone(data), revision: inserted.data.revision, validatedAt: Date.now() });
  return { data, revision: inserted.data.revision };
}

export function saveDrivingWorkspace(userId, data, revision, expectedEpoch = cacheEpoch) {
  validateHabitData(data);
  const operation = (async () => {
    const { client } = await scoped(userId);
    const result = await client.from('driving_workspaces').update({ data, revision: revision + 1, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('revision', revision).select('revision').maybeSingle();
    if (result.error?.code === '23505' || (!result.error && !result.data)) throw new Error('Habit Improvement changed on another device. Refresh before saving again.');
    assertSupabaseResult(result);
    if (cacheEpoch === expectedEpoch) workspaceCache.set(userId, { data: structuredClone(data), revision: result.data.revision, validatedAt: Date.now() });
    return result.data.revision;
  })();
  pendingWrites.set(userId, operation);
  return operation.catch(error => {
    const current = workspaceCache.get(userId);
    if (cacheEpoch === expectedEpoch && current?.pending) {
      if (current.rollback) workspaceCache.set(userId, current.rollback);
      else workspaceCache.delete(userId);
    }
    throw error;
  }).finally(() => { if (pendingWrites.get(userId) === operation) pendingWrites.delete(userId); });
}
