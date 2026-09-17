export const localDate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const dayIndex = (date) =>
  (new Date(`${date}T12:00:00`).getDay() + 6) % 7;
export const uid = () => crypto.randomUUID();
export const exerciseSets = (session, id) =>
  session?.sets.filter((s) => s.exerciseId === id) || [];
export const lastSession = (state, id) =>
  [...state.sessions]
    .sort((a, b) => b.date.localeCompare(a.date) || b.started - a.started)
    .find((s) => s.status !== "active" && exerciseSets(s, id).length);
export const displaySet = (s, e) =>
  `${["hold", "timed", "skill"].includes(e.type) ? `${s.seconds}s` : `${s.reps} reps`}${s.load ? ` · ${s.load} kg${e.type === "assisted" ? " assistance" : ""}` : ""}${e.unilateral ? ` · ${s.side}` : ""} · ${s.technique}`;
export const targetCount = (p, e) => p.sets * (e.unilateral ? 2 : 1);
/** @param {import('./models').TrainingState} state
 * @returns {import('./models').Session} */
export function startSession(state, date = localDate()) {
  if (state.sessions.some((s) => s.status === "active"))
    throw new Error("Resume or finish your active workout first.");
  const day = state.plan.days[dayIndex(date)];
  for (const p of day.exercises) {
    const e = state.exercises.find((e) => e.id === p.exerciseId);
    const restriction = exerciseRestriction(state, e, p.load);
    if (restriction) throw new Error(restriction);
  }
  return {
    id: uid(),
    date,
    name: day.name,
    status: "active",
    started: Date.now(),
    ended: null,
    pausedAt: null,
    pausedMs: 0,
    restUntil: null,
    restRemaining: 0,
    exercises: day.exercises.map((p) => ({
      ...p,
      sets:
        state.settings.phase === 2 &&
        state.exercises.find((e) => e.id === p.exerciseId)?.main
          ? 2
          : p.sets,
      rir: state.settings.phase === 2 ? 1 : p.rir,
    })),
    sets: [],
    skipped: [],
    index: 0,
    after: {},
    morning: {},
    notes: "",
  };
}
export function exerciseRestriction(state, e, load = 0) {
  const name = e.name.toLowerCase();
  if (
    (/handstand/.test(name) &&
      /floor/.test(`${name} ${e.equipment}`.toLowerCase())) ||
    (/push.?up/.test(name) &&
      !/parallette|handle|dumbbell/.test(e.equipment.toLowerCase())) ||
    (/planche/.test(name) &&
      !/parallette|handle/.test(e.equipment.toLowerCase()))
  )
    return "Current wrist restrictions exclude this movement. Use an approved neutral-wrist alternative.";
  if (
    /dip/.test(name) &&
    e.type !== "assisted" &&
    (e.type === "weighted" || load > 0) &&
    !(state.settings.wristAssessed && state.settings.dipsPainFree)
  )
    return "Weighted dips are disabled until wrist loading is assessed and bodyweight dips are pain-free during and the following day.";
  if (
    /pull.?up/.test(name) &&
    e.type !== "assisted" &&
    (e.type === "weighted" || load > 0)
  ) {
    const eligible = state.sessions.some(
      (s) =>
        s.status !== "active" &&
        s.after[e.id] != null &&
        s.morning[e.id] != null &&
        s.after[e.id] <= 2 &&
        s.morning[e.id] <= 2 &&
        exerciseSets(s, e.id).filter(
          (x) =>
            x.technique === "Clean" &&
            x.reps >= 6 &&
            x.load === 0 &&
            x.pain <= 2,
        ).length >= 3,
    );
    if (!eligible)
      return "Weighted pull-ups require 3 × 6–8 clean bodyweight reps with low during, after and next-morning symptoms.";
  }
  return "";
}
/** @param {import('./models').TrainingState} state
 * @param {import('./models').Session} session
 * @param {import('./models').Prescription} p
 * @param {import('./models').Exercise} e */
export function defaults(state, session, p, e) {
  const own = exerciseSets(session, e.id),
    prior = own.at(-1) || exerciseSets(lastSession(state, e.id), e.id).at(-1);
  return {
    reps: Math.max(prior?.reps ?? 0, p.min),
    seconds: Math.max(
      prior?.seconds ?? 0,
      ["hold", "timed", "skill"].includes(e.type) ? p.min : 0,
    ),
    load: own.at(-1)?.load ?? (p.load || prior?.load || 0),
    rir: p.rir,
    technique: "Clean",
    mistakes: [],
    pain: 0,
    side: e.unilateral ? (own.length % 2 ? "right" : "left") : "both",
    notes: "",
    attachment: null,
    skill:
      e.type === "skill"
        ? {
            method: prior?.skill?.method || "wall",
            surface: prior?.skill?.surface || "parallettes",
            successful: false,
            seconds: 0,
          }
        : null,
  };
}
export function completeSet(session, p, e, values) {
  if (session.status !== "active" || session.pausedAt)
    throw new Error("Resume the workout before logging.");
  validateSet({ ...values, exerciseId: e.id, id: "draft" });
  if (
    e.id === "handstand" &&
    !["parallettes", "dumbbells"].includes(values.skill?.surface)
  )
    throw new Error("Use parallettes or securely placed dumbbells.");
  const set = {
    ...structuredClone(values),
    id: uid(),
    exerciseId: e.id,
    at: Date.now(),
    rest: p.rest,
    skill: values.skill ? { ...values.skill, seconds: values.seconds } : null,
  };
  return {
    ...session,
    sets: [...session.sets, set],
    skipped: session.skipped.filter((id) => id !== e.id),
    restUntil: Date.now() + p.rest * 1000,
    restRemaining: 0,
  };
}
function numeric(value, min, max, label) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${label} must be between ${min} and ${max}.`);
}
function textValue(value, label, max = 10000) {
  if (typeof value !== "string" || value.length > max)
    throw new Error(`Invalid ${label}.`);
}
function dateValue(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    localDate(new Date(`${value}T12:00:00`)) !== value
  )
    throw new Error("Invalid calendar date.");
}
export function safeUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
export function validateSet(s) {
  for (const [key, max] of [
    ["reps", 1000],
    ["seconds", 86400],
    ["load", 2000],
    ["rir", 10],
    ["pain", 10],
  ])
    numeric(s[key], 0, max, key);
  if (
    !["Clean", "Acceptable", "Failed"].includes(s.technique) ||
    !["left", "right", "both"].includes(s.side) ||
    !Array.isArray(s.mistakes) ||
    s.mistakes.some((t) => typeof t !== "string")
  )
    throw new Error("Invalid set details.");
  if (
    s.attachment &&
    (!safeUrl(s.attachment.url) || s.attachment.kind !== "video")
  )
    throw new Error("Video must be an http or https link.");
  if (
    s.skill &&
    (!["wall", "block", "kick-up", "freestanding"].includes(s.skill.method) ||
      !["parallettes", "dumbbells"].includes(s.skill.surface) ||
      typeof s.skill.successful !== "boolean")
  )
    throw new Error("Invalid handstand attempt.");
  textValue(s.notes, "set notes");
}
export function validateState(value) {
  if (!value || value.version !== 1)
    throw new Error("Unsupported backup version. Expected Training schema 1.");
  if (
    !Array.isArray(value.exercises) ||
    !value.exercises.length ||
    !Array.isArray(value.sessions) ||
    !value.plan ||
    !Array.isArray(value.plan.days) ||
    value.plan.days.length !== 7 ||
    !value.checkins ||
    !value.settings ||
    !value.recovery
  )
    throw new Error("Incomplete Training backup.");
  if (
    ![1, 2].includes(value.settings.phase) ||
    !["Clean", "Acceptable"].includes(value.settings.prStandard)
  )
    throw new Error("Invalid settings.");
  for (const key of ["wristAssessed", "dipsPainFree"])
    if (typeof value.settings[key] !== "boolean")
      throw new Error("Invalid safety settings.");
  textValue(value.plan.name, "plan name");
  textValue(value.recovery.notes, "recovery notes");
  if (typeof value.recovery.enabled !== "boolean")
    throw new Error("Invalid recovery setting.");
  if (
    value.appliedProgressions &&
    (!Array.isArray(value.appliedProgressions) ||
      value.appliedProgressions.some((x) => typeof x !== "string"))
  )
    throw new Error("Invalid progression history.");
  const ids = new Set();
  for (const e of value.exercises) {
    if (
      typeof e.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(e.id) ||
      ["__proto__", "constructor", "prototype", "toString"].includes(e.id) ||
      ids.has(e.id) ||
      ![
        "bodyweight",
        "weighted",
        "assisted",
        "hold",
        "timed",
        "skill",
      ].includes(e.type)
    )
      throw new Error("Invalid or duplicate exercise.");
    ids.add(e.id);
    for (const k of [
      "name",
      "category",
      "pattern",
      "classification",
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
    ])
      if (typeof e[k] !== "string" || e[k].length > 10000)
        throw new Error(`Invalid exercise ${k}.`);
    if (
      !e.name.trim() ||
      !Array.isArray(e.mistakes) ||
      e.mistakes.some((t) => typeof t !== "string") ||
      typeof e.unilateral !== "boolean"
    )
      throw new Error("Invalid exercise details.");
    if (e.reference && !safeUrl(e.reference))
      throw new Error("Invalid reference URL.");
  }
  function prescription(p) {
    if (!ids.has(p.exerciseId)) throw new Error("Unknown exercise in plan.");
    for (const [k, min, max] of [
      ["sets", 1, 50],
      ["min", 0, 86400],
      ["max", 0, 86400],
      ["rest", 0, 3600],
      ["rir", 0, 10],
      ["load", 0, 2000],
    ])
      numeric(p[k], min, max, k);
    if (p.min > p.max || !Number.isInteger(p.sets))
      throw new Error("Invalid prescription range.");
  }
  for (const day of value.plan.days) {
    if (
      typeof day.name !== "string" ||
      !Array.isArray(day.exercises) ||
      new Set(day.exercises.map((p) => p.exerciseId)).size !==
        day.exercises.length
    )
      throw new Error("Invalid workout day.");
    day.exercises.forEach(prescription);
  }
  dateValue(value.plan.start);
  const sessions = new Set();
  let active = 0;
  for (const s of value.sessions) {
    if (
      !s.id ||
      sessions.has(s.id) ||
      !["active", "completed", "partial", "skipped"].includes(s.status) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(s.date) ||
      !Array.isArray(s.sets) ||
      !Array.isArray(s.exercises) ||
      !Array.isArray(s.skipped) ||
      !s.after ||
      !s.morning
    )
      throw new Error("Invalid session.");
    sessions.add(s.id);
    active += s.status === "active" ? 1 : 0;
    s.exercises.forEach(prescription);
    numeric(s.index, 0, Math.max(0, s.exercises.length - 1), "Exercise index");
    numeric(s.started, 0, 1e15, "Start time");
    numeric(s.pausedMs, 0, 1e15, "Paused time");
    for (const set of s.sets) {
      if (!ids.has(set.exerciseId)) throw new Error("Unknown exercise in set.");
      validateSet(set);
    }
    for (const ratings of [s.after, s.morning])
      for (const pain of Object.values(ratings)) numeric(pain, 0, 10, "Pain");
  }
  if (active > 1)
    throw new Error("A backup cannot contain multiple active sessions.");
  for (const s of value.sessions) {
    dateValue(s.date);
    textValue(s.name, "session name");
    textValue(s.notes, "session notes");
    if (!Number.isInteger(s.index)) throw new Error("Invalid exercise index.");
    for (const key of ["ended", "pausedAt", "restUntil"])
      if (s[key] !== null) numeric(s[key], 0, 1e15, key);
    numeric(s.restRemaining, 0, 3600000, "Remaining rest");
    if (new Set(s.sets.map((x) => x.id)).size !== s.sets.length)
      throw new Error("Duplicate set IDs.");
    for (const set of s.sets) {
      textValue(set.id, "set ID", 200);
      numeric(set.at, 0, 1e15, "Set time");
      numeric(set.rest, 0, 3600, "Rest");
    }
  }
  for (const [date, c] of Object.entries(value.checkins)) {
    dateValue(date);
    for (const k of ["energy", "sleep", "wrist", "ankle"])
      numeric(c[k], 0, 10, k);
    numeric(c.walking, 0, 1440, "Walking");
    numeric(c.weight, 0, 600, "Bodyweight");
    textValue(c.recovery, "recovery notes");
    if (typeof c.concerning !== "boolean")
      throw new Error("Invalid symptom check-in.");
  }
  if (JSON.stringify(value).length > 4_000_000)
    throw new Error(
      "Backup exceeds the 4 MB limit. Export older history before continuing.",
    );
  for (const s of value.sessions) {
    if (
      new Set(s.exercises.map((p) => p.exerciseId)).size !== s.exercises.length
    )
      throw new Error("Duplicate session exercises.");
    if (
      s.sets.some(
        (set) => !s.exercises.some((p) => p.exerciseId === set.exerciseId),
      )
    )
      throw new Error("Set has no session prescription.");
    for (const ratings of [s.after, s.morning])
      for (const id of Object.keys(ratings))
        if (!ids.has(id)) throw new Error("Unknown exercise in symptom check.");
  }
  return value;
}
/** @param {import('./models').TrainingState} state
 * @param {import('./models').Session} session
 * @param {import('./models').Prescription} p
 * @param {import('./models').Exercise} e */
export function progression(state, session, p, e) {
  const sets = exerciseSets(session, e.id),
    previous = lastSession(
      {
        ...state,
        sessions: state.sessions.filter(
          (s) => s.id !== session.id && s.date <= session.date,
        ),
      },
      e.id,
    );
  const pain = [
    ...sets.map((s) => s.pain),
    session.after[e.id],
    session.morning[e.id],
  ].filter((v) => v != null);
  const previousPain = previous
    ? Math.max(
        ...exerciseSets(previous, e.id).map((s) => s.pain),
        previous.after[e.id] || 0,
        previous.morning[e.id] || 0,
      )
    : null;
  if (
    pain.some((n) => n >= 3) ||
    (session.after[e.id] != null &&
      sets.length > 0 &&
      session.after[e.id] > Math.max(...sets.map((s) => s.pain))) ||
    (session.morning[e.id] != null &&
      session.after[e.id] != null &&
      session.morning[e.id] > session.after[e.id]) ||
    (/wrist/i.test(e.joints) &&
      (state.checkins[localDate()]?.wrist || 0) >= 3) ||
    (previousPain !== null && pain.some((n) => n > previousPain)) ||
    sets.filter((s) => s.technique === "Failed").length >= 2
  )
    return {
      kind: "review",
      reason:
        "Pain is elevated or increasing, or technique repeatedly failed. Stop or regress the aggravating movement and review it.",
    };
  if (
    sets.length < targetCount(p, e) ||
    sets.some((s) => s.technique !== "Clean" || s.rir < p.rir) ||
    session.after[e.id] == null ||
    session.morning[e.id] == null
  )
    return {
      kind: "maintain",
      reason:
        "Maintain: all prescribed sets must be clean, target RIR met, and during, after and next-morning pain recorded at 0–2/10.",
    };
  if (
    e.unilateral &&
    ["left", "right"].some(
      (side) => sets.filter((s) => s.side === side).length < p.sets,
    )
  )
    return {
      kind: "maintain",
      reason: "Maintain until both sides complete all prescribed sets.",
    };
  if (e.type === "skill") {
    if (
      sets.some((s) => s.seconds < Math.max(1, p.max)) ||
      sets.filter((s) => s.skill?.successful).length / sets.length < 0.8
    )
      return {
        kind: "maintain",
        reason:
          "Maintain the same method. Build clean hold time and at least 80% successful balance attempts before extending the hold target.",
      };
    return {
      kind: "skill",
      reason:
        "Clean holds, low symptoms and at least 80% balance success. Add one second to the hold target; keep the same method and equipment.",
      field: "min",
      amount: 1,
    };
  }
  const field = ["hold", "timed"].includes(e.type) ? "seconds" : "reps";
  if (sets.some((s) => s[field] < p.max))
    return {
      kind: "maintain",
      reason:
        "Performance recorded. Maintain until every set reaches the top of the target range.",
    };
  if (
    e.id === "pullup" &&
    (sets.length < 3 || sets.some((s) => s.reps < 6 || s.load > 0))
  )
    return {
      kind: "reps",
      reason:
        "Add one rep. Weighted pull-ups stay locked until 3 × 6–8 clean bodyweight reps meet symptom criteria.",
      field: "reps",
      amount: 1,
    };
  if (state.settings.phase === 1)
    return {
      kind: "reps",
      reason:
        "Clean sets and symptoms meet the criteria. In week two, add one rep (or one second for holds); keep loads conservative.",
      field: field === "seconds" ? "min" : "reps",
      amount: 1,
    };
  if (e.type === "weighted")
    return {
      kind: "load",
      reason:
        "All sets reached the top range with clean technique, target RIR and pain at 0–2. Consider adding 0.5 kg.",
      field: "load",
      amount: 0.5,
    };
  return {
    kind: "reps",
    reason:
      "All progression criteria met. Add one rep or one second, retaining controlled form.",
    field: field === "seconds" ? "min" : "reps",
    amount: 1,
  };
}
/** Strict records compare like-for-like external load / assistance and side. */
export function personalRecords(state) {
  const best = new Map(),
    records = [];
  for (const session of [...state.sessions]
    .filter((s) => s.status !== "active")
    .sort((a, b) => a.date.localeCompare(b.date) || a.started - b.started)) {
    for (const set of session.sets) {
      if (
        set.technique !== "Clean" &&
        !(
          state.settings.prStandard === "Acceptable" &&
          set.technique === "Acceptable"
        )
      )
        continue;
      const e = state.exercises.find((e) => e.id === set.exerciseId),
        key = `${e.id}:${set.load}:${set.side}`,
        value = ["hold", "timed", "skill"].includes(e.type)
          ? set.seconds
          : set.reps;
      if (value > 0 && value > (best.get(key) || 0)) {
        best.set(key, value);
        records.push({
          date: session.date,
          exercise: e.name,
          value,
          unit: ["hold", "timed", "skill"].includes(e.type) ? "sec" : "reps",
          load: set.load,
          side: set.side,
        });
      }
    }
  }
  return records.reverse();
}
export function csv(state) {
  const rows = [
    [
      "date",
      "session",
      "exercise",
      "side",
      "reps",
      "load_kg",
      "seconds",
      "RIR",
      "technique",
      "pain_during",
      "pain_after",
      "pain_morning",
      "notes",
      "video",
      "method",
      "surface",
      "balance_success",
      "mistakes",
      "rest_seconds",
    ],
  ];
  for (const s of state.sessions)
    for (const set of s.sets)
      rows.push([
        s.date,
        s.name,
        state.exercises.find((e) => e.id === set.exerciseId)?.name,
        set.side,
        set.reps,
        set.load,
        set.seconds,
        set.rir,
        set.technique,
        set.pain,
        s.after[set.exerciseId],
        s.morning[set.exerciseId],
        set.notes,
        set.attachment?.url,
        set.skill?.method,
        set.skill?.surface,
        set.skill?.successful,
        set.mistakes.join("; "),
        set.rest,
      ]);
  return rows
    .map((row) =>
      row
        .map((v) => {
          let t = String(v ?? "");
          if (/^\s*[=+\-@\t\r]/.test(t)) t = `'${t}`;
          return `"${t.replaceAll('"', '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
}
