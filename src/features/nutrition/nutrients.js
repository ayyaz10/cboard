// OFF *_100g mass values are standardized to grams, independent of *_unit.
export const NUTRIENTS = [
  ["calories", "Calories", "kcal", "energy-kcal", 1],
  ["protein", "Protein", "g", "proteins", 1],
  ["carbs", "Carbs", "g", "carbohydrates", 1],
  ["fat", "Fat", "g", "fat", 1],
  ["fiber", "Fibre", "g", "fiber", 1],
  ["sugars", "Sugars", "g", "sugars", 1],
  ["saturatedFat", "Saturated fat", "g", "saturated-fat", 1],
  ["salt", "Salt", "g", "salt", 1],
  ["sodium", "Sodium", "mg", "sodium", 1000],
  ["potassium", "Potassium", "mg", "potassium", 1000],
  ["calcium", "Calcium", "mg", "calcium", 1000],
  ["iron", "Iron", "mg", "iron", 1000],
  ["magnesium", "Magnesium", "mg", "magnesium", 1000],
  ["zinc", "Zinc", "mg", "zinc", 1000],
  ["vitaminA", "Vitamin A", "µg", "vitamin-a", 1000000],
  ["vitaminC", "Vitamin C", "mg", "vitamin-c", 1000],
  ["vitaminD", "Vitamin D", "µg", "vitamin-d", 1000000],
  ["vitaminE", "Vitamin E", "mg", "vitamin-e", 1000],
  ["vitaminB12", "Vitamin B12", "µg", "vitamin-b12", 1000000],
  ["folate", "Folate", "µg", "folates", 1000000],
];
export const nutrientKeys = NUTRIENTS.map(([key]) => key);
export const validNutrient = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
export const cleanNutrients = (values = {}) =>
  Object.fromEntries(
    nutrientKeys.map((key) => [
      key,
      validNutrient(values?.[key]) ? values[key] : null,
    ]),
  );
export function offNutrients(values) {
  return Object.fromEntries(
    NUTRIENTS.map(([key, , , field, factor]) => [
      key,
      validNutrient(values[`${field}_100g`])
        ? values[`${field}_100g`] * factor
        : null,
    ]),
  );
}
