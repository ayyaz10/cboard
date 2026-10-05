import { getUserScopedClient, assertSupabaseResult } from './supabaseCrud.js';
import { cleanFoodCatalogItem, mergeFoodCatalog, normalizeFoodText, parseFoodQuantityPrefix, findFoodMatches } from '../features/nutrition/foodCatalog.js';

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
  let current = Array.isArray(found.data?.value?.items) ? mergeFoodCatalog([], found.data.value.items) : [];
  for (const raw of updates) {
    const existingById = raw.id && current.find(food => food.id === raw.id);
    if (raw.reuseExisting && raw.id) {
      if (!existingById) throw new Error('The selected food changed or was deleted. Reload and review the possible match again.');
      continue;
    }
    const parsed = !raw.barcode && !raw.source?.barcode && !raw.source?.code && !raw.sku && !raw.source?.sku && !raw.brand && !raw.source?.brand
      ? parseFoodQuantityPrefix(raw.name) : null;
    let candidate = parsed ? { ...raw, name: parsed.foodName, aliases: [...new Set([...(raw.aliases || []), raw.name])] } : { ...raw };
    if (existingById) {
      const conflicts = findFoodMatches(candidate, current.filter(food => food.id !== existingById.id));
      if (conflicts.some(match => match.confidence === 'certain' || match.confidence === 'high' || match.confidence === 'review'))
        throw new Error(`Another food may already represent '${raw.name}'. Review Possible duplicates before renaming this record.`);
      const next = mergeFoodCatalog(current, [candidate]);
      current = next;
      continue;
    }
    if (raw.id) { candidate = { ...candidate }; delete candidate.id; }
    if (raw.allowDuplicate) {
      const newId = globalThis.crypto?.randomUUID?.() || `food-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      current = mergeFoodCatalog(current, [{ ...candidate, id: newId }]);
      continue;
    }
    const matches = findFoodMatches(candidate, current);
    const automatic = matches.filter(match => match.confidence === 'certain' || match.confidence === 'high');
    if (matches.some(match => match.confidence === 'review')) throw new Error(`Possible existing food found for '${raw.name}', but nutrition or product details differ. Review the match before saving.`);
    if (automatic.length > 1) throw new Error(`Several foods match '${raw.name}'. Open Possible duplicates and choose which records to merge.`);
    if (automatic.length === 1) {
      const match = automatic[0].food;
      const clean = cleanFoodCatalogItem(candidate);
      const filledNutrition = Object.fromEntries(Object.keys(match.nutrition || {}).map(key => [key, match.nutrition[key] ?? clean.nutrition[key] ?? null]));
      const merged = { ...match, aliases: [...new Set([...(match.aliases || []), ...(clean.aliases || []), ...(raw.name !== match.name ? [raw.name] : [])])].filter(alias => normalizeFoodText(alias) !== normalizeFoodText(match.name)),
        nutrition: filledNutrition, barcode: match.barcode || clean.barcode, sku: match.sku || clean.sku, retailer: match.retailer || clean.retailer, brand: match.brand || clean.brand };
      current = mergeFoodCatalog(current, [merged]);
      continue;
    }
    if (matches.length) throw new Error(`Possible existing food found for '${raw.name}'. Review the match or choose Create separately before saving.`);
    current = mergeFoodCatalog(current, [candidate]);
  }
  const merged = current;
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
