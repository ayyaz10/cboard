import { geminiErrorMessage } from "../_shared/gemini.js";
import { validateFinanceRequest, validateFinanceDraft } from "./financeParser.js";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
export function createFinanceHandler({ createClient, env, generate }) {
  return async (request) => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    try {
      const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
      if (!token) return json({ error: "Sign in to use AI quick add." }, 401);
      const db = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
        global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
      });
      const { data, error } = await db.auth.getUser(token);
      if (error || !data?.user) return json({ error: "Sign in again to use AI quick add." }, 401);
      const text = await request.text();
      if (text.length > 60000) return json({ error: "Quick-add request is too large." }, 413);
      let context;
      try { context = validateFinanceRequest(JSON.parse(text)); }
      catch (error) { return json({ error: error.message }, 400); }
      if (!env("GEMINI_API_KEY")) return json({ error: "AI quick add is not configured. Use Add transaction instead." }, 503);
      // Share the existing persistent 30/day AI reading allowance.
      const allowance = await db.rpc("reserve_recipe_parse");
      if (allowance.error) return json({ error: "AI quick add is unavailable. Use Add transaction instead." }, 503);
      if (!allowance.data) return json({ error: "Daily AI limit reached. You can still use Add transaction." }, 429);
      const result = await generate(context, env("GEMINI_API_KEY"));
      try { return json(validateFinanceDraft(result, context)); }
      catch (error) { return json({ error: error.message }, 422); }
    } catch (error) {
      return json({ error: geminiErrorMessage(error, "Gemini could not prepare this transaction. Try again later or use Add transaction.") }, 502);
    }
  };
}
