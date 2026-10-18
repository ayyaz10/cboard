const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const number = value => value != null && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const foodRows = payload => list(payload?.foods_search?.results?.food ?? payload?.foods_search?.food ?? payload?.foods?.food);
const servingRows = payload => list(payload?.food?.servings?.serving ?? payload?.food?.serving);
const apiError = payload => {
  const error = payload?.error;
  if (error) {
    const code = error.code ?? payload.error_code;
    const message = typeof error === "string" ? error : error.message ?? error.error_message;
    return [code && `FatSecret API error ${code}`, message].filter(Boolean).join(": ").slice(0, 240);
  }
  if (payload?.error_code != null || payload?.error_message) {
    return [`FatSecret API error ${payload.error_code ?? ""}`, payload.error_message].filter(Boolean).join(": ").slice(0, 240);
  }
  return null;
};
const DETAIL_FIELDS = [
  "calories", "carbohydrate", "protein", "fat", "saturated_fat", "monounsaturated_fat", "polyunsaturated_fat",
  "trans_fat", "cholesterol", "sodium", "potassium", "fiber", "sugar", "vitamin_a", "vitamin_c", "vitamin_d", "calcium", "iron",
];

// One process-level token cache and in-flight promise prevent token storms within an Edge instance.
export function createFatSecretHandler({ createClient, env, fetchImpl, now = Date.now }) {
  let token = null;
  let tokenExpiry = 0;
  let tokenRequest = null;
  const requests = [];
  const dailyCalls = [];
  async function getToken() {
    if (token && tokenExpiry - now() > 60_000) return token;
    if (tokenRequest) return tokenRequest;
    tokenRequest = (async () => {
      const clientId = env("FATSECRET_CLIENT_ID"), clientSecret = env("FATSECRET_CLIENT_SECRET");
      if (!clientId || !clientSecret) throw new Error("FatSecret is not configured.");
      const scope = (env("FATSECRET_SCOPE") || "basic").trim();
      if (!scope.split(/\s+/).some(value => ["basic", "premier"].includes(value))) throw new Error("Configure a FatSecret Basic or Premier scope.");
      const credentials = btoa(`${clientId}:${clientSecret}`);
      const response = await fetchImpl("https://oauth.fatsecret.com/connect/token", {
        method: "POST", headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", scope }),
      });
      if (!response.ok) throw new Error("FatSecret authentication is unavailable.");
      const data = await response.json();
      if (typeof data.access_token !== "string" || !Number.isFinite(Number(data.expires_in))) throw new Error("FatSecret authentication returned an invalid response.");
      token = data.access_token;
      tokenExpiry = now() + Number(data.expires_in) * 1000;
      return token;
    })();
    try { return await tokenRequest; }
    finally { tokenRequest = null; }
  }
  async function callFatSecret(path, params, scope = "basic") {
    const bearer = await getToken();
    const basic = !scope.split(/\s+/).includes("premier");
    const url = new URL(basic ? "https://platform.fatsecret.com/rest/server.api" : `https://platform.fatsecret.com/rest/${path}`);
    const requestParams = basic ? { method: path, ...params, format: "json" } : { ...params, format: "json" };
    const options = basic
      ? { method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(requestParams), signal: AbortSignal.timeout(15000) }
      : { headers: { Authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(15000) };
    if (!basic) Object.entries(requestParams).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    let response = await fetchImpl(url, options);
    if (response.status === 401) {
      token = null; tokenExpiry = 0;
      const refreshed = await getToken();
      response = await fetchImpl(url, basic ? { ...options, headers: { ...options.headers, Authorization: `Bearer ${refreshed}` } } : { ...options, headers: { Authorization: `Bearer ${refreshed}` } });
    }
    if (response.status === 429) throw Object.assign(new Error("FatSecret is busy. Try again shortly."), { status: 429 });
    if (response.status === 403) throw Object.assign(new Error("FatSecret food search is unavailable for this API account."), { status: 503 });
    if (!response.ok) throw Object.assign(new Error("FatSecret is temporarily unavailable."), { status: 503 });
    return response.json();
  }
  return async request => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    try {
      const bearer = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
      if (!bearer) return json({ error: "Sign in to search FatSecret foods." }, 401);
      const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
      const { data, error } = await db.auth.getUser(bearer);
      if (error || !data?.user) return json({ error: "Sign in again to search FatSecret foods." }, 401);
      const scope = (env("FATSECRET_SCOPE") || "basic").trim();
      if (!scope.split(/\s+/).some(value => ["basic", "premier"].includes(value))) return json({ error: "Configure a FatSecret Basic or Premier scope." }, 503);
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
      const op = body?.operation;
      if (op === "search" && (typeof body.query !== "string" || body.query.trim().length < 2 || body.query.length > 120)) return json({ error: "Enter a food name between 2 and 120 characters." }, 400);
      if (op === "details" && (typeof body.foodId !== "string" || !/^\d{1,20}$/.test(body.foodId))) return json({ error: "Choose a valid FatSecret food." }, 400);
      if (!(["search", "details"].includes(op))) return json({ error: "Choose search or details." }, 400);
      const query = op === "search" ? body.query.trim().replace(/\s+/g, " ") : `food:${body.foodId}`;
      const minuteAgo = now() - 60_000;
      while (requests.length && requests[0] < minuteAgo) requests.shift();
      if (requests.length >= 20) return json({ error: "Several food lookups were made recently. Wait a minute and try again." }, 429);
      // Basic edition is documented as 5,000 calls/day. Keep a conservative per-instance ceiling;
      // deployments should also monitor FatSecret's account-level quota across edge instances.
      const dayAgo = now() - 24 * 60 * 60 * 1000;
      while (dailyCalls.length && dailyCalls[0] < dayAgo) dailyCalls.shift();
      if (dailyCalls.length >= 4500) return json({ error: "FatSecret's daily call budget is nearly exhausted. Try again tomorrow." }, 429);
      requests.push(now()); dailyCalls.push(now());
      const basic = !scope.split(/\s+/).includes("premier");
      const payload = op === "search"
        ? await callFatSecret(basic ? "foods.search" : "foods/search/v5", { search_expression: query, max_results: 20, page_number: 0 }, scope)
        : await callFatSecret(basic ? "food.get" : "food/v5", { food_id: body.foodId }, scope);
      const upstreamError = apiError(payload);
      if (upstreamError) throw Object.assign(new Error(upstreamError), { status: 503 });
      let value;
      if (op === "search") {
        value = { foods: foodRows(payload).slice(0, 20).flatMap(food => {
          const foodId = String(food.food_id ?? "");
          const name = typeof food.food_name === "string" ? food.food_name.trim() : "";
          if (!/^\d{1,20}$/.test(foodId) || !name) return [];
          return [{ foodId, name, brand: String(food.brand_name || ""), foodType: String(food.food_type || "Generic"), description: String(food.food_description || "").slice(0, 240) }];
        }) };
      } else {
        const food = payload?.food;
        if (!food || String(food.food_id) !== body.foodId) return json({ error: "FatSecret returned no details for that food." }, 404);
        value = { foodId: body.foodId, name: String(food.food_name || ""), brand: String(food.brand_name || ""), foodType: String(food.food_type || "Generic"), servings: servingRows(payload).flatMap(serving => {
          const servingId = String(serving.serving_id ?? "");
          if (!/^\d{1,20}$/.test(servingId)) return [];
          const metricAmount = number(serving.metric_serving_amount);
          const metricUnit = ["g", "ml", "oz"].includes(String(serving.metric_serving_unit || "").toLowerCase()) ? String(serving.metric_serving_unit).toLowerCase() : null;
          const nutrition = Object.fromEntries(DETAIL_FIELDS.map(field => [field, number(serving[field])]));
          const nutrientMap = { calories: "calories", carbohydrate: "carbs", protein: "protein", fat: "fat", saturated_fat: "saturatedFat", monounsaturated_fat: "monounsaturatedFat", polyunsaturated_fat: "polyunsaturatedFat", trans_fat: "transFat", cholesterol: "cholesterol", sodium: "sodium", potassium: "potassium", fiber: "fiber", sugar: "sugars", vitamin_a: "vitaminA", vitamin_c: "vitaminC", vitamin_d: "vitaminD", calcium: "calcium", iron: "iron" };
          const mapped = Object.fromEntries(Object.entries(nutrientMap).map(([from, to]) => [to, nutrition[from]]));
          // Search get.v5 detail nutrients are per serving. Retain that serving as its unit basis.
          const amount = metricAmount && metricUnit && metricUnit !== "oz" ? metricAmount : null;
          const unit = metricUnit === "ml" ? "ml" : metricUnit === "g" ? "g" : null;
          return [{ servingId, description: String(serving.serving_description || "Serving"), amount, unit, nutrition: mapped }];
        }) };
      }
      return json(value);
    } catch (error) {
      const status = error.status || 503;
      return json({ error: error.message || "FatSecret is temporarily unavailable." }, status);
    }
  };
}
