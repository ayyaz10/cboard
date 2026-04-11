import { PageShell } from './PageShell';

export function ToolLayout({ activeCalculator, roadmapTools, children }) {
  return (
    <PageShell>
        <section className="panel p-6 sm:p-8 lg:p-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <a href="#/" className="pill bg-white">
                All calculators
              </a>
              <span className="pill">{activeCalculator.eyebrow}</span>
            </div>
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">
              {activeCalculator.boardLabel}
            </span>
          </div>

          <h1 className="mt-6 max-w-3xl text-4xl font-bold tracking-[-0.05em] text-black sm:text-5xl lg:text-6xl">
            {activeCalculator.name}
          </h1>

          <p className="mt-3 max-w-xl text-base font-medium leading-7 text-black/70 sm:text-lg">
            {activeCalculator.description}
          </p>

          <div className="mt-8">{children}</div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <article className="note-card bg-[#fff0b8]">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">
              Formula
            </p>

            <div className="mt-4 space-y-3 text-sm font-medium leading-6 text-black/75">
              {activeCalculator.formula.map((step) => (
                <p key={step}>{step}</p>
              ))}
            </div>
          </article>

          <article className="note-card bg-[#ff90e8]">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">
              Example
            </p>
            <p className="mt-4 text-lg font-bold text-black">{activeCalculator.example.total}</p>
            <p className="mt-2 text-sm font-medium text-black/75">
              {activeCalculator.example.desired}
            </p>
          </article>

          <article className="note-card bg-[#c5ff6f]">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">
              Next
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {roadmapTools.map((tool) => (
                <span key={tool} className="tag">
                  {tool}
                </span>
              ))}
            </div>
          </article>
        </section>
    </PageShell>
  );
}
