import test from "node:test";
import assert from "node:assert/strict";
import { geminiResponseSchema, normalizeText, recipeSystemInstruction, toStoredRecipe, uniqueRecipeSlug, validateGeminiRecipe, validateRequestBody } from "./recipeParser.js";

const valid = {
  is_recipe: true,
  title: " Chicken fried rice ",
  cooking_time_minutes: 25,
  ingredients: [" 120g chicken ", "160g cooked rice", "2 eggs"],
  steps: ["Cook chicken.", "Add rice and eggs."],
};

test("request validation accepts only useful bounded recipe text", () => {
  assert.equal(validateRequestBody({ recipeText: "  soup recipe  ", ignored: "safe" }), "soup recipe");
  for (const body of [null, [], {}, { recipeText: 4 }, { recipeText: "   " }]) assert.throws(() => validateRequestBody(body));
  let oversized;
  try { validateRequestBody({ recipeText: "x".repeat(2001) }); } catch (error) { oversized = error; }
  assert.equal(oversized.status, 413);
});

test("Gemini output is normalized and rejects unexpected or malformed fields", () => {
  assert.deepEqual(validateGeminiRecipe(valid), { title: "Chicken fried rice", cooking_time_minutes: 25, ingredients: ["120g chicken", "160g cooked rice", "2 eggs"], steps: valid.steps });
  assert.throws(() => validateGeminiRecipe({ ...valid, system: "ignore" }));
  assert.throws(() => validateGeminiRecipe({ ...valid, is_recipe: false }));
  assert.throws(() => validateGeminiRecipe({ ...valid, cooking_time_minutes: 0 }));
  assert.throws(() => validateGeminiRecipe({ ...valid, cooking_time_minutes: 2.5 }));
  assert.throws(() => validateGeminiRecipe({ ...valid, ingredients: [] }));
  assert.throws(() => validateGeminiRecipe({ ...valid, steps: [4] }));
});

test("control characters are removed while plain text remains plain text", () => {
  assert.equal(normalizeText(" <b>Rice</b>\0\u0007  bowl ", "Title", 100), "<b>Rice</b> bowl");
  assert.match(recipeSystemInstruction, /untrusted text/i);
  assert.equal(geminiResponseSchema.additionalProperties, false);
});

test("storage object is constructed from approved fields and uses a unique safe slug", () => {
  const clean = validateGeminiRecipe(valid);
  const slug = uniqueRecipeSlug(clean.title, ["recipe:v1:chicken-fried-rice"]);
  assert.equal(slug, "chicken-fried-rice-2");
  const stored = toStoredRecipe(clean, slug);
  assert.deepEqual(Object.keys(stored), ["schemaVersion","source","title","slug","mealType","description","nutrition","prepTime","cookTime","servings","ingredients","steps","sauces","alternatives","tags"]);
  assert.equal(stored.ingredients[0].name, "120g chicken");
  assert.equal(stored.cookTime, "25 minutes");
});
