import test from "node:test";
import assert from "node:assert/strict";
import {
  recipeNutrition,
  validateNutrition,
  estimatedCost,
  shoppingEstimate,
  validatePrice,
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

test("estimates scale to quantities and distinguish missing prices from free items", () => {
  const item = { ...newItem("Rice", 750, "g"), estimatedPrice: 2.50, priceQuantity: 500 };
  assert.equal(estimatedCost(item), 3.75);
  assert.deepEqual(shoppingEstimate([item, newItem("Milk", 1, "L"),
    { ...newItem("Apple", 1), estimatedPrice: 0 }]), { total: 3.75, missing: 1 });
  assert.throws(() => validatePrice({ estimatedPrice: -1, priceQuantity: 1 }));
  assert.throws(() => validatePrice({ estimatedPrice: 1, priceQuantity: 0 }));
});
test("prices survive shopping merges and purchases with converted units", () => {
  const rice = { ...newItem("Rice", 0, "kg"), estimatedPrice: 4, priceQuantity: 1 };
  const shopping = addShopping([newItem("Rice", 500, "g")], rice, 1);
  assert.equal(estimatedCost(shopping[0]), 6);
  const state = { ...initialState(), items: [rice], shopping };
  const bought = purchase(state, [{ id: shopping[0].id, quantity: 1500 }]);
  assert.equal(bought.items[0].priceQuantity, 1);
  assert.equal(estimatedCost(bought.items[0]), 6);
  const fresh = purchase({ ...state, items: [] }, [{ id: shopping[0].id, quantity: 1500 }]);
  assert.equal(estimatedCost(fresh.items[0]), 6);
});

test("recipe nutrition converts label units and scales independently of stock", () => {
  const item = { ...newItem("Rice", null, "packs"), nutrition: {
    quantity: 100, unit: "g", calories: 360, protein: 7, carbs: 80, fat: 0,
  } };
  const recipe = { ingredients: [{ name: "Rice", amount: 0.25, unit: "kg" }] };
  const totals = recipeNutrition(recipe, { items: [item] }, 2);
  assert.equal(totals.calories.value, 1800);
  assert.equal(totals.protein.value, 35);
  assert.equal(totals.fat.value, 0);
  assert.deepEqual(totals.fat.missing, []);
});
test("recipe nutrition exposes partial and unknown values instead of zero", () => {
  const item = { ...newItem("Milk"), nutrition: { quantity: 100, unit: "ml", protein: 3, fat: 0 } };
  const totals = recipeNutrition({ ingredients: [
    { name: "Milk", amount: 200, unit: "ml" },
    { name: "Milk", amount: 1, unit: "bottles" },
    { name: "Sugar", amount: null, unit: "g" },
  ] }, { items: [item] });
  assert.equal(totals.protein.value, 6);
  assert.deepEqual(totals.protein.missing, ["Milk", "Sugar"]);
  assert.equal(totals.calories.value, null);
  assert.equal(totals.calories.missing.length, 3);
  assert.equal(totals.fat.value, 0);
});
test("nutrition is optional, validates basis and preserves unknowns", () => {
  validateNutrition(null);
  validateNutrition({ quantity: 1, unit: "pieces", protein: null, fat: 0 });
  for (const nutrition of [
    { quantity: 0, unit: "g" }, { quantity: 1, unit: "serving" },
    { quantity: 100, unit: "g", calories: -1 },
    { quantity: 100, unit: "g", protein: Infinity },
  ]) assert.throws(() => validateNutrition(nutrition));
  const state = normalizeGroceryState({ items: [{ name: "Rice" }], shopping: [] });
  assert.equal(state.items[0].nutrition, null);
});
test("nutrition survives additions, shopping merges, recipes and purchases", () => {
  const item = { ...newItem("Rice", 1000, "g"), nutrition: { quantity: 100, unit: "g", protein: 7 } };
  const state = { ...initialState(), items: [], shopping: [] };
  const added = addItems(state, [item]);
  const need = recipeNeeds({ ingredients: [{ name: "Rice", amount: 2, unit: "kg" }] }, added)[0];
  assert.deepEqual(need.nutrition, item.nutrition);
  const shopping = addShopping([newItem("Rice", 1, "kg")], item, 500);
  assert.deepEqual(shopping[0].nutrition, item.nutrition);
  for (const items of [[], [newItem("Rice", 0, "kg")]]) {
    const bought = purchase({ ...state, items, shopping }, [{ id: shopping[0].id, quantity: 1.5 }]);
    assert.deepEqual(bought.items[0].nutrition, item.nutrition);
  }
  const merged = addItems({ ...state, items: [newItem("Rice", 0, "kg")] }, [item]);
  assert.deepEqual(merged.items[0].nutrition, item.nutrition);
  assert.equal(state.items.length, 0);
});
