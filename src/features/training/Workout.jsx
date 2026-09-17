import { useState } from "react";
import {
  Button,
  Card,
  Field,
  NumberField,
  Prescription,
  SymptomFields,
} from "./Training";
import {
  completeSet,
  defaults,
  displaySet,
  exerciseSets,
  lastSession,
  targetCount,
  safeUrl,
  exerciseRestriction,
} from "./trainingData";
const time = (ms) =>
  `${Math.floor(Math.max(0, ms) / 60000)}:${String(Math.floor(Math.max(0, ms) / 1000) % 60).padStart(2, "0")}`;
export function Workout({
  data,
  session,
  update,
  begin,
  clock,
  undo,
  canUndo,
  onFinish,
}) {
  const [finishing, setFinishing] = useState(false);
  if (!session)
    return (
      <Card title="Ready when you are">
        <p>
          Start today’s plan. Every completed set saves immediately on this
          device.
        </p>
        <Button primary onClick={begin}>
          Start Workout →
        </Button>
      </Card>
    );
  const p = session.exercises[session.index],
    e = data.exercises.find((x) => x.id === p?.exerciseId);
  const rest = session.pausedAt
    ? session.restRemaining
    : Math.max(0, (session.restUntil || 0) - clock);
  function pause() {
    update((s) =>
      s.pausedAt
        ? {
            ...s,
            pausedMs: s.pausedMs + Date.now() - s.pausedAt,
            pausedAt: null,
            restUntil: s.restRemaining ? Date.now() + s.restRemaining : null,
            restRemaining: 0,
          }
        : {
            ...s,
            pausedAt: Date.now(),
            restRemaining: Math.max(0, (s.restUntil || 0) - Date.now()),
            restUntil: null,
          },
    );
  }
  const fullyDone = session.exercises.every((p) => {
    const sets = exerciseSets(session, p.exerciseId),
      exercise = data.exercises.find((e) => e.id === p.exerciseId);
    return (
      !session.skipped.includes(p.exerciseId) &&
      (exercise.unilateral
        ? ["left", "right"].every(
            (side) => sets.filter((s) => s.side === side).length >= p.sets,
          )
        : sets.length >= p.sets)
    );
  });
  function finish() {
    if (
      update((s) => ({
        ...s,
        status: fullyDone ? "completed" : s.sets.length ? "partial" : "skipped",
        ended: Date.now(),
        pausedMs: s.pausedMs + (s.pausedAt ? Date.now() - s.pausedAt : 0),
        pausedAt: null,
        restUntil: null,
      }))
    ) {
      setFinishing(false);
      onFinish();
    }
  }
  return (
    <>
      <div className="tr-toolbar">
        <div>
          <strong>{session.name}</strong>
          <p className="tr-muted">
            Session{" "}
            {time(
              (session.pausedAt || clock) - session.started - session.pausedMs,
            )}{" "}
            · {session.sets.length} sets saved
          </p>
        </div>
        <div className="tr-actions">
          <Button onClick={pause}>
            {session.pausedAt ? "Resume" : "Pause"}
          </Button>
          <Button disabled={!canUndo} onClick={undo}>
            Undo last action
          </Button>
          <Button onClick={() => setFinishing(!finishing)}>
            {finishing ? "Back to workout" : "Finish session"}
          </Button>
        </div>
      </div>
      {finishing ? (
        <Card title="Session review">
          <p>
            {fullyDone
              ? "All prescribed sets completed."
              : `This will be saved as ${session.sets.length ? "a partial" : "a skipped"} session. You can still review every logged set.`}
          </p>
          <h3>Pain immediately afterward</h3>
          <SymptomFields
            data={data}
            session={session}
            kind="after"
            update={update}
          />
          <Field label="Session notes">
            <textarea
              value={session.notes}
              onChange={(e) => update((s) => ({ ...s, notes: e.target.value }))}
            />
          </Field>
          <Button primary onClick={finish}>
            Save & finish session
          </Button>
        </Card>
      ) : (
        <div className="tr-workout-grid">
          <div className="tr-current">
            {e ? (
              <SetCard
                key={`${session.id}-${e.id}-${session.sets.length}`}
                data={data}
                session={session}
                p={p}
                e={e}
                update={update}
                rest={rest}
              />
            ) : (
              <Card title="Recovery session">
                <p>
                  Log walking and recovery notes on Today, then finish here.
                </p>
              </Card>
            )}
            <div className="tr-rest" role="status">
              <strong>
                {session.pausedAt
                  ? "Workout paused"
                  : rest > 0
                    ? `Rest · ${time(rest)}`
                    : "Ready for your next set"}
              </strong>
              {rest > 0 && (
                <Button
                  onClick={() =>
                    update((s) => ({ ...s, restUntil: null, restRemaining: 0 }))
                  }
                >
                  Skip rest
                </Button>
              )}
            </div>
          </div>
          <Card title="Session exercises">
            <ol className="tr-list">
              {session.exercises.map((item, index) => {
                const exercise = data.exercises.find(
                    (x) => x.id === item.exerciseId,
                  ),
                  count = exerciseSets(session, exercise.id).length;
                return (
                  <li key={item.exerciseId} className="tr-row">
                    <Button
                      aria-current={
                        index === session.index ? "step" : undefined
                      }
                      onClick={() => update((s) => ({ ...s, index }))}
                    >
                      {index + 1}. {exercise.name} · {count}/
                      {targetCount(item, exercise)}{" "}
                      {session.skipped.includes(exercise.id) ? "· skipped" : ""}
                    </Button>
                    <div className="tr-actions">
                      <Button
                        aria-label={`Move ${exercise.name} up`}
                        disabled={index === 0}
                        onClick={() =>
                          update((s) => {
                            const current = s.exercises[s.index].exerciseId;
                            [s.exercises[index - 1], s.exercises[index]] = [
                              s.exercises[index],
                              s.exercises[index - 1],
                            ];
                            s.index = s.exercises.findIndex(
                              (p) => p.exerciseId === current,
                            );
                            return s;
                          })
                        }
                      >
                        ↑
                      </Button>
                      <Button
                        aria-label={`Move ${exercise.name} down`}
                        disabled={index === session.exercises.length - 1}
                        onClick={() =>
                          update((s) => {
                            const current = s.exercises[s.index].exerciseId;
                            [s.exercises[index + 1], s.exercises[index]] = [
                              s.exercises[index],
                              s.exercises[index + 1],
                            ];
                            s.index = s.exercises.findIndex(
                              (p) => p.exerciseId === current,
                            );
                            return s;
                          })
                        }
                      >
                        ↓
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>
      )}
    </>
  );
}
function Counter({ label, value, onChange, step = 1, max = 1000 }) {
  return (
    <div className="tr-counter">
      <NumberField
        label={label}
        value={value}
        step={step}
        max={max}
        onChange={onChange}
      />
      <div className="tr-actions">
        <Button
          aria-label={`Decrease ${label}`}
          onClick={() =>
            onChange(Math.max(0, Number((value - step).toFixed(2))))
          }
        >
          −
        </Button>
        <Button
          aria-label={`Increase ${label}`}
          onClick={() =>
            onChange(Math.min(max, Number((value + step).toFixed(2))))
          }
        >
          +
        </Button>
      </div>
    </div>
  );
}
function SetCard({ data, session, p, e, update, rest }) {
  const [values, setValues] = useState(() => defaults(data, session, p, e));
  const [error, setError] = useState("");
  const patch = (changes) => setValues((v) => ({ ...v, ...changes }));
  const sets = exerciseSets(session, e.id),
    last = lastSession(data, e.id);
  const total = targetCount(p, e);
  function log() {
    try {
      const restriction = exerciseRestriction(data, e, values.load);
      if (restriction) throw new Error(restriction);
      const next = completeSet(session, p, e, values);
      if (update(() => next)) setError("");
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <Card title={e.name}>
      <div className="tr-actions">
        <span className="pill">
          {sets.length >= total
            ? "Target complete"
            : `Set ${sets.length + 1} of ${total}`}
        </span>
        {e.unilateral && <span className="pill">{values.side} side</span>}
      </div>
      <p>
        <Prescription p={p} e={e} />
      </p>
      <p>{e.purpose}</p>
      <p className="tr-muted">
        {e.muscles} · {e.joints}
      </p>
      <p className="tr-muted">
        Previous:{" "}
        {last
          ? exerciseSets(last, e.id)
              .map((s) => displaySet(s, e))
              .join(" / ")
          : "No previous performance"}
      </p>
      <div className="tr-grid">
        {["hold", "timed", "skill"].includes(e.type) ? (
          <Counter
            label="Hold / time (seconds)"
            value={values.seconds}
            max={86400}
            onChange={(seconds) => patch({ seconds })}
          />
        ) : (
          <Counter
            label="Reps"
            value={values.reps}
            onChange={(reps) => patch({ reps })}
          />
        )}
        {["weighted", "assisted"].includes(e.type) && (
          <Counter
            label={
              e.type === "assisted" ? "Assistance (kg)" : "External load (kg)"
            }
            value={values.load}
            max={2000}
            step={0.5}
            onChange={(load) => patch({ load })}
          />
        )}
      </div>
      {e.unilateral && (
        <Field label="Side">
          <select
            value={values.side}
            onChange={(event) => patch({ side: event.target.value })}
          >
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
        </Field>
      )}
      {e.type === "skill" && (
        <div className="tr-grid">
          <Field label="Method">
            <select
              value={values.skill.method}
              onChange={(event) =>
                patch({
                  skill: { ...values.skill, method: event.target.value },
                })
              }
            >
              {["wall", "block", "kick-up", "freestanding"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Field label="Surface">
            <select
              value={values.skill.surface}
              onChange={(event) =>
                patch({
                  skill: { ...values.skill, surface: event.target.value },
                })
              }
            >
              <option value="parallettes">Parallettes</option>
              <option value="dumbbells">Secure dumbbells</option>
            </select>
          </Field>
          <label className="tr-check">
            <input
              type="checkbox"
              checked={values.skill.successful}
              onChange={(event) =>
                patch({
                  skill: { ...values.skill, successful: event.target.checked },
                })
              }
            />
            Successful balance
          </label>
        </div>
      )}
      <details>
        <summary>
          Set details · {values.technique} · {values.rir} RIR · pain{" "}
          {values.pain}/10
        </summary>
        <div className="tr-grid">
          <NumberField
            label="Reps in reserve (RIR)"
            value={values.rir}
            max={10}
            onChange={(rir) => patch({ rir })}
          />
          <NumberField
            label="Pain during /10"
            value={values.pain}
            max={10}
            onChange={(pain) => patch({ pain })}
          />
          <Field label="Technique">
            <select
              value={values.technique}
              onChange={(event) => patch({ technique: event.target.value })}
            >
              {["Clean", "Acceptable", "Failed"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="tr-actions">
          {e.mistakes.map((tag) => (
            <Button
              key={tag}
              aria-pressed={values.mistakes.includes(tag)}
              onClick={() =>
                patch({
                  mistakes: values.mistakes.includes(tag)
                    ? values.mistakes.filter((t) => t !== tag)
                    : [...values.mistakes, tag],
                })
              }
            >
              {tag}
            </Button>
          ))}
        </div>
        <Field label="Set notes">
          <textarea
            value={values.notes}
            onChange={(event) => patch({ notes: event.target.value })}
          />
        </Field>
        <Field
          label="Video attachment URL (optional)"
          type="url"
          value={values.attachment?.url || ""}
          onChange={(event) =>
            patch({
              attachment: event.target.value
                ? { kind: "video", url: event.target.value }
                : null,
            })
          }
        />
      </details>
      {values.pain >= 3 && (
        <p className="tr-notice">
          Stop or regress the aggravating movement. This set will be flagged for
          review.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="tr-log-action">
        <Button primary disabled={!!session.pausedAt} onClick={log}>
          {e.type === "skill" ? "Save attempt" : "Complete Set"} ✓
        </Button>
        <p className="tr-muted" role="status">
          {session.pausedAt
            ? "Workout paused"
            : rest > 0
              ? `Rest · ${time(rest)} · saves shown values`
              : "Saves shown values · rest starts automatically"}
        </p>
      </div>
      <div className="tr-actions">
        <Button
          onClick={() =>
            update((s) => ({
              ...s,
              exercises: s.exercises.map((x) =>
                x.exerciseId === e.id ? { ...x, sets: x.sets + 1 } : x,
              ),
            }))
          }
        >
          Add set
        </Button>
        <Button
          onClick={() =>
            update((s) => ({
              ...s,
              skipped: [...new Set([...s.skipped, e.id])],
              index: Math.min(s.index + 1, s.exercises.length - 1),
            }))
          }
        >
          Skip exercise
        </Button>
        <Button
          disabled={session.index === session.exercises.length - 1}
          onClick={() => update((s) => ({ ...s, index: s.index + 1 }))}
        >
          Next exercise →
        </Button>
      </div>
      <details>
        <summary>Technique, progressions & reference</summary>
        <p>{e.cues}</p>
        <p>
          <strong>Regression:</strong> {e.regressions}
        </p>
        <p>
          <strong>Progression:</strong> {e.progressions}
        </p>
        <p>{e.restrictions}</p>
        {safeUrl(e.reference) && (
          <a href={safeUrl(e.reference)} target="_blank" rel="noreferrer">
            Open technique reference ↗
          </a>
        )}
      </details>
      {!!sets.length && (
        <details>
          <summary>Logged sets ({sets.length})</summary>
          {sets.map((s, i) => (
            <p key={s.id}>
              {i + 1}. {displaySet(s, e)} · {s.rir} RIR · pain {s.pain}/10
            </p>
          ))}
        </details>
      )}
    </Card>
  );
}
