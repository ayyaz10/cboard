import test from "node:test";
import assert from "node:assert/strict";
import { createGroceryImageHandler } from "./handler.js";
import {
  CACHE_PREFIX,
  FLUX_MODEL,
  cloudflareConfig,
  generateFluxPhoto,
} from "./cloudflare.js";

const jpeg = Buffer.from([255, 216, 255, 224, 0, 255, 217]).toString("base64");
const imageUrl = `data:image/jpeg;base64,${jpeg}`;
const settings = {
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  CLOUDFLARE_API_TOKEN: "test-token",
};
const env = (key) => settings[key];
const response = () =>
  Response.json({ success: true, errors: [], result: { image: jpeg } });

function harness(options = {}) {
  const state = {
    jobs: new Map(),
    spent: 0,
    providerCalls: 0,
    reservations: [],
    limit: options.limit ?? 1,
  };
  const rowKey = (user, name) => `${user}:${name}`;
  const db = {
    auth: {
      getUser: async (token) =>
        token === "valid"
          ? { data: { user: { id: "user-1" } } }
          : { data: null, error: new Error("Invalid JWT") },
    },
    from(table) {
      const filters = {};
      let updates;
      const query = {
        select() {
          return query;
        },
        update(values) {
          updates = values;
          return query;
        },
        eq(key, value) {
          filters[key] = value;
          return query;
        },
        async maybeSingle() {
          if (table === "user_tool_preferences")
            return {
              data: { value: { settings: { imageLimit: state.limit } } },
            };
          const row = state.jobs.get(rowKey(filters.user_id, filters.name));
          if (
            !row ||
            Object.entries(filters).some(([key, value]) => row[key] !== value)
          )
            return { data: null };
          if (updates) Object.assign(row, updates);
          return { data: structuredClone(row) };
        },
      };
      return query;
    },
    async rpc(name, params) {
      assert.equal(name, "reserve_grocery_image");
      state.reservations.push(params);
      const key = rowKey(params.p_user, params.p_name);
      const existing = state.jobs.get(key);
      if (
        existing &&
        (existing.url ||
          (existing.status !== "failed" &&
            Date.now() - new Date(existing.updated_at).getTime() < 120000))
      )
        return { data: false };
      if (!(params.p_cost > 0) || state.spent + params.p_cost > params.p_limit)
        return { error: { message: "Monthly image allowance reached." } };
      state.spent = Math.round((state.spent + params.p_cost) * 1e6) / 1e6;
      state.jobs.set(key, {
        user_id: params.p_user,
        name: params.p_name,
        generation_id: crypto.randomUUID(),
        status: "reserved",
        url: null,
        updated_at: new Date().toISOString(),
      });
      return { data: true };
    },
  };
  const handler = createGroceryImageHandler({
    createClient: () => db,
    env: (key) => ({ ...settings, ...options.env })[key],
    fetchImpl: async (...args) => {
      state.providerCalls++;
      return options.fetchImpl ? options.fetchImpl(...args) : response();
    },
  });
  const call = (body = { name: "Oats" }, token = "valid") =>
    handler(
      new Request("https://test.invalid/grocery-image", {
        method: "POST",
        headers: token
          ? {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            }
          : {},
        body: JSON.stringify(body),
      }),
    );
  return { state, call, handler };
}

test("Cloudflare uses the exact FLUX REST model, four steps, and server-side credentials", async () => {
  const config = cloudflareConfig(env);
  const result = await generateFluxPhoto(
    "oats",
    config,
    async (url, request) => {
      assert.equal(
        url,
        `https://api.cloudflare.com/client/v4/accounts/${settings.CLOUDFLARE_ACCOUNT_ID}/ai/run/${FLUX_MODEL}`,
      );
      assert.equal(request.headers.Authorization, "Bearer test-token");
    const body = JSON.parse(request.body);
    assert.equal(body.steps, 4);
    assert.match(body.prompt, /oats/);
    assert.match(body.prompt, /Colorful illustrated grocery icon/);
    assert.match(body.prompt, /no photorealism/);
      assert.deepEqual(Object.keys(body).sort(), ["prompt", "steps"]);
      assert.ok(request.signal instanceof AbortSignal);
      return response();
    },
  );
  assert.equal(result, imageUrl);
});

test("missing credentials and invalid operator limits fail closed", () => {
  for (const override of [
    { CLOUDFLARE_API_TOKEN: "" },
    { CLOUDFLARE_ACCOUNT_ID: "bad" },
    { CLOUDFLARE_IMAGE_RESERVE_USD: "NaN" },
    { CLOUDFLARE_MONTHLY_USER_CAP_USD: "Infinity" },
    { CLOUDFLARE_IMAGE_RESERVE_USD: "0" },
  ]) {
    assert.throws(
      () => cloudflareConfig((key) => ({ ...settings, ...override })[key]),
      /not configured/,
    );
  }
});

test("provider errors, rate limits, timeouts and malformed images have actionable failures", async () => {
  const config = cloudflareConfig(env);
  for (const [fetchImpl, message] of [
    [async () => new Response("", { status: 429 }), /limit was reached/],
    [async () => new Response("", { status: 403 }), /token permissions/],
    [async () => new Response("", { status: 502 }), /could not generate/],
    [
      async () => {
        throw new Error("timeout");
      },
      /did not finish in time/,
    ],
    [async () => Response.json({ success: false }), /could not generate/],
    [
      async () => Response.json({ success: true, result: { image: "<svg/>" } }),
      /invalid image/,
    ],
    [
      async () =>
        Response.json({ success: true, result: { image: btoa("not a jpeg") } }),
      /JPEG/,
    ],
    [async () => new Response("not JSON"), /unreadable/],
  ])
    await assert.rejects(
      () => generateFluxPhoto("oats", config, fetchImpl),
      message,
    );
});

test("authentication and name validation happen before any generation or reservation", async () => {
  const { state, call, handler } = harness();
  assert.equal((await call({ name: "Oats" }, "")).status, 401);
  assert.equal((await call({ name: "Oats" }, "invalid")).status, 401);
  assert.equal((await call({ name: " " })).status, 400);
  assert.equal((await call({ name: "x".repeat(101) })).status, 400);
  assert.equal(
    (await handler(new Request("https://test.invalid", { method: "OPTIONS" })))
      .status,
    200,
  );
  assert.equal(state.providerCalls, 0);
  assert.equal(state.reservations.length, 0);
});

test("photos are cached per user and normalized model-specific key", async () => {
  const { state, call } = harness();
  state.jobs.set("other-user:" + CACHE_PREFIX + "oats", {
    user_id: "other-user",
    name: CACHE_PREFIX + "oats",
    url: "private-other-image",
  });
  assert.deepEqual(await (await call({ name: " OATS " })).json(), {
    url: imageUrl,
  });
  assert.deepEqual(await (await call({ name: "oats" })).json(), {
    url: imageUrl,
  });
  assert.equal(state.providerCalls, 1);
  assert.equal(state.reservations.length, 1);
  assert.equal(state.spent, 0.01);
  assert.equal(
    state.jobs.get("user-1:" + CACHE_PREFIX + "oats").status,
    "complete",
  );
});

test("concurrent clicks and polling reuse the same in-flight generation", async () => {
  let finish, started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  const { state, call } = harness({
    fetchImpl: async () => {
      started();
      await gate;
      return response();
    },
  });
  const first = call();
  await ready;
  assert.deepEqual(await (await call()).json(), { pending: true });
  assert.deepEqual(await (await call({ name: "Oats", poll: true })).json(), {
    pending: true,
  });
  assert.equal(state.providerCalls, 1);
  finish();
  assert.equal((await first).status, 200);
  assert.deepEqual(await (await call({ name: "Oats", poll: true })).json(), {
    url: imageUrl,
  });
  assert.equal(state.reservations.length, 1);
});

test("unknown polls never create images and stale requests require an explicit retry", async () => {
  const { state, call } = harness();
  assert.equal((await call({ name: "Oats", poll: true })).status, 409);
  state.jobs.set("user-1:" + CACHE_PREFIX + "oats", {
    user_id: "user-1",
    name: CACHE_PREFIX + "oats",
    status: "reserved",
    generation_id: "old-attempt",
    updated_at: new Date(Date.now() - 180000).toISOString(),
  });
  assert.equal((await call({ name: "Oats", poll: true })).status, 409);
  assert.equal(state.providerCalls, 0);
  assert.equal((await call()).status, 200);
  assert.notEqual(
    state.jobs.get("user-1:" + CACHE_PREFIX + "oats").generation_id,
    "old-attempt",
  );
});

test("saved account allowance and operator cap take priority over browser input", async () => {
  const zero = harness({ limit: 0 });
  assert.equal((await zero.call({ name: "Oats", limit: 99999 })).status, 400);
  assert.equal(zero.state.providerCalls, 0);
  const capped = harness({
    limit: 100,
    env: { CLOUDFLARE_MONTHLY_USER_CAP_USD: "0.01" },
  });
  assert.equal((await capped.call()).status, 200);
  assert.equal((await capped.call({ name: "Bananas" })).status, 400);
  assert.equal(capped.state.providerCalls, 1);
  assert.equal(capped.state.reservations[0].p_limit, 0.01);
});

test("failed requests retain reservations and retry only on a new explicit request", async () => {
  let fail = true;
  const { state, call } = harness({
    fetchImpl: async () =>
      fail ? new Response("", { status: 429 }) : response(),
  });
  assert.match((await (await call()).json()).error, /limit was reached/);
  assert.equal(state.spent, 0.01);
  assert.equal((await call({ name: "Oats", poll: true })).status, 409);
  assert.equal(state.providerCalls, 1);
  fail = false;
  assert.equal((await call()).status, 200);
  assert.equal(state.providerCalls, 2);
  assert.equal(state.spent, 0.02);
});

test("an expired older request cannot overwrite a newer attempt", async () => {
  let state;
  const setup = harness({
    fetchImpl: async () => {
      state.jobs.get("user-1:" + CACHE_PREFIX + "oats").generation_id =
        "new-attempt";
      return response();
    },
  });
  state = setup.state;
  assert.equal((await setup.call()).status, 400);
  assert.equal(state.jobs.get("user-1:" + CACHE_PREFIX + "oats").url, null);
});
