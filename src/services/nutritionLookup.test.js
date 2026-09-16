import test from "node:test";
import assert from "node:assert/strict";
import { nutritionProduct, createNutritionSearch } from "./nutritionLookup.js";
const product = { code: "123456", product_name: "Oats", quantity: "500 g", nutriments: {
  "energy-kcal_100g": 370, proteins_100g: 12, carbohydrates_100g: 60, fat_100g: 0,
} };
test("maps only standard per-100 values, preserves zero and missing nutrition", () => {
  const result = nutritionProduct(product);
  assert.equal(result.nutrition.unit, "g");
  assert.equal(result.nutrition.fat, 0);
  assert.equal(result.nutrition.calories, 370);
  const partial = nutritionProduct({ ...product, nutriments: { proteins_serving: 4, fat_100g: 0 } });
  assert.equal(partial.nutrition.protein, null);
  assert.equal(partial.nutrition.calories, null);
  assert.equal(nutritionProduct({ ...product, nutriments: {} }), null);
});

test("fibre lookup preserves label values without guessing missing fibre", () => {
  assert.equal(nutritionProduct(product).nutrition.fiber, null);
  assert.equal(nutritionProduct({ ...product, nutriments: { fiber_100g: 8.5 } }).nutrition.fiber, 8.5);
  assert.equal(nutritionProduct({ ...product, nutriments: { fiber_100g: 0 } }).nutrition.fiber, 0);
  assert.equal(nutritionProduct({ ...product, nutriments: { fiber_100g: -1 } }), null);
});
test("uses package units first and defaults solid foods to grams", () => {
  assert.equal(nutritionProduct({ ...product, quantity: "1 L", nutrition_data_per: "100g" }).nutrition.unit, "ml");
  assert.equal(nutritionProduct({ ...product, quantity: "", nutrition_data_per: "100g" }).nutrition.unit, "g");
  assert.equal(nutritionProduct({ ...product, nutrition_data_per: "100ml" }).nutrition.unit, "ml");
});
test("converts kJ and rejects malformed values and unsafe product IDs", () => {
  const result = nutritionProduct({ ...product, nutriments: { "energy-kj_100g": 418.4, proteins_100g: -1, fat_100g: "5" } });
  assert.equal(result.nutrition.calories, 100);
  assert.equal(result.nutrition.protein, null);
  assert.equal(result.nutrition.fat, null);
  assert.equal(nutritionProduct({ ...product, code: "../bad" }), null);
});
test("search encodes names, caches and deduplicates requests without sharing mutable results", async () => {
  let calls = 0;
  const search = createNutritionSearch(async (url, options) => {
    calls++;
    assert.equal(new URL(url).searchParams.get("q"), "Oats & milk");
    assert.ok(options.headers["X-User-Agent"]);
    return { ok: true, json: async () => ({ hits: [product, product] }) };
  });
  const [a, b] = await Promise.all([search("Oats & milk"), search("Oats & milk")]);
  assert.equal(calls, 1); assert.equal(a.length, 1);
  a[0].nutrition.fat = 30;
  assert.equal(b[0].nutrition.fat, 0);
  assert.equal((await search("oats & milk"))[0].nutrition.fat, 0);
  assert.equal(calls, 1);
});
test("handles no matches, service errors, and request limits", async () => {
  const search = createNutritionSearch(async () => ({ ok: true, json: async () => ({ hits: [] }) }), () => 1000);
  for (let i = 0; i < 8; i++) assert.deepEqual(await search(`food ${i}`), []);
  await assert.rejects(search("food nine"), /Wait a minute/);
  await assert.rejects(createNutritionSearch(async () => ({ status: 429 }))("rice"), /Wait a minute/);
  await assert.rejects(createNutritionSearch(async () => { throw new Error(); })("rice"), /could not connect/);
  await assert.rejects(createNutritionSearch(async () => ({ ok: true, json: async () => ({}) }))("rice"), /unexpected response/);
});

test("new search results support brand arrays and retry empty results", async () => {
  let calls = 0;
  const search = createNutritionSearch(async () => ({ ok: true, json: async () => {
    calls++; return { hits: calls === 1 ? [] : [{ ...product, brands: ["Tesco", "Creamfields"] }] };
  } }));
  assert.deepEqual(await search("Mature Scottish chedar cheese"), []);
  const rows = await search("Mature Scottish chedar cheese");
  assert.equal(rows[0].brand, "Tesco, Creamfields");
  assert.equal(calls, 2);
});

test("auto-selects solid and liquid units without package data", () => {
  for (const name of ["Mature Scottish chedar cheese", "Oats", "Milk chocolate", "Coconut milk powder", "Ice cream", "Coffee beans", "Tea bags", "Greek yogurt"]) {
    assert.equal(nutritionProduct({ ...product, product_name: name, quantity: "" }).nutrition.unit, "g", name);
  }
  for (const name of ["Whole milk", "Orange juice", "Olive oil", "Soy sauce", "Tomato soup", "Iced tea", "Brewed coffee", "Sparkling water"]) {
    assert.equal(nutritionProduct({ ...product, product_name: name, quantity: "" }).nutrition.unit, "ml", name);
  }
  assert.equal(nutritionProduct({ ...product, product_name: "Sauce", quantity: "250 g" }).nutrition.unit, "g");
});
