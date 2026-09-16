import test from "node:test";
import assert from "node:assert/strict";
import { geminiJson, geminiResult, GeminiError, geminiErrorMessage } from "./gemini.js";
const wait = async () => {};

test("temporary outages retry once and recover", async () => {
  for (const status of [500, 502, 503, 504]) {
    let calls = 0;
    const result = await geminiJson("https://example.invalid", {}, { wait, fetchImpl: async () => ++calls === 1 ? new Response("down", { status }) : Response.json({ ok: true }) });
    assert.deepEqual(result, { ok: true }); assert.equal(calls, 2);
  }
});
test("quota and invalid credentials do not consume retries", async () => {
  for (const status of [400, 401, 403, 404, 429]) {
    let calls = 0;
    await assert.rejects(geminiJson("https://example.invalid", {}, { wait, fetchImpl: async () => { calls++; return new Response("private provider detail", { status }); } }), (error) => error.status === status && !error.message.includes("private"));
    assert.equal(calls, 1);
  }
});
test("network failure retries but stops after two attempts", async () => {
  let calls = 0;
  await assert.rejects(geminiJson("https://example.invalid", {}, { wait, fetchImpl: async () => { calls++; throw new TypeError("network"); } }), (error) => error.kind === "network");
  assert.equal(calls, 2);
});
test("hung request aborts both attempts and reports a timeout", async () => {
  let aborted = 0;
  await assert.rejects(geminiJson("https://example.invalid", {}, { wait, timeoutMs: 5, fetchImpl: async (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener("abort", () => { aborted++; reject(new Error("aborted")); })) }), (error) => error.kind === "timeout");
  assert.equal(aborted, 2);
});
test("timeout covers a stalled response body too", async () => {
  await assert.rejects(geminiJson("https://example.invalid", {}, { wait, timeoutMs: 5, fetchImpl: async (_, { signal }) => ({ ok: true, json: () => new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))) }) }), (error) => error.kind === "timeout");
});
test("malformed provider JSON is not retried", async () => {
  let calls = 0;
  await assert.rejects(geminiJson("https://example.invalid", {}, { wait, fetchImpl: async () => { calls++; return new Response("bad json"); } }), (error) => error.kind === "invalid");
  assert.equal(calls, 1);
});
test("generation joins visible parts and rejects missing or truncated results", () => {
  assert.deepEqual(geminiResult({ candidates: [{ finishReason: "STOP", content: { parts: [{ thought: true, text: "internal" }, { text: '{"ok":' }, { text: 'true}' }] } }] }), { ok: true });
  for (const payload of [{}, { promptFeedback: { blockReason: "SAFETY" } }, { candidates: [{ finishReason: "MAX_TOKENS" }] }, { candidates: [{ content: { parts: [{ text: "invalid" }] } }] }]) assert.throws(() => geminiResult(payload), GeminiError);
});
test("messages distinguish provider limits, timeouts and bad output without exposing data", () => {
  assert.match(geminiErrorMessage(new GeminiError(429)), /limit/);
  assert.match(geminiErrorMessage(new GeminiError(0, "timeout")), /too long/);
  assert.match(geminiErrorMessage(new GeminiError(0, "empty")), /incomplete/);
  assert.equal(geminiErrorMessage(new Error("secret"), "fallback"), "fallback");
});
