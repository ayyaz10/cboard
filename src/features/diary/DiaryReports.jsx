import { useMemo, useState } from "react";
import {
  diaryTotals,
  dailyCalorieReport,
  shiftDate,
  weeklyCalorieReport,
  weekDates,
} from "./diaryData";
import { NUTRIENTS } from "../nutrition/nutrients";

const number = (value) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
const averageNumber = (value) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
const dayLabel = (date) =>
  new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(
    new Date(`${date}T12:00:00Z`),
  );
const fullDate = (date) =>
  new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));

export function DiaryReports({ days, date, today, goals, disabled, onSelectDate }) {
  const [view, setView] = useState("daily");
  const target = goals?.calories;
  const selectedDay = days.find((entry) => entry.date === date);
  const daily = useMemo(
    () => dailyCalorieReport(selectedDay, target),
    [selectedDay, target],
  );
  const selectedTotals = useMemo(
    () => diaryTotals(selectedDay?.meals || []),
    [selectedDay],
  );
  const weekly = useMemo(
    () => weeklyCalorieReport(days, date, target),
    [days, date, target],
  );
  const scale =
    daily.target ||
    Math.max(1, ...weekly.entries.map((entry) => entry.calories || 0));
  const progress = daily.calories == null ? 0 : Math.min(100, (daily.calories / scale) * 100);
  const weekRange = `${fullDate(weekly.start)} – ${fullDate(weekly.end)}`;
  const monthStart = `${date.slice(0, 7)}-01`;
  const monthDays = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
  const monthLastDate = `${date.slice(0, 7)}-${String(monthDays).padStart(2, "0")}`;
  const monthRange = `${fullDate(monthStart)} – ${fullDate(monthLastDate)}`;
  const nutrientAverages = (periodDays) => {
    const eligibleDays = periodDays.filter((day) => day.date <= today && day.meals?.length);
    return NUTRIENTS.map(([key, label, unit]) => {
      const totals = eligibleDays.map((day) => diaryTotals(day.meals)[key]).filter((total) => total.known > 0);
      return {
        key, label, unit,
        average: totals.length ? totals.reduce((sum, total) => sum + total.value, 0) / totals.length : null,
        logged: totals.length,
      };
    });
  };
  const periodDays = view === "weekly"
    ? weekDates(date).map((dayDate) => days.find((day) => day.date === dayDate) || { date: dayDate, meals: [] })
    : view === "monthly"
      ? Array.from({ length: monthDays }, (_, index) => {
          const dayDate = `${date.slice(0, 7)}-${String(index + 1).padStart(2, "0")}`;
          return days.find((day) => day.date === dayDate) || { date: dayDate, meals: [] };
        })
      : days.filter((day) => day.date <= today);
  const averages = view === "daily" ? [] : nutrientAverages(periodDays);
  const periodTitle = view === "weekly" ? weekRange : view === "monthly" ? monthRange : "All recorded days";
  const loggedDays = periodDays.filter((day) => day.date <= today && day.meals?.length).length;

  return (
    <section className="diary-panel diary-report" aria-labelledby="calorie-report-heading">
      <div className="diary-section-heading">
        <div>
          <span className="pill">Nutrition report</span>
          <h2 id="calorie-report-heading">Nutrition</h2>
        </div>
        <div className="diary-report-tabs" role="tablist" aria-label="Nutrition report period">
          {[
            ["daily", "Daily"],
            ["weekly", "Weekly"],
            ["monthly", "Monthly"],
            ["overall", "Overall"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              onClick={() => setView(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === "daily" ? (
        <div role="tabpanel" className="diary-report-body">
          <div className="diary-report-date-nav">
            <button type="button" disabled={disabled || date <= "2000-01-01"} aria-label="Previous report day" onClick={() => onSelectDate(shiftDate(date, -1))}>←</button>
            <strong>{fullDate(date)}</strong>
            <button type="button" disabled={disabled || date >= today} aria-label="Next report day" onClick={() => onSelectDate(shiftDate(date, 1))}>→</button>
          </div>
          <div className="diary-daily-report-grid">
            <div
              className="diary-calorie-ring"
              style={{ "--diary-report-progress": `${progress * 3.6}deg` }}
              aria-label={daily.calories == null ? "No calorie data" : `${number(daily.calories)} calories consumed`}
            >
              <div>
                <strong>{daily.calories == null ? "—" : number(daily.calories)}</strong>
                <span>kcal eaten</span>
              </div>
            </div>
            <dl className="diary-report-summary">
              <div><dt>Food calories consumed</dt><dd>{daily.calories == null ? "—" : number(daily.calories)}</dd></div>
              <div><dt>Daily calorie target</dt><dd>{daily.target == null ? "Not set" : number(daily.target)}</dd></div>
              <div className="diary-report-balance"><dt>Calories {daily.balance != null && daily.balance < 0 ? "over" : "remaining"}</dt><dd>{daily.balance == null ? "—" : number(Math.abs(daily.balance))}</dd></div>
            </dl>
          </div>
          <div className="diary-report-nutrients" aria-label="Daily macro and fibre progress">
            {[
              ["protein", "Protein", "g"],
              ["carbs", "Carbohydrates", "g"],
              ["fat", "Fat", "g"],
              ["fiber", "Fibre", "g"],
            ].map(([key, label, unit]) => {
              const total = selectedTotals[key];
              const nutrientTarget = goals?.[key];
              const hasValue = total.known > 0;
              const percent = nutrientTarget > 0 && hasValue
                ? Math.min(100, (total.value / nutrientTarget) * 100)
                : 0;
              return (
                <article className="diary-report-nutrient" data-nutrient={key} key={key}>
                  <div className="diary-report-nutrient-heading">
                    <strong>{label}</strong>
                    {nutrientTarget > 0 && <span>{Math.round(percent)}%</span>}
                  </div>
                  <p>{hasValue ? number(total.value) : "—"}<small> {unit}</small></p>
                  {nutrientTarget > 0 ? <>
                    <div className="diary-report-nutrient-track" role="progressbar" aria-label={`${label} daily target`} aria-valuemin="0" aria-valuemax={nutrientTarget} aria-valuenow={hasValue ? Math.min(total.value, nutrientTarget) : 0}>
                      <span style={{ width: `${percent}%` }} />
                    </div>
                    <small className="diary-report-nutrient-caption">
                      {hasValue ? `${number(Math.max(0, nutrientTarget - total.value))} ${unit} left` : `Target ${number(nutrientTarget)} ${unit}`}
                      {total.missing > 0 ? " · partial data" : ""}
                    </small>
                  </> : <small className="diary-report-nutrient-caption">{hasValue ? "Logged today" : "No data yet"}</small>}
                </article>
              );
            })}
          </div>
          {daily.missing > 0 && <p className="diary-hint">This is a known subtotal. {daily.missing} food {daily.missing === 1 ? "item has" : "items have"} missing calorie data.</p>}
          {daily.target == null && <p className="diary-hint">Set a daily calorie target above to see remaining and over-budget values.</p>}
        </div>
      ) : view === "weekly" ? (
        <div role="tabpanel" className="diary-report-body">
          <div className="diary-report-date-nav">
            <button type="button" disabled={disabled || shiftDate(date, -7) < "2000-01-01"} aria-label="Previous report week" onClick={() => onSelectDate(shiftDate(date, -7))}>←</button>
            <strong>{weekRange}</strong>
            <button type="button" disabled={disabled || weekly.end >= today} aria-label="Next report week" onClick={() => {
              const next = shiftDate(date, 7);
              onSelectDate(next > today ? today : next);
            }}>→</button>
          </div>
          <div className="diary-weekly-chart" aria-label={`Calories for ${weekRange}`}>
            {weekly.entries.map((entry) => {
              const percent = entry.calories == null ? 0 : Math.min(100, (entry.calories / scale) * 100);
              const over = entry.target != null && entry.calories > entry.target;
              const future = entry.date > today;
              return (
                <button
                  type="button"
                  className="diary-week-day"
                  key={entry.date}
                  disabled={disabled || future}
                  aria-current={entry.date === date ? "date" : undefined}
                  aria-label={`${fullDate(entry.date)}: ${entry.calories == null ? "no calories logged" : `${number(entry.calories)} calories`}. Open meals.`}
                  onClick={() => onSelectDate(entry.date, "meals")}
                >
                  <div className="diary-week-track" title={entry.calories == null ? "No calories logged" : `${number(entry.calories)} kcal${entry.missing ? ", partial" : ""}`}>
                    <span className={`${over ? "is-over" : ""} ${entry.missing ? "is-partial" : ""}`} style={{ height: `${percent}%` }} />
                    {entry.complete && <b aria-label="Day completed">✓</b>}
                  </div>
                  <strong>{dayLabel(entry.date)}</strong>
                  <small>{entry.calories == null ? "—" : number(entry.calories)}</small>
                </button>
              );
            })}
          </div>
          <div className="diary-weekly-summary">
            <p><strong>{weekly.average == null ? "—" : number(weekly.average)}</strong> kcal daily average</p>
            <p>{weekly.logged} of 7 days logged</p>
            {weekly.balance != null && <p><strong>{number(Math.abs(weekly.balance))} calories</strong> {weekly.balance < 0 ? "over" : "under"} target across logged days</p>}
          </div>
          <p className="diary-hint">Blank days are not counted as zero. Striped bars contain foods with missing calorie values.</p>
          <div className="diary-average-section">
            <h3>Average daily intake</h3>
            <p className="diary-hint">Average across days with known values for each nutrient; blank days and unknown nutrients are excluded.</p>
            <NutrientAverageCards averages={averages} loggedDays={loggedDays} />
          </div>
        </div>
      ) : (
        <div role="tabpanel" className="diary-report-body">
          {view === "monthly" && <div className="diary-report-date-nav">
            <button type="button" disabled={disabled || monthStart <= "2000-01-01"} aria-label="Previous report month" onClick={() => onSelectDate(shiftDate(monthStart, -1))}>←</button>
            <strong>{periodTitle}</strong>
            <button type="button" disabled={disabled || date.slice(0, 7) >= today.slice(0, 7)} aria-label="Next report month" onClick={() => {
              const nextMonth = new Date(`${monthStart}T12:00:00Z`);
              nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
              const next = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}-01`;
              onSelectDate(next > today ? today : next);
            }}>→</button>
          </div>}
          {view === "overall" && <h3 className="diary-overall-title">All recorded days</h3>}
          <div className="diary-weekly-summary">
            <p><strong>{loggedDays}</strong> {view === "monthly" ? "days logged this month" : "days with food logged"}</p>
            {view !== "overall" && <p>{periodTitle}</p>}
          </div>
          <div className="diary-average-section">
            <h3>Average daily intake</h3>
            <p className="diary-hint">Average across days with known values for each nutrient; blank days and unknown nutrients are excluded.</p>
            <NutrientAverageCards averages={averages} loggedDays={loggedDays} />
          </div>
        </div>
      )}
    </section>
  );
}

function NutrientAverageCards({ averages, loggedDays }) {
  return <div className="diary-report-nutrients" aria-label="Average daily nutrient intake">
    {averages.map(({ key, label, unit, average, logged }) => <article className="diary-report-nutrient" data-nutrient={key} key={key}>
      <div className="diary-report-nutrient-heading"><strong>{label}</strong></div>
      <p>{average == null ? "—" : averageNumber(average)}<small> {unit}</small></p>
      <small className="diary-report-nutrient-caption">{average == null ? "No data yet" : `${logged} of ${loggedDays} logged days`}</small>
    </article>)}
  </div>;
}
