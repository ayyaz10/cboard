import { useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { Button, Card, Field, SymptomFields } from "./Training";
import {
  localDate,
  dayIndex,
  exerciseSets,
  displaySet,
  progression,
  uid,
  safeUrl,
} from "./trainingData";
export function History({ data, change, sessionChange }) {
  const [date, setDate] = useState(localDate()),
    [month, setMonth] = useState(localDate().slice(0, 7));
  const first = new Date(`${month}-01T12:00:00`),
    count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const selected = data.sessions.filter((s) => s.date === date);
  function move(delta) {
    const next = new Date(first);
    next.setMonth(next.getMonth() + delta);
    setMonth(localDate(next).slice(0, 7));
  }
  return (
    <>
      <Card title="Calendar & history">
        <div className="tr-toolbar">
          <Button onClick={() => move(-1)} aria-label="Previous month">
            ←
          </Button>
          <h3>
            {first.toLocaleDateString(undefined, {
              month: "long",
              year: "numeric",
            })}
          </h3>
          <Button onClick={() => move(1)} aria-label="Next month">
            →
          </Button>
        </div>
        <p className="tr-muted">
          ✓ Completed · ◐ Partial · – Skipped · ○ Planned · ≈ Recovery · !
          Symptoms
        </p>
        <div className="tr-calendar">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <strong key={d}>{d}</strong>
          ))}
          {Array.from({ length: dayIndex(`${month}-01`) }, (_, i) => (
            <span key={`blank${i}`} />
          ))}
          {Array.from({ length: count }, (_, i) => {
            const key = `${month}-${String(i + 1).padStart(2, "0")}`,
              sessions = data.sessions.filter((s) => s.date === key),
              planned = data.plan.days[dayIndex(key)],
              status = sessions.some((s) => s.status === "active")
                ? "active"
                : sessions.some((s) => s.status === "completed")
                  ? "completed"
                  : sessions.some((s) => s.status === "partial")
                    ? "partial"
                    : sessions.length
                      ? "skipped"
                      : planned.exercises.length
                        ? "planned"
                        : "recovery",
              flag =
                sessions.some(
                  (s) =>
                    s.sets.some((x) => x.pain >= 3) ||
                    Object.values(s.after).some((n) => n >= 3) ||
                    Object.values(s.morning).some((n) => n >= 3),
                ) ||
                Math.max(
                  data.checkins[key]?.wrist || 0,
                  data.checkins[key]?.ankle || 0,
                ) >= 3;
            return (
              <button
                key={key}
                className={`tr-day tr-${status}`}
                aria-pressed={key === date}
                aria-label={`${key}, ${planned.name}, ${status}${flag ? ", symptom flag" : ""}`}
                onClick={() => setDate(key)}
              >
                <b>{i + 1}</b>
                <span>
                  {
                    {
                      completed: "✓",
                      partial: "◐",
                      skipped: "–",
                      planned: "○",
                      recovery: "≈",
                      active: "▶",
                    }[status]
                  }{" "}
                  {flag ? "!" : ""}
                </span>
                <small>{status}</small>
              </button>
            );
          })}
        </div>
      </Card>
      <Card title={`${date} · ${data.plan.days[dayIndex(date)].name}`}>
        <Field
          label="Open date"
          type="date"
          value={date}
          onChange={(e) => {
            if (e.target.value) {
              setDate(e.target.value);
              setMonth(e.target.value.slice(0, 7));
            }
          }}
        />
        {!selected.length ? (
          <>
            <p>
              No session logged.{" "}
              {data.plan.days[dayIndex(date)].exercises.length
                ? "Planned workout"
                : "Recovery day"}
              .
            </p>
            {date <= localDate() &&
              data.plan.days[dayIndex(date)].exercises.length > 0 && (
                <Button
                  onClick={() =>
                    change((d) => {
                      d.sessions.push({
                        id: uid(),
                        date,
                        name: d.plan.days[dayIndex(date)].name,
                        status: "skipped",
                        started: Date.now(),
                        ended: Date.now(),
                        pausedAt: null,
                        pausedMs: 0,
                        restUntil: null,
                        restRemaining: 0,
                        exercises: structuredClone(
                          d.plan.days[dayIndex(date)].exercises,
                        ),
                        sets: [],
                        skipped: [],
                        index: 0,
                        after: {},
                        morning: {},
                        notes: "",
                      });
                      return d;
                    })
                  }
                >
                  Mark planned workout skipped
                </Button>
              )}
          </>
        ) : (
          selected.map((s) => (
            <div key={s.id} className="tr-history">
              <h3>
                {s.name} · {s.status}
              </h3>
              <p>
                {s.sets.length} logged sets ·{" "}
                {s.ended
                  ? Math.round((s.ended - s.started - s.pausedMs) / 60000)
                  : "In progress"}{" "}
                min
              </p>
              {s.notes && <p>{s.notes}</p>}
              {s.exercises.map((p) => {
                const e = data.exercises.find((e) => e.id === p.exerciseId),
                  sets = exerciseSets(s, e.id);
                return (
                  !!sets.length && (
                    <details key={e.id}>
                      <summary>
                        {e.name} · {sets.length} sets
                      </summary>
                      {sets.map((set, i) => (
                        <p key={set.id}>
                          {i + 1}. {displaySet(set, e)} · {set.rir} RIR · pain{" "}
                          {set.pain}/10
                          {set.mistakes.length
                            ? ` · ${set.mistakes.join(", ")}`
                            : ""}
                          {set.notes ? ` · ${set.notes}` : ""}
                          {safeUrl(set.attachment?.url) && (
                            <>
                              {" "}
                              ·{" "}
                              <a
                                href={safeUrl(set.attachment.url)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Video ↗
                              </a>
                            </>
                          )}
                        </p>
                      ))}
                    </details>
                  )
                );
              })}
              {!!s.sets.length && (
                <>
                  <details>
                    <summary>Pain immediately afterward</summary>
                    <SymptomFields
                      data={data}
                      session={s}
                      kind="after"
                      update={(fn) => sessionChange(s.id, fn)}
                    />
                  </details>
                  {s.date < localDate() && (
                    <details>
                      <summary>Following-morning symptoms</summary>
                      <SymptomFields
                        data={data}
                        session={s}
                        kind="morning"
                        update={(fn) => sessionChange(s.id, fn)}
                      />
                    </details>
                  )}
                </>
              )}
              {s.status !== "active" && (
                <Button
                  onClick={() => {
                    if (
                      window.confirm("Delete this session and its logged sets?")
                    )
                      change((d) => ({
                        ...d,
                        sessions: d.sessions.filter((x) => x.id !== s.id),
                      }));
                  }}
                >
                  Delete session
                </Button>
              )}
            </div>
          ))
        )}
        {data.checkins[date] && (
          <p>
            Walking: {data.checkins[date].walking} min · wrist{" "}
            {data.checkins[date].wrist}/10 · ankle {data.checkins[date].ankle}
            /10 · {data.checkins[date].recovery}
          </p>
        )}
      </Card>
    </>
  );
}
const average = (values) =>
  values.length
    ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
    : 0;
function Chart({ title, rows, keys }) {
  return (
    <Card title={title}>
      {rows.length ? (
        <>
          <div className="tr-chart" aria-label={title}>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "currentColor", fontSize: 11 }}
                />
                <YAxis tick={{ fill: "currentColor", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    background: "var(--tr-surface)",
                    color: "var(--tr-text)",
                    border: "1px solid var(--tr-border)",
                  }}
                />
                {keys.map((key, i) => (
                  <Line
                    key={key}
                    name={key}
                    dataKey={key}
                    stroke={["#248146", "#6d65df", "#b25517"][i % 3]}
                    strokeWidth={3}
                    dot={rows.length < 15}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="tr-muted">{keys.join(" · ")}</p>
          <details>
            <summary>Accessible data table</summary>
            <div className="tr-table">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    {keys.map((k) => (
                      <th key={k}>{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.date}${i}`}>
                      <td>{r.date}</td>
                      {keys.map((k) => (
                        <td key={k}>{r[k] ?? "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p>Log a session to see this trend.</p>
      )}
    </Card>
  );
}
export function Progress({ data, change }) {
  const [id, setId] = useState(data.exercises[0].id),
    [message, setMessage] = useState("");
  const e = data.exercises.find((x) => x.id === id);
  const sessions = data.sessions
    .filter((s) => s.status !== "active")
    .sort((a, b) => a.date.localeCompare(b.date));
  const relevant = sessions.filter((s) => exerciseSets(s, id).length),
    latest = relevant.at(-1),
    p = latest?.exercises.find((p) => p.exerciseId === id),
    suggestion = p ? progression(data, latest, p, e) : null;
  const rows = relevant.map((s) => {
    const sets = exerciseSets(s, id);
    return {
      date: s.date,
      reps: Math.max(...sets.map((x) => x.reps)),
      load: Math.max(...sets.map((x) => x.load)),
      seconds: Math.max(...sets.map((x) => x.seconds)),
      RIR: average(sets.map((x) => x.rir)),
      clean: Math.round(
        (sets.filter((x) => x.technique === "Clean").length / sets.length) *
          100,
      ),
      pain: Math.max(
        ...sets.map((x) => x.pain),
        s.after[id] || 0,
        s.morning[id] || 0,
      ),
      balance: Math.round(
        (sets.filter((x) => x.skill?.successful).length / sets.length) * 100,
      ),
      totalHold: sets.reduce((n, x) => n + x.seconds, 0),
      attempts: sets.length,
    };
  });
  const qualifying = relevant
    .flatMap((s) => exerciseSets(s, id))
    .filter(
      (s) =>
        s.technique === "Clean" ||
        (data.settings.prStandard === "Acceptable" &&
          s.technique === "Acceptable"),
    );
  const best = qualifying.length
    ? Math.max(
        ...qualifying.map((s) =>
          ["hold", "timed", "skill"].includes(e.type) ? s.seconds : s.reps,
        ),
      ) || null
    : null;
  const weeks = {};
  for (const s of sessions) {
    const d = new Date(`${s.date}T12:00:00`);
    d.setDate(d.getDate() - dayIndex(s.date));
    const date = localDate(d);
    weeks[date] ??= { date, completed: new Set(), sets: 0 };
    if (s.status === "completed" && s.exercises.length > 0)
      weeks[date].completed.add(s.date);
    weeks[date].sets += s.sets.length;
  }
  const muscles = {},
    volumes = {};
  for (const s of sessions)
    for (const set of s.sets) {
      const exercise = data.exercises.find((e) => e.id === set.exerciseId);
      volumes[exercise.name] ??= { sets: 0, reps: 0, load: 0 };
      volumes[exercise.name].sets++;
      volumes[exercise.name].reps += set.reps;
      volumes[exercise.name].load += set.reps * set.load;
      for (const muscle of exercise.muscles
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean))
        muscles[muscle] = (muscles[muscle] || 0) + 1;
    }
  const checkins = Object.entries(data.checkins)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, c]) => ({
      date,
      weight: c.weight || null,
      walking: c.walking,
      wrist: c.wrist,
      ankle: c.ankle,
    }));
  const weekTwo =
    Date.now() - new Date(`${data.plan.start}T00:00:00`).getTime() >=
    7 * 86400000;
  const appliedKey = latest ? `${latest.id}:${id}` : "";
  function apply() {
    if (
      !window.confirm(
        `${suggestion.reason} Apply this small change to future prescriptions for ${e.name}?`,
      )
    )
      return;
    const ok = change((d) => {
      if (d.appliedProgressions?.includes(appliedKey))
        throw new Error(
          "This progression was already applied. Complete another session before progressing again.",
        );
      for (const day of d.plan.days)
        for (const item of day.exercises)
          if (item.exerciseId === id) {
            if (suggestion.field === "load")
              item.load =
                Math.max(
                  item.load,
                  ...exerciseSets(latest, id).map((s) => s.load),
                ) + suggestion.amount;
            else if (e.type === "skill") {
              item.min =
                Math.max(
                  item.min,
                  Math.min(...exerciseSets(latest, id).map((s) => s.seconds)),
                ) + 1;
              item.max = Math.max(item.max, item.min);
            } else {
              item.min += 1;
              item.max += 1;
            }
          }
      d.appliedProgressions = [...(d.appliedProgressions || []), appliedKey];
      return d;
    });
    if (ok) setMessage("Confirmed progression applied to future workouts.");
  }
  return (
    <>
      <Card title="Progress that earns the next step">
        <Field label="Exercise">
          <select
            value={id}
            onChange={(event) => {
              setId(event.target.value);
              setMessage("");
            }}
          >
            {data.exercises.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="tr-grid">
          <div>
            <h3>Personal record</h3>
            <p className="tr-big">
              {best ?? "—"}{" "}
              <small>
                {["hold", "timed", "skill"].includes(e.type) ? "sec" : "reps"}
              </small>
            </p>
            <p>
              {data.settings.prStandard} standard · {qualifying.length}{" "}
              qualifying sets
            </p>
            {qualifying.some((s) => s.load > 0) && (
              <p>
                Best recorded{" "}
                {e.type === "assisted"
                  ? "assistance (lower is harder)"
                  : "external load"}
                :{" "}
                {e.type === "assisted"
                  ? Math.min(...qualifying.map((s) => s.load))
                  : Math.max(...qualifying.map((s) => s.load))}{" "}
                kg
              </p>
            )}
          </div>
          <div>
            <h3>Previous-session comparison</h3>
            {rows.length > 1 ? (
              <p>
                Reps {rows.at(-1).reps - rows.at(-2).reps >= 0 ? "+" : ""}
                {rows.at(-1).reps - rows.at(-2).reps} · hold{" "}
                {rows.at(-1).seconds - rows.at(-2).seconds}s · load{" "}
                {rows.at(-1).load - rows.at(-2).load} kg
              </p>
            ) : (
              <p>Complete two sessions to compare.</p>
            )}
          </div>
        </div>
      </Card>
      <Card
        title={
          suggestion?.kind === "review"
            ? "Review this movement"
            : "Next step · rule-based suggestion"
        }
      >
        <p>
          {suggestion?.reason ||
            "Complete a workout to receive a transparent suggestion."}
        </p>
        {suggestion?.field && (
          <>
            <p className="tr-muted">
              Uses the latest session’s targets, clean technique, target RIR and
              all three symptom checks. Your program never changes
              automatically.
            </p>
            <Button
              disabled={
                !!message ||
                data.appliedProgressions?.includes(appliedKey) ||
                (data.settings.phase === 1 && !weekTwo)
              }
              onClick={apply}
            >
              {data.appliedProgressions?.includes(appliedKey)
                ? "Progression already applied"
                : "Confirm small progression"}
            </Button>
            {data.settings.phase === 1 && !weekTwo && (
              <p>Re-entry rep increases become available in week two.</p>
            )}
          </>
        )}
        <p role="status">{message}</p>
      </Card>
      <div className="tr-grid">
        {!["hold", "timed", "skill"].includes(e.type) && (
          <Chart
            title={
              e.type === "assisted"
                ? "Reps & assistance (kg)"
                : "Reps & load (kg)"
            }
            rows={rows}
            keys={["reps", "load"]}
          />
        )}
        {["hold", "timed", "skill"].includes(e.type) && (
          <Chart
            title={
              id === "lever"
                ? "Front-lever hold progression (sec)"
                : "Hold progression (sec)"
            }
            rows={rows}
            keys={["seconds"]}
          />
        )}
        {e.type === "skill" && (
          <>
            <Chart
              title="Handstand balance success (%)"
              rows={rows}
              keys={["balance"]}
            />
          </>
        )}
        {e.type !== "skill" && (
          <Chart title="Clean technique (%)" rows={rows} keys={["clean"]} />
        )}
      </div>
      <details>
        <summary>Technique, effort, symptoms & weekly adherence</summary>
        <div className="tr-grid">
          {e.type === "skill" && (
            <>
              <Chart
                title="Handstand practice · total hold & attempts"
                rows={rows}
                keys={["totalHold", "attempts"]}
              />
              <Chart title="Clean technique (%)" rows={rows} keys={["clean"]} />
            </>
          )}
          <Chart title="RIR trend" rows={rows} keys={["RIR"]} />
          <Chart
            title="Highest recorded pain /10"
            rows={rows}
            keys={["pain"]}
          />
          <Chart
            title="Weekly adherence & logged sets"
            rows={Object.values(weeks).map((w) => ({
              date: w.date,
              completed: w.completed.size,
              sets: w.sets,
            }))}
            keys={["completed", "sets"]}
          />
        </div>
      </details>
      <details>
        <summary>Bodyweight, walking & joint trends</summary>
        <div className="tr-grid">
          <Chart
            title="Bodyweight (kg)"
            rows={checkins.filter((r) => r.weight)}
            keys={["weight"]}
          />
          <Chart
            title="Walking workload (minutes)"
            rows={checkins}
            keys={["walking"]}
          />
          <Chart
            title="Wrist & ankle symptoms /10"
            rows={checkins}
            keys={["wrist", "ankle"]}
          />
        </div>
      </details>
      <details>
        <summary>Training volume by exercise & muscle</summary>
        <Card title="Recorded workload">
          <p className="tr-muted">
            External volume = reps × external kg. Assisted kg represents
            assistance, not lifted weight. Muscle sets overlap for compound
            exercises.
          </p>
          <div className="tr-table">
            <table>
              <thead>
                <tr>
                  <th>Exercise</th>
                  <th>Sets</th>
                  <th>Reps</th>
                  <th>Reps × kg</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(volumes).map(([name, v]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{v.sets}</td>
                    <td>{v.reps}</td>
                    <td>{v.load}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!Object.keys(volumes).length && <p>No recorded volume yet.</p>}
          <div className="tr-grid">
            {Object.entries(muscles).map(([name, sets]) => (
              <p key={name}>
                {name} · {sets} sets
              </p>
            ))}
          </div>
        </Card>
      </details>
    </>
  );
}
