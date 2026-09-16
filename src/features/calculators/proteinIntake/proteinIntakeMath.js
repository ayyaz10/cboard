export const POUNDS_PER_KILOGRAM = 2.2046226218;

export const proteinIntakeScenarios = [
  {
    id: 'almost-maximized',
    label: 'Almost maximized',
    shortLabel: 'Bare minimum',
    minGramsPerPound: 0.55,
    maxGramsPerPound: 0.63,
    description: 'The lowest range in the reference chart for capturing most muscle-gain benefit.',
  },
  {
    id: 'very-likely-maximized',
    label: 'Very likely maximized',
    shortLabel: 'High confidence',
    minGramsPerPound: 0.64,
    maxGramsPerPound: 0.72,
    description: 'A higher-confidence range for supporting muscle gain and recovery.',
  },
  {
    id: 'definitely-maximized',
    label: 'Definitely maximized',
    shortLabel: 'Highest range',
    minGramsPerPound: 0.73,
    maxGramsPerPound: 1,
    description: 'The highest range shown in the reference chart, up to 1 gram per pound.',
  },
];

export const weightUnitOptions = [
  { value: 'lb', label: 'Pounds (lb)' },
  { value: 'kg', label: 'Kilograms (kg)' },
];

const wholeNumberFormatter = new Intl.NumberFormat('en-GB', {
  maximumFractionDigits: 0,
});

const decimalFormatter = new Intl.NumberFormat('en-GB', {
  maximumFractionDigits: 1,
});

export function createEmptyProteinIntakeForm() {
  return { weight: '', unit: 'kg' };
}

export function validateProteinIntakeForm(values) {
  const errors = {};
  const rawWeight = String(values.weight ?? '').trim();
  const weight = Number(rawWeight);

  if (!rawWeight) {
    errors.weight = 'Body weight is required.';
  } else if (!Number.isFinite(weight)) {
    errors.weight = 'Enter a valid body weight.';
  } else if (weight <= 0) {
    errors.weight = 'Body weight must be greater than zero.';
  } else if (weight > 2000) {
    errors.weight = 'Enter a body weight of 2,000 or less.';
  }

  if (!weightUnitOptions.some(({ value }) => value === values.unit)) {
    errors.unit = 'Choose pounds or kilograms.';
  }

  return errors;
}

export function calculateProteinIntake(values) {
  const inputWeight = Number(values.weight);
  const weightPounds = values.unit === 'kg'
    ? inputWeight * POUNDS_PER_KILOGRAM
    : inputWeight;
  const weightKilograms = values.unit === 'kg'
    ? inputWeight
    : inputWeight / POUNDS_PER_KILOGRAM;

  const scenarios = proteinIntakeScenarios.map((scenario) => ({
    ...scenario,
    minGrams: weightPounds * scenario.minGramsPerPound,
    maxGrams: weightPounds * scenario.maxGramsPerPound,
    minGramsPerKilogram: scenario.minGramsPerPound * POUNDS_PER_KILOGRAM,
    maxGramsPerKilogram: scenario.maxGramsPerPound * POUNDS_PER_KILOGRAM,
  }));

  return { inputWeight, weightPounds, weightKilograms, scenarios };
}

export function formatProteinGrams(value) {
  return wholeNumberFormatter.format(Math.round(value));
}

export function formatWeight(value) {
  return decimalFormatter.format(value);
}

export function buildProteinIntakeResult(values) {
  const result = calculateProteinIntake(values);
  const formattedInput = `${formatWeight(result.inputWeight)} ${values.unit}`;
  const scenarioResults = result.scenarios.map((scenario) => ({
    ...scenario,
    formattedRange: `${formatProteinGrams(scenario.minGrams)}-${formatProteinGrams(scenario.maxGrams)} g/day`,
    formattedPoundRatio: `${scenario.minGramsPerPound}-${scenario.maxGramsPerPound} g/lb`,
    formattedKilogramRatio: `${scenario.minGramsPerKilogram.toFixed(2)}-${scenario.maxGramsPerKilogram.toFixed(2)} g/kg`,
  }));

  return {
    ...result,
    scenarios: scenarioResults,
    formattedInput,
    historySummary: `${formattedInput}: ${scenarioResults[1].formattedRange} very likely maximized`,
    historyDetail: scenarioResults.map(({ label, formattedRange }) => `${label}: ${formattedRange}`).join(' | '),
  };
}
