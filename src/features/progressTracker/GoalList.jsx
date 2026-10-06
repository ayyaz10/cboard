import { useState } from 'react';
import {
  formatGoalTarget,
  getGoalType,
  goalBehaviorTypes,
  goalTypePresets,
} from './progressTrackerStorage';
import {
  calculateAccumulativeStats,
  calculateBinaryStats,
  calculatePerformanceStats,
  formatTrackerNumber,
} from './progressCalculations';

function getCurrentSummary(goal, entries) {
  const goalEntries = entries.filter((entry) => entry.goalId === goal.id);
  const goalType = getGoalType(goal);

  if (goalType === 'binary') {
    const stats = calculateBinaryStats(goal, goalEntries);
    const unit = goal.unit || 'points';

    return {
      current: `Current: ${formatTrackerNumber(stats.totalScore)} ${unit}`.trim(),
      target: Number.isFinite(goal.targetValue)
        ? `Goal: ${formatTrackerNumber(goal.targetValue)} ${unit}`.trim()
        : '',
      percentage: stats.progressPercentage,
    };
  }

  if (goalType === 'accumulative') {
    const stats = calculateAccumulativeStats(goal, goalEntries);
    const unit = stats.unit || goal.unit;

    return {
      current: `Current: ${formatTrackerNumber(stats.totalValue)}`,
      target: Number.isFinite(goal.targetValue)
        ? `Goal: ${formatTrackerNumber(goal.targetValue)} ${unit}`.trim()
        : '',
      percentage: stats.progressPercentage,
    };
  }

  const stats = calculatePerformanceStats(goal, goalEntries);
  const unit = stats.unit || goal.unit;

  return {
    current: Number.isFinite(stats.latestValue)
      ? `Current: ${formatTrackerNumber(stats.latestValue)} ${unit}`.trim()
      : 'No entries yet',
    target: Number.isFinite(goal.targetValue)
      ? `Goal: ${formatTrackerNumber(goal.targetValue)} ${unit}`.trim()
      : '',
    percentage: stats.progressPercentage,
  };
}

function ProgressStrip({ percentage }) {
  const width = Number.isFinite(percentage) ? Math.min(100, Math.max(0, percentage)) : 0;

  return (
    <div className="ui-progress-track">
      <div className="ui-progress-fill" style={{ width: `${width}%` }} />
    </div>
  );
}

function reorderItems(items, activeId, overId) {
  if (!activeId || !overId || activeId === overId) {
    return items;
  }

  const fromIndex = items.findIndex((item) => item.id === activeId);
  const toIndex = items.findIndex((item) => item.id === overId);

  if (fromIndex === -1 || toIndex === -1) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
}

function isInteractiveTarget(target) {
  return Boolean(
    target.closest?.('button, input, select, textarea, a, [data-no-drag="true"]'),
  );
}

export function GoalList({
  goals,
  selectedGoalId,
  entries,
  onSelectGoal,
  onEditGoal,
  onLogGoal,
  onReorderGoals,
}) {
  const [draggedGoalId, setDraggedGoalId] = useState('');
  const [dragOverGoalId, setDragOverGoalId] = useState('');

  function handleCardKeyDown(event, goalId) {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    onSelectGoal(goalId);
  }

  function handleDrop(event, overGoalId) {
    event.preventDefault();
    event.stopPropagation();
    const activeGoalId = draggedGoalId || event.dataTransfer.getData('text/plain');
    const nextGoals = reorderItems(goals, activeGoalId, overGoalId);
    setDraggedGoalId('');
    setDragOverGoalId('');

    if (nextGoals !== goals) {
      onReorderGoals(nextGoals);
    }
  }

  return (
    <section className="ui-panel tracker-goal-list p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">
            Goals
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-black">
            Tracker list
          </h2>
        </div>
        <span className="ui-badge">
          {goals.length}
        </span>
      </div>

      {goals.length === 0 ? (
        <div className="ui-card mt-5 px-4 py-5 text-sm font-bold leading-6">
          No goals yet. Create one to unlock the dashboard.
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          {goals.map((goal) => {
            const isSelected = goal.id === selectedGoalId;
            const isDragging = draggedGoalId === goal.id;
            const isDropTarget = dragOverGoalId === goal.id && draggedGoalId !== goal.id;
            const goalType = getGoalType(goal);
            const summary = getCurrentSummary(goal, entries);

            return (
              <article
                key={goal.id}
                role="button"
                tabIndex={0}
                draggable
                onClick={() => onSelectGoal(goal.id)}
                onKeyDown={(event) => handleCardKeyDown(event, goal.id)}
                onDragStart={(event) => {
                  if (isInteractiveTarget(event.target)) {
                    event.preventDefault();
                    return;
                  }

                  setDraggedGoalId(goal.id);
                  setDragOverGoalId('');
                  event.dataTransfer.setData('text/plain', goal.id);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (draggedGoalId && draggedGoalId !== goal.id) {
                    setDragOverGoalId(goal.id);
                  }
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setDragOverGoalId((currentGoalId) =>
                      currentGoalId === goal.id ? '' : currentGoalId,
                    );
                  }
                }}
                onDrop={(event) => handleDrop(event, goal.id)}
                onDragEnd={() => {
                  setDraggedGoalId('');
                  setDragOverGoalId('');
                }}
                aria-pressed={isSelected}
                className={`ui-card tracker-goal-card group relative p-4 outline-none transition ${
                  isSelected ? 'is-selected' : ''
                } ${
                  isDragging ? 'is-dragging' : ''
                } ${
                  isDropTarget ? 'is-drop-target' : ''
                }`}
              >
                {isDropTarget ? (
                  <span className="ui-badge pointer-events-none absolute -top-3 left-5 text-[0.65rem] font-bold uppercase tracking-[0.14em] shadow-[var(--shadow-sm)]">
                    Drop here
                  </span>
                ) : null}
                <div className="flex items-start gap-3">
                  <span
                    role="button"
                    tabIndex={0}
                    draggable
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    onDragStart={(event) => {
                      setDraggedGoalId(goal.id);
                      setDragOverGoalId('');
                      event.dataTransfer.setData('text/plain', goal.id);
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    className={`ui-badge tracker-goal-drag mt-1 shrink-0 cursor-grab px-2 py-1 text-xs font-bold uppercase tracking-[0.08em] transition active:cursor-grabbing ${
                      isDragging ? 'is-dragging' : ''
                    }`}
                    title="Drag to reorder"
                  >
                    ::
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-black/55">
                          {goalBehaviorTypes[goalType].shortLabel} - {goalTypePresets[goal.type]?.label || goal.type}
                        </p>
                        <h3 className="mt-1 break-words text-xl font-bold tracking-[-0.04em] text-black">
                          {goal.title}
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onEditGoal(goal);
                        }}
                        className="ui-button ui-button--sm shrink-0 text-xs uppercase tracking-[0.12em]"
                      >
                        Edit
                      </button>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="ui-badge ui-badge--accent text-xs uppercase tracking-[0.12em]">
                        {summary.current}
                      </span>
                      {summary.target ? (
                        <span className="ui-badge ui-badge--warning text-xs uppercase tracking-[0.12em]">
                          {summary.target}
                        </span>
                      ) : goalType !== 'binary' ? (
                        <span className="ui-badge text-xs uppercase tracking-[0.12em]">
                          {formatGoalTarget(goal)}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-3 grid gap-2">
                      <ProgressStrip percentage={summary.percentage} />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-bold uppercase tracking-[0.12em] text-black/55">
                          {Number.isFinite(summary.percentage) ? `${summary.percentage}% progress` : 'Progress pending'}
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold uppercase tracking-[0.12em] text-black/55">
                            {goal.allowMultipleEntriesPerDay ? 'Multi-entry' : 'Daily entry'}
                          </span>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onLogGoal(goal.id);
                            }}
                            className="ui-button ui-button--primary ui-button--sm text-xs uppercase tracking-[0.12em]"
                          >
                            Add log
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
