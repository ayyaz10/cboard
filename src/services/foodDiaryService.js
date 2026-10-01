import { loadGroceries } from './groceryService';
import { reconcileInventory } from '../features/groceries/inventory.js';
import { getUserScopedClient, assertSupabaseResult } from "./supabaseCrud";
import { validateDay } from "../features/diary/diaryData.js";

const PREFIX = "food-diary:v1:";
export async function getFoodDiary(expectedUserId) {
  const { client, userId } = await getUserScopedClient();
  if (userId !== expectedUserId)
    throw new Error("Your account changed. Reload the diary.");
  const rows = [];
  for (let from = 0; ; from += 100) {
    const result = await client
      .from("user_tool_preferences")
      .select("key,value,updated_at")
      .eq("user_id", userId)
      .like("key", `${PREFIX}%`)
      .order("key")
      .range(from, from + 99);
    assertSupabaseResult(result);
    rows.push(...result.data);
    if (result.data.length < 100) break;
  }
  return rows.map((row) => {
    const day = validateDay(row.value);
    if (row.key !== `${PREFIX}${day.date}`)
      throw new Error(
        "A diary date is invalid. Your saved records have not been changed.",
      );
    return { ...day, updatedAt: row.updated_at };
  });
}
async function commitDay(day, expectedUserId, deleting = false) {
  const clean = validateDay(day);
  const { client, userId } = await getUserScopedClient();
  if (userId !== expectedUserId) throw new Error('Your account changed. Reload the diary.');
  const [groceries, found] = await Promise.all([
    loadGroceries(),
    client.from('user_tool_preferences').select('value,updated_at').eq('user_id', userId).eq('key', `${PREFIX}${clean.date}`).maybeSingle(),
  ]);
  assertSupabaseResult(found);
  if (groceries.userId !== userId) throw new Error('Your account changed. Reload the diary.');
  if ((found.data?.updated_at || null) !== (day.updatedAt || null)) throw new Error('This day changed in another tab. Reload before saving. Your draft is still here.');
  const next = deleting ? null : clean;
  if (next) for (const meal of next.meals) for (const food of meal.items) {
    if (!food.inventoryUsage && food.unit !== 'servings') food.inventoryUsage = [{
      key: `food:${food.source?.code || food.name.trim().toLowerCase().replace(/\s+/g, ' ')}:${food.nutritionUnit}`,
      name: food.name, code: food.source?.code || '', unit: food.nutritionUnit, amount: 1,
    }];
  }
  const inventory = reconcileInventory(groceries.state, found.data?.value, next);
  const result = await client.rpc('commit_diary_inventory', {
    p_date: clean.date, p_day: next, p_day_version: day.updatedAt || null,
    p_grocery: inventory.state, p_grocery_version: groceries.version,
    p_adjustments: inventory.adjustments,
  });
  assertSupabaseResult(result);
  return deleting ? clean.date : { ...clean, updatedAt: result.data };
}
export const saveFoodDiary = (day, expectedUserId) => commitDay(day, expectedUserId);
export function deleteFoodDiaryDay(day, expectedUserId) {
  if (!day.updatedAt) throw new Error('This diary day is not saved yet.');
  return commitDay(day, expectedUserId, true);
}
