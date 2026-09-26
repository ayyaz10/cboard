import { useEffect, useMemo, useRef, useState } from "react";
import { calendarMonthSummary } from "./diaryCalendarData";

const monthNames = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(2020, index, 1)),
);

const monthLabel = (value) => {
  if (!value) return "All months";
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1),
  );
};

export function DiaryMonthPicker({ month, today, days, target, disabled, onChange }) {
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number(month?.slice(0, 4)) || currentYear);
  const root = useRef(null);
  const summaries = useMemo(
    () => monthNames.map((_, index) => calendarMonthSummary(days, `${year}-${String(index + 1).padStart(2, "0")}`, target)),
    [days, target, year],
  );

  useEffect(() => {
    if (month) setYear(Number(month.slice(0, 4)));
  }, [month]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.key === "Escape" || (event.type === "pointerdown" && !root.current?.contains(event.target))) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="diary-month-field">
      <span>Filter history by month</span>
      <div className="diary-calendar-anchor" ref={root}>
        <button
          type="button"
          className="diary-calendar-trigger"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span>{monthLabel(month)}</span>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>
        </button>
        {open && (
          <div className="diary-calendar-popover diary-month-popover" role="dialog" aria-label="Filter meal history by month">
            <div className="diary-month-year">
              <button type="button" disabled={year <= 2000} aria-label="Previous year" onClick={() => setYear((value) => value - 1)}>←</button>
              <strong>{year}</strong>
              <button type="button" disabled={year >= currentYear} aria-label="Next year" onClick={() => setYear((value) => value + 1)}>→</button>
            </div>
            <div className="diary-month-grid">
              {monthNames.map((name, index) => {
                const key = `${year}-${String(index + 1).padStart(2, "0")}`;
                const summary = summaries[index];
                const future = year === currentYear && index + 1 > currentMonth;
                return (
                  <button
                    type="button"
                    key={key}
                    className={`diary-month-${summary.band}`}
                    disabled={future}
                    aria-pressed={month === key}
                    title={summary.logged ? `${summary.logged} logged day${summary.logged === 1 ? "" : "s"}${summary.partial ? ", partial nutrition" : ""}` : "No logged days"}
                    onClick={() => { onChange(key); setOpen(false); }}
                  >
                    <strong>{name}</strong>
                    {summary.logged > 0 && <small>{summary.logged}d</small>}
                  </button>
                );
              })}
            </div>
            <div className="diary-calendar-legend" aria-label="Monthly calorie colour guide">
              <span><i className="is-low" />Far under</span>
              <span><i className="is-near" />Near target</span>
              <span><i className="is-slight-over" />5–20% over</span>
              <span><i className="is-over" />20%+ over</span>
            </div>
            <button type="button" className="diary-month-clear" onClick={() => { onChange(""); setOpen(false); }}>Show all months</button>
          </div>
        )}
      </div>
    </div>
  );
}
