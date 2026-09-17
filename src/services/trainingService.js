import { getUserScopedClient, assertSupabaseResult } from "./supabaseCrud";
async function scope(expected) {
  const context = await getUserScopedClient();
  if (context.userId !== expected)
    throw new Error("Account changed. Reopen Training.");
  return context;
}
export async function loadTraining(userId) {
  const { client } = await scope(userId);
  const result = await client
    .from("training_workspaces")
    .select("data,revision")
    .eq("user_id", userId)
    .maybeSingle();
  assertSupabaseResult(result);
  return result.data;
}
export async function saveTraining(userId, data, revision) {
  const { client } = await scope(userId);
  const record = {
    data,
    revision: revision + 1,
    updated_at: new Date().toISOString(),
  };
  const result = await (
    revision
      ? client
          .from("training_workspaces")
          .update(record)
          .eq("user_id", userId)
          .eq("revision", revision)
      : client
          .from("training_workspaces")
          .insert({ ...record, user_id: userId })
  )
    .select("revision")
    .maybeSingle();
  if (result.error?.code === "23505" || (!result.error && !result.data))
    throw new Error(
      "Conflict: Training changed on another device. Export this device’s backup, then load the cloud copy.",
    );
  assertSupabaseResult(result);
  return result.data.revision;
}
