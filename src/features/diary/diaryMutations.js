import { copyMealEntry, MEALS } from './diaryData.js';

export function moveDiaryMeal(day, mealId, destination) {
  if (!MEALS.includes(destination)) throw new Error('Choose a valid meal.');
  const meal = day.meals.find(entry => entry.id === mealId);
  if (!meal) throw new Error('This meal is no longer in the selected day.');
  if (meal.meal === destination) return day;
  return {
    ...day,
    meals: day.meals.map(entry => entry.id === mealId ? { ...entry, meal: destination } : entry),
    skipped: (day.skipped || []).filter(slot => slot !== destination),
    complete: false,
  };
}

export function removeDiaryFood(day, mealId, foodId) {
  let found = false;
  const meals = day.meals.flatMap(meal => {
    if (meal.id !== mealId) return [meal];
    const items = meal.items.filter(item => {
      if (item.id !== foodId) return true;
      found = true;
      return false;
    });
    return items.length ? [{ ...meal, items }] : [];
  });
  if (!found) throw new Error('This food is no longer in the selected day.');
  return { ...day, meals, complete: false };
}

export function removeDiaryMeal(day, mealId) {
  if (!day.meals.some(meal => meal.id === mealId)) throw new Error('This meal is no longer in the selected day.');
  return { ...day, meals: day.meals.filter(meal => meal.id !== mealId), complete: false };
}

export function appendCopiedMeals(day, meals) {
  if (!Array.isArray(meals) || !meals.length) throw new Error('Choose at least one meal to copy.');
  const copies = meals.map(copyMealEntry);
  return {
    ...day,
    meals: [...day.meals, ...copies],
    skipped: (day.skipped || []).filter(slot => !copies.some(meal => meal.meal === slot)),
    complete: false,
  };
}
