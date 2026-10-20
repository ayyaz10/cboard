import { getUserScopedClient, assertSupabaseResult } from './supabaseCrud.js';
import { cleanFoodCatalogItem, mergeFoodCatalog, normalizeFoodText, parseFoodQuantityPrefix, findFoodMatches, resolveRecipeFoodCandidate } from '../features/nutrition/foodCatalog.js';
import { unlinkDeletedFoodFromGroceryState } from '../features/nutrition/foodMergeData.js';

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
  const migrated = stored.some(item => typeof item?.id !== 'string' || !item.id.trim() ||
    item.groceryTrackingEnabled === undefined || item.shoppingListEnabled === undefined || item.nutritionTrackingEnabled === undefined ||
    item.receiptMappings === undefined || item.groceryTrackingEnabled === false && item.shoppingListEnabled !== false);
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
      if (raw.separateAliasesOnly) {
        current = mergeFoodCatalog(current, [candidate]);
        continue;
      }
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
    const separateFrom = food => (food.separateAliases || []).some(alias => normalizeFoodText(alias) === normalizeFoodText(candidate.name));
    const candidates = current.filter(food => !separateFrom(food));
    const matches = findFoodMatches(candidate, candidates);
    const resolution = resolveRecipeFoodCandidate(candidate, candidates);
    if (resolution.status === 'review') throw new Error(`Possible existing food found for '${raw.name}'. Review the suggested food before saving or choose Create separately.`);
    const automatic = resolution.status === 'matched' ? [resolution.food] : matches.filter(match => match.confidence === 'certain' || match.confidence === 'high').map(match => match.food);
    if (matches.some(match => match.confidence === 'review')) throw new Error(`Possible existing food found for '${raw.name}', but nutrition or product details differ. Review the match before saving.`);
    if (automatic.length > 1) throw new Error(`Several foods match '${raw.name}'. Open Possible duplicates and choose which records to merge.`);
    if (automatic.length === 1) {
      const match = automatic[0];
      const clean = cleanFoodCatalogItem(candidate);
      const filledNutrition = Object.fromEntries(Object.keys(match.nutrition || {}).map(key => [key, match.nutrition[key] ?? clean.nutrition[key] ?? null]));
      const nutrientSources = { ...(match.nutrientSources || {}) };
      for (const [key, value] of Object.entries(clean.nutrition || {})) if (match.nutrition?.[key] == null && value != null && clean.nutrientSources?.[key]) nutrientSources[key] = clean.nutrientSources[key];
      const merged = { ...match, aliases: [...new Set([...(match.aliases || []), ...(clean.aliases || []), ...(raw.name !== match.name ? [raw.name] : [])])].filter(alias => normalizeFoodText(alias) !== normalizeFoodText(match.name)),
        nutrition: filledNutrition, nutrientSources, barcode: match.barcode || clean.barcode, sku: match.sku || clean.sku, retailer: match.retailer || clean.retailer, brand: match.brand || clean.brand };
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

export async function saveReceiptFoodMappings(mappings, expectedUserId) {
  const valid = [...new Map((mappings || []).filter(item => item && typeof item.foodId === 'string' && typeof item.productCode === 'string' && /^\d{5,8}$/.test(item.productCode) && typeof item.retailer === 'string' && item.retailer.trim() && typeof item.alias === 'string' && item.alias.trim())
    .map(item => [`${item.foodId}:${normalizeFoodText(item.retailer)}:${item.productCode}`, { foodId:item.foodId, retailer:item.retailer.trim().slice(0,120), productCode:item.productCode, alias:item.alias.trim().slice(0,300) }])).values()];
  if (!valid.length) return;
  const { client, userId } = await getUserScopedClient();
  if (expectedUserId && userId !== expectedUserId) throw new Error('Your account changed. Reload before saving receipt food links.');
  const found = await client.from('user_tool_preferences').select('value,updated_at').eq('user_id', userId).eq('key', KEY).maybeSingle();
  assertSupabaseResult(found);
  const current = mergeFoodCatalog([], Array.isArray(found.data?.value?.items) ? found.data.value.items : []);
  for (const mapping of valid) {
    const food = current.find(item => item.id === mapping.foodId);
    if (!food) throw new Error('A selected food was removed. Reload the food library and choose it again.');
    const conflict=current.find(item=>item.id!==food.id&&(item.receiptMappings||[]).some(existing=>existing.productCode===mapping.productCode&&normalizeFoodText(existing.retailer)===normalizeFoodText(mapping.retailer)));
    if(conflict)throw new Error(`${mapping.retailer} product ${mapping.productCode} is already linked to ${conflict.name}. Choose that food or resolve the saved mapping first.`);
    food.receiptMappings = [...new Map([...(food.receiptMappings || []), { retailer:mapping.retailer, productCode:mapping.productCode, alias:mapping.alias }]
      .map(entry => [`${normalizeFoodText(entry.retailer)}:${entry.productCode}`, entry])).values()].slice(-200);
  }
  await writeCatalog(client, userId, current, found.data);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('food-catalog-changed'));
  return current;
}

async function rewriteReceiptFoodReferences(client,userId,idMap) {
  const found = await client.from('finance_workspaces').select('state,updated_at').eq('user_id',userId).maybeSingle();
  assertSupabaseResult(found);
  if (!found.data?.state || !Array.isArray(found.data.state.transactions)) return false;
  const state = structuredClone(found.data.state);let changed=false;
  for (const transaction of state.transactions) for (const item of transaction.receipt?.items || []) {
    if (!Object.hasOwn(idMap,item.canonicalFoodId)) continue;
    item.canonicalFoodId = idMap[item.canonicalFoodId] || null;
    item.rememberFoodMapping = false;changed=true;
  }
  if (!changed) return false;
  const updated_at = new Date().toISOString();let query = client.from('finance_workspaces').update({state,updated_at}).eq('user_id',userId);
  query = found.data.updated_at ? query.eq('updated_at',found.data.updated_at) : query.is('updated_at',null);
  const saved = await query.select('updated_at').maybeSingle();
  assertSupabaseResult(saved);
  if (!saved.data) throw new Error('Finance receipts changed in another tab. Reload and retry the food change.');
  return true;
}

async function unlinkGroceryFoodReferences(client,userId,foodIds) {
  const found=await client.from('user_tool_preferences').select('value,updated_at').eq('user_id',userId).eq('key','groceries:v1').maybeSingle();
  assertSupabaseResult(found);if(!found.data?.value)return false;
  const rewritten=unlinkDeletedFoodFromGroceryState(found.data.value,foodIds);if(!rewritten.changed)return false;
  const updated_at=new Date().toISOString();let query=client.from('user_tool_preferences').update({value:rewritten.state,updated_at}).eq('user_id',userId).eq('key','groceries:v1');
  query=found.data.updated_at?query.eq('updated_at',found.data.updated_at):query.is('updated_at',null);
  const saved=await query.select('updated_at').maybeSingle();assertSupabaseResult(saved);
  if(!saved.data)throw new Error('Grocery links changed in another tab. Reload and retry the food change.');
  return true;
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
    await rewriteReceiptFoodReferences(client,userId,Object.fromEntries([...deleting].map(id=>[id,null])));
    await unlinkGroceryFoodReferences(client,userId,deleting);
    await writeCatalog(client, userId, remaining, found.data);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('food-catalog-changed'));
  }
  return removed;
}
