import { formatGoalTarget, goalTypePresets } from './progressTrackerStorage';

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  return Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function getCurrentProgress(goal, entries) {
  const mainMetric = goal.metrics[0];

  if (!mainMetric) {
    return null;
  }

  const latestEntry = entries
    .filter((entry) => entry.goalId === goal.id)
    .sort((leftEntry, rightEntry) => {
      const dateCompare = rightEntry.date.localeCompare(leftEntry.date);
      return dateCompare || rightEntry.createdAt.localeCompare(leftEntry.createdAt);
    })
    .find((entry) => Number.isFinite(entry.values?.[mainMetric.id]));

  if (!latestEntry) {
    return null;
  }

  const value = latestEntry.values[mainMetric.id];
  const unit = mainMetric.unit || goal.unit;
  const hasTarget = Number.isFinite(goal.targetValue) && goal.targetValue > 0;

  return {
    value,
    unit,
    percentage: hasTarget ? Math.round((value / goal.targetValue) * 100) : null,
  };
}

export function GoalList({
  goals,
  selectedGoalId,
  entries,
  onSelectGoal,
  onDeleteGoal,
}) {
  return (
    <section className="rounded-[1.75rem] border-2 border-black bg-[#fff0b8] p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">
            Goals
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-black">
            Tracker list
          </h2>
        </div>
        <span className="rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-black">
          {goals.length}
        </span>
      </div>

      {goals.length === 0 ? (
        <div className="mt-5 rounded-[1.35rem] border-2 border-black bg-white px-4 py-5 text-sm font-bold leading-6 text-black/70">
          No goals yet. Create one to unlock the dashboard.
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          {goals.map((goal) => {
            const isSelected = goal.id === selectedGoalId;
            const entryCount = entries.filter(
              (entry) => entry.goalId === goal.id,
            ).length;
            const currentProgress = getCurrentProgress(goal, entries);

            return (
              <article
                key={goal.id}
                className={`rounded-[1.35rem] border-2 border-black p-4 ${
                  isSelected ? 'bg-[#ff90e8]' : 'bg-[#fffdf8]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onSelectGoal(goal.id)}
                    className="min-w-0 text-left"
                  >
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-black/55">
                      {goalTypePresets[goal.type]?.label || goal.type}
                    </p>
                    <h3 className="mt-1 break-words text-xl font-bold tracking-[-0.04em] text-black">
                      {goal.title}
                    </h3>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteGoal(goal.id)}
                    className="shrink-0 rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-black"
                  >
                    Delete
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-black">
                    {formatGoalTarget(goal)}
                  </span>
                  <span className="rounded-full border-2 border-black bg-[#c5ff6f] px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-black">
                    Current{' '}
                    {currentProgress
                      ? `${formatNumber(currentProgress.value)} ${currentProgress.unit}`.trim()
                      : '--'}
                  </span>
                  {currentProgress?.percentage !== null && currentProgress?.percentage !== undefined ? (
                    <span className="rounded-full border-2 border-black bg-[#9fe3ff] px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-black">
                      {currentProgress.percentage}% of goal
                    </span>
                  ) : null}
                  <span className="rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-black">
                    {entryCount} entr{entryCount === 1 ? 'y' : 'ies'}
                  </span>
                  {goal.deadline ? (
                    <span className="rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-black">
                      Due {goal.deadline}
                    </span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
