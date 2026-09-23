import { useMemo, useState } from "react";
import {
  dailyCalorieReport,
  shiftDate,
  weeklyCalorieReport,
} from "./diaryData";

const number = (value) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
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
  const weekly = useMemo(
    () => weeklyCalorieReport(days, date, target),
    [days, date, target],
  );
  const scale =
    daily.target ||
    Math.max(1, ...weekly.entries.map((entry) => entry.calories || 0));
  const progress = daily.calories == null ? 0 : Math.min(100, (daily.calories / scale) * 100);
  const weekRange = `${fullDate(weekly.start)} – ${fullDate(weekly.end)}`;

  return (
    <section className="diary-panel diary-report" aria-labelledby="calorie-report-heading">
      <div className="diary-section-heading">
        <div>
          <span className="pill">Nutrition report</span>
          <h2 id="calorie-report-heading">Calories</h2>
        </div>
        <div className="diary-report-tabs" role="tablist" aria-label="Calorie report period">
          {[
            ["daily", "Daily"],
            ["weekly", "Weekly"],
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
          {daily.missing > 0 && <p className="diary-hint">This is a known subtotal. {daily.missing} food {daily.missing === 1 ? "item has" : "items have"} missing calorie data.</p>}
          {daily.target == null && <p className="diary-hint">Set a daily calorie target above to see remaining and over-budget values.</p>}
        </div>
      ) : (
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
              return (
                <div className="diary-week-day" key={entry.date}>
                  <div className="diary-week-track" title={entry.calories == null ? "No calories logged" : `${number(entry.calories)} kcal${entry.missing ? ", partial" : ""}`}>
                    <span className={`${over ? "is-over" : ""} ${entry.missing ? "is-partial" : ""}`} style={{ height: `${percent}%` }} />
                    {entry.complete && <b aria-label="Day completed">✓</b>}
                  </div>
                  <strong>{dayLabel(entry.date)}</strong>
                  <small>{entry.calories == null ? "—" : number(entry.calories)}</small>
                </div>
              );
            })}
          </div>
          <div className="diary-weekly-summary">
            <p><strong>{weekly.average == null ? "—" : number(weekly.average)}</strong> kcal daily average</p>
            <p>{weekly.logged} of 7 days logged</p>
            {weekly.balance != null && <p><strong>{number(Math.abs(weekly.balance))} calories</strong> {weekly.balance < 0 ? "over" : "under"} target across logged days</p>}
          </div>
          <p className="diary-hint">Blank days are not counted as zero. Striped bars contain foods with missing calorie values.</p>
        </div>
      )}
    </section>
  );
}
