import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSavingsPlan } from './savingsPlannerMath.js';

const base = { target: '80', alreadySaved: '0', planMode: 'contribution', savingMode: 'amount', amountPerDay: '10', dailyIncome: '100', savingPercentage: '10', equalPayments: false, scheduleMode: 'specific', selectedDays: [1, 3, 5], daysPerWeek: '3', daysPerMonth: '12', startDate: '2026-09-28', targetDate: '2026-10-31', currency: 'GBP' };

test('calculates exact saving days and finish date for selected workdays', () => {
  const result = calculateSavingsPlan(base);
  assert.equal(result.contributions, 8);
  assert.equal(result.periods, 3);
  assert.equal(result.finishDate, '2026-10-14');
  assert.equal(result.finalContribution, 10);
});

test('handles a partial final contribution', () => {
  const result = calculateSavingsPlan({ ...base, target: '85' });
  assert.equal(result.contributions, 9);
  assert.equal(result.finalContribution, 5);
  assert.equal(result.finishDate, '2026-10-16');
});

test('calculates each saving day as a percentage of daily earnings', () => {
  const result = calculateSavingsPlan({ ...base, savingMode: 'percentage', target: '100', dailyIncome: '80', savingPercentage: '25' });
  assert.equal(result.amountPerDay, 20);
  assert.equal(result.contributions, 5);
  assert.equal(result.finishDate, '2026-10-07');
});

test('calculates the required amount per selected saving day from a deadline', () => {
  const result = calculateSavingsPlan({ ...base, planMode: 'deadline', target: '100', targetDate: '2026-10-09' });
  assert.equal(result.contributions, 6);
  assert.equal(result.amountPerDay, 16.67);
  assert.equal(result.finalContribution, 16.65);
  assert.equal(result.finishDate, '2026-10-09');
  assert.equal(result.exactDate, true);
});

test('rejects a deadline with no selected saving days available', () => {
  const result = calculateSavingsPlan({ ...base, planMode: 'deadline', selectedDays: [0], targetDate: '2026-09-28' });
  assert.ok(result.errors.targetDate);
});

test('can keep every deadline payment equal and report the overage', () => {
  const result = calculateSavingsPlan({ ...base, planMode: 'deadline', target: '88', targetDate: '2026-10-28', selectedDays: [5, 6, 0], equalPayments: true });
  assert.equal(result.contributions, 12);
  assert.equal(result.amountPerDay, 7.34);
  assert.equal(result.finalContribution, 7.34);
  assert.ok(Math.abs(result.requiredPercentage - 7.34) < 1e-10);
  assert.equal(result.projectedTotal, 88.08);
  assert.equal(result.overTarget, 0.08);
});

test('deadline percentage is based on earnings per workday', () => {
  const result = calculateSavingsPlan({ ...base, planMode: 'deadline', target: '88', targetDate: '2026-10-28', selectedDays: [5, 6, 0], dailyIncome: '225' });
  assert.equal(result.amountPerDay, 7.34);
  assert.ok(Math.abs(result.requiredPercentage - 3.2622222222222224) < 1e-10);
});

test('validates impossible schedules and amounts', () => {
  const result = calculateSavingsPlan({ ...base, amountPerDay: '0', selectedDays: [] });
  assert.ok(result.errors.amountPerDay);
  assert.ok(result.errors.selectedDays);
});
