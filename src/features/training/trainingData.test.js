import test from "node:test";
import assert from "node:assert/strict";
import { seedState } from "./seed.js";
import {
  startSession,
  defaults,
  completeSet,
  progression,
  validateState,
  csv,
  exerciseRestriction,
  personalRecords,
} from "./trainingData.js";
import { readCache, writeCache, equivalentData } from "./trainingStorage.js";
function fixture(id = "incline") {
  const state = seedState();
  let session = startSession(state, "2026-09-14");
  const e = state.exercises.find((e) => e.id === id);
  const p = session.exercises.find((p) => p.exerciseId === id) || {
    exerciseId: id,
    sets: 3,
    min: 5,
    max: 8,
    rest: 90,
    rir: 2,
    load: 0,
  };
  if (!session.exercises.some((p) => p.exerciseId === id))
    session.exercises.push(p);
  return { state, session, e, p };
}
function qualified(id = "incline") {
  let { state, session, e, p } = fixture(id);
  for (let i = 0; i < p.sets * (e.unilateral ? 2 : 1); i++)
    session = completeSet(session, p, e, {
      ...defaults(state, session, p, e),
      reps: p.max,
      seconds: Math.max(p.max, 5),
      skill:
        e.type === "skill"
          ? {
              method: "wall",
              surface: "parallettes",
              successful: true,
              seconds: 5,
            }
          : null,
    });
  session.status = "completed";
  session.ended = Date.now();
  session.after[e.id] = 0;
  session.morning[e.id] = 0;
  state.sessions = [session];
  return { state, session, e, p };
}
test("initial plan has correct four-day schedule and isolated recovery", () => {
  const s = seedState();
  assert.doesNotThrow(() => validateState(s));
  assert.deepEqual(
    s.plan.days.map((d) => d.exercises.length),
    [7, 8, 8, 9, 0, 0, 0],
  );
  assert.equal(
    s.exercises.find((e) => e.id === "handstand").equipment,
    "parallettes",
  );
  assert.equal(s.settings.phase, 1);
});
test("one-tap logging prefills previous set and persists timer, side and technique", () => {
  const { state, session, e, p } = fixture();
  const values = { ...defaults(state, session, p, e), reps: 9, load: 12.5 };
  const next = completeSet(session, p, e, values);
  assert.equal(session.sets.length, 0);
  assert.equal(next.sets.length, 1);
  assert.equal(next.sets[0].technique, "Clean");
  assert.ok(next.restUntil > Date.now());
  assert.equal(defaults(state, next, p, e).load, 12.5);
  assert.equal(defaults(state, next, p, e).reps, 9);
  assert.equal(next.sets[0].rir, 2);
});
test("paused logging and duplicate active sessions are rejected", () => {
  const { state, session, e, p } = fixture();
  assert.throws(() =>
    completeSet(
      { ...session, pausedAt: Date.now() },
      p,
      e,
      defaults(state, session, p, e),
    ),
  );
  state.sessions = [session];
  assert.throws(() => startSession(state));
});
test("phase two is explicit and adjusts only selected strength exercises", () => {
  const state = seedState();
  state.settings.phase = 2;
  const s = startSession(state, "2026-09-14");
  assert.equal(s.exercises.find((p) => p.exerciseId === "incline").sets, 2);
  assert.equal(s.exercises.find((p) => p.exerciseId === "fly").sets, 3);
  assert.equal(state.plan.days[0].exercises[1].sets, 3);
});
test("unilateral defaults alternate left and right", () => {
  const { state, session, e, p } = fixture("pulldown");
  const values = defaults(state, session, p, e);
  assert.equal(values.side, "left");
  const next = completeSet(session, p, e, values);
  assert.equal(defaults(state, next, p, e).side, "right");
});
test("progression requires full clean sets, target RIR and all symptom checkpoints", () => {
  const { state, session, e, p } = qualified();
  assert.equal(progression(state, session, p, e).kind, "reps");
  delete session.morning[e.id];
  assert.equal(progression(state, session, p, e).kind, "maintain");
  session.morning[e.id] = 0;
  session.sets[0].technique = "Acceptable";
  assert.equal(progression(state, session, p, e).kind, "maintain");
  session.sets[0].technique = "Clean";
  session.sets[0].rir = 0;
  assert.equal(progression(state, session, p, e).kind, "maintain");
});
test("pain at three, increasing pain and repeated technique failures prevent progression", () => {
  for (const location of ["during", "after", "morning"]) {
    const { state, session, e, p } = qualified();
    if (location === "during") session.sets[0].pain = 3;
    else session[location][e.id] = 3;
    assert.equal(progression(state, session, p, e).kind, "review");
  }
  const { state, session, e, p } = qualified();
  const previous = structuredClone(session);
  previous.id = "previous";
  previous.date = "2026-09-07";
  state.sessions.unshift(previous);
  session.morning[e.id] = 1;
  assert.equal(progression(state, session, p, e).kind, "review");
  session.morning[e.id] = 0;
  session.sets[0].technique = session.sets[1].technique = "Failed";
  assert.equal(progression(state, session, p, e).kind, "review");
});
test("handstand progression prioritizes successful balance and floor is rejected", () => {
  const { state, session, e, p } = qualified("handstand");
  assert.equal(progression(state, session, p, e).kind, "skill");
  session.sets.forEach((s) => (s.skill.successful = false));
  assert.equal(progression(state, session, p, e).kind, "maintain");
  assert.throws(() =>
    completeSet({ ...session, status: "active" }, p, e, {
      ...defaults(state, session, p, e),
      skill: { method: "wall", surface: "floor", successful: false },
    }),
  );
});
test("both unilateral sides must reach prescribed set counts", () => {
  const { state, session, e, p } = qualified("pulldown");
  session.sets.forEach((s) => (s.side = "left"));
  assert.equal(progression(state, session, p, e).kind, "maintain");
});
test("weighted pull-ups and dips honor prerequisites", () => {
  const { state, e } = fixture("pullup");
  assert.match(exerciseRestriction(state, e, 5), /require/);
  assert.equal(exerciseRestriction(state, { ...e, type: "assisted" }, 20), "");
  const dipped = { ...e, name: "Weighted dip", type: "weighted" };
  assert.match(exerciseRestriction(state, dipped, 5), /disabled/);
  state.settings.wristAssessed = state.settings.dipsPainFree = true;
  assert.equal(exerciseRestriction(state, dipped, 5), "");
});
test("cache roundtrip is user-scoped and retains active session and all logs", () => {
  const map = new Map(),
    storage = {
      getItem: (k) => map.get(k) || null,
      setItem: (k, v) => map.set(k, v),
    };
  const { state, session } = qualified();
  session.status = "active";
  writeCache(storage, "alice", { data: state, revision: 2, dirty: true });
  assert.deepEqual(readCache(storage, "alice").data, state);
  assert.equal(readCache(storage, "bob"), null);
  assert.equal(readCache(storage, "alice").dirty, true);
});
test("storage quota errors propagate rather than claiming a successful save", () => {
  assert.throws(
    () =>
      writeCache(
        {
          setItem: () => {
            throw new Error("Quota exceeded");
          },
        },
        "alice",
        { data: seedState(), revision: 1, dirty: true },
      ),
    /Quota/,
  );
});
test("backups reject invalid schema, unknown exercises, invalid ranges and unsafe links", () => {
  assert.throws(() => validateState({ version: 99 }));
  for (const mutate of [
    (s) => (s.plan.days[0].exercises[0].exerciseId = "missing"),
    (s) => (s.plan.days[0].exercises[0].sets = -1),
    (s) => (s.exercises[0].reference = "javascript:alert(1)"),
    (s) => (s.settings.phase = 3),
  ]) {
    const s = seedState();
    mutate(s);
    assert.throws(() => validateState(s));
  }
  const { state } = qualified();
  state.sessions[0].sets[0].pain = NaN;
  assert.throws(() => validateState(state));
});
test("CSV escapes notes and spreadsheet formula injection", () => {
  const { state } = qualified();
  state.sessions[0].sets[0].notes = '=SUM(1,2) "test"';
  const output = csv(state);
  assert.ok(output.includes("'=SUM"));
  assert.ok(output.includes('""test""'));
  assert.ok(output.includes("pain_morning"));
});
test("JSONB key reordering does not create a false recovery conflict", () => {
  assert.equal(
    equivalentData(
      { version: 1, data: { a: 1, b: 2 } },
      { data: { b: 2, a: 1 }, version: 1 },
    ),
    true,
  );
  assert.equal(equivalentData({ sets: [1, 2] }, { sets: [2, 1] }), false);
});
test("increasing symptoms within a session prevent progression even below three", () => {
  const { state, session, e, p } = qualified();
  session.after[e.id] = 1;
  assert.equal(progression(state, session, p, e).kind, "review");
});
test("strict personal records exclude failed sets and compare side and load separately", () => {
  const { state, session } = qualified();
  session.sets[0].reps = 99;
  session.sets[0].technique = "Failed";
  assert.equal(personalRecords(state)[0].value, 10);
  session.sets[1].load = 10;
  assert.equal(personalRecords(state).length, 2);
});
