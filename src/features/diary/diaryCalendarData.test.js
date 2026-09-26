import test from "node:test";
import assert from "node:assert/strict";
import { calorieBubbleSize, calorieTargetBand, calendarMonthSummary } from "./diaryCalendarData.js";

test("calendar calorie bands distinguish progress and over-target days", () => {
  assert.equal(calorieTargetBand(null, 2000), "empty");
  assert.equal(calorieTargetBand(500, 2000), "low");
  assert.equal(calorieTargetBand(1500, 2000), "building");
  assert.equal(calorieTargetBand(1995, 2000), "near");
  assert.equal(calorieTargetBand(2200, 2000), "over");
  assert.equal(calorieTargetBand(2500, 2000), "high");
  assert.equal(calorieTargetBand(500, null), "logged");
});

test("calendar bubbles grow with calories and stop at the available cell size", () => {
  assert.equal(calorieBubbleSize(null, 2000), 0);
  assert.ok(calorieBubbleSize(500, 2000) < calorieBubbleSize(1500, 2000));
  assert.ok(calorieBubbleSize(1500, 2000) < calorieBubbleSize(2000, 2000));
  assert.equal(calorieBubbleSize(2200, 2000), calorieBubbleSize(3000, 2000));
});

test("month summaries use the average of logged days and flag partial data", () => {
  const days = [
    { date: "2026-09-01", meals: [{ items: [
      { nutrition: { calories: 1900 }, quantity: 1, basis: 1, unit: "g", nutritionUnit: "g" },
      { nutrition: {}, quantity: 1, basis: 1, unit: "g", nutritionUnit: "g" },
    ] }] },
    { date: "2026-09-02", meals: [{ items: [{ nutrition: { calories: 2100 }, quantity: 1, basis: 1, unit: "g", nutritionUnit: "g" }] }] },
  ];
  assert.deepEqual(calendarMonthSummary(days, "2026-09", 2000), {
    band: "near",
    logged: 2,
    partial: true,
  });
  assert.deepEqual(calendarMonthSummary(days, "2026-08", 2000), {
    band: "empty",
    logged: 0,
    partial: false,
  });
});
