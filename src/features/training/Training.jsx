import { useEffect, useState } from "react";
import { PageShell } from "../../components/layout/PageShell";
import { AppNavigation } from "../../components/layout/AppNavigation";
import { useAuth } from "../../contexts/AuthContext";
import { useTraining } from "./useTraining";
import {
  localDate,
  dayIndex,
  startSession,
  lastSession,
  exerciseSets,
  displaySet,
  personalRecords,
} from "./trainingData";
import { Workout } from "./Workout";
import { History, Progress } from "./TrainingReview";
import { PlanEditor, Library, Settings } from "./TrainingEditors";
import "./training.css";
export function Button({ children, primary = false, ...props }) {
  return (
    <button
      type="button"
      className={`tr-button ${primary ? "tr-primary" : ""}`}
      {...props}
    >
      {children}
    </button>
  );
}
export function Field({ label, children, ...props }) {
  return (
    <label className="tr-field">
      <span>{label}</span>
      {children || <input {...props} />}
    </label>
  );
}
export function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 1000,
  step = 1,
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) =>
          onChange(e.target.value === "" ? 0 : Number(e.target.value))
        }
      />
    </Field>
  );
}
export function Card({ title, children, className = "" }) {
  return (
    <section className={`tr-card ${className}`}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}
export function Prescription({ p, e }) {
  return (
    <span>
      {p.sets}
      {e.type === "skill" && p.attemptsMax > p.sets
        ? `–${p.attemptsMax}`
        : ""}{" "}
      {e.type === "skill" ? "attempts" : "sets"}
      {e.type === "skill" && p.max === 0 ? (
        " · record each hold"
      ) : (
        <>
          {" "}
          × {p.min}
          {p.max !== p.min ? `–${p.max}` : ""}{" "}
          {["hold", "timed", "skill"].includes(e.type) ? "sec" : "reps"}
        </>
      )}
      {e.unilateral ? " / side" : ""} · {p.rest}s rest · {p.rir}+ RIR
      {p.minutes ? ` · ${p.minutes} min practice` : ""}
    </span>
  );
}
export function Training() {
  const { user } = useAuth();
  const store = useTraining(user.id);
  const { data, change } = store;
  const [tab, setTab] = useState(
    () => new URLSearchParams(location.search).get("section") || "Today",
  );
  const tabs = [
    "Today",
    "Active Workout",
    "Calendar/History",
    "Progress",
    "Training Plan",
    "Exercise Library",
    "Settings",
  ];
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  function go(next) {
    setTab(next);
    const url = new URL(location.href);
    url.searchParams.set("section", next);
    history.replaceState({}, "", url);
  }
  const active = data?.sessions.find((s) => s.status === "active");
  function begin() {
    if (active) {
      go("Active Workout");
      return;
    }
    if (
      change((d) => {
        d.sessions.push(startSession(d));
        return d;
      })
    )
      go("Active Workout");
  }
  function sessionChange(id, fn) {
    return change((d) => {
      d.sessions = d.sessions.map((s) => (s.id === id ? fn(s) : s));
      return d;
    });
  }
  return (
    <PageShell>
      <AppNavigation activePath="/training" />
      <div className="training">
        <header className="tr-heading">
          <div>
            <span className="pill">Strength · skill · recovery</span>
            <h1>Training</h1>
            <p>Good form. Small steps. Consistent progress.</p>
          </div>
          <div>
            <p role="status" className="tr-muted">
              {store.status}
            </p>
            {active && (
              <Button primary onClick={() => go("Active Workout")}>
                Resume workout →
              </Button>
            )}
          </div>
        </header>
        <nav aria-label="Training sections" className="tr-tabs">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              aria-current={tab === t ? "page" : undefined}
              onClick={() => go(t)}
            >
              {t}
            </button>
          ))}
        </nav>
        {store.error && (
          <div className="tr-notice" role="alert">
            {store.error} <Button onClick={store.retry}>Retry</Button>
          </div>
        )}
        {!data ? (
          <Card title="Preparing your training space">
            <p>
              Your plan and history will appear here once storage is available.
            </p>
            <Button onClick={store.retry}>Retry loading</Button>
          </Card>
        ) : (
          <>
            {tab === "Today" && (
              <Today
                data={data}
                change={change}
                begin={begin}
                active={active}
                sessionChange={sessionChange}
                go={go}
              />
            )}
            {tab === "Active Workout" && (
              <Workout
                data={data}
                session={active}
                update={(fn) => sessionChange(active.id, fn)}
                begin={begin}
                clock={clock}
                undo={store.undo}
                canUndo={store.canUndo}
                onFinish={() => go("Calendar/History")}
              />
            )}
            {tab === "Calendar/History" && (
              <History
                data={data}
                change={change}
                sessionChange={sessionChange}
              />
            )}
            {tab === "Progress" && <Progress data={data} change={change} />}
            {tab === "Training Plan" && (
              <PlanEditor data={data} change={change} />
            )}
            {tab === "Exercise Library" && (
              <Library data={data} change={change} />
            )}
            {tab === "Settings" && <Settings data={data} store={store} />}
          </>
        )}
      </div>
    </PageShell>
  );
}
const emptyCheckin = {
  energy: 5,
  sleep: 5,
  wrist: 0,
  ankle: 0,
  walking: 0,
  weight: 0,
  recovery: "",
  concerning: false,
};
export function Today({ data, change, begin, active, sessionChange, go }) {
  const today = localDate(),
    day = data.plan.days[dayIndex(today)],
    check = data.checkins[today] || emptyCheckin;
  const start = new Date(`${today}T12:00:00`);
  start.setDate(start.getDate() - dayIndex(today));
  const week = localDate(start);
  const done = new Set(
    data.sessions
      .filter(
        (s) =>
          s.date >= week &&
          s.date <= today &&
          s.status === "completed" &&
          s.exercises.length > 0,
      )
      .map((s) => s.date),
  ).size;
  const planned = data.plan.days.filter((d) => d.exercises.length).length;
  const pending = data.sessions.filter(
    (s) =>
      s.date < today &&
      s.sets.length &&
      s.status !== "active" &&
      [...new Set(s.sets.map((x) => x.exerciseId))].some(
        (id) => s.morning[id] == null,
      ),
  );
  function checkin(patch) {
    change((d) => {
      d.checkins[today] = { ...check, ...patch };
      return d;
    });
  }
  const recent = data.sessions
    .filter((s) => s.status !== "active")
    .slice(-3)
    .reverse();
  return (
    <>
      <div className="tr-grid">
        <Card className="tr-hero" title={day.name}>
          <p className="tr-muted">
            {new Date(`${today}T12:00:00`).toLocaleDateString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}{" "}
            · Phase {data.settings.phase}
          </p>
          <p>
            {day.exercises.length
              ? `${day.exercises.length} exercises · build a clean baseline`
              : "A recovery day. Optional walking and comfortable mobility."}
          </p>
          <Button primary onClick={begin}>
            {active
              ? "Resume Workout"
              : day.exercises.length
                ? "Start Workout"
                : "Start recovery session"}{" "}
            →
          </Button>
          <p className="tr-muted">
            {done} / {planned} planned days completed this week
          </p>
          <progress
            aria-label="Weekly workout completion"
            value={done}
            max={Math.max(planned, done, 1)}
          />
        </Card>
        <Card title="How are you arriving?">
          <div className="tr-grid">
            {[
              ["energy", "Energy"],
              ["sleep", "Sleep quality"],
              ["wrist", "Wrist pain"],
              ["ankle", "Ankle pain"],
            ].map(([key, label]) => (
              <Field key={key} label={`${label} · ${check[key]}/10`}>
                <input
                  type="range"
                  min="0"
                  max="10"
                  value={check[key]}
                  onChange={(e) => checkin({ [key]: Number(e.target.value) })}
                />
              </Field>
            ))}
          </div>
          <p className="tr-muted">
            {data.checkins[today]
              ? "Check-in saved"
              : "Defaults shown · tap Save check-in to record"}{" "}
            · 0 = low / none, 10 = highest
          </p>
          <Button onClick={() => checkin({})}>Save check-in</Button>
          <details>
            <summary>Bodyweight, walking & symptoms</summary>
            <div className="tr-grid">
              <NumberField
                label="Bodyweight (kg, optional)"
                value={check.weight}
                max={600}
                step={0.1}
                onChange={(weight) => checkin({ weight })}
              />
              <NumberField
                label="Walking today (minutes)"
                value={check.walking}
                max={1440}
                onChange={(walking) => checkin({ walking })}
              />
            </div>
            <Button onClick={() => checkin({ walking: 80 })}>
              Log gym walk · 40 + 40 min
            </Button>
            <label className="tr-check">
              <input
                type="checkbox"
                checked={check.concerning}
                onChange={(e) => checkin({ concerning: e.target.checked })}
              />
              Persistent or worsening swelling/lump, weakness, numbness or
              significant wrist pain
            </label>
          </details>
          {check.concerning && (
            <p className="tr-notice">
              Arrange a professional medical assessment for these wrist
              symptoms.
            </p>
          )}
          {Math.max(check.wrist, check.ankle) >= 3 && (
            <p className="tr-notice">
              Review or stop movements that aggravate symptoms. Progression is
              on hold.
            </p>
          )}
        </Card>
      </div>
      {pending.map((s) => (
        <Card key={s.id} title={`Next-morning check-in · ${s.date}`}>
          <p>Record the symptoms you experienced the following morning.</p>
          <SymptomFields
            data={data}
            session={s}
            kind="morning"
            update={(fn) => sessionChange(s.id, fn)}
          />
        </Card>
      ))}
      <Card title="On the plan">
        <div className="tr-list">
          {day.exercises.length ? (
            day.exercises.map((p) => {
              const e = data.exercises.find((x) => x.id === p.exerciseId),
                last = lastSession(data, e.id);
              return (
                <div key={e.id} className="tr-row">
                  <div>
                    <h3>{e.name}</h3>
                    <Prescription p={p} e={e} />
                  </div>
                  <p className="tr-muted">
                    {last
                      ? `Last · ${exerciseSets(last, e.id)
                          .map((s) => displaySet(s, e))
                          .join(" / ")}`
                      : "First session · establish a comfortable baseline"}
                  </p>
                </div>
              );
            })
          ) : (
            <p>No strength work scheduled. Recovery counts too.</p>
          )}
        </div>
      </Card>
      {data.recovery.enabled && (
        <Card title="Temporary Ankle Recovery">
          <p>
            Separate from your permanent training plan. Your gym walk already
            adds around 80 minutes of lower-body workload.
          </p>
          <Field label="Recovery / mobility notes">
            <textarea
              value={check.recovery}
              onChange={(e) => checkin({ recovery: e.target.value })}
              placeholder="Record your existing recovery work and response"
            />
          </Field>
          {data.recovery.notes && <p>{data.recovery.notes}</p>}
        </Card>
      )}
      <Card title="Recent sessions & strict-form records">
        {personalRecords(data)
          .slice(0, 3)
          .map((r, i) => (
            <p key={i}>
              <strong>PR · {r.exercise}</strong> · {r.value} {r.unit}
              {r.load ? ` at ${r.load} kg` : ""}
              {r.side !== "both" ? ` · ${r.side}` : ""} · {r.date}
            </p>
          ))}
        {recent.length ? (
          recent.map((s) => (
            <p key={s.id}>
              {s.date} · {s.name} · {s.sets.length} sets · {s.status}
            </p>
          ))
        ) : (
          <p>Your first clean sets will establish your personal records.</p>
        )}
        <Button onClick={() => go("Progress")}>View records & trends →</Button>
      </Card>
    </>
  );
}
export function SymptomFields({ data, session, kind, update }) {
  return (
    <div className="tr-grid">
      {[...new Set(session.sets.map((s) => s.exerciseId))].map((id) => (
        <Field
          key={id}
          label={`${data.exercises.find((e) => e.id === id)?.name} · pain /10`}
        >
          <select
            value={session[kind][id] ?? ""}
            onChange={(e) =>
              update((s) => ({
                ...s,
                [kind]: { ...s[kind], [id]: Number(e.target.value) },
              }))
            }
          >
            <option value="" disabled>
              Not recorded
            </option>
            {Array.from({ length: 11 }, (_, i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </Field>
      ))}
    </div>
  );
}
