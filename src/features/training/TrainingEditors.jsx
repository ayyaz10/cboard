import { useState } from "react";
import { Button, Card, Field, NumberField } from "./Training";
import {
  csv,
  uid,
  validateState,
  safeUrl,
  safeImage,
  exercisePrescription,
} from "./trainingData";
export function download(name, content, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function PlanEditor({ data, change }) {
  const [day, setDay] = useState(0),
    [draft, setDraft] = useState(() => structuredClone(data.plan)),
    [message, setMessage] = useState("");
  function patch(index, key, value) {
    setDraft((d) => ({
      ...d,
      days: d.days.map((v, i) =>
        i === day
          ? {
              ...v,
              exercises: v.exercises.map((p, j) =>
                j === index ? { ...p, [key]: value } : p,
              ),
            }
          : v,
      ),
    }));
  }
  function remove(index) {
    if (
      window.confirm(
        "Remove this exercise from the planned day? Existing session logs are preserved.",
      )
    )
      setDraft((d) => ({
        ...d,
        days: d.days.map((v, i) =>
          i === day
            ? { ...v, exercises: v.exercises.filter((_, j) => j !== index) }
            : v,
        ),
      }));
  }
  const current = draft.days[day];
  return (
    <>
      <Card title="Your weekly plan">
        <p>
          Choose your training days, add exercises and set your targets. Changes
          apply to your next workout.
        </p>
        <details>
          <summary>Programme settings</summary>
          <p>
            Phase 1: conservative loads, standardized clean technique, usually
            at least 2 RIR. In week two, add a rep only with clean technique and
            no symptom increase. This weekly schedule repeats; phase changes are
            always explicit.
          </p>
          <p>
            Phase 2 uses two working sets for exercises marked “Main strength”,
            usually at 1–2 RIR. Existing active workouts retain their
            prescription.
          </p>
          <div className="tr-grid">
            <Field
              label="Plan name"
              value={draft.name}
              onChange={(e) =>
                setDraft((d) => ({ ...d, name: e.target.value }))
              }
            />
            <Field
              label="Re-entry start date"
              type="date"
              value={draft.start}
              onChange={(e) =>
                setDraft((d) => ({ ...d, start: e.target.value }))
              }
            />
            <Field label="Program phase">
              <select
                value={data.settings.phase}
                onChange={(e) => {
                  const phase = Number(e.target.value);
                  if (
                    window.confirm(
                      `Switch to Phase ${phase}? This changes future sessions only.`,
                    )
                  )
                    change((d) => {
                      d.settings.phase = phase;
                      return d;
                    });
                }}
              >
                <option value={1}>1 · Re-entry / calibration</option>
                <option value={2}>2 · Proper two-set method</option>
              </select>
            </Field>
          </div>
        </details>
      </Card>
      <Card title="Edit the weekly schedule">
        <div className="tr-tabs">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name, i) => (
            <Button
              key={name}
              aria-pressed={day === i}
              onClick={() => setDay(i)}
            >
              {name}
            </Button>
          ))}
        </div>
        <Field
          label="Workout name"
          value={current.name}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              days: d.days.map((v, i) =>
                i === day ? { ...v, name: e.target.value } : v,
              ),
            }))
          }
        />
        {!current.exercises.length && (
          <p>Recovery / rest day. Walking and mobility are optional.</p>
        )}
        {current.exercises.map((p, index) => {
          const e = data.exercises.find((x) => x.id === p.exerciseId);
          return (
            <details key={p.exerciseId}>
              <summary>
                {index + 1}. {e.name} · {p.sets} × {p.min}–{p.max}
              </summary>
              <div className="tr-grid">
                {[
                  ["sets", "Sets / attempts", 1, 50],
                  ["min", "Minimum reps / seconds", 0, 86400],
                  ["max", "Maximum reps / seconds", 0, 86400],
                  ["rest", "Rest seconds", 0, 3600],
                  ["rir", "Target RIR", 0, 10],
                  ["load", "Starting load / assistance kg", 0, 2000],
                ].map(([key, label, min, max]) => (
                  <NumberField
                    key={key}
                    label={label}
                    value={p[key]}
                    min={min}
                    max={max}
                    step={key === "load" ? 0.5 : 1}
                    onChange={(value) => patch(index, key, value)}
                  />
                ))}
                {e.type === "skill" && (
                  <Field
                    label="Practice minutes (range)"
                    value={p.minutes || ""}
                    onChange={(event) =>
                      patch(index, "minutes", event.target.value)
                    }
                  />
                )}
              </div>
              <div className="tr-actions">
                <Button
                  disabled={index === 0}
                  onClick={() =>
                    setDraft((d) => {
                      const next = structuredClone(d);
                      [
                        next.days[day].exercises[index - 1],
                        next.days[day].exercises[index],
                      ] = [
                        next.days[day].exercises[index],
                        next.days[day].exercises[index - 1],
                      ];
                      return next;
                    })
                  }
                >
                  Move up
                </Button>
                <Button onClick={() => remove(index)}>Remove exercise</Button>
              </div>
            </details>
          );
        })}
        <Field label="Add exercise">
          <select
            value=""
            onChange={(event) => {
              const exerciseId = event.target.value;
              setDraft((d) => ({
                ...d,
                days: d.days.map((v, i) =>
                  i === day
                    ? {
                        ...v,
                        exercises: [
                          ...v.exercises,
                          exercisePrescription(
                            data.exercises.find((e) => e.id === exerciseId),
                          ),
                        ],
                      }
                    : v,
                ),
              }));
            }}
          >
            <option value="" disabled>
              Choose from library
            </option>
            {data.exercises
              .filter(
                (e) =>
                  !e.archived &&
                  !current.exercises.some((p) => p.exerciseId === e.id),
              )
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
        </Field>
        <Button
          primary
          onClick={() => {
            if (
              change((d) => {
                d.plan = draft;
                return d;
              })
            )
              setMessage("Plan saved. Future workouts use this schedule.");
          }}
        >
          Save training plan
        </Button>
        <p role="status">{message}</p>
      </Card>
      <details>
        <summary>Optional recovery notes</summary>
        <Card title="Recovery">
          <label className="tr-check">
            <input
              type="checkbox"
              checked={data.recovery.enabled}
              onChange={(e) =>
                change((d) => {
                  d.recovery.enabled = e.target.checked;
                  return d;
                })
              }
            />
            Show temporary recovery section
          </label>
          <Field label="Your existing recovery instructions / notes">
            <textarea
              value={data.recovery.notes}
              onChange={(e) =>
                change((d) => {
                  d.recovery.notes = e.target.value;
                  return d;
                })
              }
            />
          </Field>
          <p className="tr-muted">
            Kept separate from your permanent workout schedule.
          </p>
        </Card>
      </details>
    </>
  );
}
export function Library({ data, change }) {
  const [query, setQuery] = useState("");
  const [edit, setEdit] = useState(null);
  const [message, setMessage] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const fresh = () =>
    Object.fromEntries([
      ...[
        "name",
        "pattern",
        "equipment",
        "purpose",
        "muscles",
        "secondary",
        "joints",
        "cues",
        "progressions",
        "regressions",
        "reference",
        "restrictions",
        "image",
      ].map((k) => [k, ""]),
      ["id", uid()],
      ["type", "bodyweight"],
      ["category", "Strength"],
      ["classification", "Strength"],
      ["unilateral", false],
      ["main", false],
      ["mistakes", []],
      ["timerSeconds", 60],
      ["restSeconds", 90],
      ["defaultSets", 3],
      ["defaultReps", 8],
    ]);
  async function upload(file) {
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 500000
    ) {
      setMessage("Choose a JPG, PNG or WebP image under 500 KB.");
      return;
    }
    const editingId = edit.id;
    try {
      const image = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setEdit((current) =>
        current?.id === editingId ? { ...current, image } : current,
      );
      setMessage("");
    } catch {
      setMessage("Could not read that image. Please try another file.");
    }
  }
  const filtered = data.exercises.filter(
    (e) =>
      !!e.archived === showArchived &&
      `${e.name} ${e.muscles} ${e.equipment}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <Card title="Your exercise library">
        <div className="tr-toolbar">
          <Field
            label="Search exercises"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button
            primary
            onClick={() => {
              setEdit(fresh());
              setMessage("");
            }}
          >
            + Create exercise
          </Button>
        </div>
        <p className="tr-muted">
          Set up an exercise once: reps or holds, timer, rest, a photo and a
          technique link.
        </p>
        <label className="tr-check">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show removed exercises
        </label>
      </Card>
      {edit && (
        <Card title={edit.name || "New exercise"}>
          <div className="tr-grid">
            <Field
              label="Exercise name"
              value={edit.name}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            />
            <Field label="Track">
              <select
                value={edit.type}
                onChange={(e) => setEdit({ ...edit, type: e.target.value })}
              >
                {[
                  ["bodyweight", "Bodyweight reps"],
                  ["weighted", "Reps + weight"],
                  ["assisted", "Reps + assistance"],
                  ["hold", "Hold (seconds)"],
                  ["timed", "Timed exercise"],
                  ["skill", "Skill practice"],
                ].map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <NumberField
              label="Default sets"
              min={1}
              max={50}
              value={edit.defaultSets ?? 3}
              onChange={(defaultSets) => setEdit({ ...edit, defaultSets })}
            />
            <NumberField
              label="Target reps / hold seconds"
              max={1000}
              value={edit.defaultReps ?? 8}
              onChange={(defaultReps) => setEdit({ ...edit, defaultReps })}
            />
            <NumberField
              label="Exercise timer (seconds)"
              min={1}
              max={3600}
              value={edit.timerSeconds ?? 60}
              onChange={(timerSeconds) => setEdit({ ...edit, timerSeconds })}
            />
            <NumberField
              label="Rest between sets (seconds)"
              max={3600}
              value={edit.restSeconds ?? 90}
              onChange={(restSeconds) => setEdit({ ...edit, restSeconds })}
            />
            <Field
              label="Equipment"
              value={edit.equipment}
              onChange={(e) => setEdit({ ...edit, equipment: e.target.value })}
            />
            <Field
              label="Muscles"
              value={edit.muscles}
              onChange={(e) => setEdit({ ...edit, muscles: e.target.value })}
            />
          </div>
          <Field label="Technique notes">
            <textarea
              value={edit.cues}
              onChange={(e) => setEdit({ ...edit, cues: e.target.value })}
            />
          </Field>
          <Field
            label="Technique / video link"
            type="url"
            value={edit.reference}
            onChange={(e) => setEdit({ ...edit, reference: e.target.value })}
          />
          <Field
            label="Image URL"
            type="url"
            value={edit.image?.startsWith("data:") ? "" : edit.image || ""}
            onChange={(e) => setEdit({ ...edit, image: e.target.value })}
          />
          <Field label="Or upload an image (JPG, PNG, WebP; up to 500 KB)">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => upload(e.target.files?.[0])}
            />
          </Field>
          {safeImage(edit.image) && (
            <>
              <img
                className="tr-exercise-image"
                src={safeImage(edit.image)}
                alt="Exercise preview"
              />
              <Button onClick={() => setEdit({ ...edit, image: "" })}>
                Remove image
              </Button>
            </>
          )}
          <label className="tr-check">
            <input
              type="checkbox"
              checked={edit.unilateral}
              onChange={(e) =>
                setEdit({ ...edit, unilateral: e.target.checked })
              }
            />
            Track left and right sides separately
          </label>
          <details>
            <summary>Additional exercise details</summary>
            {["purpose", "progressions", "regressions", "restrictions"].map(
              (key) => (
                <Field key={key} label={key}>
                  <textarea
                    value={edit[key]}
                    onChange={(e) =>
                      setEdit({ ...edit, [key]: e.target.value })
                    }
                  />
                </Field>
              ),
            )}
          </details>
          <div className="tr-actions">
            <Button
              primary
              onClick={() => {
                if (
                  change((d) => {
                    const item = { ...edit, name: edit.name.trim() };
                    d.exercises = d.exercises.some((e) => e.id === item.id)
                      ? d.exercises.map((e) => (e.id === item.id ? item : e))
                      : [...d.exercises, item];
                    return d;
                  })
                ) {
                  setMessage(
                    "Exercise saved. Add it to a workout or your weekly plan.",
                  );
                  setEdit(null);
                }
              }}
            >
              Save exercise
            </Button>
            <Button onClick={() => setEdit(null)}>Cancel</Button>
          </div>
        </Card>
      )}
      <p role="status">{message}</p>
      <div className="tr-grid">
        {filtered.map((e) => (
          <Card key={e.id} title={e.name}>
            {safeImage(e.image) && (
              <img
                className="tr-exercise-image"
                loading="lazy"
                src={safeImage(e.image)}
                alt={e.name}
              />
            )}
            <p className="tr-muted">
              {e.type} · {e.equipment || "No equipment specified"}
            </p>
            <div className="tr-actions">
              <span className="pill">{e.timerSeconds ?? 60}s timer</span>
              <span className="pill">{e.restSeconds ?? 90}s rest</span>
            </div>
            {e.cues && <p>{e.cues}</p>}
            {safeUrl(e.reference) && (
              <p>
                <a href={safeUrl(e.reference)} target="_blank" rel="noreferrer">
                  Watch technique ↗
                </a>
              </p>
            )}
            <div className="tr-actions">
              <Button
                onClick={() => {
                  setEdit(structuredClone(e));
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                Edit exercise
              </Button>
              <Button
                onClick={() => {
                  if (
                    change((d) => {
                      d.exercises = d.exercises.map((x) =>
                        x.id === e.id ? { ...x, archived: !e.archived } : x,
                      );
                      if (!e.archived)
                        d.plan.days.forEach((day) => {
                          day.exercises = day.exercises.filter(
                            (p) => p.exerciseId !== e.id,
                          );
                        });
                      return d;
                    })
                  )
                    setMessage(
                      e.archived
                        ? "Exercise restored."
                        : "Exercise removed from library and future plans. Saved workouts are kept.",
                    );
                }}
              >
                {e.archived ? "Restore exercise" : "Remove exercise"}
              </Button>
            </div>
          </Card>
        ))}
      </div>
      {!filtered.length && (
        <Card title="No matching exercises">
          <p>Create an exercise or try another search.</p>
        </Card>
      )}
    </>
  );
}
export function Settings({ data, store }) {
  const [incoming, setIncoming] = useState(null),
    [error, setError] = useState("");
  async function read(file) {
    try {
      if (!file) return;
      if (file.size > 4_000_000) throw new Error("Backup exceeds 4 MB.");
      const parsed = validateState(JSON.parse(await file.text()));
      setIncoming(parsed);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <>
      <Card title="Backup & restore">
        <p>
          Sets save locally immediately and sync to your signed-in Supabase
          account. Keep a JSON backup before resolving a conflict or replacing
          data.
        </p>
        <div className="tr-actions">
          <Button
            onClick={() =>
              download(
                `training-${new Date().toISOString().slice(0, 10)}.json`,
                JSON.stringify(data, null, 2),
              )
            }
          >
            Export JSON backup
          </Button>
          <Button
            onClick={() =>
              download("training-sets.csv", csv(data), "text/csv;charset=utf-8")
            }
          >
            Export CSV
          </Button>
        </div>
        <Field label="Restore JSON backup">
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => read(e.target.files?.[0])}
          />
        </Field>
        {error && <p role="alert">{error}</p>}
        {incoming && (
          <div className="tr-notice">
            <p>
              Validated schema {incoming.version}: {incoming.sessions.length}{" "}
              sessions and {incoming.exercises.length} exercises. Restoring
              replaces this account’s Training data.
            </p>
            <Button
              onClick={() => {
                if (
                  window.confirm(
                    "Replace all Training data with this backup? Export your current data first.",
                  ) &&
                  store.change(incoming)
                ) {
                  setIncoming(null);
                  setError("Backup restored.");
                }
              }}
            >
              Confirm restore
            </Button>
            <Button onClick={() => setIncoming(null)}>Cancel</Button>
          </div>
        )}
        <details>
          <summary>Resolve a cloud conflict</summary>
          <p>
            Export this device’s JSON first. Loading the cloud copy discards
            pending local changes.
          </p>
          <Button
            onClick={() => {
              if (
                window.confirm(
                  "Discard pending local changes and load the cloud copy?",
                )
              )
                store.loadCloud();
            }}
          >
            Load cloud copy
          </Button>
        </details>
      </Card>
      <Card title="Technique & current restrictions">
        <Field label="Personal-record technique standard">
          <select
            value={data.settings.prStandard}
            onChange={(e) =>
              store.change((d) => {
                d.settings.prStandard = e.target.value;
                return d;
              })
            }
          >
            <option>Clean</option>
            <option>Acceptable</option>
          </select>
        </Field>
        <p>
          Progression suggestions always require Clean technique, regardless of
          the personal-record standard.
        </p>
        <p>
          No floor handstands, wrist-loaded push-ups or flat-palm planche. Wrist
          loading progresses only with consistently low symptoms (0–2/10).
        </p>
        <label className="tr-check">
          <input
            type="checkbox"
            checked={data.settings.wristAssessed}
            onChange={(e) =>
              store.change((d) => {
                d.settings.wristAssessed = e.target.checked;
                return d;
              })
            }
          />
          Wrist loading has been assessed
        </label>
        <label className="tr-check">
          <input
            type="checkbox"
            checked={data.settings.dipsPainFree}
            onChange={(e) =>
              store.change((d) => {
                d.settings.dipsPainFree = e.target.checked;
                return d;
              })
            }
          />
          Bodyweight dips are pain-free during and the following day
        </label>
        <p>
          Weighted dips:{" "}
          {data.settings.wristAssessed && data.settings.dipsPainFree
            ? "prerequisites recorded; review before adding to plan"
            : "disabled until both prerequisites are met"}
          .
        </p>
        <p>
          Persistent or worsening wrist swelling/lump, weakness, numbness or
          significant pain warrants professional medical assessment. This
          tracker does not diagnose injuries.
        </p>
      </Card>
    </>
  );
}
