// Search-a-licious supports broader product-name matching. Browser calls use
// our authenticated proxy because the upstream search does not allow browser CORS.
const value = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
export function nutritionUnit(product) {
  // Prefer the recorded label/package basis over a guess from the food name.
  if (product.nutrition_data_per === "100ml") return "ml";
  const packageUnit = product.product_quantity_unit?.toLowerCase() ||
    (typeof product.quantity === "string" ? product.quantity.match(/\d\s*(kg|mg|g|ml|cl|dl|l)\b/i)?.[1]?.toLowerCase() : null);
  if (["ml", "l", "cl", "dl"].includes(packageUnit)) return "ml";
  if (["g", "kg", "mg"].includes(packageUnit)) return "g";
  const name = String(product.product_name_en || product.product_name || "").toLowerCase().replace(/[-_]/g, " ");
  // Solid products often contain liquid names (milk chocolate, milk powder).
  if (/\b(powder|powdered|dried|dry|instant|granules|beans|leaves|bags|chocolate|cheese|chedar|cheddar|butter|spread|yogurt|yoghurt|ice cream|biscuits?|cookies?|cakes?|bread|rice|oats?|flakes|cereal|nuts?|bars?|gummies|sweets?|candy|crisps|chips)\b/.test(name)) return "g";
  if (/\b(milk|juice|drink|beverage|smoothie|shake|water|cola|lemonade|soda|squash|cordial|syrup|sauce|vinegar|oil|soup|broth|stock|wine|beer|cider|lager|vodka|whisky|whiskey|rum|gin|cream)\b/.test(name) ||
      /\b(iced|brewed|ready to drink)\s+(coffee|tea)\b/.test(name)) return "ml";
  return "g";
}
export function nutritionProduct(product) {
  if (!product || !/^\d+$/.test(String(product.code || ""))) return null;
  const name = product.product_name_en || product.product_name;
  if (typeof name !== "string" || !name.trim()) return null;
  const n = product.nutriments || {};
  const kcal = value(n["energy-kcal_100g"]);
  const kj = value(n["energy-kj_100g"]);
  const nutrition = {
    quantity: 100,
    // OFF uses *_100g for both weight and volume.
    unit: nutritionUnit(product),
    calories: kcal ?? (kj == null ? null : Math.round(kj / 4.184 * 100) / 100),
    protein: value(n.proteins_100g), carbs: value(n.carbohydrates_100g), fat: value(n.fat_100g), fiber: value(n.fiber_100g),
  };
  if ([nutrition.calories, nutrition.protein, nutrition.carbs, nutrition.fat, nutrition.fiber].every((v) => v == null)) return null;
  return {
    code: String(product.code), name: name.trim(),
    brand: Array.isArray(product.brands) ? product.brands.filter((v) => typeof v === "string").join(", ") : typeof product.brands === "string" ? product.brands : "",
    pack: typeof product.quantity === "string" ? product.quantity : "",
    nutrition,
    source: { provider: "Open Food Facts", code: String(product.code), name: name.trim(),
      url: `https://world.openfoodfacts.org/product/${product.code}`, license: "ODbL" },
  };
}
export function createNutritionSearch(fetchImpl = fetch, now = Date.now) {
  const cache = new Map();
  const pending = new Map();
  let requests = [];
  return async function searchNutrition(name) {
    const query = name.trim().replace(/\s+/g, " ");
    if (query.length < 2 || query.length > 120) throw new Error("Enter a product name between 2 and 120 characters.");
    const key = query.toLowerCase();
    if (cache.has(key) && now() - cache.get(key).at < 3600000) return structuredClone(cache.get(key).results);
    if (pending.has(key)) return structuredClone(await pending.get(key));
    requests = requests.filter((time) => now() - time < 60000);
    if (requests.length >= 8) throw new Error("Several foods were searched recently. Wait a minute and try again.");
    requests.push(now());
    const request = (async () => {
      const params = new URLSearchParams({ q: query, page_size: "24" });
      let response;
      try {
        response = await fetchImpl(`https://search.openfoodfacts.org/search?${params}`, {
          headers: { "X-User-Agent": "CBoard/0.1 (https://github.com/ayyaz10/cboard)" },
          signal: AbortSignal.timeout(20000),
        });
      } catch {
        throw new Error("Nutrition search could not connect. Please try again.");
      }
      if (response.status === 429) throw new Error("Nutrition search is busy. Wait a minute and try again.");
      if (!response.ok) throw new Error("Nutrition search is temporarily unavailable. Please try again.");
      let data;
      try { data = await response.json(); } catch { throw new Error("Nutrition search returned an invalid response. Please try again."); }
      if (data.error) throw new Error(data.error);
      if (!Array.isArray(data.hits)) throw new Error("Nutrition search returned an unexpected response. Please try again.");
      const seen = new Set();
      const results = data.hits.map(nutritionProduct).filter((p) => {
        if (!p || seen.has(p.code)) return false;
        seen.add(p.code); return true;
      });
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      if (results.length) cache.set(key, { at: now(), results });
      return results;
    })();
    pending.set(key, request);
    try { return structuredClone(await request); }
    finally { pending.delete(key); }
  };
}
export const searchNutrition = createNutritionSearch(async (url) => {
  const { getUserScopedClient } = await import("./supabaseCrud");
  const { client } = await getUserScopedClient();
  const { data, error } = await client.functions.invoke("nutrition-search", {
    body: { name: new URL(url).searchParams.get("q") },
  });
  if (error) {
    let message = "Nutrition search is temporarily unavailable. Please try again.";
    if (error.context instanceof Response) {
      try { message = (await error.context.json()).error || message; } catch { /* non-JSON failure */ }
    }
    return { ok: true, json: async () => ({ error: message }) };
  }
  return { ok: true, json: async () => data };
});

export async function invokeNutritionFunction(functionName, body) {
  const { getUserScopedClient } = await import("./supabaseCrud");
  const { client } = await getUserScopedClient();
  const { data, error } = await client.functions.invoke(functionName, { body });
  if (error) {
    let message = "Nutrition lookup failed. Please try again.";
    if (error.context instanceof Response) {
      try { message = (await error.context.json()).error || message; } catch { /* no JSON body */ }
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
export async function lookupBarcode(barcode) {
  const code = barcode.replace(/[\s-]/g, "");
  if (!/^(?:\d{8}|\d{12,14})$/.test(code)) throw new Error("Enter an 8, 12, 13 or 14 digit barcode.");
  const data = await invokeNutritionFunction("nutrition-search", { barcode: code });
  return (data.hits || []).map(nutritionProduct).filter(Boolean);
}
