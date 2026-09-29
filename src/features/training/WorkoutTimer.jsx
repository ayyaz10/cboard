import { Button, NumberField } from "./Training";

export const timerRemaining = (timer, now) =>
  timer?.until ? Math.max(0, timer.until - now) : (timer?.remaining ?? 0);

export function WorkoutTimer({ session, update, clock, exercise }) {
  const timer = session.timer || {
    duration: exercise?.timerSeconds || 60,
    remaining: (exercise?.timerSeconds || 60) * 1000,
    until: null,
  };
  const remaining = timerRemaining(timer, clock);
  const running = !!timer.until && remaining > 0;
  const done = !!timer.until && remaining === 0;
  const patch = (next) =>
    update((s) => ({ ...s, timer: { ...timer, ...next } }));
  return (
    <section className="tr-timer" aria-label="Exercise timer">
      <div className="tr-toolbar">
        <div>
          <span className="tr-eyebrow">Exercise timer</span>
          <div className="tr-timer-digits" role="timer">
            {Math.floor(Math.ceil(remaining / 1000) / 60)}:
            {String(Math.ceil(remaining / 1000) % 60).padStart(2, "0")}
          </div>
        </div>
        <NumberField
          label="Timer seconds"
          min={1}
          max={3600}
          value={timer.duration}
          onChange={(duration) =>
            patch({ duration, remaining: duration * 1000, until: null })
          }
        />
      </div>
      <div className="tr-actions">
        <Button
          primary
          disabled={!!session.pausedAt || timer.duration < 1}
          onClick={() =>
            running
              ? patch({ remaining, until: null })
              : patch({
                  until: Date.now() + (remaining || timer.duration * 1000),
                })
          }
        >
          {running ? "Pause timer" : "Start timer"}
        </Button>
        <Button
          onClick={() =>
            patch({ remaining: timer.duration * 1000, until: null })
          }
        >
          Reset timer
        </Button>
        {exercise && (
          <Button
            onClick={() =>
              patch({
                duration: exercise.timerSeconds || 60,
                remaining: (exercise.timerSeconds || 60) * 1000,
                until: null,
              })
            }
          >
            Use exercise preset
          </Button>
        )}
      </div>
      <p className="tr-muted" role="status" data-complete={done}>
        {done
          ? "Time complete. Record your actual reps or hold below."
          : "Start when you are ready. Your set is saved only when you log it."}
      </p>
    </section>
  );
}
