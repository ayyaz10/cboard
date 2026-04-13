export const massUnitOptions = [
  {
    value: 'tonne',
    label: 'Tonne',
    singular: 'tonne',
    plural: 'tonnes',
    kilograms: 1000,
  },
  {
    value: 'kilogram',
    label: 'Kilogram',
    singular: 'kilogram',
    plural: 'kilograms',
    kilograms: 1,
  },
  {
    value: 'gram',
    label: 'Gram',
    singular: 'gram',
    plural: 'grams',
    kilograms: 0.001,
  },
  {
    value: 'milligram',
    label: 'Milligram',
    singular: 'milligram',
    plural: 'milligrams',
    kilograms: 0.000001,
  },
  {
    value: 'microgram',
    label: 'Microgram',
    singular: 'microgram',
    plural: 'micrograms',
    kilograms: 0.000000001,
  },
  {
    value: 'imperial-ton',
    label: 'Imperial ton',
    singular: 'imperial ton',
    plural: 'imperial tons',
    kilograms: 1016.0469088,
  },
  {
    value: 'us-ton',
    label: 'US ton',
    singular: 'US ton',
    plural: 'US tons',
    kilograms: 907.18474,
  },
  {
    value: 'stone',
    label: 'Stone',
    singular: 'stone',
    plural: 'stone',
    kilograms: 6.35029318,
  },
  {
    value: 'pound',
    label: 'Pound',
    singular: 'pound',
    plural: 'pounds',
    kilograms: 0.45359237,
  },
  {
    value: 'ounce',
    label: 'Ounce',
    singular: 'ounce',
    plural: 'ounces',
    kilograms: 0.028349523125,
  },
];

const massUnitMap = Object.fromEntries(
  massUnitOptions.map((unit) => [unit.value, unit]),
);

const numberFormatter = new Intl.NumberFormat('en-GB', {
  maximumFractionDigits: 12,
});

export function createEmptyMassForm(preferredUnits = {}) {
  const fallbackToUnit = preferredUnits.fromUnit === 'gram' ? 'kilogram' : 'gram';

  return {
    value: '',
    fromUnit: preferredUnits.fromUnit ?? 'kilogram',
    toUnit: preferredUnits.toUnit ?? fallbackToUnit,
  };
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

function getUnit(unitValue) {
  return massUnitMap[unitValue];
}

function getUnitName(unit, quantity) {
  const isSingular = Math.abs(quantity - 1) < 0.000000000001;
  return isSingular ? unit.singular : unit.plural;
}

export function formatNumber(value) {
  const absoluteValue = Math.abs(value);

  if (absoluteValue !== 0 && absoluteValue < 0.000001) {
    return value.toExponential(12).replace(/\.?0+e/, 'e');
  }

  return numberFormatter.format(value);
}

export function validateMassForm(values) {
  const errors = {};
  const parsedValue = parseNumber(values.value);

  if (parsedValue.isEmpty) {
    errors.value = 'Value is required.';
  } else if (parsedValue.isInvalid) {
    errors.value = 'Enter a valid number for value.';
  } else if (parsedValue.value < 0) {
    errors.value = 'Value cannot be negative.';
  }

  if (!getUnit(values.fromUnit)) {
    errors.fromUnit = 'Choose a valid starting unit.';
  }

  if (!getUnit(values.toUnit)) {
    errors.toUnit = 'Choose a valid target unit.';
  }

  return errors;
}

export function convertMass(values) {
  const inputValue = Number(values.value);
  const fromUnit = getUnit(values.fromUnit);
  const toUnit = getUnit(values.toUnit);
  const conversionFactor = fromUnit.kilograms / toUnit.kilograms;
  const convertedValue = inputValue * conversionFactor;

  return {
    inputValue,
    fromUnit,
    toUnit,
    conversionFactor,
    convertedValue,
  };
}

export function buildMassResult(values) {
  const result = convertMass(values);
  const formattedInputValue = formatNumber(result.inputValue);
  const formattedConvertedValue = formatNumber(result.convertedValue);
  const fromUnitName = getUnitName(result.fromUnit, result.inputValue);
  const toUnitName = getUnitName(result.toUnit, result.convertedValue);
  const formattedConversionFactor = formatNumber(result.conversionFactor);
  const relationshipText = `1 ${result.fromUnit.singular} = ${formattedConversionFactor} ${getUnitName(
    result.toUnit,
    result.conversionFactor,
  )}`;
  const formulaText = `${result.toUnit.plural} = ${result.fromUnit.plural} x ${formattedConversionFactor}`;
  const calculationText = `${formattedInputValue} x ${formattedConversionFactor} = ${formattedConvertedValue}`;

  return {
    ...result,
    formattedInputValue,
    formattedConvertedValue,
    fromUnitName,
    toUnitName,
    relationshipText,
    formulaText,
    calculationText,
    historySummary: `${formattedInputValue} ${fromUnitName} = ${formattedConvertedValue} ${toUnitName}`,
    historyDetail: `Calculation: ${calculationText}`,
  };
}
