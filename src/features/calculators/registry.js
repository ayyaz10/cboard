import { CalorieCalculator } from './calorie/CalorieCalculator';
import { MassCalculator } from './mass/MassCalculator';
import { PercentageCalculator } from './percentage/PercentageCalculator';

export const calculators = [
  {
    id: 'percentage',
    path: '/calculators/percentage',
    name: 'Percentage Calculator',
    boardLabel: 'Calculator 01',
    boardColor: '#c5ff6f',
    boardDescription: 'Calculate a percentage of any number in one step.',
    formula: [
      'result = number x (percentage / 100)',
    ],
    example: {
      total: '30% of 150 = 45',
      desired: '120% of 5 = 6',
    },
    showReferenceCards: true,
    component: PercentageCalculator,
  },
  {
    id: 'calorie',
    path: '/calculators/calorie',
    name: 'Calorie Calculator',
    boardLabel: 'Calculator 02',
    boardColor: '#ff90e8',
    boardDescription: 'Calculate calories for any portion size from a total amount.',
    description:
      'Enter the total amount, total calories, and the portion you want.',
    formula: [
      'calories per unit = total calories / total quantity',
      'result = calories per unit x desired quantity',
    ],
    example: {
      total: '100 grams = 500 calories',
      desired: '40 grams = 200 calories',
    },
    showReferenceCards: true,
    component: CalorieCalculator,
  },
  {
    id: 'mass',
    path: '/calculators/mass',
    name: 'Mass Unit Converter',
    boardLabel: 'Calculator 03',
    boardColor: '#9fe3ff',
    boardDescription: 'Convert between metric and imperial mass units.',
    description:
      'Switch between mass units and see the formula used for the exact conversion you selected.',
    formula: [
      'result = value x (from unit in kilograms / to unit in kilograms)',
      'example: grams = kilograms x 1000',
    ],
    example: {
      total: '2 kilograms -> grams',
      desired: '2 x 1000 = 2,000 grams',
    },
    showReferenceCards: true,
    component: MassCalculator,
  },
];

export function findCalculatorByPath(path) {
  return calculators.find((calculator) => calculator.path === path);
}
