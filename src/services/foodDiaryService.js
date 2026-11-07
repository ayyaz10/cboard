import { loadGroceries } from './groceryService';
import { reconcileInventory } from '../features/groceries/inventory.js';
import { getUserScopedClient, assertSupabaseResult } from "./supabaseCrud";
import { validDate, validateDay } from "../features/diary/diaryData.js";
import { getFoodCatalog } from './foodCatalogService.js';
import { createSingleFlightByKey } from '../utils/singleFlight.js';
import { notify } from '../lib/notifications.js';

const PREFIX = "food-diary:v1:";
const DIARY_WRITE_TIMEOUT_MS = 30_000;
const DIARY_CACHE_TTL_MS = 45_000;
const loadDiaryOnce = createSingleFlightByKey();
const diaryCache = new Map();
let diaryCacheUserId = null;
let diaryAuthSubscription = null;

function clearDiaryCache() {
  diaryCache.clear();
  diaryCacheUserId = null;
}

function cacheDiary(userId, days) {
  if (diaryCacheUserId && diaryCacheUserId !== userId) diaryCache.clear();
  diaryCacheUserId = userId;
  diaryCache.set(userId, { days: structuredClone(days), expiresAt: Date.now() + DIARY_CACHE_TTL_MS });
}

function watchDiaryAuth(client) {
  if (diaryAuthSubscription) return;
  const result = client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || session?.user?.id && diaryCacheUserId && session.user.id !== diaryCacheUserId) clearDiaryCache();
  });
  diaryAuthSubscription = result.data.subscription;
}

export function getCachedFoodDiary(expectedUserId) {
  if (!expectedUserId) return null;
  if (diaryCacheUserId && diaryCacheUserId !== expectedUserId) clearDiaryCache();
  diaryCacheUserId = expectedUserId;
  const cached = diaryCache.get(expectedUserId);
  if (!cached || cached.expiresAt <= Date.now()) {
    diaryCache.delete(expectedUserId);
    return null;
  }
  return structuredClone(cached.days);
}
export async function getFoodDiary(expectedUserId) {
  const { client, userId } = await getUserScopedClient();
  if (userId !== expectedUserId)
    throw new Error("Your account changed. Reload the diary.");
  watchDiaryAuth(client);
  const cached = getCachedFoodDiary(userId);
  if (cached) return cached;
  const days = await loadDiaryOnce(userId, async () => {
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
  });
  cacheDiary(userId, days);
  return structuredClone(days);
}
export async function getFoodDiaryDays(dates, expectedUserId) {
  const uniqueDates = [...new Set(dates)].filter(validDate);
  if (!uniqueDates.length) return [];
  const { client, userId } = await getUserScopedClient();
  if (userId !== expectedUserId) throw new Error("Your account changed. Reload the diary.");
  const rows = [];
  for (let from = 0; from < uniqueDates.length; from += 80) {
    const keys = uniqueDates.slice(from, from + 80).map(date => `${PREFIX}${date}`);
    const result = await client.from("user_tool_preferences")
      .select("key,value,updated_at")
      .eq("user_id", userId)
      .in("key", keys)
      .order("key");
    assertSupabaseResult(result);
    rows.push(...result.data);
  }
  return rows.map(row => {
    const day = validateDay(row.value);
    if (row.key !== `${PREFIX}${day.date}`) throw new Error("A diary date is invalid. Your saved records have not been changed.");
    return { ...day, updatedAt: row.updated_at };
  });
}
async function commitDay(day, expectedUserId, deleting = false) {
  const clean = validateDay(day);
  const { client, userId } = await getUserScopedClient();
  if (userId !== expectedUserId) throw new Error('Your account changed. Reload the diary.');
  const [groceries, foodCatalog, found] = await Promise.all([
    loadGroceries(),
    getFoodCatalog(userId),
    client.from('user_tool_preferences').select('value,updated_at').eq('user_id', userId).eq('key', `${PREFIX}${clean.date}`).maybeSingle(),
  ]);
  assertSupabaseResult(found);
  if (groceries.userId !== userId) throw new Error('Your account changed. Reload the diary.');
  if ((found.data?.updated_at || null) !== (day.updatedAt || null)) throw new Error('This day changed in another tab. Reload before saving. Your draft is still here.');
  const next = deleting ? null : clean;
  if (next) for (const meal of next.meals) for (const food of meal.items) {
    if (!food.inventoryUsage && food.unit !== 'servings') food.inventoryUsage = food.groceryTrackingEnabled === false ? [] : [{
      ...(food.foodId ? { foodId: food.foodId } : {}), groceryTrackingEnabled: food.groceryTrackingEnabled !== false,
      key: `food:${food.source?.code || food.name.trim().toLowerCase().replace(/\s+/g, ' ')}:${food.nutritionUnit}`,
      name: food.name, code: food.source?.code || '', unit: food.nutritionUnit, amount: 1,
    }];
  }
  const inventory = reconcileInventory(groceries.state, found.data?.value, next, foodCatalog);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DIARY_WRITE_TIMEOUT_MS);
  let result;
  try {
    result = await client.rpc('commit_diary_inventory', {
      p_date: clean.date, p_day: next, p_day_version: day.updatedAt || null,
      p_grocery: inventory.state, p_grocery_version: groceries.version,
      p_adjustments: inventory.adjustments,
    }).abortSignal(controller.signal);
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Saving this meal took too long. Your draft is still here. Check the diary before retrying in case the save completed.');
    throw error;
  } finally { clearTimeout(timeout); }
  assertSupabaseResult(result);
  const previousAlerts = new Set((groceries.state.stockAlerts || []).map(alert => alert.id));
  for (const alert of inventory.state.stockAlerts || []) if (!previousAlerts.has(alert.id)) notify.warning(alert.title);
  const updated = deleting ? null : { ...clean, updatedAt: result.data, inventoryWarnings: inventory.warnings };
  const cached = getCachedFoodDiary(userId);
  if (cached) {
    cacheDiary(userId, deleting ? cached.filter(entry => entry.date !== clean.date) : [...cached.filter(entry => entry.date !== clean.date), updated]);
  }
  return deleting ? clean.date : updated;
}
export const saveFoodDiary = (day, expectedUserId) => commitDay(day, expectedUserId);
export function deleteFoodDiaryDay(day, expectedUserId) {
  if (!day.updatedAt) throw new Error('This diary day is not saved yet.');
  return commitDay(day, expectedUserId, true);
}
