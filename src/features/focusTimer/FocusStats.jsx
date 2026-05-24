import { buildFocusStats } from './focusTimerHelpers';

function formatAverage(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '--';
}

function StatCard({ label, value, detail, color = '#fffdf8', colorKey = 'paper' }) {
  return (
    <article
      className="tracker-stat-card flex min-h-32 flex-col justify-between rounded-[1.35rem] border-2 border-black p-4"
      data-stat-color={colorKey}
      style={{ backgroundColor: `var(--tracker-stat-${colorKey}, ${color})` }}
    >
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-black/55">
        {label}
      </p>
      <p className="mt-3 break-words text-4xl font-bold tracking-[-0.05em] text-black">
        {value}
      </p>
      <p className="mt-3 border-t-2 border-black/15 pt-3 text-xs font-bold uppercase tracking-[0.12em] text-black/55">
        {detail}
      </p>
    </article>
  );
}

export function FocusStats({ sessions, breakTasksBySessionId }) {
  const stats = buildFocusStats(sessions, breakTasksBySessionId);

  return (
    <section className="rounded-[1.75rem] border-2 border-black bg-[#fffdf8] p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">
            Dashboard
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-black">
            Focus stats
          </h2>
        </div>
        <span className="rounded-full border-2 border-black bg-[#c5ff6f] px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-black">
          Today / week
        </span>
      </div>

      <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3">
        <StatCard
          label="Today sessions"
          value={stats.today.completedSessions}
          detail="completed sessions"
          color="#c5ff6f"
          colorKey="lime"
        />
        <StatCard
          label="Today focus"
          value={stats.today.totalFocusMinutes}
          detail="minutes focused"
          color="#9fe3ff"
          colorKey="cyan"
        />
        <StatCard
          label="Breaks"
          value={stats.today.breaksCompleted}
          detail="completed today"
          color="#ff90e8"
          colorKey="pink"
        />
        <StatCard
          label="Distraction"
          value={formatAverage(stats.today.averageDistraction)}
          detail="daily average"
          color="#ffd166"
          colorKey="amber"
        />
        <StatCard
          label="Focus score"
          value={stats.today.focusScore}
          detail="simple score"
          color="#fffdf8"
          colorKey="paper"
        />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <StatCard
          label="Week focus"
          value={stats.week.totalFocusMinutes}
          detail="minutes this week"
          color="#c5ff6f"
          colorKey="lime"
        />
        <StatCard
          label="Week sessions"
          value={stats.week.completedSessions}
          detail="completed this week"
          color="#9fe3ff"
          colorKey="cyan"
        />
        <StatCard
          label="Best day"
          value={stats.week.bestFocusDay}
          detail="highest weekly minutes"
          color="#fffdf8"
          colorKey="paper"
        />
      </div>
    </section>
  );
}
