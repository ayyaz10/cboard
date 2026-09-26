import { dailyCalorieReport } from "./diaryData.js";

export function calorieTargetBand(calories, target) {
  if (!Number.isFinite(calories)) return "empty";
  if (!Number.isFinite(target) || target <= 0) return "logged";
  const ratio = calories / target;
  if (ratio < 0.6) return "low";
  if (ratio < 0.85) return "building";
  if (ratio <= 1.05) return "near";
  if (ratio <= 1.2) return "over";
  return "high";
}

export function calorieBubbleSize(calories, target) {
  if (!Number.isFinite(calories)) return 0;
  if (!Number.isFinite(target) || target <= 0) return 28;
  const progress = Math.min(1.05, Math.max(0, calories / target));
  return Math.round(16 + (22 * progress) / 1.05);
}

export function calendarCalorieStats(days, target) {
  return Object.fromEntries(
    days.map((day) => {
      const report = dailyCalorieReport(day, target);
      return [day.date, {
        ...report,
        band: calorieTargetBand(report.calories, target),
        size: calorieBubbleSize(report.calories, target),
      }];
    }),
  );
}

export function calendarCalorieDays(days, target, parseDate) {
  const groups = { logged: [], low: [], building: [], near: [], over: [], high: [], partial: [] };
  for (const day of days) {
    const report = dailyCalorieReport(day, target);
    const band = calorieTargetBand(report.calories, target);
    if (band === "empty") continue;
    groups[band].push(parseDate(day.date));
    if (report.missing > 0) groups.partial.push(parseDate(day.date));
  }
  return groups;
}

export function calendarMonthSummary(days, month, target) {
  const reports = days
    .filter((day) => day.date.startsWith(month))
    .map((day) => dailyCalorieReport(day, target))
    .filter((report) => Number.isFinite(report.calories));
  if (!reports.length) return { band: "empty", logged: 0, partial: false };
  const average = reports.reduce((sum, report) => sum + report.calories, 0) / reports.length;
  return {
    band: calorieTargetBand(average, target),
    logged: reports.length,
    partial: reports.some((report) => report.missing > 0),
  };
}
