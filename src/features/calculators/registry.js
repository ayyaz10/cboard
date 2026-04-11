import { CalorieCalculator } from './calorie/CalorieCalculator';

export const calculators = [
  {
    id: 'calorie',
    path: '/calculators/calorie',
    name: 'Calorie Calculator',
    boardLabel: 'Calculator 01',
    boardColor: '#ff90e8',
    boardDescription: 'Calculate calories for any portion size from a total amount.',
    eyebrow: 'Minimal utility tool',
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
    component: CalorieCalculator,
  },
];

export const roadmapTools = [
  'Protein Calculator',
  'Carbs Calculator',
  'Fat Calculator',
  'Percentage Calculator',
  'Unit Converter',
];

export function findCalculatorByPath(path) {
  return calculators.find((calculator) => calculator.path === path);
}
