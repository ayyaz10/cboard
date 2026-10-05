import { getUserScopedClient, assertSupabaseResult } from './supabaseCrud.js';
import { cleanFoodCatalogItem, mergeFoodCatalog } from '../features/nutrition/foodCatalog.js';

const KEY = 'food-catalog:v1';

async function writeCatalog(client, userId, items, previous) {
  const payload = { value: { version: 1, items }, updated_at: new Date().toISOString() };
  if (!previous) {
    const inserted = await client.from('user_tool_preferences').insert({ user_id: userId, key: KEY, ...payload });
    assertSupabaseResult(inserted);
    return;
  }
  let query = client.from('user_tool_preferences').update(payload).eq('user_id', userId).eq('key', KEY);
  query = previous.updated_at ? query.eq('updated_at', previous.updated_at) : query.is('updated_at', null);
  const result = await query.select('updated_at').maybeSingle();
  assertSupabaseResult(result);
  if (!result.data) throw new Error('The food library changed in another tab. Reload it and try again.');
}

export async function getFoodCatalog(expectedUserId) {
  const { client, userId } = await getUserScopedClient();
  if (expectedUserId && userId !== expectedUserId) throw new Error('Your account changed. Reload your food library.');
  const result = await client.from('user_tool_preferences').select('value,updated_at').eq('user_id', userId).eq('key', KEY).maybeSingle();
  assertSupabaseResult(result);
  const stored = Array.isArray(result.data?.value?.items) ? result.data.value.items : [];
  const migrated = stored.some(item => typeof item?.id !== 'string' || !item.id.trim());
  const items = mergeFoodCatalog([], stored);
  if (migrated) {
    await writeCatalog(client, userId, items, result.data);
  }
  return items;
}

export async function upsertFoodCatalogItems(items, expectedUserId) {
  const updates = items.filter(item => cleanFoodCatalogItem(item));
  if (!updates.length) return getFoodCatalog(expectedUserId);
  const { client, userId } = await getUserScopedClient();
  if (expectedUserId && userId !== expectedUserId) throw new Error('Your account changed. Reload before saving food nutrition.');
  const found = await client.from('user_tool_preferences').select('value,updated_at').eq('user_id', userId).eq('key', KEY).maybeSingle();
  assertSupabaseResult(found);
  const current = Array.isArray(found.data?.value?.items) ? found.data.value.items : [];
  for (const item of updates) {
    const name = item.name.trim().toLocaleLowerCase();
    const conflicts = current.filter(existing => existing.id !== item.id && [existing.name, ...(existing.aliases || [])].some(value => value.trim().toLocaleLowerCase() === name));
    if (conflicts.length) throw new Error(`Food name '${item.name}' belongs to another saved food name or alias. Edit that food record instead of creating a duplicate.`);
    if (item.id) continue;
    const sameName = current.filter(existing => existing.name.trim().toLocaleLowerCase() === name);
    if (sameName.length > 1) throw new Error(`Food name '${item.name}' has multiple saved records. Edit a specific food item before updating it.`);
  }
  const merged = mergeFoodCatalog(current, updates);
  await writeCatalog(client, userId, merged, found.data);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('food-catalog-changed'));
  return merged;
}

export async function deleteFoodCatalogItems(ids, expectedUserId) {
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !id.trim()))
    throw new Error('Select one or more valid food items to delete.');
  const { client, userId } = await getUserScopedClient();
  if (expectedUserId && userId !== expectedUserId) throw new Error('Your account changed. Reload the food library before deleting.');
  const found = await client.from('user_tool_preferences').select('value,updated_at').eq('user_id', userId).eq('key', KEY).maybeSingle();
  assertSupabaseResult(found);
  const current = Array.isArray(found.data?.value?.items) ? found.data.value.items : [];
  const deleting = new Set(ids);
  const remaining = current.filter(item => !deleting.has(item.id));
  const removed = current.length - remaining.length;
  if (removed) {
    await writeCatalog(client, userId, remaining, found.data);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('food-catalog-changed'));
  }
  return removed;
}
