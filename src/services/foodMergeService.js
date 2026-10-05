import { getUserScopedClient, assertSupabaseResult } from './supabaseCrud.js';
import { applyFoodCatalogToRecipes, mergeCanonicalFoods, mergeFoodCatalog } from '../features/nutrition/foodCatalog.js';
import { mergeFoodNamesInGroceryState, mergeFoodReferencesInRecipe } from '../features/nutrition/foodMergeData.js';
import { validateRecipe } from '../features/recipes/recipeData.js';

const CATALOG_KEY = 'food-catalog:v1';
const RECIPE_PREFIX = 'recipe:v1:';
const GROCERY_KEY = 'groceries:v1';

async function readAllRecipes(client, userId) {
  const rows = [];
  for (let from = 0; ; from += 100) {
    const result = await client.from('user_tool_preferences').select('key,value,updated_at').eq('user_id', userId).like('key', `${RECIPE_PREFIX}%`).order('key').range(from, from + 99);
    assertSupabaseResult(result);
    rows.push(...result.data);
    if (result.data.length < 100) return rows;
  }
}

export async function mergeFoodRecords({ keepId, mergeIds, nutritionSourceId, expectedUserId }) {
  const { client, userId } = await getUserScopedClient();
  if (expectedUserId && userId !== expectedUserId) throw new Error('Your account changed. Reload before merging foods.');
  if (!Array.isArray(mergeIds) || !mergeIds.length || new Set([keepId, ...mergeIds]).size !== mergeIds.length + 1) throw new Error('Select one canonical food and at least one different food to merge.');
  const [catalogResult, recipeRows, groceryResult] = await Promise.all([
    client.from('user_tool_preferences').select('value,updated_at').eq('user_id', userId).eq('key', CATALOG_KEY).maybeSingle(),
    readAllRecipes(client, userId),
    client.from('user_tool_preferences').select('value,updated_at').eq('user_id', userId).eq('key', GROCERY_KEY).maybeSingle(),
  ]);
  assertSupabaseResult(catalogResult);
  assertSupabaseResult(groceryResult);
  const catalogRow = catalogResult.data;
  const catalog = mergeFoodCatalog([], Array.isArray(catalogRow?.value?.items) ? catalogRow.value.items : []);
  const selectedIds = new Set([keepId, ...mergeIds]);
  const selectedFoods = catalog.filter(food => selectedIds.has(food.id));
  if (selectedFoods.length !== selectedIds.size) throw new Error('One of the selected foods changed or was deleted. Reload Possible duplicates.');
  const keptFood = mergeCanonicalFoods(catalog, keepId, mergeIds, nutritionSourceId);
  const nextCatalog = mergeFoodCatalog(catalog.filter(food => !mergeIds.includes(food.id)), [keptFood]);
  const rewrittenRows = [];
  for (const row of recipeRows) {
    const clean = validateRecipe(row.value.recipe);
    const rewritten = mergeFoodReferencesInRecipe(clean, mergeIds, selectedFoods, keptFood, catalog);
    const recalculated = applyFoodCatalogToRecipes([rewritten], nextCatalog)[0];
    if (JSON.stringify(recalculated) === JSON.stringify(clean)) continue;
    rewrittenRows.push({ user_id: userId, key: row.key, value: { ...row.value, recipe: validateRecipe(recalculated) }, updated_at: new Date().toISOString() });
  }
  const groceryRewrite = groceryResult.data ? mergeFoodNamesInGroceryState(groceryResult.data.value, selectedFoods, keptFood) : { changed: false };
  const expectedVersions = new Map([[CATALOG_KEY, catalogRow?.updated_at || null]]);
  for (const row of rewrittenRows) expectedVersions.set(row.key, recipeRows.find(source => source.key === row.key)?.updated_at || null);
  if (groceryRewrite.changed) expectedVersions.set(GROCERY_KEY, groceryResult.data?.updated_at || null);
  const latestVersions = await client.from('user_tool_preferences').select('key,updated_at').eq('user_id', userId).in('key', [...expectedVersions.keys()]);
  assertSupabaseResult(latestVersions);
  const actualVersions = new Map(latestVersions.data.map(row => [row.key, row.updated_at || null]));
  if ([...expectedVersions].some(([key, version]) => (actualVersions.get(key) || null) !== version))
    throw new Error('Food, recipe, or grocery data changed while preparing the merge. Reload and try again.');
  const payload = [
    ...rewrittenRows,
    { user_id: userId, key: CATALOG_KEY, value: { version: 1, items: nextCatalog }, updated_at: new Date().toISOString() },
    ...(groceryRewrite.changed ? [{ user_id: userId, key: GROCERY_KEY, value: groceryRewrite.state, updated_at: new Date().toISOString() }] : []),
  ];
  const write = await client.from('user_tool_preferences').upsert(payload, { onConflict: 'user_id,key' });
  assertSupabaseResult(write);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('food-catalog-changed'));
  return { catalog: nextCatalog, recipesUpdated: rewrittenRows.length, mergedCount: mergeIds.length };
}
