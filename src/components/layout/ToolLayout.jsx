import { AppNavigation } from './AppNavigation';
import { PageShell } from './PageShell';

export function ToolLayout({ activeCalculator, calculators, children }) {
  return (
    <PageShell>
      <section className="panel p-6 sm:p-8 lg:p-10">
        <AppNavigation
          activePath={activeCalculator.path}
          extraItems={calculators.map((calculator) => ({
            path: calculator.path,
            label: calculator.name,
          }))}
        />

        <h1 className="mt-7 max-w-3xl text-4xl font-bold tracking-[-0.05em] text-black sm:text-5xl lg:text-6xl">
          {activeCalculator.name}
        </h1>

        {activeCalculator.description ? (
          <p className="mt-3 max-w-xl text-base font-medium leading-7 text-black/70 sm:text-lg">
            {activeCalculator.description}
          </p>
        ) : null}

        <div className="mt-8">{children}</div>
      </section>

      {activeCalculator.showReferenceCards ? (
        <section className="grid gap-4 md:grid-cols-2">
          <article className="rounded-[1.75rem] border-2 border-black bg-[#fff0b8] p-5 sm:p-6">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">
              Formula
            </p>

            <div className="mt-4 space-y-3 text-sm font-medium leading-7 text-black/75 sm:text-base">
              {activeCalculator.formula.map((step) => (
                <p key={step}>{step}</p>
              ))}
            </div>
          </article>

          <article className="rounded-[1.75rem] border-2 border-black bg-[#ff90e8] p-5 sm:p-6">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">
              Example
            </p>
            <p className="mt-4 text-2xl font-bold tracking-[-0.03em] text-black sm:text-3xl">
              {activeCalculator.example.total}
            </p>
            <p className="mt-4 text-lg font-medium text-black/85">
              {activeCalculator.example.desired}
            </p>
          </article>
        </section>
      ) : null}
    </PageShell>
  );
}
