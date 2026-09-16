import { geminiErrorMessage } from "../_shared/gemini.js";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
export function validateLabel(value) {
  if (!value || !Number.isFinite(value.quantity) || value.quantity <= 0 || !["g", "ml", "pieces"].includes(value.unit))
    throw new Error("The label's serving size could not be read. Upload a clearer photo including the column headings.");
  const nutrition = { quantity: value.quantity, unit: value.unit };
  for (const key of ["calories", "protein", "carbs", "fat", "fiber"]) {
    const n = value[key];
    if (n != null && (typeof n !== "number" || !Number.isFinite(n) || n < 0))
      throw new Error("Some label values could not be read. Please try a clearer photo.");
    nutrition[key] = n ?? null;
  }
  if ([nutrition.calories, nutrition.protein, nutrition.carbs, nutrition.fat, nutrition.fiber].every((v) => v == null))
    throw new Error("No readable nutrition values found. Upload a close-up of the nutrition table.");
  return nutrition;
}
export function createLabelHandler({ createClient, env, extract }) {
  return async (request) => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    try {
      const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
      if (!token) return json({ error: "Sign in to read a label." }, 401);
      const db = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
        global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
      });
      const { data, error } = await db.auth.getUser(token);
      if (error || !data?.user) return json({ error: "Sign in again to read a label." }, 401);
      if (Number(request.headers.get("content-length")) > 1500000) return json({ error: "Photo is too large." }, 413);
      const text = await request.text();
      if (text.length > 1500000) return json({ error: "Photo is too large." }, 413);
      let body;
      try { body = JSON.parse(text); } catch { return json({ error: "Invalid photo request." }, 400); }
      const match = typeof body?.image === "string" && body.image.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
      if (!match || match[2].length < 16) return json({ error: "Upload a JPG, PNG or WebP nutrition label." }, 400);
      if (!env("GEMINI_API_KEY")) return json({ error: "Label reading is not configured." }, 503);
      // Reuse the existing persistent AI allowance; no image is stored.
      const allowance = await db.rpc("reserve_recipe_parse");
      if (allowance.error) return json({ error: "Label reading is temporarily unavailable." }, 503);
      if (!allowance.data) return json({ error: "Daily AI reading limit reached. Try again tomorrow." }, 429);
      const result = await extract({ mimeType: `image/${match[1]}`, data: match[2] }, env("GEMINI_API_KEY"));
      try { return json({ nutrition: validateLabel(result) }); }
      catch (error) { return json({ error: error.message }, 422); }
    } catch (error) {
      return json({ error: geminiErrorMessage(error, "The label could not be read right now. Try again with a clear photo.") }, 502);
    }
  };
}
