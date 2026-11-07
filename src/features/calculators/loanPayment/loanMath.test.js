import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLoan, formatGBP, LOAN_DEFAULTS, validateLoanInput } from './loanMath.js';

test('flat calculation uses original principal and reconciles schedule', () => {
  const result = calculateLoan(LOAN_DEFAULTS);
  assert.equal(result.totalInterestCents, 1189);
  assert.equal(result.totalRepaymentCents, 17589);
  assert.equal(result.monthlyPaymentCents, 5863);
  assert.equal(result.schedule.at(-1).balanceCents, 0);
  assert.equal(result.schedule.reduce((sum, row) => sum + row.principalCents, 0), result.principalCents);
  assert.equal(result.schedule.reduce((sum, row) => sum + row.interestCents, 0), result.totalInterestCents);
});

test('reducing balance uses nominal annual rate divided by twelve', () => {
  const result = calculateLoan({ ...LOAN_DEFAULTS, method: 'REDUCING' });
  assert.equal(result.monthlyPaymentCents, 5733);
  assert.equal(result.totalInterestCents, 798);
  assert.equal(result.schedule.at(-1).balanceCents, 0);
  assert.equal(result.schedule.reduce((sum, row) => sum + row.paymentCents, 0), result.totalRepaymentCents);
  assert.ok(result.schedule[0].interestCents > result.schedule[1].interestCents);
});

test('zero interest, one month, and penny remainders reconcile', () => {
  const zero = calculateLoan({ amount: '100', annualRate: '0', termMonths: '3', method: 'REDUCING' });
  assert.equal(zero.totalInterestCents, 0);
  assert.equal(zero.totalRepaymentCents, 10000);
  assert.equal(zero.schedule.at(-1).balanceCents, 0);
  const penny = calculateLoan({ amount: '0.01', annualRate: '0', termMonths: '3', method: 'REDUCING' });
  assert.deepEqual(penny.schedule.map(row => row.paymentCents), [0, 0, 1]);
  assert.equal(penny.schedule.at(-1).balanceCents, 0);
  const one = calculateLoan({ amount: '0.01', annualRate: '5.5', termMonths: '1', method: 'REDUCING' });
  assert.equal(one.totalRepaymentCents, 1);
  assert.equal(one.schedule.at(-1).balanceCents, 0);
});

test('validation rejects incomplete and out-of-range values', () => {
  assert.ok(validateLoanInput({ ...LOAN_DEFAULTS, amount: '' }).amount);
  assert.ok(validateLoanInput({ ...LOAN_DEFAULTS, annualRate: '-1' }).annualRate);
  assert.ok(validateLoanInput({ ...LOAN_DEFAULTS, termMonths: '1.5' }).termMonths);
  assert.equal(calculateLoan({ ...LOAN_DEFAULTS, amount: '0' }), null);
});

test('rounding-heavy long schedule reconciles without a negative balance', () => {
  const result = calculateLoan({ amount: '1234.57', annualRate: '5.55', termMonths: '360', method: 'REDUCING' });
  assert.equal(result.schedule.length, 360);
  assert.equal(result.schedule.at(-1).balanceCents, 0);
  assert.ok(result.schedule.every(row => row.balanceCents >= 0));
  assert.equal(result.schedule.reduce((sum, row) => sum + row.paymentCents, 0), result.totalRepaymentCents);
  assert.equal(result.schedule.reduce((sum, row) => sum + row.interestCents, 0), result.totalInterestCents);
});

test('formats GBP without mixing formatting into the calculation', () => {
  assert.equal(formatGBP(123456), '£1,234.56');
});
