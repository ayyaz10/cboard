export function recipeDeletionEligibility(recipe, { diaryDays = [], mealPlans = [], groceryItems = [] } = {}) {
  const diaryReference = diaryDays.some(day => (day.meals || []).some(meal => (meal.items || []).some(item =>
    item.recipeOrigin?.slug === recipe.slug ||
    item.source?.provider === 'Recipe' && item.source.name === recipe.title ||
    item.source?.provider === 'Recipe ingredient' && item.source.name === recipe.title)));
  const plannerReference = mealPlans.some(plan => (plan.entries || []).some(entry => entry.slug === recipe.slug));
  const groceryReference = groceryItems.some(item =>
    (item.recipeRefs || []).some(reference => reference.slug === recipe.slug) ||
    typeof item.key === 'string' && item.key.startsWith(`${recipe.slug}/`));
  const reasons = [
    diaryReference && 'Diary history uses this recipe',
    plannerReference && 'A saved meal plan uses this recipe',
    groceryReference && 'Grocery stock is linked to this recipe',
  ].filter(Boolean);
  return { eligible: reasons.length === 0, reasons };
}
