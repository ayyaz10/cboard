import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import {
  deleteFoodDiaryDay,
  getFoodDiary,
  saveFoodDiary,
} from "../../services/foodDiaryService";
import { getPreference } from "../../services/preferenceService";
import { readMealRoutine } from "../recipes/mealPlanData";
import { RecipeLink } from "../recipes/RecipeComponents";
import { NutritionTotals } from "./DiaryNutrition";
import { DiaryMealEditor } from "./DiaryMealEditor";
import { DiaryReports } from "./DiaryReports";
import {
  MEALS,
  REQUIRED_MEALS,
  canComplete,
  diaryTotals,
  emptyDay,
  localDate,
  newMeal,
  recipeItems,
  shiftDate,
  streaks,
  validDate,
} from "./diaryData";
import "../groceries/groceries.css";
import "./foodDiary.css";

const format = (n) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(n);
export function FoodDiary({ recipes, nutritionGoals }) {
  const { user } = useAuth();
  const [today, setToday] = useState(localDate);
  const [date, setDate] = useState(localDate);
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const [remove, setRemove] = useState(null);
  const [removeDay, setRemoveDay] = useState(null);
  const [routine, setRoutine] = useState(null);
  const [selected, setSelected] = useState([]);
  const [month, setMonth] = useState("");
  const lock = useRef(false);
  const generation = useRef(0);
  const editorRef = useRef(null);
  const diaryTopRef = useRef(null);
  const day = days.find((entry) => entry.date === date) || emptyDay(date);
  const streak = streaks(days, today);
  const disabled = busy || Boolean(draft) || Boolean(routine);
  const goals =
    !nutritionGoals.loading && !nutritionGoals.error
      ? nutritionGoals.goals
      : null;
  async function load() {
    const id = ++generation.current;
    setLoading(true);
    setLoadError("");
    try {
      const saved = await getFoodDiary(user.id);
      if (id === generation.current) setDays(saved);
    } catch (err) {
      if (id === generation.current)
        setLoadError(err.message || "Could not load your diary.");
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    load();
    return () => {
      generation.current++;
    };
  }, [user.id]);
  useEffect(() => {
    const timer = setInterval(() => setToday(localDate()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (draft)
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [draft?.id]);
  useEffect(() => {
    if (!draft && !routine) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const guardLink = (event) => {
      const link = event.target.closest?.("a[href]");
      if (
        !link ||
        link.target === "_blank" ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const destination = new URL(link.href, window.location.href);
      if (destination.href === window.location.href) return;
      if (
        !window.confirm(
          "Leave this diary and discard your unsaved meal or planner selection?",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", guardLink, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", guardLink, true);
    };
  }, [draft, routine]);
  async function persist(next, success) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const id = generation.current;
    try {
      const saved = await saveFoodDiary(
        { ...next, updatedAt: day.updatedAt },
        user.id,
      );
      if (id !== generation.current) return false;
      setDays((previous) => [
        ...previous.filter((entry) => entry.date !== saved.date),
        saved,
      ]);
      setNotice(success);
      return true;
    } catch (err) {
      if (id === generation.current)
        setError(err.message || "Could not save. Your draft is still here.");
      return false;
    } finally {
      lock.current = false;
      if (id === generation.current) setBusy(false);
    }
  }
  function selectDate(next, scroll = false) {
    if (validDate(next) && next <= today) {
      setDate(next);
      setError("");
      setNotice("");
      setRemove(null);
      setRemoveDay(null);
      if (scroll)
        window.requestAnimationFrame(() =>
          diaryTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        );
    }
  }
  async function deleteDay(entry) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const id = generation.current;
    try {
      await deleteFoodDiaryDay(entry, user.id);
      if (id !== generation.current) return;
      setDays((previous) => previous.filter((item) => item.date !== entry.date));
      setRemoveDay(null);
      setNotice(`${entry.date} was removed from meal history.`);
    } catch (err) {
      if (id === generation.current)
        setError(err.message || "Could not delete this diary day.");
    } finally {
      lock.current = false;
      if (id === generation.current) setBusy(false);
    }
  }
  async function saveMeal(meal) {
    const exists = day.meals.some((entry) => entry.id === meal.id);
    const meals = exists
      ? day.meals.map((entry) => (entry.id === meal.id ? meal : entry))
      : [...day.meals, meal];
    if (
      await persist(
        {
          ...day,
          meals,
          skipped: day.skipped.filter((slot) => slot !== meal.meal),
          complete: false,
        },
        "Meal saved. Finish the day when all your meals are recorded.",
      )
    )
      setDraft(null);
  }
  async function openRoutine() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const id = generation.current;
    try {
      const saved = await getPreference("recipes:daily-plan:v1");
      if (id !== generation.current) return;
      if (!saved) throw new Error("Save a routine in the Daily Planner first.");
      const entries = readMealRoutine(saved).entries.filter(
        (entry) => entry.slug,
      );
      if (!entries.length) throw new Error("Your saved planner has no meals.");
      setRoutine(entries);
      setSelected(
        entries
          .filter((entry) =>
            recipes.some((recipe) => recipe.slug === entry.slug),
          )
          .map((entry) => entry.id),
      );
    } catch (err) {
      if (id === generation.current) setError(err.message);
    } finally {
      lock.current = false;
      if (id === generation.current) setBusy(false);
    }
  }
  async function importRoutine() {
    try {
      const meals = routine
        .filter((entry) => selected.includes(entry.id))
        .map((entry) => {
          const recipe = recipes.find((recipe) => recipe.slug === entry.slug);
          if (!recipe)
            throw new Error("A selected recipe is no longer available.");
          return {
            ...newMeal(entry.meal),
            title: recipe.title,
            items: recipeItems(recipe, entry.portions),
          };
        });
      if (!meals.length) throw new Error("Select at least one meal to log.");
      if (
        await persist(
          {
            ...day,
            meals: [...day.meals, ...meals],
            skipped: day.skipped.filter(
              (slot) => !meals.some((entry) => entry.meal === slot),
            ),
            complete: false,
          },
          "Selected planner meals logged. You can edit each meal below.",
        )
      )
        setRoutine(null);
    } catch (err) {
      setError(err.message);
    }
  }
  if (loading) return <p role="status">Loading your food diary…</p>;
  if (loadError)
    return (
      <div role="alert">
        <p>{loadError}</p>
        <button onClick={load}>Retry diary</button>
      </div>
    );
  return (
    <div className="food-diary groceries">
      <header className="diary-heading">
        <div>
          <span className="pill">Everyday nutrition</span>
          <h1>Food diary</h1>
          <p>Your meals, your portions, your daily progress.</p>
        </div>
        <RecipeLink to="/recipes/planner/day">Daily Planner</RecipeLink>
      </header>
      <section className="diary-streak" aria-label="Logging streak">
        <div>
          <strong>{streak.current}</strong>
          <span>day logging streak</span>
        </div>
        <p>
          Best: <b>{streak.longest} days</b> · {streak.completed} completed days
        </p>
        <small>
          Finish a day after logging or skipping breakfast, lunch and dinner.
          Snacks are optional. Your streak counts completed calendar days,
          including backfilled entries. Today can stay open until you finish.
        </small>
      </section>
      <div className="diary-datebar" ref={diaryTopRef}>
        <button
          type="button"
          disabled={disabled || date <= "2000-01-01"}
          aria-label="Previous diary day"
          onClick={() => selectDate(shiftDate(date, -1))}
        >
          ←
        </button>
        <label>
          Diary date
          <input
            type="date"
            value={date}
            min="2000-01-01"
            max={today}
            disabled={disabled}
            onChange={(event) => selectDate(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={disabled || date >= today}
          aria-label="Next diary day"
          onClick={() => selectDate(shiftDate(date, 1))}
        >
          →
        </button>
        <button
          type="button"
          disabled={disabled || date === today}
          onClick={() => selectDate(today)}
        >
          Today
        </button>
      </div>
      <DiaryReports
        days={days}
        date={date}
        today={today}
        goals={goals}
        disabled={disabled}
        onSelectDate={selectDate}
      />
      <section className="diary-panel" aria-label="Daily nutrition totals">
        <div className="diary-section-heading">
          <h2>{date === today ? "Today’s" : date} nutrition</h2>
          <span className="pill">
            {day.complete ? "Day complete" : "Day in progress"}
          </span>
        </div>
        <NutritionTotals
          meals={day.meals}
          goals={goals}
        />
        <p className="diary-hint">
          {day.meals.length} meal entries · totals reflect saved meals. Targets
          are your current targets.
        </p>
      </section>
      {notice && (
        <p className="diary-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <div className="diary-error" role="alert">
          <p>{error}</p>
          <button type="button" disabled={busy} onClick={load}>
            Reload saved diary (keep meal draft)
          </button>
        </div>
      )}
      {!draft && !routine && (
        <div className="diary-actions">
          <button
            className="diary-primary"
            type="button"
            disabled={busy}
            onClick={() => {
              setDraft(newMeal());
              setError("");
            }}
          >
            Log a meal
          </button>
          <button type="button" disabled={busy} onClick={openRoutine}>
            Copy meals from planner
          </button>
        </div>
      )}
      {routine && (
        <section className="diary-panel" aria-label="Copy planner meals">
          <h2>Choose meals you actually ate</h2>
          <p>Adds dated copies to {date}; existing entries stay in place.</p>
          {routine.map((entry) => {
            const recipe = recipes.find((recipe) => recipe.slug === entry.slug);
            return (
              <label className="diary-check" key={entry.id}>
                <input
                  type="checkbox"
                  disabled={busy || !recipe}
                  checked={selected.includes(entry.id)}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, entry.id]
                        : selected.filter((id) => id !== entry.id),
                    )
                  }
                />
                {entry.meal}: {recipe?.title || "Recipe no longer available"} ·{" "}
                {entry.portions}×
              </label>
            );
          })}
          <div className="diary-actions">
            <button
              className="diary-primary"
              disabled={busy || !selected.length}
              onClick={importRoutine}
            >
              Save selected meals to diary
            </button>
            <button disabled={busy} onClick={() => setRoutine(null)}>
              Cancel copy
            </button>
          </div>
        </section>
      )}
      {draft && (
        <div ref={editorRef}>
          <DiaryMealEditor
            key={draft.id}
            initial={draft}
            recipes={recipes}
            busy={busy}
            onSave={saveMeal}
            onDraftChange={setDraft}
            onCancel={() => {
              setDraft(null);
              setError("");
            }}
          />
        </div>
      )}
      <div className="diary-meal-sections">
        {MEALS.map((slot) => {
          const entries = day.meals.filter((meal) => meal.meal === slot);
          return (
            <section
              className="diary-panel"
              key={slot}
              aria-label={`${slot} entries`}
            >
              <div className="diary-section-heading">
                <h2>{slot}</h2>
                <button
                  disabled={disabled}
                  onClick={() => {
                    setDraft(newMeal(slot));
                    setError("");
                  }}
                >
                  Add {slot.toLowerCase()}
                </button>
              </div>
              {!entries.length && (
                <p>
                  {day.skipped.includes(slot)
                    ? "Marked skipped"
                    : slot === "Snack"
                      ? "No snacks logged. Optional."
                      : "No meal logged yet."}
                </p>
              )}
              {!entries.length && slot !== "Snack" && (
                <button
                  disabled={disabled}
                  onClick={() =>
                    persist(
                      {
                        ...day,
                        complete: false,
                        skipped: day.skipped.includes(slot)
                          ? day.skipped.filter((meal) => meal !== slot)
                          : [...day.skipped, slot],
                      },
                      "Meal status saved.",
                    )
                  }
                >
                  {day.skipped.includes(slot)
                    ? `Undo skipped ${slot.toLowerCase()}`
                    : `Mark ${slot.toLowerCase()} skipped`}
                </button>
              )}
              {entries.map((meal) => (
                <article className="diary-entry" key={meal.id}>
                  <h3>{meal.title}</h3>
                  <p>
                    {meal.items
                      .map(
                        (item) =>
                          `${format(item.quantity)} ${item.unit} ${item.name}`,
                      )
                      .join(" · ")}
                  </p>
                  {meal.notes && <p>{meal.notes}</p>}
                  <NutritionTotals meals={[meal]} compact />
                  <div className="diary-actions">
                    <button
                      disabled={disabled}
                      onClick={() => {
                        setDraft(meal);
                        setError("");
                      }}
                    >
                      Edit {meal.title}
                    </button>
                    <button
                      disabled={disabled}
                      onClick={() => setRemove(meal.id)}
                    >
                      Delete {meal.title}
                    </button>
                  </div>
                  {remove === meal.id && (
                    <div
                      className="diary-delete"
                      role="group"
                      aria-label="Confirm meal deletion"
                    >
                      <p>Remove this meal from {date}?</p>
                      <div className="diary-actions">
                        <button
                          disabled={disabled}
                          onClick={async () => {
                            if (
                              await persist(
                                {
                                  ...day,
                                  meals: day.meals.filter(
                                    (entry) => entry.id !== meal.id,
                                  ),
                                  complete: false,
                                },
                                "Meal deleted.",
                              )
                            )
                              setRemove(null);
                          }}
                        >
                          Confirm delete meal
                        </button>
                        <button disabled={busy} onClick={() => setRemove(null)}>
                          Keep meal
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </section>
          );
        })}
      </div>
      <section className="diary-panel diary-finish">
        <h2>{day.complete ? "Day logged ✓" : "Ready to finish this day?"}</h2>
        <p>
          {day.complete
            ? "This day counts towards your streak. Editing a meal reopens it so you can review the totals."
            : `Record ${
                REQUIRED_MEALS.filter(
                  (slot) =>
                    !day.skipped.includes(slot) &&
                    !day.meals.some((meal) => meal.meal === slot),
                )
                  .join(", ")
                  .toLowerCase() || "any snacks, if needed"
              }, then confirm you have logged everything you ate.`}
        </p>
        <button
          className="diary-primary"
          disabled={disabled || (!day.complete && !canComplete(day))}
          onClick={() =>
            persist(
              { ...day, complete: !day.complete },
              day.complete
                ? "Day reopened."
                : "Day complete. Your logging streak is updated.",
            )
          }
        >
          {day.complete ? "Reopen day" : "Finish day & update streak"}
        </button>
        <p className="diary-hint">
          Completion is about keeping a record, not reaching a calorie target.
          At least one meal must be logged.
        </p>
      </section>
      <section className="diary-panel" aria-label="Meal history">
        <h2>Meal history</h2>
        <div className="diary-fields">
          <label>
            Filter history by month
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </label>
          {month && (
            <button onClick={() => setMonth("")}>Show all months</button>
          )}
        </div>
        <div className="diary-history">
          {days
            .filter(
              (entry) =>
                (entry.meals.length || entry.skipped.length) &&
                (!month || entry.date.startsWith(month)),
            )
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((entry) => {
              const totals = diaryTotals(entry.meals);
              return (
                <article
                  className="diary-history-item"
                  key={entry.date}
                  aria-current={entry.date === date ? "date" : undefined}
                >
                  <div className="diary-history-copy">
                    <strong>
                      {entry.date}
                      {entry.complete ? " ✓" : ""}
                    </strong>
                    <span>
                      {entry.meals.length} meals ·{" "}
                      {totals.calories.known
                        ? `${format(totals.calories.value)} kcal${totals.calories.missing ? " (partial)" : ""}`
                        : "Calories unknown"}{" "}
                      ·{" "}
                      {totals.protein.known
                        ? `${format(totals.protein.value)} g protein${totals.protein.missing ? " (partial)" : ""}`
                        : "Protein unknown"}
                    </span>
                  </div>
                  <div className="diary-actions">
                    <button type="button" disabled={disabled} onClick={() => selectDate(entry.date, true)}>
                      Open & edit
                    </button>
                    <button type="button" disabled={disabled} onClick={() => {
                      selectDate(entry.date);
                      setDraft(newMeal());
                    }}>
                      Add meal
                    </button>
                    <button type="button" disabled={disabled} onClick={() => setRemoveDay(entry.date)}>
                      Delete day
                    </button>
                  </div>
                  {removeDay === entry.date && (
                    <div className="diary-delete" role="group" aria-label={`Confirm deletion of ${entry.date}`}>
                      <p>Delete every meal saved for {entry.date}? This cannot be undone.</p>
                      <div className="diary-actions">
                        <button type="button" disabled={busy} onClick={() => deleteDay(entry)}>Confirm delete day</button>
                        <button type="button" disabled={busy} onClick={() => setRemoveDay(null)}>Keep this day</button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
        </div>
        {!days.some(
          (entry) =>
            (entry.meals.length || entry.skipped.length) &&
            (!month || entry.date.startsWith(month)),
        ) && <p>No meals recorded for this period yet.</p>}
      </section>
      <p className="diary-hint">
        Food lookup:{" "}
        <a
          href="https://world.openfoodfacts.org"
          target="_blank"
          rel="noreferrer"
        >
          Open Food Facts
        </a>{" "}
        ·{" "}
        <a
          href="https://opendatacommons.org/licenses/odbl/1-0/"
          target="_blank"
          rel="noreferrer"
        >
          ODbL
        </a>
        . Match preparation and check the label; vitamin and mineral coverage
        varies.
      </p>
    </div>
  );
}
