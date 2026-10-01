import { convert } from '../groceries/groceryData.js';
import { nutrientKeys } from '../nutrition/nutrients.js';
import { validateItem, itemNutrition } from './diaryData.js';
import { prepareIngredientEditor, ingredientLabelNutrition } from '../recipes/ingredientNutrition.js';
import { validateRecipe, slugify, uniqueSlug } from '../recipes/recipeData.js';

export function buildDiaryRecipe(meal, recipes, { title, servings, steps }) {
  if (!meal.items.length) throw new Error('Add at least one food first.');
  const ingredients = meal.items.map(raw => {
    const item = validateItem(raw);
    return { name: item.name, amount: item.quantity, unit: item.unit, nutrition: itemNutrition(item),
      ...(['g', 'ml', 'pieces'].includes(item.nutritionUnit) ? { nutritionLabel: {
        ...item.nutrition, quantity: item.basis, unit: item.nutritionUnit,
        source: { ...item.source, recipeOnly: true },
        ...(item.unit === 'pieces' && item.perPiece > 0 ? { amountPerUnit: item.perPiece, recipeUnit: 'pieces' } : {}),
      } } : {}),
    };
  });
  return validateRecipe({ title: title.trim(), slug: uniqueSlug(slugify(title.trim()), recipes.map(recipe => recipe.slug)),
    mealType: meal.meal || 'Meal', servings: Number(servings), ingredients,
    steps: steps.split('\n').map(step => step.trim()).filter(Boolean), nutritionFromIngredients: true,
    description: 'Saved from Food Diary.', tags: ['food-diary'] });
}

const nameKey = name => String(name || '').trim().toLowerCase();
export function suggestedDiaryRecipe(meal, recipes) {
  const matches = recipes.filter(recipe => meal.items.some(item =>
    item.recipeOrigin?.slug === recipe.slug ||
    (item.source?.provider === 'Recipe' && nameKey(item.name) === nameKey(recipe.title)) ||
    (item.source?.provider === 'Recipe ingredient' && nameKey(item.source.name) === nameKey(recipe.title))));
  return matches.length === 1 ? matches[0].slug : '';
}

export function recipeUpdateRows(meal, recipe, initial) {
  const original = [...(recipe?.ingredients || []), ...(recipe?.sauces || [])];
  return meal.items.filter(item => {
    if (item.source?.provider === 'Recipe') return false;
    const before = initial?.items.find(old => old.id === item.id) || item.recipeOrigin?.baseline;
    if (!before) return true;
    return ['name', 'quantity', 'unit', 'basis', 'nutritionUnit', 'perPiece'].some(key => (item[key] ?? null) !== (before[key] ?? null)) ||
      nutrientKeys.some(key => (item.nutrition?.[key] ?? null) !== (before.nutrition?.[key] ?? null));
  }).map(item => {
    const matches = original.filter(ingredient => item.recipeOrigin?.slug === recipe?.slug && item.recipeOrigin?.ingredientId ? ingredient.id === item.recipeOrigin.ingredientId : nameKey(ingredient.name) === nameKey(item.name));
    const baseline = item.recipeOrigin?.baseline || initial?.items.find(old => old.id === item.id);
    const consumed = baseline ? convert(item.quantity, item.unit, baseline.unit) ?? (item.unit === 'pieces' && item.perPiece > 0 ? convert(item.quantity * item.perPiece, item.nutritionUnit, baseline.unit) : null) : null;
    const wholeAmount = item.recipeOrigin?.ingredientAmount || matches[0]?.amount;
    return { id: item.id, selected: false, amount: matches.length === 1 && baseline?.quantity > 0 && consumed != null ? Number(wholeAmount) * consumed / baseline.quantity : matches.length === 1 ? matches[0].amount : item.quantity,
      unit: matches.length === 1 ? matches[0].unit : item.unit, exists: matches.length > 0 };
  });
}

export function buildDiaryRecipeUpdate(recipe, meal, selections, share = false) {
  const next = structuredClone(prepareIngredientEditor(recipe));
  const chosen = selections.filter(row => row.selected);
  if (!chosen.length) throw new Error('Select at least one food to add or update.');
  const seen = new Set();
  for (const row of chosen) {
    const item = validateItem(meal.items.find(item => item.id === row.id));
    const key = nameKey(item.name);
    if (seen.has(key)) throw new Error(`Select only one entry for ${item.name}.`);
    seen.add(key);
    const amount = Number(row.amount);
    if (!(amount > 0) || !row.unit.trim()) throw new Error(`Enter the whole-recipe amount and unit for ${item.name}.`);
    const matching = ['ingredients', 'sauces'].flatMap(group => (next[group] || []).map((ingredient, index) => ({ group, index, ingredient })).filter(({ ingredient }) => (item.recipeOrigin?.slug === recipe.slug && item.recipeOrigin?.ingredientId ? ingredient.id === item.recipeOrigin.ingredientId : nameKey(ingredient.name) === key)));
    if (matching.length > 1) throw new Error(`${item.name} appears more than once in this recipe. Edit the recipe directly to choose the right ingredient.`);
    const ingredient = { ...(matching[0]?.ingredient || {}), name: item.name, amount, unit: row.unit.trim(), note: matching[0]?.ingredient.note || '' };
    if (['g', 'ml', 'pieces'].includes(item.nutritionUnit)) {
      ingredient.nutritionLabel = { ...item.nutrition, quantity: item.basis, unit: item.nutritionUnit, source: { ...item.source, recipeOnly: !share },
        ...(item.unit === 'pieces' && item.perPiece > 0 ? { amountPerUnit: item.perPiece, recipeUnit: 'pieces' } : {}) };
      ingredient.nutrition = ingredientLabelNutrition(ingredient);
      if (Object.values(item.nutrition).some(value => value != null) && Object.values(ingredient.nutrition).every(value => value == null))
        throw new Error(`Use a compatible amount/unit for ${item.name}; its label is per ${item.nutritionUnit}.`);
    } else {
      if (row.unit !== item.unit) throw new Error(`Use ${item.unit} for ${item.name}.`);
      delete ingredient.nutritionLabel;
      ingredient.nutrition = itemNutrition({ ...item, quantity: amount });
    }
    if (matching.length) next[matching[0].group][matching[0].index] = ingredient;
    else next.ingredients.push(ingredient);
  }
  next.nutritionFromIngredients = true;
  return { ...validateRecipe(next), image: recipe.image, updatedAt: recipe.updatedAt };
}
