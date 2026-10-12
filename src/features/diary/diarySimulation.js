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
      if (!override) return [item];
      const next = {
        ...item,
        ...(Number.isFinite(override.quantity) ? { quantity: override.quantity } : {}),
        ...(override.name ? { name: override.name } : {}),
        ...(override.foodId ? { foodId: override.foodId } : {}),
        ...(override.basis != null ? { basis: override.basis } : {}),
        ...(override.nutritionUnit ? { nutritionUnit: override.nutritionUnit } : {}),
        ...(override.nutrition ? { nutrition: { ...override.nutrition } } : {}),
        ...(override.nutrientSources ? { nutrientSources: { ...override.nutrientSources } } : {}),
        ...(override.source ? { source: { ...override.source } } : {}),
      };
      if (override.productChanged) { delete next.inventoryUsage; delete next.inventoryUnresolved; }
      const isChanged = Object.keys(next).some(field => JSON.stringify(next[field]) !== JSON.stringify(item[field]));
      if (!isChanged) return [item];
      changedEntries.push({ key, mealId: meal.id, meal: meal.title || meal.meal, itemId: item.id,
        name: item.name, afterName: next.name, before: item.quantity, after: next.quantity, unit: item.unit,
        productChanged: next.name !== item.name || JSON.stringify(next.nutrition) !== JSON.stringify(item.nutrition) });
      if (next.quantity <= 0) return [];
      return [next];
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

