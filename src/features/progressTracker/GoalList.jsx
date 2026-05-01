import { formatGoalTarget, goalTypePresets } from './progressTrackerStorage';
import { getProgressFromStart } from './progressCalculations';

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
  const goalEntries = entries.filter((entry) => entry.goalId === goal.id);

  return {
    value,
    unit,
    percentage: getProgressFromStart(goal, goalEntries, mainMetric.id),
  };
}

export function GoalList({
  goals,
  selectedGoalId,
  entries,
  onSelectGoal,
  onLogGoal,
  onDeleteGoal,
}) {
  function handleCardKeyDown(event, goalId) {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    onSelectGoal(goalId);
  }

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
                role="button"
                tabIndex={0}
                onClick={() => onSelectGoal(goal.id)}
                onKeyDown={(event) => handleCardKeyDown(event, goal.id)}
                className={`group cursor-pointer rounded-[1.35rem] border-2 border-black p-4 outline-none transition hover:-translate-y-1 hover:shadow-[7px_7px_0_#000] focus-visible:-translate-y-1 focus-visible:shadow-[7px_7px_0_#000] focus-visible:ring-2 focus-visible:ring-black ${
                  isSelected ? 'bg-[#ff90e8]' : 'bg-[#fffdf8]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 text-left">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-black/55">
                      {goalTypePresets[goal.type]?.label || goal.type}
                    </p>
                    <h3 className="mt-1 break-words text-xl font-bold tracking-[-0.04em] text-black">
                      {goal.title}
                    </h3>
                    <span className="mt-2 inline-flex items-center rounded-full border-2 border-black bg-[#9fe3ff] px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-black shadow-[2px_2px_0_#000] transition group-hover:translate-x-1">
                      View details -&gt;
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteGoal(goal.id);
                    }}
                    className="shrink-0 rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-black transition hover:bg-[#ffe0de]"
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
                      {currentProgress.percentage}% from start
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

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t-2 border-black/20 pt-4">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-black/55">
                    Dashboard
                  </p>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onLogGoal(goal.id);
                    }}
                    className="inline-flex items-center justify-center rounded-full border-2 border-black bg-black px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-white shadow-[3px_3px_0_#c5ff6f] transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[1px_1px_0_#c5ff6f]"
                  >
                    Add log
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
