import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POUNDS_PER_KILOGRAM,
  buildProteinIntakeResult,
  calculateProteinIntake,
  proteinIntakeScenarios,
  validateProteinIntakeForm,
} from './proteinIntakeMath.js';

test('defines the three protein ranges from the reference chart', () => {
  assert.deepEqual(
    proteinIntakeScenarios.map(({ minGramsPerPound, maxGramsPerPound }) => [minGramsPerPound, maxGramsPerPound]),
    [[0.55, 0.63], [0.64, 0.72], [0.73, 1]],
  );
});

test('calculates all three scenarios from pounds', () => {
  const result = calculateProteinIntake({ weight: '160', unit: 'lb' });

  assert.equal(result.weightPounds, 160);
  assert.equal(result.scenarios[0].minGrams, 88);
  assert.equal(result.scenarios[0].maxGrams, 100.8);
  assert.equal(result.scenarios[1].minGrams, 102.4);
  assert.ok(Math.abs(result.scenarios[1].maxGrams - 115.2) < 1e-10);
  assert.equal(result.scenarios[2].minGrams, 116.8);
  assert.equal(result.scenarios[2].maxGrams, 160);
});

test('kilograms and equivalent pounds produce the same protein targets', () => {
  const kilograms = calculateProteinIntake({ weight: '80', unit: 'kg' });
  const pounds = calculateProteinIntake({ weight: String(80 * POUNDS_PER_KILOGRAM), unit: 'lb' });

  kilograms.scenarios.forEach((scenario, index) => {
    assert.ok(Math.abs(scenario.minGrams - pounds.scenarios[index].minGrams) < 1e-10);
    assert.ok(Math.abs(scenario.maxGrams - pounds.scenarios[index].maxGrams) < 1e-10);
  });
});

test('formats displayed protein targets to the nearest whole gram', () => {
  const result = buildProteinIntakeResult({ weight: '160', unit: 'lb' });

  assert.equal(result.scenarios[0].formattedRange, '88-101 g/day');
  assert.equal(result.scenarios[1].formattedRange, '102-115 g/day');
  assert.equal(result.scenarios[2].formattedRange, '117-160 g/day');
});

test('rejects missing, zero, negative, excessive, and invalid weights', () => {
  assert.equal(validateProteinIntakeForm({ weight: '', unit: 'kg' }).weight, 'Body weight is required.');
  assert.equal(validateProteinIntakeForm({ weight: '0', unit: 'kg' }).weight, 'Body weight must be greater than zero.');
  assert.equal(validateProteinIntakeForm({ weight: '-1', unit: 'kg' }).weight, 'Body weight must be greater than zero.');
  assert.equal(validateProteinIntakeForm({ weight: '2001', unit: 'lb' }).weight, 'Enter a body weight of 2,000 or less.');
  assert.equal(validateProteinIntakeForm({ weight: 'abc', unit: 'kg' }).weight, 'Enter a valid body weight.');
  assert.equal(validateProteinIntakeForm({ weight: '80', unit: 'stone' }).unit, 'Choose pounds or kilograms.');
});
