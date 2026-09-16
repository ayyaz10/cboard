export const MACRO_KEYS = ['protein', 'carbs', 'fat'];

export const MACRO_CALORIES_PER_GRAM = {
  protein: 4,
  carbs: 4,
  fat: 9,
};

export const MACRO_PRESETS = {
  balanced: {
    label: 'Balanced',
    percentages: { protein: 20, carbs: 50, fat: 30 },
  },
  higherProtein: {
    label: 'Higher Protein',
    percentages: { protein: 25, carbs: 45, fat: 30 },
  },
};

const EPSILON = 1e-8;

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function macroResult(key, grams, locked, calorieTarget) {
  const calories = grams * MACRO_CALORIES_PER_GRAM[key];
  return {
    grams,
    calories,
    percentage: calorieTarget > 0 ? calories / calorieTarget * 100 : 0,
    locked,
  };
}

export function calculateMacroTargets({
  calories,
  preferredPercentages,
  locked,
  grams,
}) {
  if (typeof calories !== 'number' || !Number.isFinite(calories) || calories <= 0) {
    return {
      valid: false,
      error: 'Daily calorie target must be greater than 0.',
      totalCalories: 0,
      remainingCalories: 0,
    };
  }

  const percentages = Object.fromEntries(MACRO_KEYS.map((key) => [key, preferredPercentages?.[key]]));
  if (MACRO_KEYS.some((key) => !finiteNonNegative(percentages[key]))) {
    return {
      valid: false,
      error: 'Macro percentages must be zero or greater.',
      totalCalories: 0,
      remainingCalories: calories,
    };
  }

  const percentageTotal = MACRO_KEYS.reduce((total, key) => total + percentages[key], 0);
  if (Math.abs(percentageTotal - 100) > EPSILON) {
    return {
      valid: false,
      error: `Preferred macro percentages must total 100% (currently ${percentageTotal}%).`,
      totalCalories: 0,
      remainingCalories: calories,
    };
  }

  const lockedState = Object.fromEntries(MACRO_KEYS.map((key) => [key, Boolean(locked?.[key])]));
  const lockedKeys = MACRO_KEYS.filter((key) => lockedState[key]);
  const unlockedKeys = MACRO_KEYS.filter((key) => !lockedState[key]);

  for (const key of lockedKeys) {
    if (!finiteNonNegative(grams?.[key])) {
      return {
        valid: false,
        error: `Enter a valid ${key === 'carbs' ? 'carbohydrate' : key} target before locking it.`,
        totalCalories: 0,
        remainingCalories: calories,
      };
    }
  }

  const resolvedGrams = Object.fromEntries(lockedKeys.map((key) => [key, grams[key]]));
  const lockedCalories = lockedKeys.reduce(
    (total, key) => total + resolvedGrams[key] * MACRO_CALORIES_PER_GRAM[key],
    0,
  );
  const remainingCalories = calories - lockedCalories;

  if (unlockedKeys.length > 0 && remainingCalories < -EPSILON) {
    for (const key of unlockedKeys) resolvedGrams[key] = 0;
    const macros = Object.fromEntries(
      MACRO_KEYS.map((key) => [key, macroResult(key, resolvedGrams[key], lockedState[key], calories)]),
    );
    return {
      ...macros,
      valid: false,
      error: `Your locked macro targets already exceed your daily calorie target by ${Math.round(Math.abs(remainingCalories))} kcal.`,
      totalCalories: lockedCalories,
      remainingCalories,
      targetDifference: lockedCalories - calories,
    };
  }

  if (unlockedKeys.length === 1) {
    const key = unlockedKeys[0];
    resolvedGrams[key] = Math.max(0, remainingCalories) / MACRO_CALORIES_PER_GRAM[key];
  } else if (unlockedKeys.length > 1) {
    const unlockedWeight = unlockedKeys.reduce((total, key) => total + percentages[key], 0);
    if (unlockedWeight <= EPSILON) {
      for (const key of unlockedKeys) resolvedGrams[key] = 0;
      const macros = Object.fromEntries(
        MACRO_KEYS.map((key) => [key, macroResult(key, resolvedGrams[key], lockedState[key], calories)]),
      );
      return {
        ...macros,
        valid: false,
        error: 'The unlocked macros need a combined preferred percentage greater than 0%.',
        totalCalories: lockedCalories,
        remainingCalories,
        targetDifference: lockedCalories - calories,
      };
    }
    for (const key of unlockedKeys) {
      const allocatedCalories = Math.max(0, remainingCalories) * percentages[key] / unlockedWeight;
      resolvedGrams[key] = allocatedCalories / MACRO_CALORIES_PER_GRAM[key];
    }
  }

  const macros = Object.fromEntries(
    MACRO_KEYS.map((key) => [key, macroResult(key, resolvedGrams[key], lockedState[key], calories)]),
  );
  const totalCalories = MACRO_KEYS.reduce((total, key) => total + macros[key].calories, 0);

  return {
    ...macros,
    valid: true,
    error: '',
    totalCalories,
    remainingCalories: calories - totalCalories,
    targetDifference: totalCalories - calories,
  };
}
