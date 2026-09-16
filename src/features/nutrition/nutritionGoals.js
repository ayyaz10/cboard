import {
  MACRO_KEYS,
  MACRO_PRESETS,
  calculateMacroTargets,
} from './macroTargets.js';

export const GOAL_KEY = 'nutrition:daily-goals:v1';
export const GOAL_FIELDS = [
  ['calories', 'Calorie target', 'kcal'],
  ['maintenanceCalories', 'Maintenance calories', 'kcal'],
  ['protein', 'Protein', 'g'],
  ['carbs', 'Carbs', 'g'],
  ['fat', 'Fat', 'g'],
  ['fiber', 'Fibre', 'g'],
];
export const DEFAULT_MACRO_PERCENTAGES = { ...MACRO_PRESETS.balanced.percentages };
export const emptyGoals = () => ({
  ...Object.fromEntries(GOAL_FIELDS.map(([key]) => [key, null])),
  macroPreset: 'balanced',
  customMacroPercentages: { ...DEFAULT_MACRO_PERCENTAGES },
  macroLocked: Object.fromEntries(MACRO_KEYS.map((key) => [key, false])),
});

function validatePercentage(value, key) {
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 100)
    throw new Error(`${key === 'carbs' ? 'Carbohydrate' : key[0].toUpperCase() + key.slice(1)} percentage: enter a number between 0 and 100.`);
  return number;
}

export function validateGoals(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Could not read your daily targets.');
  const targets = Object.fromEntries(GOAL_FIELDS.map(([key, label]) => {
    const raw = value[key];
    if (raw == null || (typeof raw === 'string' && !raw.trim())) return [key, null];
    const number = typeof raw === 'string' ? Number(raw) : raw;
    const belowMinimum = key === 'calories' ? number <= 0 : number < 0;
    if (typeof number !== 'number' || !Number.isFinite(number) || belowMinimum || number > 100000)
      throw new Error(`${label}: enter ${key === 'calories' ? 'a number greater than 0' : 'a number between 0 and 100,000'}, or leave it blank.`);
    return [key, number];
  }));

  const macroPreset = value.macroPreset ?? 'balanced';
  if (![...Object.keys(MACRO_PRESETS), 'custom'].includes(macroPreset))
    throw new Error('Choose a valid preferred macro distribution.');

  const customSource = value.customMacroPercentages ?? DEFAULT_MACRO_PERCENTAGES;
  if (!customSource || typeof customSource !== 'object' || Array.isArray(customSource))
    throw new Error('Could not read your custom macro percentages.');
  const customMacroPercentages = Object.fromEntries(
    MACRO_KEYS.map((key) => [key, validatePercentage(customSource[key], key)]),
  );
  const customTotal = MACRO_KEYS.reduce((total, key) => total + customMacroPercentages[key], 0);
  if (Math.abs(customTotal - 100) > 1e-8)
    throw new Error(`Custom macro percentages must total 100% (currently ${customTotal}%).`);

  let macroLocked;
  if (value.macroLocked == null) {
    // Existing saved targets predate automatic macros, so preserve them as manual values.
    macroLocked = Object.fromEntries(MACRO_KEYS.map((key) => [key, targets[key] != null]));
  } else {
    if (typeof value.macroLocked !== 'object' || Array.isArray(value.macroLocked))
      throw new Error('Could not read your macro lock settings.');
    macroLocked = Object.fromEntries(MACRO_KEYS.map((key) => {
      if (typeof value.macroLocked[key] !== 'boolean')
        throw new Error(`Could not read the ${key} lock setting.`);
      return [key, value.macroLocked[key]];
    }));
  }

  return {
    ...targets,
    macroPreset,
    customMacroPercentages,
    macroLocked,
  };
}

export function preferredMacroPercentages(goals) {
  return goals.macroPreset === 'custom'
    ? goals.customMacroPercentages
    : MACRO_PRESETS[goals.macroPreset]?.percentages ?? DEFAULT_MACRO_PERCENTAGES;
}

export function calculateGoalsMacros(goals) {
  return calculateMacroTargets({
    calories: goals.calories,
    preferredPercentages: preferredMacroPercentages(goals),
    locked: goals.macroLocked,
    grams: goals,
  });
}

export function prepareGoalsForSave(value) {
  const goals = validateGoals(value);
  const calculation = calculateGoalsMacros(goals);
  if (!calculation.valid) throw new Error(calculation.error);
  return {
    ...goals,
    ...Object.fromEntries(MACRO_KEYS.map((key) => [key, calculation[key].grams])),
  };
}

export function hydrateCalculatedGoals(value) {
  const goals = validateGoals(value);
  if (goals.calories == null) return goals;
  const calculation = calculateGoalsMacros(goals);
  if (!calculation.protein) return goals;
  return {
    ...goals,
    ...Object.fromEntries(MACRO_KEYS
      .filter((key) => !goals.macroLocked[key])
      .map((key) => [key, calculation[key].grams])),
  };
}

export function compareGoal(total, target, key) {
  if (target == null) return { status: 'unset' };
  if (!total.known && !total.missing) return { status: 'empty' };
  const difference = total.value - target;
  const incomplete = total.missing > 0;
  // Avoid treating normal floating-point addition noise as exceeding the target.
  if (key === 'fiber' && total.known > 0 && difference >= -1e-8)
    return { status: 'reached', amount: Math.max(0, difference), incomplete };
  if (difference > 1e-8)
    return { status: 'over', amount: difference, incomplete };
  if (incomplete) return { status: 'incomplete' };
  if (Math.abs(difference) < 1e-8) return { status: 'met', amount: 0 };
  return { status: 'remaining', amount: -difference };
}

export const formatMacro = (value) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);

export function maintenanceDifference(goals) {
  if (goals.calories == null || goals.maintenanceCalories == null) return null;
  return goals.maintenanceCalories - goals.calories;
}
export function comparisonText(comparison, unit) {
  const amount = comparison.amount > 0 && comparison.amount < 0.1 ? '<0.1' : formatMacro(comparison.amount ?? 0);
  switch (comparison.status) {
    case 'unset': return 'No target set';
    case 'empty': return 'Choose meals to compare';
    case 'over': return `${comparison.incomplete ? 'At least ' : ''}${amount} ${unit} over target`;
    case 'incomplete': return 'Comparison incomplete — nutrition is missing';
    case 'reached': return comparison.amount > 1e-8 ? `Target reached (${comparison.incomplete ? 'at least ' : ''}${amount} ${unit} above)` : 'Target reached';
    case 'met': return 'Target met';
    default: return `${amount} ${unit} remaining`;
  }
}
