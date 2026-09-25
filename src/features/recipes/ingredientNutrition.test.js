import test from 'node:test';
import assert from 'node:assert/strict';
import { ingredientLabelNutrition, cleanIngredientLabel, ingredientRecipeCalculation, ingredientRecipeTotals, prepareIngredientEditor, updateIngredientField } from './ingredientNutrition.js';
import { validateRecipe } from './recipeData.js';
const label = cleanIngredientLabel({ quantity: 100, unit: 'g', calories: 90, protein: 1, carbs: 20, fat: 0, fiber: 3, source: { name: 'Banana', provider: 'Open Food Facts' } });
test('ingredient editor scales fractions by confirmed piece weight and keeps unknown weight unknown', () => {
  const item = { name: 'Banana', amount: '1/2', unit: 'piece', nutritionLabel: label };
  assert.equal(ingredientLabelNutrition(item).calories, null);
  item.nutritionLabel = { ...label, amountPerUnit: 120, recipeUnit: 'piece' };
  assert.equal(ingredientLabelNutrition(item).calories, 54);
  assert.equal(ingredientLabelNutrition({ ...item, amount: 1 }).calories, 108);
  assert.equal(ingredientLabelNutrition({ ...item, unit: 'cup' }).calories, null);
});
test('renaming an ingredient preserves its selected label and calculated nutrition', () => {
  const item = { name: 'Banana', amount: 100, unit: 'g', nutritionLabel: label, nutrition: ingredientLabelNutrition({ amount: 100, unit: 'g', nutritionLabel: label }) };
  const renamed = updateIngredientField(item, 'name', 'Medium banana');
  assert.equal(renamed.name, 'Medium banana');
  assert.equal(renamed.nutritionLabel, label);
  assert.deepEqual(renamed.nutrition, item.nutrition);
});
test('label metadata and calculated ingredient and overall macros persist through validation', () => {
  const recipe = validateRecipe({ title: 'Banana', slug: 'banana', mealType: 'Snack', servings: 2, steps: ['Serve'], ingredients: [{ name: 'Banana', amount: 200, unit: 'g', nutritionLabel: label }], nutritionFromIngredients: true });
  assert.equal(recipe.ingredients[0].nutrition.calories, 180);
  assert.equal(recipe.nutrition.calories, 90);
  assert.deepEqual(validateRecipe(recipe), recipe);
  assert.equal(validateRecipe({ ...recipe, ingredients: [{ ...recipe.ingredients[0], amount: 100 }] }).nutrition.calories, 45);
  assert.equal(ingredientRecipeTotals({ ...recipe, servings: null }).calories, null);
});
test('known ingredient nutrition populates recipe subtotals while missing items remain explicit', () => {
  const calculation = ingredientRecipeCalculation({ servings: 2, ingredients: [
    { nutrition: { calories: 180, protein: 2, fiber: 6 } },
    { nutrition: { calories: null, protein: null, fiber: null } },
  ] });
  assert.equal(calculation.perServing.calories, 90);
  assert.equal(calculation.perServing.fiber, 3);
  assert.equal(calculation.missing.calories, 1);
  assert.equal(calculation.known.calories, 1);
  const saved = validateRecipe({ title: 'Fruit bowl', slug: 'fruit-bowl', mealType: 'Snack', servings: 2, steps: ['Serve'], nutritionFromIngredients: true, ingredients: [
    { name: 'Banana', amount: 200, unit: 'g', nutrition: { calories: 180, protein: 2, fiber: 6 } },
    { name: 'Topping', amount: 10, unit: 'g' },
  ] });
  assert.equal(saved.nutrition.calories, 90);
  assert.equal(saved.nutrition.fiber, 3);
  assert.equal(ingredientRecipeCalculation(saved).missing.calories, 1);
});
test('existing saved product choices move into editor labels without losing actual quantities', () => {
  const prepared = prepareIngredientEditor({ ingredients: [{ name: 'Banana', amount: 150, unit: 'g' }], sauces: [], productNutrition: { items: [{ quantity: 200, unit: 'g', nutrition: label }] } });
  assert.equal(prepared.productNutrition, undefined);
  assert.equal(prepared.ingredients[0].amount, 200);
  assert.equal(ingredientLabelNutrition(prepared.ingredients[0]).calories, 180);
});
