import { cloneElement, useEffect, useId, useState } from "react";
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
} from "./trainingData";
import { TrainingGoals } from "./TrainingGoals";
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
  const id = useId();
  return (
    <div className="tr-field">
      <label htmlFor={id}>{label}</label>
      {children ? cloneElement(children, { id }) : <input id={id} {...props} />}
    </div>
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
  const [tab, setTab] = useState(() => {
    const section = new URLSearchParams(location.search).get("section");
    return [
      "Today",
      "Active Workout",
      "Calendar/History",
      "Progress",
      "Exercise Library",
      "Training Plan",
      "Settings",
    ].includes(section)
      ? section
      : "Today";
  });
  const orderedTabs = [
    "Today",
    "Active Workout",
    "Calendar/History",
    "Progress",
    "Exercise Library",
  ];
  const labels = {
    Today: "Overview",
    "Active Workout": "Workout",
    "Calendar/History": "Calendar",
    "Exercise Library": "Exercises",
  };
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  function go(next) {
    setTab(next);
    window.scrollTo({ top: 0 });
    const url = new URL(location.href);
    url.searchParams.set("section", next);
    history.replaceState({}, "", url);
  }
  const active = data?.sessions.find((s) => s.status === "active");
  function begin(empty = false) {
    if (active) {
      go("Active Workout");
      return;
    }
    if (
      change((d) => {
        const session = startSession(
          empty
            ? {
                ...d,
                plan: {
                  ...d.plan,
                  days: d.plan.days.map((day) => ({
                    ...day,
                    name: "Custom workout",
                    exercises: [],
                  })),
                },
              }
            : d,
        );
        d.sessions.push(session);
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
            <p>Your sets, your progress, your next personal best.</p>
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
          {orderedTabs.map((t) => (
            <button
              key={t}
              type="button"
              aria-current={tab === t ? "page" : undefined}
              onClick={() => go(t)}
            >
              {labels[t] || t}
            </button>
          ))}
        </nav>
        <div className="tr-actions tr-secondary-nav">
          <Button
            aria-pressed={tab === "Training Plan"}
            onClick={() => go("Training Plan")}
          >
            Weekly plan
          </Button>
          <Button
            aria-pressed={tab === "Settings"}
            onClick={() => go("Settings")}
          >
            Backup & settings
          </Button>
        </div>
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
            {tab === "Progress" && (
              <>
                <TrainingGoals data={data} change={change} />
                <Progress data={data} change={change} />
              </>
            )}
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
export function Today({ data, begin, active, go }) {
  const today = localDate();
  const day = data.plan.days[dayIndex(today)];
  const recent = [...data.sessions]
    .filter((s) => s.status !== "active" && s.sets.length)
    .sort((a, b) => b.date.localeCompare(a.date) || b.started - a.started)
    .slice(0, 4);
  const start = new Date(`${today}T12:00:00`);
  start.setDate(start.getDate() - dayIndex(today));
  const weekSessions = data.sessions.filter(
    (s) =>
      s.date >= localDate(start) &&
      s.date <= today &&
      s.status !== "active" &&
      s.sets.length,
  );
  return (
    <>
      <div className="tr-grid">
        <Card
          className="tr-hero"
          title={active ? "Your workout is in progress" : day.name}
        >
          <span className="tr-eyebrow">
            {new Date(`${today}T12:00:00`).toLocaleDateString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </span>
          <p>
            {active
              ? `${active.sets.length} sets saved. Pick up where you left off.`
              : `${day.exercises.length} planned exercises. Record each set and compare it with last time.`}
          </p>
          <div className="tr-actions">
            <Button primary onClick={() => begin(false)}>
              {active ? "Resume workout" : "Start planned workout"} →
            </Button>
            {!active && (
              <Button onClick={() => begin(true)}>Start empty workout</Button>
            )}
          </div>
        </Card>
        <Card title="This week">
          <div className="tr-stats">
            <div>
              <strong>{weekSessions.length}</strong>
              <span>workouts logged</span>
            </div>
            <div>
              <strong>
                {weekSessions.reduce((n, s) => n + s.sets.length, 0)}
              </strong>
              <span>sets completed</span>
            </div>
          </div>
          <p className="tr-muted">
            Build consistency. Every saved set adds to your history.
          </p>
          <Button onClick={() => go("Progress")}>
            View progress & goals →
          </Button>
        </Card>
      </div>
      <Card title="Today's exercises">
        <div className="tr-toolbar">
          <p className="tr-muted">
            Your previous performance is here so you know where to start.
          </p>
          <Button onClick={() => go("Training Plan")}>Edit weekly plan</Button>
        </div>
        <div className="tr-list">
          {day.exercises.map((p) => {
            const e = data.exercises.find((x) => x.id === p.exerciseId),
              last = lastSession(data, e.id);
            return (
              <div className="tr-row tr-overview-exercise" key={e.id}>
                <div>
                  <h3>{e.name}</h3>
                  <Prescription p={p} e={e} />
                </div>
                <div className="tr-previous">
                  <span className="tr-eyebrow">
                    {last ? `Last trained · ${last.date}` : "First session"}
                  </span>
                  <p>
                    {last
                      ? exerciseSets(last, e.id)
                          .map((s) => displaySet(s, e))
                          .join(" / ")
                      : "Log a set to establish your starting point."}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
        {!day.exercises.length && (
          <p>
            Nothing scheduled today. Start an empty workout and add any
            exercises you want to train.
          </p>
        )}
      </Card>
      <Card title="Recent workouts">
        {recent.length ? (
          recent.map((s) => (
            <div className="tr-row tr-toolbar" key={s.id}>
              <div>
                <h3>{s.name}</h3>
                <p className="tr-muted">
                  {s.date} · {s.sets.length} sets · {s.status}
                </p>
              </div>
              <p>
                {s.exercises
                  .filter((p) => exerciseSets(s, p.exerciseId).length)
                  .map(
                    (p) =>
                      data.exercises.find((e) => e.id === p.exerciseId)?.name,
                  )
                  .join(", ")}
              </p>
            </div>
          ))
        ) : (
          <p>Your workouts will appear here after your first session.</p>
        )}
        <Button onClick={() => go("Calendar/History")}>
          Open calendar & history →
        </Button>
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
