import { formatGoalTarget, getTodayInputValue } from './progressTrackerStorage';
import { getProgressFromStart } from './progressCalculations';

function getMetricValues(entries, metricId) {
  return entries
    .map((entry) => entry.values?.[metricId])
    .filter((value) => Number.isFinite(value));
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  return Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function getPreviousDate(dateValue) {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() - 1);
  return getTodayInputValue(date);
}

function getCurrentStreak(entries) {
  if (entries.length === 0) {
    return 0;
  }

  const dates = new Set(entries.map((entry) => entry.date));
  let cursor = getTodayInputValue();
  let streak = 0;

  if (!dates.has(cursor)) {
    cursor = [...dates].sort().at(-1);
  }

  while (cursor && dates.has(cursor)) {
    streak += 1;
    cursor = getPreviousDate(cursor);
  }

  return streak;
}

export function GoalStats({ goal, entries }) {
  if (!goal) {
    return (
      <section className="rounded-[1.75rem] border-2 border-black bg-[#fffdf8] p-5 sm:p-6">
        <span className="pill">Dashboard</span>
        <h2 className="mt-4 text-3xl font-bold tracking-[-0.05em] text-black">
          Select or create a goal
        </h2>
        <p className="mt-3 text-sm font-semibold leading-6 text-black/65">
          Your target card, stats, streak, and chart will appear here.
        </p>
      </section>
    );
  }

  const sortedEntries = [...entries].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const mainMetric = goal.metrics[0];
  const values = mainMetric ? getMetricValues(sortedEntries, mainMetric.id) : [];
  const latestEntry = [...sortedEntries]
    .reverse()
    .find((entry) => Number.isFinite(entry.values?.[mainMetric?.id]));
  const latestValue = latestEntry?.values?.[mainMetric?.id];
  const latestUnit = mainMetric?.unit || goal.unit;
  const bestValue = values.length > 0 ? Math.max(...values) : null;
  const averageValue =
    values.length > 0
      ? values.reduce((total, value) => total + value, 0) / values.length
      : null;
  const hasTarget = Number.isFinite(goal.targetValue);
  const fallbackMax = Number.isFinite(bestValue) && bestValue > 0 ? bestValue : 0;
  const progressBase = hasTarget ? goal.targetValue : fallbackMax;
  const progressPercentage =
    hasTarget
      ? getProgressFromStart(goal, sortedEntries, mainMetric?.id)
      : Number.isFinite(latestValue) && progressBase > 0
      ? Math.min(999, Math.round((latestValue / progressBase) * 100))
      : null;
  const streak = getCurrentStreak(sortedEntries);

  const statCards = [
    {
      label: 'Latest',
      value: formatNumber(latestValue),
      detail: latestEntry ? latestEntry.date : mainMetric?.name || 'No entries',
      color: '#c5ff6f',
    },
    {
      label: 'Best',
      value: formatNumber(bestValue),
      detail: mainMetric?.name || 'Primary metric',
      color: '#9fe3ff',
    },
    {
      label: 'Average',
      value: formatNumber(averageValue),
      detail: values.length ? `${values.length} logged value${values.length === 1 ? '' : 's'}` : 'No data yet',
      color: '#ff90e8',
    },
    {
      label: hasTarget ? 'Progress' : 'Best match',
      value: progressPercentage === null ? '--' : `${progressPercentage}%`,
      detail: hasTarget ? 'From first log to target' : 'Against best value',
      color: '#ffd166',
    },
    {
      label: 'Streak',
      value: `${streak}`,
      detail: `day${streak === 1 ? '' : 's'} with entries`,
      color: '#fffdf8',
    },
  ];

  return (
    <section className="rounded-[1.75rem] border-2 border-black bg-[#fffdf8] p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">
            Dashboard
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-[-0.05em] text-black sm:text-4xl">
            {goal.title}
          </h2>
        </div>
        <span className="rounded-full border-2 border-black bg-[#c5ff6f] px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-black">
          {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
        </span>
      </div>

      <article className="mt-5 rounded-[1.5rem] border-2 border-black bg-black p-5 text-white">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">
          Target goal
        </p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-4xl font-bold tracking-[-0.05em]">
              {formatGoalTarget(goal)}
            </p>
            <p className="mt-2 text-sm font-bold uppercase tracking-[0.14em] text-white/70">
              Current progress:{' '}
              {Number.isFinite(latestValue)
                ? `${formatNumber(latestValue)} ${latestUnit}`.trim()
                : '--'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {hasTarget && progressPercentage !== null ? (
              <span className="rounded-full border-2 border-white bg-[#c5ff6f] px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-black">
                {progressPercentage}% from start
              </span>
            ) : null}
            {goal.deadline ? (
              <span className="rounded-full border-2 border-white bg-[#ffd166] px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-black">
                Due {goal.deadline}
              </span>
            ) : null}
          </div>
        </div>
      </article>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {statCards.map((stat) => (
          <article
            key={stat.label}
            className="rounded-[1.35rem] border-2 border-black p-4"
            style={{ backgroundColor: stat.color }}
          >
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-black/55">
              {stat.label}
            </p>
            <p className="mt-2 break-words text-3xl font-bold tracking-[-0.05em] text-black">
              {stat.value}
            </p>
            <p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-black/55">
              {stat.detail}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
