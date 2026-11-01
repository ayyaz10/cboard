export function ResultPanel({ result, className = '' }) {
  if (!result) {
    return (
      <aside
        aria-live="polite"
        className={`rounded-[2rem] border-2 border-[var(--border-default)] bg-[#ff90e8] p-6 text-[var(--color-text)] sm:p-7 ${className}`}
      >
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
          Result
        </p>

        <p className="mt-6 text-6xl font-bold tracking-[-0.06em] text-[var(--color-text)] sm:text-7xl">
          --
        </p>
        <p className="mt-3 text-sm font-bold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">
          Fill the form
        </p>
      </aside>
    );
  }

  return (
    <aside
      aria-live="polite"
      className={`rounded-[2rem] border-2 border-[var(--border-default)] bg-[#ff90e8] p-6 text-[var(--color-text)] sm:p-7 ${className}`}
    >
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
        Result
      </p>

      <p className="mt-6 text-6xl font-bold tracking-[-0.06em] text-[var(--color-text)] sm:text-7xl">
        {result.formattedCalculatedCalories}
      </p>
      <p className="mt-3 text-sm font-bold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">
        calories
      </p>

      <div className="mt-6 grid gap-3">
        <div className="rounded-[1.4rem] border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] p-4">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
            Per unit
          </p>
          <p className="mt-2 text-xl font-bold text-[var(--color-text)]">
            {result.formattedCaloriesPerUnit}
          </p>
        </div>

        <div className="rounded-[1.4rem] border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] p-4">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
            Desired quantity
          </p>
          <p className="mt-2 text-xl font-bold text-[var(--color-text)]">
            {result.formattedDesiredQuantity}
          </p>
        </div>
      </div>

      <p className="mt-6 text-sm font-medium leading-7 text-[var(--color-text-secondary)]">
        Calculation: {result.formulaText}
      </p>
    </aside>
  );
}
