export const calorieFieldConfig = [
  {
    name: 'totalQuantity',
    label: 'Total quantity',
    placeholder: 'e.g. 100',
  },
  {
    name: 'totalCalories',
    label: 'Total calories',
    placeholder: 'e.g. 500',
  },
  {
    name: 'desiredQuantity',
    label: 'Desired quantity',
    placeholder: 'e.g. 40',
    wide: true,
  },
];

const numberFormatter = new Intl.NumberFormat('en-GB', {
  maximumFractionDigits: 2,
});

export function createEmptyCalorieForm() {
  return Object.fromEntries(calorieFieldConfig.map(({ name }) => [name, '']));
}

function parseNumber(value) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return { isEmpty: true };
  }

  const parsedValue = Number(trimmedValue);

  if (!Number.isFinite(parsedValue)) {
    return { isInvalid: true };
  }

  return { value: parsedValue };
}

export function validateCalorieForm(values) {
  const errors = {};

  for (const field of calorieFieldConfig) {
    const parsedField = parseNumber(values[field.name]);

    if (parsedField.isEmpty) {
      errors[field.name] = `${field.label} is required.`;
      continue;
    }

    if (parsedField.isInvalid) {
      errors[field.name] = `Enter a valid number for ${field.label.toLowerCase()}.`;
      continue;
    }

    if (field.name === 'totalQuantity' && parsedField.value <= 0) {
      errors[field.name] = 'Total quantity must be greater than zero.';
      continue;
    }

    if (field.name !== 'totalQuantity' && parsedField.value < 0) {
      errors[field.name] = `${field.label} cannot be negative.`;
    }
  }

  return errors;
}

export function calculateCalories(values) {
  const totalQuantity = Number(values.totalQuantity);
  const totalCalories = Number(values.totalCalories);
  const desiredQuantity = Number(values.desiredQuantity);
  const caloriesPerUnit = totalCalories / totalQuantity;
  const calculatedCalories = caloriesPerUnit * desiredQuantity;

  return {
    totalQuantity,
    desiredQuantity,
    caloriesPerUnit,
    calculatedCalories,
  };
}

export function formatNumber(value) {
  return numberFormatter.format(value);
}

export function buildResultSummary(values) {
  const result = calculateCalories(values);

  return {
    ...result,
    formattedCaloriesPerUnit: formatNumber(result.caloriesPerUnit),
    formattedDesiredQuantity: formatNumber(result.desiredQuantity),
    formattedCalculatedCalories: formatNumber(result.calculatedCalories),
    formulaText: `${formatNumber(result.caloriesPerUnit)} x ${formatNumber(
      result.desiredQuantity,
    )} = ${formatNumber(result.calculatedCalories)}`,
  };
}
