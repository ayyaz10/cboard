import { useMemo, useState } from 'react';
import { calculateLoan, formatGBP, LOAN_DEFAULTS, validateLoanInput } from './loanMath.js';

function Money({ cents, className = '' }) {
  return <span className={`tabular-nums ${className}`}>{formatGBP(cents)}</span>;
}

export function LoanPaymentCalculator() {
  const [form, setForm] = useState(LOAN_DEFAULTS);
  const [copied, setCopied] = useState('');
  const [visibleRows, setVisibleRows] = useState(12);
  const errors = useMemo(() => validateLoanInput(form), [form]);
  const result = useMemo(() => Object.keys(errors).length ? null : calculateLoan(form), [form, errors]);
  const update = (key, value) => { setCopied(''); setForm(current => ({ ...current, [key]: value })); };
  const reset = () => { setForm(LOAN_DEFAULTS); setCopied(''); setVisibleRows(12); };

  async function copyResults() {
    if (!result) return;
    const summary = [
      'Loan Payment Estimate', '',
      `Loan: ${formatGBP(result.principalCents)}`,
      `Rate: ${new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(result.annualRate)}%`,
      `Term: ${result.termMonths} months`,
      `Method: ${result.method === 'FLAT' ? 'Flat Interest' : 'Reducing Balance'}`, '',
      `Monthly payment: ${formatGBP(result.monthlyPaymentCents)}`,
      `Total interest: ${formatGBP(result.totalInterestCents)}`,
      `Total repayment: ${formatGBP(result.totalRepaymentCents)}`,
    ].join('\n');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(summary);
      setCopied('Results copied');
    } catch {
      setCopied('Could not copy results. Check clipboard permissions and try again.');
    }
  }

  const inputSpecs = [
    { key: 'amount', label: 'Loan amount', hint: 'GBP, up to £1 billion', inputMode: 'decimal' },
    { key: 'annualRate', label: 'Annual interest rate', hint: 'Enter a percentage, for example 5.5', inputMode: 'decimal' },
    { key: 'termMonths', label: 'Repayment period', hint: '1 to 600 months', inputMode: 'numeric' },
  ];

  return <div className="grid min-w-0 gap-6">
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section className="min-w-0 rounded-2xl border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] p-4 sm:p-6" aria-labelledby="loan-input-heading">
        <h2 id="loan-input-heading" className="text-lg font-bold">Loan details</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {inputSpecs.map(({ key, label, hint, inputMode }) => (
            <div key={key} className={key === 'amount' ? 'sm:col-span-2' : ''}>
              <label htmlFor={`loan-${key}`} className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">{label}</label>
              <input id={`loan-${key}`} className="field-input tabular-nums" type="text" inputMode={inputMode} autoComplete="off" value={form[key]} onChange={event => update(key, event.target.value)} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `loan-${key}-error` : `loan-${key}-hint`} />
              <p id={`loan-${key}-hint`} className="mt-1.5 text-xs text-[var(--color-text-muted)]">{hint}</p>
              {errors[key] && <p id={`loan-${key}-error`} role="alert" className="mt-1.5 text-sm font-semibold text-[var(--color-danger)]">{errors[key]}</p>}
            </div>
          ))}
        </div>
        <fieldset className="mt-5">
          <legend className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">Calculation method</legend>
          <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-1">
            {[['FLAT', 'Flat interest'], ['REDUCING', 'Reducing balance']].map(([method, label]) => <button key={method} type="button" aria-pressed={form.method === method} onClick={() => update('method', method)} className={`min-h-11 rounded-lg px-2 py-2 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)] ${form.method === method ? 'bg-[var(--color-accent)] text-[var(--color-accent-text)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--surface-interactive)]'}`}>{label}</button>)}
          </div>
          <p className="mt-2 text-sm leading-5 text-[var(--color-text-muted)]">{form.method === 'FLAT' ? 'Interest is calculated from the original loan amount.' : 'Interest is calculated monthly on the remaining balance.'}</p>
        </fieldset>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={reset} className="min-h-11 rounded-lg border-2 border-[var(--border-default)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-interactive)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]">Reset</button>
          <button type="button" onClick={copyResults} disabled={!result} className="min-h-11 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-bold text-[var(--color-accent-text)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]">Copy results</button>
          {copied && <span role="status" className="text-sm font-semibold text-[var(--color-text-secondary)]">{copied}</span>}
        </div>
      </section>

      <section className="min-w-0 rounded-2xl border-2 border-[var(--border-default)] bg-[var(--color-accent-soft)] p-5 sm:p-7" aria-live="polite" aria-label="Loan calculation results">
        {result ? <>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">Monthly payment</p>
          <p className="mt-2 break-words text-[clamp(1.5rem,8vw,3rem)] font-bold leading-tight tracking-tight text-[var(--color-text)]"><Money cents={result.monthlyPaymentCents} /></p>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">You would repay <Money cents={result.totalRepaymentCents} /> in total, including <Money cents={result.totalInterestCents} /> interest.</p>
          <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-[var(--border-default)] pt-4">
            {[
              ['Total interest', result.totalInterestCents], ['Total repayment', result.totalRepaymentCents], ['Original amount', result.principalCents],
            ].map(([label, cents]) => <div key={label}><dt className="text-xs font-bold text-[var(--color-text-muted)]">{label}</dt><dd className="mt-1 text-base font-bold text-[var(--color-text)]"><Money cents={cents} /></dd></div>)}
          </dl>
        </> : <div role="status"><p className="text-sm font-bold text-[var(--color-text-secondary)]">Complete the loan details to see your estimate.</p><p className="mt-2 text-sm text-[var(--color-text-muted)]">Correct the highlighted input to continue.</p></div>}
      </section>
    </div>

    {result && <>
      <section className="min-w-0 border-t border-[var(--border-default)] pt-5" aria-labelledby="repayment-breakdown-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="repayment-breakdown-heading" className="text-lg font-bold">Repayment breakdown</h2><p className="text-sm font-semibold text-[var(--color-text-secondary)]">Total repayment <Money cents={result.totalRepaymentCents} /></p></div>
        <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-[var(--surface-interactive)]" role="img" aria-label={`Principal ${formatGBP(result.principalCents)}, interest ${formatGBP(result.totalInterestCents)}`}>
          <span className="bg-[var(--color-accent)]" style={{ width: `${result.principalCents / result.totalRepaymentCents * 100}%` }} />
          <span className="bg-[var(--color-warning)]" style={{ width: `${result.totalInterestCents / result.totalRepaymentCents * 100}%` }} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm"><p className="font-semibold">Principal <span className="block font-bold"><Money cents={result.principalCents} /></span></p><p className="font-semibold">Interest <span className="block font-bold"><Money cents={result.totalInterestCents} /></span></p></div>
      </section>

      <section className="min-w-0 border-t border-[var(--border-default)] pt-5" aria-labelledby="schedule-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="schedule-heading" className="text-lg font-bold">Repayment schedule</h2><p className="text-sm text-[var(--color-text-muted)]">{result.termMonths} monthly payments</p></div>
        <div className="mt-3 hidden overflow-x-auto md:block">
          <table className="w-full border-collapse text-left text-sm"><thead><tr className="border-b border-[var(--border-default)] text-xs text-[var(--color-text-muted)]"><th scope="col" className="px-2 py-3">Month</th><th scope="col" className="px-2 py-3 text-right">Payment</th><th scope="col" className="px-2 py-3 text-right">Interest</th><th scope="col" className="px-2 py-3 text-right">Principal</th><th scope="col" className="px-2 py-3 text-right">Balance</th></tr></thead><tbody>{result.schedule.slice(0, visibleRows).map(row => <tr key={row.month} className="border-b border-[var(--border-subtle)]"><th scope="row" className="px-2 py-3 font-semibold">{row.month}</th><td className="px-2 py-3 text-right tabular-nums"><Money cents={row.paymentCents} /></td><td className="px-2 py-3 text-right tabular-nums"><Money cents={row.interestCents} /></td><td className="px-2 py-3 text-right tabular-nums"><Money cents={row.principalCents} /></td><td className="px-2 py-3 text-right tabular-nums"><Money cents={row.balanceCents} /></td></tr>)}</tbody></table>
        </div>
        <div className="mt-3 grid gap-2 md:hidden">{result.schedule.slice(0, visibleRows).map(row => <article key={row.month} className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] p-3"><div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2"><h3 className="font-bold">Month {row.month}</h3><p className="font-bold tabular-nums"><Money cents={row.paymentCents} /></p></div><dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3"><div><dt className="text-[var(--color-text-muted)]">Interest</dt><dd className="mt-1 break-all font-semibold tabular-nums"><Money cents={row.interestCents} /></dd></div><div><dt className="text-[var(--color-text-muted)]">Principal</dt><dd className="mt-1 break-all font-semibold tabular-nums"><Money cents={row.principalCents} /></dd></div><div className="col-span-2 sm:col-span-1"><dt className="text-[var(--color-text-muted)]">Balance</dt><dd className="mt-1 break-all font-semibold tabular-nums"><Money cents={row.balanceCents} /></dd></div></dl></article>)}</div>
        {visibleRows < result.schedule.length && <button type="button" className="mt-3 min-h-11 rounded-lg border-2 border-[var(--border-default)] px-4 py-2 text-sm font-bold hover:bg-[var(--surface-interactive)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]" onClick={() => setVisibleRows(count => Math.min(count + 12, result.schedule.length))}>Show more months ({result.schedule.length - visibleRows} remaining)</button>}
      </section>

      <details className="border-t border-[var(--border-default)] pt-4">
        <summary className="min-h-11 py-2 font-bold">How this is calculated</summary>
        <div className="space-y-3 pb-2 text-sm leading-6 text-[var(--color-text-secondary)]">
          {result.method === 'FLAT' ? <p>Interest is calculated using the original loan amount for the entire repayment period. The interest and principal are spread across installments, with any rounding remainder settled in the final payment.</p> : <><p>Each month's interest is calculated from the outstanding balance, so the interest portion generally falls as principal is repaid.</p><p>The annual rate is treated as a nominal rate divided by 12 for monthly amortization. This estimate does not reproduce every lender's APR calculation; fees, compounding, payment timing, promotional periods, and irregular dates can change actual payments.</p></>}
          <p>Amounts are rounded to pennies for scheduled payments. The final installment is adjusted so the balance reaches £0.00.</p>
        </div>
      </details>
    </>}
  </div>;
}
