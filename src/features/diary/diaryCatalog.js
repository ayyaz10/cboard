import { normalizeFoodName, resolveRecipeFoodCandidate } from '../nutrition/foodCatalog.js';

export function prepareDiaryCatalogItems(meals, foodCatalog) {
  const newFoods = [];
  const reviewFoods = [];
  const preparedMeals = meals.map(meal => ({
    ...meal,
    items: meal.items.map(item => {
      if (item.foodId) return item;
      const matches = foodCatalog.filter(food => [food.name, ...(food.aliases || [])]
        .some(name => normalizeFoodName(name) === normalizeFoodName(item.name)));
      if (matches.length === 1) return {
        ...item,
        foodId: matches[0].id,
        groceryTrackingEnabled: matches[0].groceryTrackingEnabled !== false,
        nutritionExcluded: matches[0].nutritionTrackingEnabled === false,
      };
      const resolution = resolveRecipeFoodCandidate(item, foodCatalog);
      if (resolution.status === 'matched') return {
        ...item,
        foodId: resolution.food.id,
        groceryTrackingEnabled: resolution.food.groceryTrackingEnabled !== false,
        nutritionExcluded: resolution.food.nutritionTrackingEnabled === false,
      };
      if (resolution.status === 'review') {
        reviewFoods.push(item.name);
        return item;
      }
      newFoods.push(item);
      return item;
    }),
  }));
  return { meals: preparedMeals, newFoods, reviewFoods: [...new Set(reviewFoods)] };
}
