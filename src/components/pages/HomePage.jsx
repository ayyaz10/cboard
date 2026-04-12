import { PageShell } from '../layout/PageShell';
import { CalculatorBoardCard } from '../ui/CalculatorBoardCard';

export function HomePage({ calculators }) {
  return (
    <PageShell>
      <section className="panel p-6 sm:p-8 lg:p-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="pill">Calculator board</span>
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">
            {calculators.length} live tool{calculators.length === 1 ? '' : 's'}
          </span>
        </div>

        <h1 className="mt-6 max-w-3xl text-4xl font-bold tracking-[-0.05em] text-black sm:text-5xl lg:text-6xl">
          Choose a calculator
        </h1>

        <p className="mt-3 max-w-2xl text-base font-medium leading-7 text-black/70 sm:text-lg">
          Open any tool from the board.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {calculators.map((calculator, index) => (
            <CalculatorBoardCard
              key={calculator.id}
              calculator={calculator}
              index={index}
            />
          ))}
        </div>
      </section>
    </PageShell>
  );
}
