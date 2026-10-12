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
  const cleaned = validateGeminiRecipe(valid);
  assert.equal(cleaned.title, 'Chicken fried rice');
  assert.deepEqual(cleaned.ingredients.map(({ name, amount, unit }) => [name, amount, unit]), [['Chicken', 120, 'g'], ['Cooked rice', 160, 'g'], ['Eggs', 2, 'pieces']]);
  assert.equal(cleaned.servings, null);
  assert.equal(cleaned.nutrition.calories, null);
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
  assert.equal(stored.ingredients[0].name, "Chicken");
  assert.equal(stored.ingredients[0].amount, 120);
  assert.equal(stored.ingredients[0].unit, 'g');
  assert.equal(stored.cookTime, "25 minutes");
});

test('AI ingredient repairs preserve explicit amount precedence and separated context', () => {
  const cleaned = validateGeminiRecipe({ ...valid, ingredients: [
    { name: '2 tbsp yogurt', amount: 3, unit: 'tablespoons', note: '', group: 'Sauce', preparation: '' },
    { name: '1 tsp salt (for chicken)', amount: null, unit: '', note: '', group: '', preparation: '' },
  ] });
  assert.deepEqual(cleaned.ingredients.map(({ name, amount, unit, group }) => [name, amount, unit, group]), [
    ['Yogurt', 3, 'tbsp', 'Sauce'], ['Salt', 1, 'tsp', 'Chicken'],
  ]);
});

test('Turkish Chicken regression keeps twenty usages separate and retains recipe nutrition basis', () => {
  const extracted = validateGeminiRecipe({
    is_recipe: true, title: 'Turkish Chicken', cooking_time_minutes: 25, servings: 3,
    nutrition: { calories: 433, protein: 37, carbs: 10, fat: 27, fiber: null }, nutrition_basis: 'per-serving',
    ingredients: [
      ['500g boneless skinless chicken thighs', 'Chicken marinade'], ['2 tbsp yogurt', 'Chicken marinade'], ['1 tsp salt (for chicken)', 'Chicken marinade'],
      ['1 tsp Kashmiri red chilli', 'Chicken marinade'], ['1 tsp black pepper', 'Chicken marinade'], ['1/3 tsp cumin', 'Chicken marinade'],
      ['1/2 tbsp paprika', 'Chicken marinade'], ['3 tbsp tomato paste', 'Chicken marinade'], ['1/2 tbsp ginger garlic paste', 'Chicken marinade'],
      ['1 tbsp butter', 'Cooking'], ['1 tbsp butter', 'Creamy sauce'], ['1 tbsp maida', 'Creamy sauce'], ['150ml skimmed milk', 'Creamy sauce'],
      ['1/3 tsp garlic powder', 'Creamy sauce'], ['1/4 tsp salt', 'Creamy sauce'], ['1/3 tsp chilli flakes', 'Creamy sauce'],
      ['1/3 tsp pepper', 'Creamy sauce'], ['1/3 tsp oregano', 'Creamy sauce'], ['30g cheese', 'Finishing'], ['coriander for garnish', 'Finishing'],
    ].map(([name, group]) => ({ name, amount: null, unit: '', note: '', group, preparation: '' })),
    steps: ['Mix the marinade.', 'Cook the chicken.', 'Make the sauce and combine.'],
  });
  const stored = toStoredRecipe(extracted, 'turkish-chicken');
  assert.equal(stored.ingredients.length, 20);
  assert.deepEqual(stored.ingredients.filter(item => item.name === 'Butter').map(item => [item.amount, item.unit, item.group]), [[1, 'tbsp', 'Cooking'], [1, 'tbsp', 'Creamy sauce']]);
  assert.deepEqual(stored.ingredients.filter(item => item.name === 'Salt').map(item => [item.amount, item.unit, item.group]), [[1, 'tsp', 'Chicken marinade'], [0.25, 'tsp', 'Creamy sauce']]);
  assert.deepEqual([stored.servings, stored.nutrition.calories, stored.nutrition.protein], [3, 433, 37]);
  assert.equal(stored.ingredients.at(-1).amount, null);
  assert.equal(stored.ingredients.at(-1).name, 'Coriander');
  assert.equal(stored.ingredients.at(-1).note, 'garnish');
});
