import { getRecipes } from './recipeService';
import { getFoodDiary } from './foodDiaryService';
import { linkRecipeInventory } from '../features/groceries/inventory.js';
import { getUserScopedClient, assertSupabaseResult } from "./supabaseCrud";
import {
  initialState,
  normalizeGroceryState,
} from "../features/groceries/groceryData";
const key = "groceries:v1";
export async function loadGroceries() {
  const { client, userId } = await getUserScopedClient();
  const result = await client
    .from("user_tool_preferences")
    .select("value,updated_at")
    .eq("user_id", userId)
    .eq("key", key)
    .maybeSingle();
  assertSupabaseResult(result);
  const [recipes, days] = await Promise.all([getRecipes(), getFoodDiary(userId)]);
  const loaded = result.data
    ? {
        state: normalizeGroceryState(result.data.value),
        version: result.data.updated_at,
        userId,
      }
    : { state: initialState(), version: null, userId };
  loaded.state = linkRecipeInventory(loaded.state, recipes, days);
  return loaded;
}
export async function saveGroceries(state, version, expectedUserId) {
  const { client, userId } = await getUserScopedClient();
  if (userId !== expectedUserId)
    throw new Error("Your account changed. Reload groceries before saving.");
  for (const entry of Object.values(state.inventoryLedger || {})) for (const id of Object.keys(entry)) {
    if (!state.items.some(item => item.id === id)) throw new Error('This stock item has tracked diary usage. Set its stock to zero instead of deleting it.');
  }
  const updated_at = new Date().toISOString();
  const query = version
    ? client
        .from("user_tool_preferences")
        .update({ value: state, updated_at })
        .eq("user_id", userId)
        .eq("key", key)
        .eq("updated_at", version)
    : client
        .from("user_tool_preferences")
        .insert({ user_id: userId, key, value: state, updated_at });
  const result = await query.select("updated_at").maybeSingle();
  if (result.error?.code === "23505" || (!result.error && !result.data))
    throw new Error(
      "Groceries changed in another tab. Reload before trying again.",
    );
  assertSupabaseResult(result);
  return result.data.updated_at;
}
export async function groceryImage(name, poll = false) {
  const { client } = await getUserScopedClient();
  const { data, error } = await client.functions.invoke("grocery-image", {
    body: { name, poll },
  });
  let serviceError = data?.error;
  if (error?.context instanceof Response) {
    try {
      serviceError = (await error.context.json()).error;
    } catch {
      /* Network errors have no JSON response. */
    }
  }
  if (error || serviceError)
    throw new Error(
      serviceError ||
        "Image service unavailable. You can still upload a photo.",
    );
  return data;
}
