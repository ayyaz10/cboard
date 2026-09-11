import {
  CACHE_PREFIX,
  cloudflareConfig,
  generateFluxPhoto,
} from "./cloudflare.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

export function createGroceryImageHandler({ createClient, env, fetchImpl }) {
  return async (request) => {
    if (request.method === "OPTIONS")
      return new Response("ok", { headers: cors });
    if (request.method !== "POST")
      return json({ error: "Method not allowed" }, 405);
    try {
      const token = request.headers
        .get("Authorization")
        ?.replace(/^Bearer\s+/i, "");
      if (!token) return json({ error: "Sign in to generate an image." }, 401);
      const db = createClient(
        env("SUPABASE_URL"),
        env("SUPABASE_SERVICE_ROLE_KEY"),
      );
      const { data: auth, error: authError } = await db.auth.getUser(token);
      if (authError || !auth?.user)
        return json({ error: "Sign in again to generate an image." }, 401);
      const body = await request.json();
      if (
        typeof body?.name !== "string" ||
        !body.name.trim() ||
        body.name.length > 100
      )
        return json(
          { error: "Use an item name between 1 and 100 characters." },
          400,
        );
      const name = body.name.trim().toLowerCase().replace(/\s+/g, " ");
      const cacheKey = `${CACHE_PREFIX}${name}`;
      const userId = auth.user.id;
      async function getJob() {
        const { data, error } = await db
          .from("grocery_image_jobs")
          .select("*")
          .eq("user_id", userId)
          .eq("name", cacheKey)
          .maybeSingle();
        if (error)
          throw new Error(
            "Image storage is not configured. Apply the grocery image migrations.",
          );
        return data;
      }
      function existingResult(job) {
        if (job?.url) return json({ url: job.url });
        if (!job || job.status === "failed")
          return json(
            {
              error:
                "No completed photo yet. Retry from the item editor to create one.",
            },
            409,
          );
        if (Date.now() - new Date(job.updated_at).getTime() > 120000)
          return json(
            {
              error:
                "The photo request expired. Retry to create a new image using your remaining allowance.",
            },
            409,
          );
        return json({ pending: true });
      }
      const job = await getJob();
      if (job?.url) return json({ url: job.url });
      // Polls only read our cache; they never submit a second Cloudflare request.
      if (body.poll) return existingResult(job);
      if (
        job &&
        job.status !== "failed" &&
        Date.now() - new Date(job.updated_at).getTime() <= 120000
      )
        return existingResult(job);
      const config = cloudflareConfig(env);
      const { data: prefs, error } = await db
        .from("user_tool_preferences")
        .select("value")
        .eq("user_id", userId)
        .eq("key", "groceries:v1")
        .maybeSingle();
      if (error) throw new Error("Could not check your image allowance.");
      const requestedLimit = Number(prefs?.value?.settings?.imageLimit);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(requestedLimit, config.monthlyCapUsd)
        : 0;
      const reserved = await db.rpc("reserve_grocery_image", {
        p_user: userId,
        p_name: cacheKey,
        p_cost: config.reserveUsd,
        p_limit: limit,
      });
      if (reserved.error) return json({ error: reserved.error.message }, 400);
      if (!reserved.data) return existingResult(await getJob());
      const attempt = await getJob();
      if (!attempt?.generation_id)
        throw new Error(
          "Apply the Cloudflare image migration before generating photos.",
        );
      async function update(values) {
        const result = await db
          .from("grocery_image_jobs")
          .update({ ...values, updated_at: new Date().toISOString() })
          .eq("user_id", userId)
          .eq("name", cacheKey)
          .eq("generation_id", attempt.generation_id)
          .select("name")
          .maybeSingle();
        if (result.error || !result.data)
          throw new Error(
            "Could not save image progress. Retry to check the photo cache.",
          );
      }
      let url;
      try {
        url = await generateFluxPhoto(name, config, fetchImpl);
      } catch (error) {
        // No automatic retry: another attempt consumes another budget reservation.
        await update({ status: "failed" });
        throw error;
      }
      await update({ status: "complete", url });
      return json({ url });
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Image service unavailable.",
        },
        400,
      );
    }
  };
}
