import { useEffect, useMemo, useRef, useState } from "react";
import { DayButton, DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { calendarCalorieDays, calendarCalorieStats } from "./diaryCalendarData";

function dateFromKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dateKey(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const displayDate = (value) =>
  new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);

export function DiaryCalendar({ date, today, days, target, disabled, onSelect }) {
  const selected = dateFromKey(date);
  const todayDate = dateFromKey(today);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(selected);
  const root = useRef(null);
  const modifiers = useMemo(
    () => calendarCalorieDays(days, target, dateFromKey),
    [days, target],
  );
  const calorieStats = useMemo(() => calendarCalorieStats(days, target), [days, target]);
  const CalorieDayButton = useMemo(
    () => function CalorieDayButtonComponent(props) {
      const stats = calorieStats[props.day.isoDate];
      const band = stats?.band || "empty";
      return (
        <DayButton {...props}>
          <span
            className={`diary-cal-bubble diary-cal-bubble-${band}`}
            style={stats?.size ? { "--diary-cal-bubble-size": `${stats.size}px` } : undefined}
          >
            {props.children}
          </span>
        </DayButton>
      );
    },
    [calorieStats],
  );

  useEffect(() => setMonth(selected), [date]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.key === "Escape" || (event.type === "pointerdown" && !root.current?.contains(event.target))) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="diary-calendar-field">
      <span>Diary date</span>
      <div className="diary-calendar-anchor" ref={root}>
        <button
          type="button"
          className="diary-calendar-trigger"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span>{displayDate(selected)}</span>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>
        </button>
        {open && (
          <div className="diary-calendar-popover" role="dialog" aria-label="Choose diary date">
            <DayPicker
              mode="single"
              month={month}
              onMonthChange={setMonth}
              selected={selected}
              onSelect={(next) => {
                if (!next) return;
                onSelect(dateKey(next));
                setOpen(false);
              }}
              startMonth={new Date(2000, 0, 1)}
              endMonth={todayDate}
              disabled={{ after: todayDate }}
              showOutsideDays
              fixedWeeks
              components={{ DayButton: CalorieDayButton }}
              modifiers={modifiers}
              modifiersClassNames={{
                logged: "diary-cal-logged",
                low: "diary-cal-low",
                building: "diary-cal-building",
                near: "diary-cal-near",
                over: "diary-cal-over",
                high: "diary-cal-high",
                partial: "diary-cal-partial",
              }}
            />
            <div className="diary-calendar-legend" aria-label="Calorie colour guide">
              <span><i className="is-low" />Less</span>
              <span><i className="is-near" />Near target</span>
              <span><i className="is-over" />Over</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
