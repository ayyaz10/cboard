import { formatGoalTarget, getGoalType, goalBehaviorTypes } from './progressTrackerStorage';
import {
  calculateAccumulativeStats,
  calculateBinaryStats,
  calculatePerformanceStats,
  formatTrackerNumber,
} from './progressCalculations';

function formatSignedNumber(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  const prefix = value > 0 ? '+' : '';
  return `${prefix}${formatTrackerNumber(value)}`;
}

function ProgressBar({ percentage }) {
  const width = Number.isFinite(percentage) ? Math.min(100, Math.max(0, percentage)) : 0;

  return (
    <div className="ui-progress-track mt-4 h-4">
      <div className="ui-progress-fill" style={{ width: `${width}%` }} />
    </div>
  );
}

function StatGrid({ stats }) {
  return (
    <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(13.5rem,1fr))] gap-3">
      {stats.map((stat) => {
        const colorKey = stat.colorKey || 'neutral';

        return (
          <article
            key={stat.label}
            className="ui-card tracker-stat-card flex min-h-36 flex-col justify-between p-4"
            data-stat-color={colorKey}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-black/55">
                {stat.label}
              </p>
              {stat.unit ? (
                <span className="ui-badge shrink-0 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.1em]">
                  {stat.unit}
                </span>
              ) : null}
            </div>
            <p className="mt-3 break-words text-4xl font-bold tracking-[-0.05em] text-black">
              {stat.value}
            </p>
            <div className="mt-3 border-t-2 border-black/15 pt-3">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-black/55">
                {stat.detail}
              </p>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function TargetSummary({ label, heading, detail, percentage, deadline }) {
  return (
    <article className="ui-card tracker-target-summary mt-5 p-5">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
        {label}
      </p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-4xl font-bold tracking-[-0.05em]">
            {heading}
          </p>
          <p className="mt-2 text-sm font-bold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
            {detail}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {Number.isFinite(percentage) ? (
            <span className="ui-badge ui-badge--success text-xs uppercase tracking-[0.14em]">
              {percentage}% complete
            </span>
          ) : null}
          {deadline ? (
            <span className="ui-badge ui-badge--warning text-xs uppercase tracking-[0.14em]">
              Due {deadline}
            </span>
          ) : null}
        </div>
      </div>
      {Number.isFinite(percentage) ? <ProgressBar percentage={percentage} /> : null}
    </article>
  );
}

function buildPerformanceDashboard(goal, entries) {
  const stats = calculatePerformanceStats(goal, entries);
  const unit = stats.unit;
  const isLowerTarget =
    Number.isFinite(stats.startValue)
    && Number.isFinite(goal.targetValue)
    && goal.targetValue < stats.startValue;
  const movedTowardTarget =
    Number.isFinite(stats.trendValue)
    && stats.trendValue !== 0
    && (isLowerTarget ? stats.trendValue < 0 : stats.trendValue > 0);
  const trendDetail =
    Number.isFinite(stats.trendValue) && stats.trendValue !== 0
      ? movedTowardTarget
        ? 'Moved toward target'
        : 'Moved away from target'
      : 'Needs two logs';
  const startDetail = Number.isFinite(stats.startValue)
    ? ` - Start: ${formatTrackerNumber(stats.startValue)} ${unit}`.trimEnd()
    : '';

  return {
    target: (
      <TargetSummary
        label="Current capability"
        heading={formatGoalTarget(goal)}
        detail={`Latest: ${
          Number.isFinite(stats.latestValue)
            ? `${formatTrackerNumber(stats.latestValue)} ${unit}`.trim()
            : '--'
        }${startDetail}`}
        percentage={stats.progressPercentage}
        deadline={goal.deadline}
      />
    ),
    cards: [
      {
        label: 'Latest',
        value: formatTrackerNumber(stats.latestValue),
        unit,
        detail: stats.latestEntry ? stats.latestEntry.date : stats.mainMetric?.name || 'No entries',
        colorKey: 'accent',
      },
      {
        label: 'Best',
        value: formatTrackerNumber(stats.bestValue),
        unit,
        detail: Number.isFinite(stats.startValue) ? 'Closest logged value to target' : stats.mainMetric?.name || 'Primary metric',
        colorKey: 'info',
      },
      {
        label: 'Average',
        value: formatTrackerNumber(stats.averageValue),
        unit,
        detail: stats.valueCount ? `${stats.valueCount} logged value${stats.valueCount === 1 ? '' : 's'}` : 'No data yet',
        colorKey: 'success',
      },
      {
        label: 'Trend',
        value: formatSignedNumber(stats.trendValue),
        unit,
        detail: trendDetail,
        colorKey: 'warning',
      },
      {
        label: 'Streak',
        value: `${stats.streak}`,
        unit: 'days',
        detail: `day${stats.streak === 1 ? '' : 's'} with entries`,
        colorKey: 'neutral',
      },
    ],
  };
}

function buildAccumulativeDashboard(goal, entries) {
  const stats = calculateAccumulativeStats(goal, entries);
  const unit = stats.unit || goal.unit;
  const totalLabel = `${formatTrackerNumber(stats.totalValue)} / ${formatTrackerNumber(goal.targetValue)} ${unit}`.trim();

  return {
    target: (
      <TargetSummary
        label="Completion progress"
        heading={Number.isFinite(goal.targetValue) ? totalLabel : `${formatTrackerNumber(stats.totalValue)} ${unit}`.trim()}
        detail={
          Number.isFinite(stats.progressPercentage)
            ? `${stats.progressPercentage}% of target completed`
            : 'Set a target to show completion percentage'
        }
        percentage={stats.progressPercentage}
        deadline={goal.deadline}
      />
    ),
    cards: [
      {
        label: 'Total',
        value: formatTrackerNumber(stats.totalValue),
        unit,
        detail: unit || 'Cumulative amount',
        colorKey: 'accent',
      },
      {
        label: 'Target',
        value: formatTrackerNumber(goal.targetValue),
        unit,
        detail: unit || 'Completion target',
        colorKey: 'info',
      },
      {
        label: 'Remaining',
        value: formatTrackerNumber(stats.remainingValue),
        unit,
        detail: unit || 'Left to complete',
        colorKey: 'success',
      },
      {
        label: 'Progress',
        value: Number.isFinite(stats.progressPercentage) ? `${stats.progressPercentage}%` : '--',
        detail: 'Based on cumulative total',
        colorKey: 'warning',
      },
      {
        label: 'Streak',
        value: `${stats.streak}`,
        unit: 'days',
        detail: `day${stats.streak === 1 ? '' : 's'} with activity`,
        colorKey: 'neutral',
      },
    ],
  };
}

function buildBinaryDashboard(goal, entries) {
  const stats = calculateBinaryStats(goal, entries);
  const unit = goal.unit || 'points';
  const targetLabel = Number.isFinite(goal.targetValue)
    ? `${formatTrackerNumber(stats.totalScore)} / ${formatTrackerNumber(goal.targetValue)} ${unit}`.trim()
    : `${formatTrackerNumber(stats.totalScore)} ${unit}`.trim();

  return {
    target: (
      <TargetSummary
        label="Binary score"
        heading={targetLabel}
        detail={
          Number.isFinite(stats.progressPercentage)
            ? `${stats.progressPercentage}% of target completed`
            : 'Set a target to show score progress'
        }
        percentage={stats.progressPercentage}
        deadline={goal.deadline}
      />
    ),
    cards: [
      {
        label: 'Score',
        value: formatTrackerNumber(stats.totalScore),
        unit,
        detail: `net ${formatSignedNumber(stats.scoreDelta)} from entries`,
        colorKey: 'accent',
      },
      {
        label: 'Target',
        value: formatTrackerNumber(goal.targetValue),
        unit,
        detail: unit || 'Binary target',
        colorKey: 'info',
      },
      {
        label: 'Remaining',
        value: formatTrackerNumber(stats.remainingValue),
        unit,
        detail: unit || 'Left to complete',
        colorKey: 'success',
      },
      {
        label: 'Streak',
        value: `${stats.streak}`,
        unit: 'days',
        detail: `completed day${stats.streak === 1 ? '' : 's'} in a row`,
        colorKey: 'warning',
      },
      {
        label: 'Completion',
        value: stats.completionRate === null ? '--' : `${stats.completionRate}%`,
        unit: 'rate',
        detail: `${stats.totalEntries} logged day${stats.totalEntries === 1 ? '' : 's'}`,
        colorKey: 'neutral',
      },
    ],
  };
}

export function GoalStats({ goal, entries }) {
  if (!goal) {
    return (
      <section className="ui-panel p-5 sm:p-6">
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

  const goalType = getGoalType(goal);
  const dashboard =
    goalType === 'accumulative'
      ? buildAccumulativeDashboard(goal, entries)
      : goalType === 'binary'
      ? buildBinaryDashboard(goal, entries)
      : buildPerformanceDashboard(goal, entries);

  return (
    <section className="ui-panel p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">
            Dashboard
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-[-0.05em] text-black sm:text-4xl">
            {goal.title}
          </h2>
        </div>
        <span className="ui-badge ui-badge--accent text-xs uppercase tracking-[0.14em]">
          {goalBehaviorTypes[goalType].shortLabel}
        </span>
      </div>

      {dashboard.target}
      <StatGrid stats={dashboard.cards} />
    </section>
  );
}
