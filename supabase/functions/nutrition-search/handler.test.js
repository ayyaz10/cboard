import test from "node:test";
import assert from "node:assert/strict";
import { createNutritionSearchHandler } from "./handler.js";
const request = (name, token = "test") => new Request("https://local", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify({ name }) });
const config = { env: () => "test", createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "user" } } }) } }) };
test("authenticates, proxies name search and caches only successful results", async () => {
  let calls = 0;
  const handler = createNutritionSearchHandler({ ...config, fetchImpl: async (url) => {
    calls++; assert.equal(new URL(url).searchParams.get("q"), "mature scottish chedar cheese");
    return new Response(JSON.stringify({ hits: [{ code: "123", product_name: "Scottish cheddar", nutriments: { fat_100g: 35 }, unwanted: "discard" }] }));
  } });
  assert.equal((await handler(request("cheddar", ""))).status, 401);
  assert.equal((await handler(request("x"))).status, 400);
  const response = await handler(request("Mature Scottish chedar cheese"));
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  const data = await response.json();
  assert.equal(data.hits[0].unwanted, undefined);
  await handler(request("Mature Scottish chedar cheese")); assert.equal(calls, 1);
});
test("upstream failures never masquerade as no matches", async () => {
  for (const response of [new Response("down", {status:503}), new Response("not json"), new Response(JSON.stringify({hits:[], timed_out:true}))]) {
    const handler = createNutritionSearchHandler({ ...config, fetchImpl: async () => response });
    const result = await handler(request("cheddar")); assert.equal(result.status, 503);
    assert.ok((await result.json()).error);
  }
});

test("barcode lookup uses exact product endpoint and preserves leading zeros", async () => {
  const handler = createNutritionSearchHandler({ ...config, fetchImpl: async (url) => {
    assert.match(url, /api\/v3\/product\/0012345678905\?/);
    return new Response(JSON.stringify({ product: { code: "0012345678905", product_name: "Milk", nutriments: { fat_100g: 0 } } }));
  } });
  const barcodeRequest = (barcode) => new Request("https://local", { method: "POST", headers: { Authorization: "Bearer test" }, body: JSON.stringify({ barcode }) });
  assert.equal((await handler(barcodeRequest("123"))).status, 400);
  const response = await handler(barcodeRequest("0012345678905"));
  assert.equal((await response.json()).hits[0].code, "0012345678905");
  const missing = createNutritionSearchHandler({ ...config, fetchImpl: async () => new Response("Not found", { status: 404 }) });
  assert.deepEqual(await (await missing(barcodeRequest("0012345678905"))).json(), { hits: [] });
});
