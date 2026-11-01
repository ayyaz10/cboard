import { useEffect, useMemo, useRef, useState } from 'react';

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function pad(value) {
  return String(value).padStart(2, '0');
}

function toInputDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseInputDate(value) {
  if (!value) {
    return null;
  }

  const [year, month, day] = value.split('-').map(Number);

  if (!year || !month || !day) {
    return null;
  }

  return new Date(year, month - 1, day);
}

function makeChangeEvent(value, name, id) {
  return {
    target: {
      id,
      name,
      value,
    },
  };
}

function getCalendarDays(monthDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: firstDay }, () => null);

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(year, month, day));
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

export function ThemedDatePicker({
  id,
  name,
  value,
  onChange,
  disabled = false,
  className = '',
}) {
  const selectedDate = parseInputDate(value);
  const todayValue = toInputDate(new Date());
  const [isOpen, setIsOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(
    selectedDate ?? new Date(),
  );
  const rootRef = useRef(null);

  const calendarDays = useMemo(
    () => getCalendarDays(visibleMonth),
    [visibleMonth],
  );

  useEffect(() => {
    const nextSelectedDate = parseInputDate(value);

    if (nextSelectedDate) {
      setVisibleMonth(nextSelectedDate);
    }
  }, [value]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  function changeMonth(monthOffset) {
    setVisibleMonth((current) => (
      new Date(current.getFullYear(), current.getMonth() + monthOffset, 1)
    ));
  }

  function selectDate(date) {
    const nextValue = toInputDate(date);
    onChange?.(makeChangeEvent(nextValue, name, id));
    setIsOpen(false);
  }

  function selectToday() {
    selectDate(new Date());
  }

  return (
    <div ref={rootRef} className="relative">
      {name ? <input type="hidden" name={name} value={value ?? ''} /> : null}
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className={`field-input flex items-center justify-between gap-3 text-left font-semibold disabled:cursor-not-allowed disabled:opacity-55 ${className}`}
      >
        <span>{value || 'Pick date'}</span>
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-[var(--border-default)] bg-[var(--color-accent)] text-xs font-bold shadow-[2px_2px_0_#000] ${
            isOpen ? 'bg-[#9fe3ff]' : ''
          }`}
          aria-hidden="true"
        >
          31
        </span>
      </button>

      {isOpen ? (
        <div
          role="dialog"
          aria-label="Choose date"
          className="absolute left-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-[1.35rem] border-2 border-[var(--border-default)] bg-[var(--color-warning-soft)] p-3 shadow-[7px_7px_0_#000]"
        >
          <div className="flex items-center justify-between gap-3 rounded-[1rem] border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] p-2">
            <button
              type="button"
              onClick={() => changeMonth(-1)}
              aria-label="Previous month"
              className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] text-lg font-bold shadow-[2px_2px_0_#000]"
            >
              &lt;
            </button>
            <p className="text-center text-sm font-bold uppercase tracking-[0.12em] text-[var(--color-text)]">
              {monthNames[visibleMonth.getMonth()]} {visibleMonth.getFullYear()}
            </p>
            <button
              type="button"
              onClick={() => changeMonth(1)}
              aria-label="Next month"
              className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] text-lg font-bold shadow-[2px_2px_0_#000]"
            >
              &gt;
            </button>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1">
            {weekdays.map((weekday) => (
              <div
                key={weekday}
                className="rounded-full border border-black/20 bg-[var(--surface-elevated)] px-1 py-1 text-center text-[0.62rem] font-bold uppercase tracking-[0.08em] text-[var(--color-text-muted)]"
              >
                {weekday}
              </div>
            ))}
            {calendarDays.map((date, index) => {
              const dateValue = date ? toInputDate(date) : '';
              const isSelected = dateValue === value;
              const isToday = dateValue === todayValue;

              return date ? (
                <button
                  key={dateValue}
                  type="button"
                  onClick={() => selectDate(date)}
                  className={`aspect-square rounded-[0.9rem] border-2 border-[var(--border-default)] text-sm font-bold text-[var(--color-text)] transition hover:-translate-y-px hover:bg-[#9fe3ff] hover:shadow-[2px_2px_0_#000] ${
                    isSelected
                      ? 'bg-[var(--color-accent)] shadow-[2px_2px_0_#000]'
                      : isToday
                        ? 'bg-[#ffd166]'
                        : 'bg-[var(--surface-elevated)]'
                  }`}
                >
                  {date.getDate()}
                </button>
              ) : (
                <span key={`blank-${index}`} aria-hidden="true" />
              );
            })}
          </div>

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={selectToday}
              className="rounded-full border-2 border-[var(--border-default)] bg-black px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-white shadow-[3px_3px_0_#c5ff6f]"
            >
              Today
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
