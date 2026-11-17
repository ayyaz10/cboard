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
  stockPercentage,
  formatStockPercentage,
  recordStockTransitions,
  plannedIngredientShortages,
  restockStock,
  undoRestockStock,
  setShoppingCompleted,
  convert,
  addItems,
  addShopping,
  purchase,
  recipeNeeds,
  cookRecipe,
  normalizeGroceryState,
  checkGroceryIntegrity,
  groceryImageFor,
  setGroceryImage,
} from "./groceryData.js";
test("all 30 starter groceries have unknown stock, not zero", () => {
  const state = initialState();
  assert.equal(state.items.length, 30);
  assert.ok(
    state.items.every(
      (i) => i.quantity === null && stockStatus(i) === "Unknown",
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

test('foods with automatic shopping disabled can still be added to a trip manually', () => {
  const pepper = { ...newItem('Black pepper'), groceryTrackingEnabled: true, shoppingListEnabled: false };
  const shopping = addShopping([], pepper, 1);
  assert.equal(shopping.length, 1);
  assert.equal(shopping[0].name, 'Black pepper');
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
  assert.equal(cooked.items[1].shortage, 0);
  assert.equal(state.items[1].quantity, 4);
  const cookedAgain = cookRecipe(cooked, needs);
  assert.equal(cookedAgain.items[1].quantity, 0);
  assert.equal(cookedAgain.items[1].shortage, 4);
});

test('negative balances migrate once to available zero and preserve shortage', () => {
  const raw = { items: [{ id: 'berries', name: 'Frozen berries', quantity: -310, unit: 'g' }], shopping: [] };
  const migrated = normalizeGroceryState(raw);
  assert.equal(migrated.items[0].quantity, 0);
  assert.equal(migrated.items[0].shortage, 310);
  assert.equal(migrated.migrations.negativeStockV1Count, 1);
  assert.equal(stockStatus(migrated.items[0]), 'Out of stock');
  assert.equal(normalizeGroceryState(migrated).items[0].shortage, 310);
  assert.equal(normalizeGroceryState(migrated).migrations.negativeStockV1Count, 1);
});

test('low stock percentage uses the baseline and configured default threshold', () => {
  const item = { ...newItem('Chicken', 200, 'g'), stockBaseline: { quantity: 1000, unit: 'g' } };
  assert.equal(stockStatus(item), 'Low stock');
  item.quantity = 0;
  assert.equal(stockStatus(item), 'Out of stock');
});
test('grocery integrity check rejects negative availability, invalid shortage and duplicate canonical rows', () => {
  const state = { items: [{ id: 'a', name: 'A', quantity: -1, shortage: -2, foodId: 'food' }, { id: 'b', name: 'B', quantity: 0, shortage: 0, foodId: 'food' }], stockAlerts: [] };
  assert.equal(checkGroceryIntegrity(state).length, 3);
  assert.equal(checkGroceryIntegrity(normalizeGroceryState(state)).length, 1);
});

test('re-adding a canonical food reuses its Grocery row instead of making a duplicate', () => {
  const item = { ...newItem('Store chicken', 0, 'g'), foodId: 'food-chicken', removed: true };
  const added = addItems({ items: [item], shopping: [] }, [{ ...newItem('Chicken breast', 200, 'g'), foodId: 'food-chicken' }]);
  assert.equal(added.items.length, 1);
  assert.equal(added.items[0].removed, false);
  assert.equal(added.items[0].quantity, 200);
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

test('recipe grocery requirements honor Grocery and auto-shopping preferences independently', () => {
  const rice = { ...newItem('Chicken', 200, 'g'), id: 'chicken-stock' };
  const recipe = { slug: 'chicken', ingredients: [{ id: 'chicken-part', foodId: 'chicken-food', name: 'Chicken', amount: 500, unit: 'g', groceryTrackingEnabled: true, shoppingListEnabled: false }] };
  const catalog = [{ id: 'chicken-food', name: 'Chicken', groceryTrackingEnabled: true, shoppingListEnabled: false }];
  const [need] = recipeNeeds(recipe, { items: [rice], ingredientLinks: { 'chicken/chicken-part': 'chicken-stock' } }, 1, catalog);
  assert.equal(need.missing, 300);
  assert.equal(need.autoShoppingEnabled, false);
  const [automatic] = recipeNeeds({ ...recipe, ingredients: [{ ...recipe.ingredients[0], shoppingListEnabled: true }] }, { items: [rice], ingredientLinks: { 'chicken/chicken-part': 'chicken-stock' } }, 1, [{ ...catalog[0], shoppingListEnabled: true }]);
  assert.equal(automatic.missing, 300);
  assert.equal(automatic.autoShoppingEnabled, true);
  assert.deepEqual(recipeNeeds({ ...recipe, ingredients: [{ ...recipe.ingredients[0], groceryTrackingEnabled: false }] }, { items: [rice] }, 1, [{ ...catalog[0], groceryTrackingEnabled: false }]), []);
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

test('stock percentage boundaries, unknown legacy baselines, and saved defaults', () => {
  const baseline = { quantity: 100, unit: 'g' };
  for (const [quantity, expected] of [[46, 'In stock'], [45, 'In stock'], [44.9, 'Low stock'], [0.01, 'Low stock'], [0, 'Out of stock']]) {
    const item = { ...newItem('Rice', quantity, 'g'), stockBaseline: baseline };
    assert.equal(stockStatus(item, 45), expected);
  }
  assert.equal(formatStockPercentage(stockPercentage({ quantity: 44.999, unit: 'g', stockBaseline: baseline }), 45), '44.999');
  assert.equal(stockStatus({ ...newItem('Legacy', 10, 'g') }, 45), 'Unknown');
  assert.deepEqual(normalizeGroceryState({ settings: { showStockPercentage: true, lowStockThresholdPercent: 30 } }).settings, { currency: 'GBP', autoImages: false, expiryReminders: true, imageLimit: 0, lowStockThresholdPercent: 30, showStockPercentage: true });
  assert.equal(normalizeGroceryState({ settings: { currency: 'EUR' } }).settings.lowStockThresholdPercent, 45);
});

test('threshold edits alert on entry, recover without an alert, and can alert on a later drop', () => {
  const item = { ...newItem('Milk', 46, 'ml'), stockBaseline: { quantity: 100, unit: 'ml' } };
  const before = { ...initialState(), items: [item] };
  const low = recordStockTransitions(before, { ...structuredClone(before), settings: { ...before.settings, lowStockThresholdPercent: 50 } }, { at: 1 });
  assert.equal(low.stockAlerts.filter(alert => alert.itemIds.includes(item.id)).length, 1);
  const recovered = recordStockTransitions(low, { ...structuredClone(low), settings: { ...low.settings, lowStockThresholdPercent: 40 } }, { at: 2 });
  assert.equal(recovered.stockAlerts.length, 1);
  const dropped = structuredClone(recovered); dropped.items[0].quantity = 39;
  recordStockTransitions(recovered, dropped, { at: 3 });
  assert.equal(dropped.stockAlerts.length, 2);
});

test('planned meal shortages combine, subtract pantry stock once, and retain unresolved items', () => {
  const rice = { ...newItem('Rice', 300, 'g'), id: 'rice-stock', foodId: 'rice-food' };
  const state = { ...initialState(), items: [rice], shopping: [] };
  const recipes = [
    { slug: 'one', title: 'Rice bowl', ingredients: [{ id: 'rice', foodId: 'rice-food', name: 'Rice', amount: 250, unit: 'g' }, { name: 'Unknown spice', amount: null, unit: 'g' }] },
    { slug: 'two', title: 'Second bowl', ingredients: [{ id: 'rice2', foodId: 'rice-food', name: 'Rice', amount: 250, unit: 'g' }, { name: 'Milk', amount: 500, unit: 'ml' }] },
  ];
  const rows = plannedIngredientShortages([{ id: 'm1', slug: 'one', meal: 'Lunch', portions: 1 }, { id: 'm2', slug: 'two', meal: 'Dinner', portions: 1 }], recipes, state);
  assert.equal(rows.find(row => row.name === 'Rice').required, 500);
  assert.equal(rows.find(row => row.name === 'Rice').available, 300);
  assert.equal(rows.find(row => row.name === 'Rice').shortage, 200);
  assert.equal(rows.find(row => row.name === 'Milk').shortage, 500);
  assert.equal(rows.find(row => row.name === 'Unknown spice').shortage, null);
  assert.equal(plannedIngredientShortages([{ id: 'm2', slug: 'two', meal: 'Dinner', portions: 2 }], recipes, state).find(row => row.name === 'Rice').shortage, 200);
  const incompatible = plannedIngredientShortages([{ id: 'm3', slug: 'bad', meal: 'Dinner', portions: 1 }], [{ slug: 'bad', ingredients: [{ name: 'Rice', amount: 1, unit: 'L' }] }], state);
  assert.equal(incompatible[0].issue, 'Incompatible units');
  const unknownStock = plannedIngredientShortages([{ id: 'm1', slug: 'one', meal: 'Lunch', portions: 1 }], recipes, { ...state, items: [{ ...rice, quantity: null }] }).find(row => row.name === 'Rice');
  assert.equal(unknownStock.shortage, null);
  assert.match(unknownStock.issue, /Available pantry quantity/);
  const incompatibleList = plannedIngredientShortages([{ id: 'm1', slug: 'one', meal: 'Lunch', portions: 1 }], recipes, { ...state, shopping: [{ ...newItem('Rice', 1, 'packs'), id: 'rice-list' }] }).find(row => row.name === 'Rice');
  assert.equal(incompatibleList.issue, 'Incompatible shopping-list unit');
  assert.equal(incompatibleList.listedUnit, 'packs');
});

test('quick restock and its specific undo preserve later item changes and apply once', () => {
  const item = { ...newItem('Milk', 300, 'ml'), id: 'milk-stock', stockBaseline: { quantity: 1000, unit: 'ml' } };
  const state = { ...initialState(), items: [item] };
  const restocked = restockStock(state, item.id, 1, 'L', null, 'restock-1');
  restocked.items[0].quantity -= 100;
  restocked.items.push(newItem('Bread', 1, 'pieces'));
  const undone = undoRestockStock(restocked, 'restock-1');
  assert.equal(undone.items[0].quantity, 200);
  assert.equal(undone.items[1].name, 'Bread');
  assert.throws(() => undoRestockStock(undone, 'restock-1'), /already undone/);
});
test('quick restock converts compatible units and specific undo preserves list edits and later stock changes', () => {
  const item = { ...newItem('Milk', 300, 'ml'), id: 'milk-stock', stockBaseline: { quantity: 1000, unit: 'ml' } };
  const listEntry = { id: 'milk-list', name: 'Milk', quantity: 1, unit: 'L', checked: true };
  const state = { ...initialState(), items: [item], shopping: [listEntry] };
  const restocked = restockStock(state, item.id, 1, 'L', null, 'restock-1', listEntry.id);
  assert.equal(restocked.items[0].quantity, 1300);
  assert.equal(restocked.shopping.length, 0);
  restocked.items[0].quantity += 100;
  restocked.items.push(newItem('Bread', 1, 'pieces'));
  const undone = undoRestockStock(restocked, 'restock-1');
  assert.equal(undone.items[0].quantity, 400);
  assert.equal(undone.items[1].name, 'Bread');
  assert.deepEqual(undone.shopping, [listEntry]);
  assert.throws(() => undoRestockStock(undone, 'restock-1'), /already undone/);
});
test('shopping restock converts the selected compatible purchase unit and reuses canonical links', () => {
  const milk = { ...newItem('Store milk', 300, 'ml'), id: 'milk-pantry', foodId: 'milk-food', stockBaseline: { quantity: 1000, unit: 'ml' } };
  const listEntry = { id: 'milk-list', name: 'Milk', foodId: 'milk-food', quantity: 1, unit: 'L', checked: false };
  const state = { ...initialState(), items: [milk], shopping: [listEntry] };
  const result = purchase(state, [{ id: listEntry.id, quantity: 1, purchaseUnit: 'L' }]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].quantity, 1300);
  assert.equal(result.shopping.length, 0);
});
test('marking a shopping item complete does not change pantry stock', () => {
  const item = { ...newItem('Milk', 300, 'ml'), id: 'milk-stock' };
  const entry = { id: 'milk-list', name: 'Milk', quantity: 1, unit: 'L' };
  const state = { ...initialState(), items: [item], shopping: [entry] };
  const completed = setShoppingCompleted(state, entry.id, true);
  assert.equal(completed.items[0].quantity, 300);
  assert.equal(completed.shopping[0].checked, true);
  assert.equal(state.shopping[0].checked, undefined);
});