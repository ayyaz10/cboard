import { MAX_RECIPE_TEXT_LENGTH, toStoredRecipe, uniqueRecipeSlug, validateGeminiRecipe, validateRequestBody } from "./recipeParser.js";

const localOrigins = new Set(["http://localhost:5173", "http://127.0.0.1:5173", "https://ayyaz10.github.io"]);
function allowedOrigins(env) {
  return new Set([...
    localOrigins,
    ...(env("APP_ALLOWED_ORIGINS") || "").split(",").map((item) => item.trim()).filter(Boolean),
  ]);
}
function corsFor(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = !origin || allowedOrigins(env).has(origin);
  return {
    allowed,
    headers: {
      ...(origin && allowed ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  };
}
function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export function createParseRecipeHandler({ createClient, env, generateRecipe }) {
  return async (request) => {
    const cors = corsFor(request, env);
    if (!cors.allowed) return json({ error: "Origin not allowed." }, 403, cors.headers);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors.headers });
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, cors.headers);
    const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Please sign in again." }, 401, cors.headers);

    const supabaseUrl = env("SUPABASE_URL");
    const anonKey = env("SUPABASE_PUBLISHABLE_KEY") || env("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey || !env("GEMINI_API_KEY")) {
      console.error("parse-recipe configuration missing");
      return json({ error: "Recipe parser is not configured." }, 500, cors.headers);
    }
    const db = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let user;
    try {
      const result = await db.auth.getUser(token);
      user = result.data?.user;
      if (result.error || !user) return json({ error: "Please sign in again." }, 401, cors.headers);
    } catch {
      return json({ error: "Please sign in again." }, 401, cors.headers);
    }

    let recipeText;
    try {
      recipeText = validateRequestBody(await request.json());
    } catch (error) {
      const status = error?.status === 413 ? 413 : 400;
      return json({ error: status === 413 ? `Recipe text must be ${MAX_RECIPE_TEXT_LENGTH} characters or fewer.` : "Enter valid recipe text." }, status, cors.headers);
    }

    try {
      const allowance = await db.rpc("reserve_recipe_parse");
      if (allowance.error) {
        console.error("parse-recipe rate check failed", allowance.error.code || "unknown");
        return json({ error: "Unable to parse recipe right now." }, 500, cors.headers);
      }
      if (!allowance.data) return json({ error: "Daily AI recipe limit reached. Try again tomorrow." }, 429, cors.headers);
      let generated;
      try {
        generated = await generateRecipe(recipeText, env("GEMINI_API_KEY"));
      } catch (error) {
        const providerStatus = Number(error?.status || error?.code) || 0;
        console.error("parse-recipe Gemini request failed", error instanceof Error ? error.name : "unknown", providerStatus || "unknown");
        if (providerStatus === 401 || providerStatus === 403)
          return json({ error: "Gemini rejected the API key. Check the key and its API restrictions." }, 502, cors.headers);
        if (providerStatus === 429)
          return json({ error: "Gemini has reached its current quota. Try again later or check the Gemini quota." }, 502, cors.headers);
        if (providerStatus === 400)
          return json({ error: "Gemini rejected the recipe request configuration. Please try again after updating the app." }, 502, cors.headers);
        if (providerStatus === 404)
          return json({ error: "No compatible Gemini Flash model is available for this API key." }, 502, cors.headers);
        return json({ error: "The AI recipe service is unavailable right now. Please try again." }, 502, cors.headers);
      }
      let extracted;
      try {
        extracted = validateGeminiRecipe(generated);
      } catch {
        return json({ error: "The text does not contain a complete recipe with a cooking time, ingredients, and steps." }, 422, cors.headers);
      }
      const existing = await db.from("user_tool_preferences").select("key").eq("user_id", user.id).like("key", "recipe:v1:%").limit(1000);
      if (existing.error) throw new Error("lookup failed");
      const slug = uniqueRecipeSlug(extracted.title, (existing.data || []).map((row) => row.key));
      const recipe = toStoredRecipe(extracted, slug);
      const inserted = await db.from("user_tool_preferences").insert({
        user_id: user.id,
        key: `recipe:v1:${slug}`,
        value: { recipe, image: null },
        updated_at: new Date().toISOString(),
      }).select("updated_at").single();
      if (inserted.error) {
        console.error("parse-recipe insert failed", inserted.error.code || "unknown");
        return json({ error: "Unable to save recipe." }, inserted.error.code === "23505" ? 409 : 500, cors.headers);
      }
      return json({ success: true, recipe: { ...recipe, image: null, updatedAt: inserted.data.updated_at } }, 201, cors.headers);
    } catch (error) {
      console.error("parse-recipe unexpected failure", error instanceof Error ? error.name : "unknown");
      return json({ error: "Unable to save recipe." }, 500, cors.headers);
    }
  };
}
