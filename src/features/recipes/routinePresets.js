import { readMealRoutine } from './mealPlanData.js';

export function readRoutinePresets(value) {
  if (!Array.isArray(value) || value.length > 30)
    throw new Error('A routine library can contain up to 30 presets.');
  const ids = new Set();
  return value.map((item) => {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id))
      throw new Error('Could not read the saved routine presets.');
    ids.add(item.id);
    return { id: item.id, ...readMealRoutine(item) };
  });
}

export function saveRoutinePreset(presets, draft, id) {
  const routine = readMealRoutine(draft);
  if (!routine.entries.some((entry) => entry.slug))
    throw new Error('Choose at least one recipe before saving a preset.');
  const existing = presets.find((item) => item.id === id);
  if (!existing && presets.length >= 30)
    throw new Error('You have 30 presets. Delete one before adding another.');
  return readRoutinePresets(
    existing
      ? presets.map((item) => (item.id === id ? { ...routine, id } : item))
      : [...presets, { ...routine, id }],
  );
}
