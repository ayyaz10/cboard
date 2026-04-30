export const GOALS_STORAGE_KEY = 'calculatorBoard_progressTracker_goals';
export const ENTRIES_STORAGE_KEY = 'calculatorBoard_progressTracker_entries';

export const metricColors = {
  lime: '#7ed957',
  pink: '#ff90e8',
  blue: '#38bdf8',
  yellow: '#ffd166',
  coral: '#ff7a59',
  violet: '#a78bfa',
};

export const metricColorKeys = Object.keys(metricColors);

export const goalTypePresets = {
  typing: {
    label: 'Typing practice',
    targetUnit: 'WPM',
    metrics: [
      { name: 'WPM', unit: 'WPM' },
      { name: 'Accuracy', unit: '%' },
      { name: 'Raw Speed', unit: 'WPM' },
      { name: 'Consistency', unit: '%' },
    ],
  },
  walking: {
    label: 'Walking',
    targetUnit: 'steps',
    metrics: [
      { name: 'Steps', unit: 'steps' },
      { name: 'Distance', unit: 'km' },
      { name: 'Calories', unit: 'kcal' },
    ],
  },
  pomodoro: {
    label: 'Pomodoro',
    targetUnit: 'sessions',
    metrics: [
      { name: 'Completed Pomodoros', unit: 'sessions' },
      { name: 'Focus Minutes', unit: 'minutes' },
    ],
  },
  selfControl: {
    label: 'Self-control',
    targetUnit: 'controls',
    metrics: [
      { name: 'Successful Controls', unit: 'count' },
      { name: 'Failed Attempts', unit: 'count' },
    ],
  },
  custom: {
    label: 'Custom',
    targetUnit: '',
    metrics: [
      { name: 'Progress', unit: '' },
    ],
  },
};

export function createId(prefix) {
  const randomValue =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `${prefix}_${randomValue}`;
}

export function getTodayInputValue(date = new Date()) {
  const timezoneOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

export function buildPresetMetrics(type) {
  return goalTypePresets[type].metrics.map((metric, index) => ({
    id: createId('metric'),
    name: metric.name,
    unit: metric.unit,
    colorKey: metricColorKeys[index % metricColorKeys.length],
  }));
}

export function formatGoalTarget(goal) {
  if (!Number.isFinite(goal.targetValue)) {
    return 'No target set';
  }

  return `${goal.targetValue.toLocaleString()} ${goal.unit}`.trim();
}
