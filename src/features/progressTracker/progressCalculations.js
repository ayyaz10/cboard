export function getSortedMetricEntries(entries, metricId) {
  return [...entries]
    .filter((entry) => Number.isFinite(entry.values?.[metricId]))
    .sort((leftEntry, rightEntry) => {
      const dateCompare = leftEntry.date.localeCompare(rightEntry.date);
      return dateCompare || leftEntry.createdAt.localeCompare(rightEntry.createdAt);
    });
}

export function getProgressFromStart(goal, entries, metricId) {
  if (!metricId || !Number.isFinite(goal?.targetValue)) {
    return null;
  }

  const metricEntries = getSortedMetricEntries(entries, metricId);

  if (metricEntries.length === 0) {
    return null;
  }

  const startEntry = metricEntries[0];
  const latestEntry = metricEntries.at(-1);
  const startValue = startEntry.values[metricId];
  const latestValue = latestEntry.values[metricId];
  const totalDistance = goal.targetValue - startValue;

  if (totalDistance === 0) {
    return latestValue === goal.targetValue ? 100 : null;
  }

  const progress = ((latestValue - startValue) / totalDistance) * 100;

  return Math.min(999, Math.max(0, Math.round(progress)));
}
