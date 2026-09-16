import test from "node:test";
import assert from "node:assert/strict";
import { createLabelHandler, validateLabel } from "./handler.js";
const values = { quantity: 100, unit: "g", calories: 416, protein: 25, carbs: null, fat: 0, fiber: null };
const config = { env: () => "test", createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "user" } } }) }, rpc: async () => ({ data: true }) }) };
const request = (image, token = "test") => new Request("https://local", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify({ image }) });
const image = "data:image/png;base64,iVBORw0KGgoAAAAAAAAAAAAA";
test("label validation retains unknowns and zero, rejects unknown basis and guesses", () => {
  assert.deepEqual(validateLabel(values), values);
  assert.equal(validateLabel({ ...values, fiber: 5 }).fiber, 5);
  assert.throws(() => validateLabel({ ...values, fiber: -1 }));
  for (const value of [null, { ...values, quantity: null }, { ...values, unit: "serving" }, { ...values, fat: -1 }, { ...values, protein: "25" }, { quantity: 100, unit: "g" }]) assert.throws(() => validateLabel(value));
});
test("authenticated photo extraction returns review data without saving image", async () => {
  let calls = 0;
  const handler = createLabelHandler({ ...config, extract: async (photo) => { calls++; assert.equal(photo.mimeType, "image/png"); return values; } });
  assert.equal((await handler(request(image, ""))).status, 401);
  assert.equal((await handler(request("data:text/html;base64,AAAA"))).status, 400);
  const response = await handler(request(image));
  assert.deepEqual(await response.json(), { nutrition: values }); assert.equal(calls, 1);
});
test("quota and unreadable labels fail without invented values", async () => {
  const unreadable = createLabelHandler({ ...config, extract: async () => ({}) });
  assert.equal((await unreadable(request(image))).status, 422);
  const quota = createLabelHandler({ ...config, createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "user" } } }) }, rpc: async () => ({ data: false }) }), extract: async () => { throw new Error("must not run"); } });
  assert.equal((await quota(request(image))).status, 429);
  const failed = createLabelHandler({ ...config, extract: async () => { throw new Error("provider failed"); } });
  assert.equal((await failed(request(image))).status, 502);
});
