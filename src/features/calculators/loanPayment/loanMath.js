export const LOAN_DEFAULTS = Object.freeze({
  amount: '164',
  annualRate: '29',
  termMonths: '3',
  method: 'FLAT',
});

const MAX_AMOUNT_CENTS = 100_000_000_000;
const MAX_RATE = 1000;
const MAX_TERM_MONTHS = 600;

export function validateLoanInput(input) {
  const errors = {};
  const amount = Number(input.amount);
  const annualRate = Number(input.annualRate);
  const termMonths = Number(input.termMonths);
  if (input.amount.trim() === '' || !Number.isFinite(amount) || amount <= 0 || amount * 100 > MAX_AMOUNT_CENTS) {
    errors.amount = 'Enter a loan amount greater than £0 (up to £1 billion).';
  }
  if (input.annualRate.trim() === '' || !Number.isFinite(annualRate) || annualRate < 0 || annualRate > MAX_RATE) {
    errors.annualRate = 'Enter an interest rate from 0% to 1,000%.';
  }
  if (input.termMonths.trim() === '' || !Number.isInteger(termMonths) || termMonths < 1 || termMonths > MAX_TERM_MONTHS) {
    errors.termMonths = 'Enter a whole number of months from 1 to 600.';
  }
  if (!['FLAT', 'REDUCING'].includes(input.method)) errors.method = 'Choose a calculation method.';
  return errors;
}

const toCents = amount => Math.round((amount + Number.EPSILON) * 100);
const allocate = (totalCents, count, index) => Math.floor(totalCents / count) + (index === count - 1 ? totalCents % count : 0);

export function calculateLoan(input) {
  const errors = validateLoanInput(input);
  if (Object.keys(errors).length) return null;
  const principalCents = toCents(Number(input.amount));
  const annualRate = Number(input.annualRate);
  const termMonths = Number(input.termMonths);
  const schedule = [];

  if (input.method === 'FLAT') {
    const interestTotalCents = toCents(principalCents / 100 * annualRate * termMonths / 1200);
    const repaymentTotalCents = principalCents + interestTotalCents;
    let remainingPrincipalCents = principalCents;
    for (let i = 0; i < termMonths; i += 1) {
      const principalCentsPaid = allocate(principalCents, termMonths, i);
      const paymentCents = allocate(repaymentTotalCents, termMonths, i);
      const interestCents = paymentCents - principalCentsPaid;
      remainingPrincipalCents -= principalCentsPaid;
      schedule.push({ month: i + 1, paymentCents, interestCents, principalCents: principalCentsPaid, balanceCents: remainingPrincipalCents });
    }
  } else {
    const monthlyRate = annualRate / 1200;
    const exactPaymentCents = monthlyRate === 0
      ? principalCents / termMonths
      : principalCents * monthlyRate / (1 - ((1 + monthlyRate) ** -termMonths));
    const regularPaymentCents = Math.max(1, Math.round(exactPaymentCents));
    let balanceCents = principalCents;
    for (let i = 0; i < termMonths; i += 1) {
      const interestCents = monthlyRate === 0 ? 0 : Math.round(balanceCents * monthlyRate);
      const paymentCents = monthlyRate === 0
        ? allocate(principalCents, termMonths, i)
        : i === termMonths - 1 ? balanceCents + interestCents : Math.min(regularPaymentCents, balanceCents + interestCents);
      const principalCentsPaid = paymentCents - interestCents;
      balanceCents = Math.max(0, balanceCents - principalCentsPaid);
      schedule.push({ month: i + 1, paymentCents, interestCents, principalCents: principalCentsPaid, balanceCents });
    }
  }

  const totalRepaymentCents = schedule.reduce((sum, row) => sum + row.paymentCents, 0);
  const totalInterestCents = totalRepaymentCents - principalCents;
  return {
    principalCents, annualRate, termMonths, method: input.method,
    monthlyPaymentCents: schedule[0]?.paymentCents ?? 0,
    totalInterestCents, totalRepaymentCents, schedule,
  };
}

export const formatGBP = cents => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(cents / 100);
