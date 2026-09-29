import { useState } from "react";
import { Button, Card, Field, NumberField } from "./Training";
import { uid, exerciseSets } from "./trainingData";

export function TrainingGoals({ data, change }) {
  const [adding, setAdding] = useState(false);
  const [exerciseId, setExerciseId] = useState(
    data.exercises.find((e) => !e.archived)?.id || "",
  );
  const [target, setTarget] = useState(10);
  const [deadline, setDeadline] = useState("");
  const exercise = data.exercises.find((e) => e.id === exerciseId);
  const metric = ["hold", "timed", "skill"].includes(exercise?.type)
    ? "seconds"
    : "reps";
  return (
    <Card title="Your goals">
      <p className="tr-muted">
        Choose an exercise and a target for one clean set. Progress uses
        finished workouts; reps compare sets at any recorded load.
      </p>
      {(data.goals || []).map((goal) => {
        const e = data.exercises.find((e) => e.id === goal.exerciseId);
        const best = Math.max(
          0,
          ...data.sessions
            .filter((s) => s.status !== "active")
            .flatMap((s) => exerciseSets(s, e.id))
            .filter((s) => s.technique === "Clean")
            .map((s) => s[goal.metric]),
        );
        return (
          <div className="tr-row" key={goal.id}>
            <div className="tr-toolbar">
              <h3>
                {e.name} · {goal.target} {goal.metric}
              </h3>
              <Button
                aria-label={`Remove goal for ${e.name}`}
                onClick={() =>
                  change((d) => ({
                    ...d,
                    goals: d.goals.filter((g) => g.id !== goal.id),
                  }))
                }
              >
                Remove goal
              </Button>
            </div>
            <p>
              {best >= goal.target
                ? "Goal achieved"
                : `${best} / ${goal.target} ${goal.metric}`}
              {goal.deadline ? ` · Target date ${goal.deadline}` : ""}
            </p>
            <progress
              aria-label={`${e.name} goal progress`}
              value={Math.min(best, goal.target)}
              max={goal.target}
            />
          </div>
        );
      })}
      {!data.goals?.length && (
        <p>No goals yet. Set a rep target or work toward a longer hold.</p>
      )}
      {adding ? (
        <div>
          <Field label="Goal exercise">
            <select
              value={exerciseId}
              onChange={(e) => setExerciseId(e.target.value)}
            >
              {data.exercises
                .filter((e) => !e.archived)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
          </Field>
          <NumberField
            label={`Target ${metric}`}
            min={1}
            max={86400}
            value={target}
            onChange={setTarget}
          />
          <Field
            label="Target date (optional)"
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
          <div className="tr-actions">
            <Button
              primary
              disabled={!exerciseId}
              onClick={() => {
                if (
                  change((d) => ({
                    ...d,
                    goals: [
                      ...(d.goals || []),
                      { id: uid(), exerciseId, metric, target, deadline },
                    ],
                  }))
                )
                  setAdding(false);
              }}
            >
              Save goal
            </Button>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => setAdding(true)}>+ Add goal</Button>
      )}
    </Card>
  );
}
