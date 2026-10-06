import { buildFocusStats } from './focusTimerHelpers';

function formatAverage(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '--';
}

function StatCard({ label, value, detail, colorKey = 'neutral' }) {
  return (
    <article
      className="ui-card tracker-stat-card flex min-h-32 flex-col justify-between p-4"
      data-stat-color={colorKey}
    >
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
        {label}
      </p>
      <p className="mt-3 break-words text-4xl font-bold tracking-[-0.05em] text-[var(--color-text)]">
        {value}
      </p>
      <p className="mt-3 border-t-2 border-[var(--color-border)] pt-3 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
        {detail}
      </p>
    </article>
  );
}

export function FocusStats({ sessions, breakTasksBySessionId }) {
  const stats = buildFocusStats(sessions, breakTasksBySessionId);

  return (
    <section className="ui-panel p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
            Dashboard
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-[var(--color-text)]">
            Focus stats
          </h2>
        </div>
        <span className="ui-badge ui-badge--accent text-xs uppercase tracking-[0.14em]">
          Today / week
        </span>
      </div>

      <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3">
        <StatCard
          label="Today sessions"
          value={stats.today.completedSessions}
          detail="completed sessions"
          colorKey="accent"
        />
        <StatCard
          label="Today focus"
          value={stats.today.totalFocusMinutes}
          detail="minutes focused"
          colorKey="info"
        />
        <StatCard
          label="Breaks"
          value={stats.today.breaksCompleted}
          detail="completed today"
          colorKey="success"
        />
        <StatCard
          label="Distraction"
          value={formatAverage(stats.today.averageDistraction)}
          detail="daily average"
          colorKey="warning"
        />
        <StatCard
          label="Focus score"
          value={stats.today.focusScore}
          detail="simple score"
          colorKey="neutral"
        />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <StatCard
          label="Week focus"
          value={stats.week.totalFocusMinutes}
          detail="minutes this week"
          colorKey="accent"
        />
        <StatCard
          label="Week sessions"
          value={stats.week.completedSessions}
          detail="completed this week"
          colorKey="info"
        />
        <StatCard
          label="Best day"
          value={stats.week.bestFocusDay}
          detail="highest weekly minutes"
          colorKey="neutral"
        />
      </div>
    </section>
  );
}
