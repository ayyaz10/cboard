const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
export function createNutritionSearchHandler({ createClient, env, fetchImpl, now = Date.now }) {
  const cache = new Map();
  let requests = [];
  return async (request) => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    try {
      const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
      if (!token) return json({ error: "Sign in to look up nutrition." }, 401);
      const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
      const { data, error } = await db.auth.getUser(token);
      if (error || !data?.user) return json({ error: "Sign in again to look up nutrition." }, 401);
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
      const barcode = body?.barcode;
      if (barcode !== undefined && (typeof barcode !== "string" || !/^(?:\d{8}|\d{12,14})$/.test(barcode)))
        return json({ error: "Enter an 8, 12, 13 or 14 digit barcode." }, 400);
      if (barcode === undefined && (typeof body?.name !== "string" || body.name.trim().length < 2 || body.name.length > 120))
        return json({ error: "Enter a product name between 2 and 120 characters." }, 400);
      // Treat input as food names, not Lucene operators or field filters.
      const query = barcode ? `barcode:${barcode}` : body.name.replace(/[^\p{L}\p{N}\s'-]/gu, " ").trim().replace(/\s+/g, " ").toLowerCase();
      if (query.length < 2) return json({ error: "Enter a product name." }, 400);
      const cached = cache.get(query);
      if (cached && now() - cached.at < 3600000) return json(cached.data);
      requests = requests.filter((at) => now() - at < 60000);
      if (requests.length >= 8) return json({ error: "Nutrition search is busy. Wait a minute and try again." }, 429);
      requests.push(now());
      const params = new URLSearchParams({ q: query, page_size: "24" });
      const url = barcode
        ? `https://world.openfoodfacts.org/api/v3/product/${barcode}?fields=code,product_name,product_name_en,brands,quantity,nutriments,nutrition_data_per,product_quantity_unit`
        : `https://search.openfoodfacts.org/search?${params}`;
      const response = await fetchImpl(url, {
        headers: { "User-Agent": "CBoard/0.1 (https://github.com/ayyaz10/cboard)" }, signal: AbortSignal.timeout(20000),
      });
      if (barcode && response.status === 404) return json({ hits: [] });
      if (!response.ok) return json({ error: "The food database is temporarily unavailable. Please try again shortly." }, 503);
      const result = await response.json();
      if (barcode) result.hits = result.product ? [result.product] : [];
      if (!Array.isArray(result.hits) || result.timed_out) return json({ error: "The food database could not complete the search. Please try again." }, 503);
      const fields = ["code", "product_name", "product_name_en", "brands", "quantity", "nutriments", "nutrition_data_per", "product_quantity_unit"];
      const payload = { hits: result.hits.map((hit) => Object.fromEntries(fields.filter((key) => hit[key] != null).map((key) => [key, hit[key]]))) };
      if (payload.hits.length) {
        if (cache.size >= 100) cache.delete(cache.keys().next().value);
        cache.set(query, { at: now(), data: payload });
      }
      return json(payload);
    } catch {
      return json({ error: "Nutrition search could not connect. Please try again." }, 503);
    }
  };
}
