import { getPreference } from './preferenceService.js';
import { readMealRoutine } from '../features/recipes/mealPlanData.js';
import { readRoutinePresets } from '../features/recipes/routinePresets.js';

export async function getMealPlanFoodReferences() {
  const [daily, storedPresets] = await Promise.all([
    getPreference('recipes:daily-plan:v1'),
    getPreference('recipes:routine-presets:v1', []),
  ]);
  const references = [];
  if (daily) {
    const plan = readMealRoutine(daily);
    references.push({ id: 'current-plan', name: plan.name, source: 'Current meal plan', entries: plan.entries });
  }
  readRoutinePresets(storedPresets).forEach(plan => references.push({ id: plan.id, name: plan.name, source: 'Saved routine', entries: plan.entries }));
  return references;
}
