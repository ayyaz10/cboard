// General food-labelling factors; estimates do not replace recorded food energy.
export const ENERGY_FACTORS = { protein: 4, carbs: 4, fat: 9, fiber: 2 };

export function nutrientEnergy(key, nutrient, loggedCalories) {
  const factor = ENERGY_FACTORS[key];
  if (!factor) return null;
  const known = nutrient.known > 0;
  const calories = known ? nutrient.total * factor : null;
  return {
    factor,
    calories,
    percentage: calories != null && loggedCalories.total > 0 ? calories / loggedCalories.total * 100 : null,
    partial: nutrient.missing > 0 || loggedCalories.missing > 0,
  };
}
