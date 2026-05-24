export const focusSessionStatuses = {
  activeFocus: 'active_focus',
  pausedFocus: 'paused_focus',
  focusComplete: 'focus_complete',
  activeBreak: 'active_break',
  pausedBreak: 'paused_break',
  completed: 'completed',
  cancelled: 'cancelled',
  skippedBreak: 'skipped_break',
  missed: 'missed',
};

export const activeFocusStatuses = [
  focusSessionStatuses.activeFocus,
  focusSessionStatuses.pausedFocus,
  focusSessionStatuses.focusComplete,
  focusSessionStatuses.activeBreak,
  focusSessionStatuses.pausedBreak,
];

export function clampNumber(value, min, max) {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    return min;
  }

  return Math.min(max, Math.max(min, parsedValue));
}

export function formatTimer(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatSessionDate(value) {
  if (!value) {
    return 'Not started';
  }

  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getPhaseRemainingSeconds(session, nowMs = Date.now()) {
  if (!session) {
    return 0;
  }

  const isBreak = [
    focusSessionStatuses.activeBreak,
    focusSessionStatuses.pausedBreak,
  ].includes(session.status);
  const fallbackSeconds = (isBreak ? session.breakMinutes : session.focusMinutes) * 60;
  const storedRemaining = Number.isFinite(
    isBreak ? session.breakRemainingSeconds : session.focusRemainingSeconds,
  )
    ? isBreak ? session.breakRemainingSeconds : session.focusRemainingSeconds
    : fallbackSeconds;
  const isRunning = [
    focusSessionStatuses.activeFocus,
    focusSessionStatuses.activeBreak,
  ].includes(session.status);

  if (!isRunning || !session.phaseStartedAt) {
    return Math.max(0, storedRemaining);
  }

  const elapsedSeconds = Math.floor(
    (nowMs - new Date(session.phaseStartedAt).getTime()) / 1000,
  );

  return Math.max(0, storedRemaining - elapsedSeconds);
}

export function calculateFocusScore(session, breakTasks = []) {
  if (!session) {
    return 0;
  }

  let score = 0;

  if (session.status === focusSessionStatuses.completed) {
    score += 45;
  }

  if (session.reflectionResult === 'yes') {
    score += 25;
  } else if (session.reflectionResult === 'partially') {
    score += 12;
  }

  if (Number.isFinite(session.distractionLevel)) {
    score += Math.max(0, 6 - session.distractionLevel) * 4;
  }

  if (breakTasks.length > 0) {
    const completedTasks = breakTasks.filter((task) => task.isCompleted).length;
    score += Math.round((completedTasks / breakTasks.length) * 10);
  }

  return Math.min(100, Math.max(0, score));
}

export function getSessionBreakTaskSummary(breakTasks = []) {
  const total = breakTasks.length;
  const completed = breakTasks.filter((task) => task.isCompleted).length;

  return { completed, total };
}

export function buildFocusStats(sessions, breakTasksBySessionId = {}) {
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  const completedSessions = sessions.filter(
    (session) => session.status === focusSessionStatuses.completed,
  );
  const todaySessions = completedSessions.filter((session) =>
    (session.completedAt || session.createdAt || '').slice(0, 10) === todayKey,
  );
  const weekSessions = completedSessions.filter((session) => {
    const completedAt = session.completedAt || session.createdAt;
    return completedAt && new Date(completedAt) >= weekStart;
  });
  const todayDistractions = todaySessions
    .map((session) => session.distractionLevel)
    .filter(Number.isFinite);
  const focusMinutes = (items) =>
    items.reduce((total, session) => total + (session.focusMinutes || 0), 0);
  const breakCompletedCount = (items) =>
    items.filter((session) => Boolean(session.breakEndedAt)).length;
  const averageDistraction =
    todayDistractions.length > 0
      ? todayDistractions.reduce((total, value) => total + value, 0) / todayDistractions.length
      : null;
  const dayTotals = weekSessions.reduce((totals, session) => {
    const dayKey = (session.completedAt || session.createdAt || '').slice(0, 10);
    totals[dayKey] = (totals[dayKey] || 0) + (session.focusMinutes || 0);
    return totals;
  }, {});
  const bestFocusDay = Object.entries(dayTotals).sort((left, right) => right[1] - left[1])[0];
  const scoredToday = todaySessions.map((session) =>
    calculateFocusScore(session, breakTasksBySessionId[session.id] || []),
  );

  return {
    today: {
      completedSessions: todaySessions.length,
      totalFocusMinutes: focusMinutes(todaySessions),
      breaksCompleted: breakCompletedCount(todaySessions),
      averageDistraction,
      focusScore:
        scoredToday.length > 0
          ? Math.round(scoredToday.reduce((total, value) => total + value, 0) / scoredToday.length)
          : 0,
    },
    week: {
      totalFocusMinutes: focusMinutes(weekSessions),
      completedSessions: weekSessions.length,
      bestFocusDay: bestFocusDay
        ? `${new Date(`${bestFocusDay[0]}T00:00:00`).toLocaleDateString([], {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })} (${bestFocusDay[1]} min)`
        : 'No focus yet',
    },
  };
}
