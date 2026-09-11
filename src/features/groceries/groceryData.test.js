import test from "node:test";
import assert from "node:assert/strict";
import {
  initialState,
  newItem,
  parseEntry,
  stockStatus,
  convert,
  addItems,
  addShopping,
  purchase,
  recipeNeeds,
  cookRecipe,
  normalizeGroceryState,
  groceryImageFor,
  setGroceryImage,
} from "./groceryData.js";
test("all 30 starter groceries have unknown stock, not zero", () => {
  const state = initialState();
  assert.equal(state.items.length, 30);
  assert.ok(
    state.items.every(
      (i) => i.quantity === null && stockStatus(i) === "Set quantity",
    ),
  );
});
test("quick add parses amounts, units, names and decimals", () => {
  assert.deepEqual(
    ["6 bananas", "500 g chicken breast", "2 L milk", "0.5 kg rice"].map(
      (s) => {
        const i = parseEntry(s);
        return [i.name, i.quantity, i.unit];
      },
    ),
    [
      ["bananas", 6, "pieces"],
      ["chicken breast", 500, "g"],
      ["milk", 2, "L"],
      ["rice", 0.5, "kg"],
    ],
  );
  assert.equal(parseEntry("Oats").quantity, null);
});
test("conversion never guesses pack weights or incompatible dimensions", () => {
  assert.equal(convert(0.5, "kg", "g"), 500);
  assert.equal(convert(250, "ml", "L"), 0.25);
  assert.equal(convert(1, "packs", "g"), null);
  assert.equal(convert(1, "g", "ml"), null);
});
test("duplicate groceries merge compatible quantities without mutating input", () => {
  const state = { items: [newItem("Oats", 100, "g")], shopping: [] };
  const result = addItems(state, [newItem("oats", 0.5, "kg")]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].quantity, 600);
  assert.equal(state.items[0].quantity, 100);
  assert.throws(() => addItems(state, [newItem("Oats", 1, "packs")]));
  assert.throws(() => addItems(state, [newItem("Milk", -1, "L")]));
});
test("low stock and recipe additions ensure the needed shopping amount without duplicating it", () => {
  const item = newItem("Oats", 100, "g");
  let list = addShopping([], item, 200, true);
  list = addShopping(list, item, 200, true);
  assert.equal(list[0].quantity, 200);
  list = addShopping(list, { ...item, unit: "kg" }, 0.5, true);
  assert.equal(list[0].quantity, 500);
});
test("purchasing increments stock atomically and cannot count the same entry twice", () => {
  const oats = newItem("Oats", 100, "g");
  const state = { items: [oats], shopping: addShopping([], oats, 500) };
  const purchases = [{ id: state.shopping[0].id, quantity: 450 }];
  const result = purchase(state, purchases);
  assert.equal(result.items[0].quantity, 550);
  assert.equal(result.shopping.length, 0);
  assert.deepEqual(purchase(result, purchases), result);
  assert.equal(state.items[0].quantity, 100);
});
test("unknown stock requires an explicit current quantity when buying", () => {
  const eggs = newItem("Eggs");
  const state = { items: [eggs], shopping: addShopping([], eggs, 6) };
  const id = state.shopping[0].id;
  assert.throws(() => purchase(state, [{ id, quantity: 6 }]));
  assert.equal(
    purchase(state, [{ id, quantity: 6, currentQuantity: 2 }]).items[0]
      .quantity,
    8,
  );
});
test("recipes scale, match common variations, aggregate ingredients, and deduct correctly", () => {
  const state = {
    items: [
      newItem("Plain fat-free Greek yogurt", 500, "g"),
      newItem("Bananas", 4),
    ],
    shopping: [],
  };
  const recipe = {
    ingredients: [
      { name: "Fat-Free Greek Yogurt", amount: 100, unit: "g" },
      { name: "Banana", amount: 1, unit: "medium" },
      { name: "Banana", amount: 1, unit: "whole" },
    ],
  };
  const needs = recipeNeeds(recipe, state, 2);
  assert.equal(needs.length, 2);
  assert.equal(needs[1].required, 4);
  const cooked = cookRecipe(state, needs);
  assert.equal(cooked.items[0].quantity, 300);
  assert.equal(cooked.items[1].quantity, 0);
  assert.equal(state.items[1].quantity, 4);
  assert.throws(() => cookRecipe(cooked, needs));
});
test("unknown recipe amounts and incompatible units block deductions", () => {
  const state = { items: [newItem("Oats", 100, "g")], shopping: [] };
  for (const ingredient of [
    { name: "Oats", amount: null, unit: "g" },
    { name: "Oats", amount: 1, unit: "cups" },
  ]) {
    const needs = recipeNeeds({ ingredients: [ingredient] }, state);
    assert.equal(needs[0].missing, null);
    assert.throws(() => cookRecipe(state, needs));
  }
});

test("one Supabase-backed image library resolves across stock, shopping and recipes", () => {
  const oats = newItem("Oats", 100, "g");
  const state = {
    items: [oats],
    shopping: addShopping([], oats, 200),
    settings: {},
  };
  setGroceryImage(state, "Oats", "data:image/webp;base64,AAAA");
  assert.equal(
    groceryImageFor(state, state.items[0].name),
    "data:image/webp;base64,AAAA",
  );
  assert.equal(
    groceryImageFor(state, state.shopping[0].name),
    "data:image/webp;base64,AAAA",
  );
  assert.equal(
    recipeNeeds(
      { ingredients: [{ name: "Oats", amount: 50, unit: "g" }] },
      state,
    )[0].image,
    "data:image/webp;base64,AAAA",
  );
  setGroceryImage(state, "oats", null);
  assert.equal(groceryImageFor(state, "Oats"), null);
});

test("legacy item images migrate once into the shared library without duplication", () => {
  const state = normalizeGroceryState({
    items: [
      { ...newItem("Bananas", 2), image: "data:image/webp;base64,BBBB" },
    ],
    shopping: [
      { ...newItem("Banana", 3), image: "data:image/webp;base64,BBBB" },
    ],
    settings: {},
  });
  assert.equal(
    groceryImageFor(state, "Banana"),
    "data:image/webp;base64,BBBB",
  );
  assert.equal(Object.hasOwn(state.items[0], "image"), false);
  assert.equal(Object.hasOwn(state.shopping[0], "image"), false);
});
