import test from "node:test";
import assert from "node:assert/strict";
import { createParseRecipeHandler } from "./handler.js";

const generated = { is_recipe: true, title: "Soup", cooking_time_minutes: 20, ingredients: ["1 cup water"], steps: ["Boil water"] };
function setup({ auth = true, allowance = true, generate = async () => generated, insertError = null } = {}) {
  const calls = { generated: 0, inserted: null, clientOptions: null };
  const chain = {
    select() { return this; }, eq() { return this; }, like() { return this; }, limit: async () => ({ data: [], error: null }),
    insert(value) { calls.inserted = value; return { select: () => ({ single: async () => ({ data: { updated_at: "2026-09-11T00:00:00Z" }, error: insertError }) }) }; },
  };
  const db = {
    auth: { getUser: async () => auth ? { data: { user: { id: "user-1" } }, error: null } : { data: {}, error: new Error("bad") } },
    rpc: async () => ({ data: allowance, error: null }),
    from: () => chain,
  };
  const handler = createParseRecipeHandler({
    createClient: (_url, _key, options) => { calls.clientOptions = options; return db; },
    env: (key) => ({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon", GEMINI_API_KEY: "secret", APP_ALLOWED_ORIGINS: "https://app.example.com" })[key],
    generateRecipe: async (text, key) => { calls.generated++; calls.text = text; calls.key = key; return generate(text); },
  });
  return { handler, calls };
}
const request = (body = { recipeText: "Soup with water. Boil for 20 minutes." }, options = {}) => new Request("https://fn.example.com", {
  method: options.method || "POST",
  headers: { Authorization: options.token === false ? "" : "Bearer user-token", Origin: options.origin || "https://app.example.com", "Content-Type": "application/json" },
  body: options.method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
});

test("method, origin, auth, JSON, size, and rate limits fail before Gemini", async () => {
  const { handler, calls } = setup();
  assert.equal((await handler(request({}, { method: "GET" }))).status, 405);
  assert.equal((await handler(request({}, { origin: "https://evil.example" }))).status, 403);
  assert.equal((await handler(request({}, { token: false }))).status, 401);
  assert.equal((await handler(request("not-json"))).status, 400);
  assert.equal((await handler(request({ recipeText: "x".repeat(2001) }))).status, 413);
  const limited = setup({ allowance: false });
  assert.equal((await limited.handler(request())).status, 429);
  assert.equal(calls.generated, 0);
  assert.equal(limited.calls.generated, 0);
});

test("authenticated request sends only text to Gemini and inserts explicit user-owned fields", async () => {
  const { handler, calls } = setup();
  const response = await handler(request({ recipeText: " Soup recipe ", user_id: "attacker", admin: true }));
  assert.equal(response.status, 201);
  assert.equal(calls.text, "Soup recipe");
  assert.equal(calls.key, "secret");
  assert.equal(calls.inserted.user_id, "user-1");
  assert.equal(calls.inserted.key, "recipe:v1:soup");
  assert.deepEqual(Object.keys(calls.inserted).sort(), ["key", "updated_at", "user_id", "value"]);
  assert.equal(calls.clientOptions.global.headers.Authorization, "Bearer user-token");
  const result = await response.json();
  assert.equal(result.recipe.title, "Soup");
});

test("invalid AI output and provider failures return safe errors without inserts", async () => {
  const invalid = setup({ generate: async () => ({ ...generated, steps: [], internal: "secret" }) });
  const invalidResponse = await invalid.handler(request());
  assert.equal(invalidResponse.status, 422);
  assert.equal(invalid.calls.inserted, null);
  assert.doesNotMatch(JSON.stringify(await invalidResponse.json()), /internal|secret/);
  const failed = setup({ generate: async () => { throw new Error("API key secret stack"); } });
  const response = await failed.handler(request());
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "The AI recipe service is unavailable right now. Please try again." });

  const rejectedKey = setup({ generate: async () => { const error = new Error("secret provider detail"); error.status = 403; throw error; } });
  const rejectedResponse = await rejectedKey.handler(request());
  assert.equal(rejectedResponse.status, 502);
  assert.deepEqual(await rejectedResponse.json(), { error: "Gemini rejected the API key. Check the key and its API restrictions." });

  const missingModel = setup({ generate: async () => { const error = new Error("model detail"); error.status = 404; throw error; } });
  assert.deepEqual(await (await missingModel.handler(request())).json(), { error: "No compatible Gemini Flash model is available for this API key." });
});

test("OPTIONS returns scoped CORS headers", async () => {
  const { handler } = setup();
  const response = await handler(new Request("https://fn.example.com", { method: "OPTIONS", headers: { Origin: "https://app.example.com" } }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://app.example.com");
});
