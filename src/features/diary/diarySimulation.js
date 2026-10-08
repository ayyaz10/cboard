import { diaryTotals, nutrientContributions } from './diaryData.js';
import { nutrientKeys } from '../nutrition/nutrients.js';

export const simulationKey = (mealId, itemId) => `${mealId}::${itemId}`;

/** Build an isolated preview from diary snapshots; callers persist only after confirmation. */
export function simulateDiaryChanges(meals = [], overrides = {}) {
  const originalMeals = structuredClone(meals);
  const changedEntries = [];
  const simulatedMeals = originalMeals.map(meal => ({
    ...meal,
    items: meal.items.flatMap(item => {
      const key = simulationKey(meal.id, item.id);
      const override = overrides[key];
      if (!override || !Number.isFinite(override.quantity) || override.quantity === item.quantity) return [item];
      changedEntries.push({ key, mealId: meal.id, meal: meal.title || meal.meal, itemId: item.id, name: item.name, before: item.quantity, after: override.quantity, unit: item.unit });
      if (override.quantity <= 0) return [];
      return [{ ...item, quantity: override.quantity }];
    }),
  })).filter(meal => meal.items.length > 0);
  const currentTotals = diaryTotals(originalMeals);
  const simulatedTotals = diaryTotals(simulatedMeals);
  const deltas = Object.fromEntries(nutrientKeys.map(key => [key, simulatedTotals[key].value - currentTotals[key].value]));
  return {
    meals: simulatedMeals,
    currentTotals,
    simulatedTotals,
    deltas,
    contributions: nutrientContributions(simulatedMeals, nutrientKeys),
    changes: changedEntries,
  };
}

