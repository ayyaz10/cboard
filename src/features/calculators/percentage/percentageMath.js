export const percentageFieldConfig = [
  {
    name: 'number',
    label: 'Number',
    placeholder: 'e.g. 150',
  },
  {
    name: 'percentage',
    label: 'Percentage',
    placeholder: 'e.g. 30',
  },
];

const numberFormatter = new Intl.NumberFormat('en-GB', {
  maximumFractionDigits: 4,
});

export function createEmptyPercentageForm() {
  return Object.fromEntries(percentageFieldConfig.map(({ name }) => [name, '']));
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

export function validatePercentageForm(values) {
  const errors = {};

  for (const field of percentageFieldConfig) {
    const parsedField = parseNumber(values[field.name]);

    if (parsedField.isEmpty) {
      errors[field.name] = `${field.label} is required.`;
      continue;
    }

    if (parsedField.isInvalid) {
      errors[field.name] = `Enter a valid number for ${field.label.toLowerCase()}.`;
    }
  }

  return errors;
}

export function calculatePercentageResult(values) {
  const number = Number(values.number);
  const percentage = Number(values.percentage);

  return number * (percentage / 100);
}

export function formatResult(value) {
  return numberFormatter.format(value);
}

export function buildPercentageResult(values) {
  const result = calculatePercentageResult(values);

  return {
    value: result,
    formattedValue: formatResult(result),
  };
}
