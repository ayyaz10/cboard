import { getUserScopedClient, assertSupabaseResult } from './supabaseCrud.js';
import { cleanFoodCatalogItem, mergeFoodCatalog } from '../features/nutrition/foodCatalog.js';

const KEY = 'food-catalog:v1';

export async function getFoodCatalog(expectedUserId) {
  const { client, userId } = await getUserScopedClient();
  if (expectedUserId && userId !== expectedUserId) throw new Error('Your account changed. Reload your food library.');
  const result = await client.from('user_tool_preferences').select('value').eq('user_id', userId).eq('key', KEY).maybeSingle();
  assertSupabaseResult(result);
  return mergeFoodCatalog([], Array.isArray(result.data?.value?.items) ? result.data.value.items : []);
}

export async function upsertFoodCatalogItems(items, expectedUserId) {
  const updates = items.map(cleanFoodCatalogItem).filter(Boolean);
  if (!updates.length) return getFoodCatalog(expectedUserId);
  const { client, userId } = await getUserScopedClient();
  if (expectedUserId && userId !== expectedUserId) throw new Error('Your account changed. Reload before saving food nutrition.');
  const found = await client.from('user_tool_preferences').select('value').eq('user_id', userId).eq('key', KEY).maybeSingle();
  assertSupabaseResult(found);
  const merged = mergeFoodCatalog(Array.isArray(found.data?.value?.items) ? found.data.value.items : [], updates);
  const result = await client.from('user_tool_preferences').upsert({ user_id: userId, key: KEY, value: { version: 1, items: merged }, updated_at: new Date().toISOString() }, { onConflict: 'user_id,key' });
  assertSupabaseResult(result);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('food-catalog-changed'));
  return merged;
}
