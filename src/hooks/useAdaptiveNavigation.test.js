import test from "node:test";
import assert from "node:assert/strict";
import { orderByUsage } from "../utils/adaptiveNavigation.js";

test("navigation orders frequent items first and preserves defaults for ties", () => {
  const items = [{ key: "recipes" }, { key: "finance" }, { key: "training" }];
  const usage = {
    recipes: { count: 8, lastUsed: 10 },
    finance: { count: 2, lastUsed: 30 },
    training: { count: 2, lastUsed: 20 },
  };
  assert.deepEqual(
    orderByUsage(items, usage, (item) => item.key).map((item) => item.key),
    ["recipes", "finance", "training"],
  );
  assert.deepEqual(
    orderByUsage(items, {}, (item) => item.key).map((item) => item.key),
    ["recipes", "finance", "training"],
  );
});
