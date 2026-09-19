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
export async function saveFoodDiary(day, expectedUserId) {
  const clean = validateDay(day);
  const { client, userId } = await getUserScopedClient();
  if (userId !== expectedUserId)
    throw new Error("Your account changed. Reload the diary before saving.");
  const payload = {
    user_id: userId,
    key: `${PREFIX}${clean.date}`,
    value: clean,
    updated_at: new Date().toISOString(),
  };
  const query = day.updatedAt
    ? client
        .from("user_tool_preferences")
        .update({ value: clean, updated_at: payload.updated_at })
        .eq("user_id", userId)
        .eq("key", payload.key)
        .eq("updated_at", day.updatedAt)
    : client.from("user_tool_preferences").insert(payload);
  const result = await query.select("updated_at").maybeSingle();
  if (result.error?.code === "23505" || (!result.error && !result.data))
    throw new Error(
      "This day changed in another tab. Reload the diary before saving again. Your draft is still here.",
    );
  assertSupabaseResult(result);
  return { ...clean, updatedAt: result.data.updated_at };
}
