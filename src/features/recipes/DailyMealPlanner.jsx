import { useEffect, useRef, useState } from 'react';
import { getPreference, setPreference } from '../../services/preferenceService';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { RecipeLink, secondaryButton } from './RecipeComponents';
import {
  MEAL_SLOTS,
  MACROS,
  emptyMealPlan,
  calculateMealPlan,
  readMealRoutine,
} from './mealPlanData';
import { MealRoutine } from './MealRoutine';
import { QuickRoutines } from './QuickRoutines';

const STORAGE_KEY = 'recipes:daily-plan:v1';
const units = {
  calories: 'kcal',
  protein: 'g protein',
  carbs: 'g carbs',
  fat: 'g fat',
};
const format = (value) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);

export function DailyMealPlanner({ recipes }) {
  const [entries, setEntries] = useState(emptyMealPlan);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [routine, setRoutine] = useState(null);
  const [editing, setEditing] = useState(true);
  const [name, setName] = useState('My current meal routine');
  const [notes, setNotes] = useState('');
  const lock = useRef(false);
  async function load() {
    setLoading(true);
    setLoadError('');
    try {
      const plan = await getPreference(STORAGE_KEY);
      const stored = plan == null ? null : readMealRoutine(plan);
      setRoutine(stored);
      setEntries(stored?.entries ?? emptyMealPlan());
      setName(stored?.name ?? 'My current meal routine');
      setNotes(stored?.notes ?? '');
      setEditing(!stored?.entries.some((entry) => entry.slug));
    } catch (error) {
      setLoadError(error.message || 'Could not load your meal plan.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  const update = (next) => {
    setEntries(next);
    setDirty(true);
    setSaved(false);
    setError('');
  };
  const change = (id, values) =>
    update(
      entries.map((entry) =>
        entry.id === id ? { ...entry, ...values } : entry,
      ),
    );
  async function save(event, preset = null) {
    event?.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const next = readMealRoutine(
        preset ?? { version: 1, name, notes, entries },
      );
      if (!next.entries.some((entry) => entry.slug))
        throw new Error('Choose at least one recipe for your routine.');
      await setPreference(STORAGE_KEY, next);
      setRoutine(next);
      setEntries(next.entries);
      setName(next.name);
      setNotes(next.notes);
      setEditing(false);
      setDirty(false);
      setSaved(true);
    } catch (error) {
      setError(
        error.message ||
          'Could not save. Your selections are still here; try again.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const { meals, totals } = calculateMealPlan(entries, recipes);
  return (
    <div className="space-y-7 text-black">
      <header className="space-y-3">
        <span className="pill">Daily meals</span>
        <h1 className="text-4xl font-bold">Daily Meal Planner</h1>
        <p className="leading-7 text-black/70">
          Choose your meals to see what you’ll eat and the combined calories,
          protein, carbs and fat.
        </p>
      </header>
      {loading ? (
        <p role="status">Loading your meal plan…</p>
      ) : loadError ? (
        <div role="alert">
          <p>{loadError}</p>
          <button className={secondaryButton} onClick={load}>
            Retry loading plan
          </button>
        </div>
      ) : (
        <>
          <QuickRoutines
            draft={{ version: 1, name, notes, entries }}
            recipes={recipes}
            disabled={busy}
            dirty={dirty}
            editing={editing}
            onUse={(preset) => save(null, preset)}
            onEdit={(preset) => {
              setEntries(preset.entries);
              setName(preset.name);
              setNotes(preset.notes);
              setEditing(true);
              setDirty(true);
              setSaved(false);
              setError('');
            }}
          />
          {error && !editing && <p role="alert">{error}</p>}
          {!recipes.length && (
            <p className="rounded-2xl border-2 border-black bg-white p-5">
              No recipes yet.{' '}
              <RecipeLink to="/recipes/import">Add a recipe</RecipeLink> to
              start planning.
            </p>
          )}
          <section
            aria-label="Daily totals"
            className="space-y-4 rounded-2xl border-2 border-black bg-white p-5"
          >
            <h2 className="text-2xl font-bold">Daily totals</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {MACROS.map((key) => (
                <div key={key}>
                  <p className="text-sm capitalize text-black/70">{key}</p>
                  <p className="text-2xl font-bold">
                    {totals[key].known ? format(totals[key].value) : '—'}{' '}
                    {units[key]}
                  </p>
                  {totals[key].missing > 0 && (
                    <p className="text-sm text-black/70">
                      {totals[key].known ? 'Known subtotal' : 'Not provided'} ·
                      missing for {totals[key].missing} meal
                      {totals[key].missing === 1 ? '' : 's'}
                    </p>
                  )}
                </div>
              ))}
            </div>
            <p role="status" className="text-sm text-black/70">
              {meals.length
                ? `${meals.length} selected meal${meals.length === 1 ? '' : 's'}. Totals update as you change selections.`
                : 'Choose a recipe below to start calculating.'}
            </p>
            <p className="text-sm text-black/70">
              1× uses the recipe’s listed macros exactly as entered. 0.5× counts
              half; 2× counts double. Servings are not divided automatically.
              Missing macros are never counted as zero.
            </p>
          </section>
          {!editing && routine ? (
            <MealRoutine
              routine={routine}
              meals={meals}
              onEdit={() => {
                setEditing(true);
                setSaved(false);
              }}
            />
          ) : (
            <form className="space-y-5" onSubmit={save}>
              <fieldset disabled={busy} className="min-w-0 space-y-5">
                <div className="space-y-4">
                  <label htmlFor="routine-name" className="block font-semibold">
                    Routine name
                  </label>
                  <input
                    id="routine-name"
                    className="field-input"
                    required
                    maxLength={120}
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      setDirty(true);
                    }}
                  />
                  <label
                    htmlFor="routine-notes"
                    className="block font-semibold"
                  >
                    Routine notes (optional)
                  </label>
                  <textarea
                    id="routine-notes"
                    className="field-input"
                    rows={3}
                    maxLength={2000}
                    placeholder="The meals I’m following these days…"
                    value={notes}
                    onChange={(event) => {
                      setNotes(event.target.value);
                      setDirty(true);
                    }}
                  />
                </div>
                {entries.map((entry, index) => {
                  const recipe = recipes.find(
                    (recipe) => recipe.slug === entry.slug,
                  );
                  const preferred = recipes.filter(
                    (recipe) =>
                      recipe.mealType.toLowerCase() ===
                      entry.meal.toLowerCase(),
                  );
                  const other = recipes.filter(
                    (recipe) => !preferred.includes(recipe),
                  );
                  return (
                    <section
                      key={entry.id}
                      className="space-y-4 rounded-2xl border-2 border-black p-5"
                      aria-label={`Meal ${index + 1}`}
                    >
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_2fr_1fr]">
                        <label className="block space-y-2 font-semibold">
                          <span>Meal type</span>
                          <select
                            className="field-input"
                            value={entry.meal}
                            aria-label="Meal type"
                            onChange={(event) =>
                              change(entry.id, { meal: event.target.value })
                            }
                          >
                            {MEAL_SLOTS.map((meal) => (
                              <option key={meal}>{meal}</option>
                            ))}
                          </select>
                        </label>
                        <label className="block min-w-0 space-y-2 font-semibold">
                          <span>{entry.meal} recipe</span>
                          <select
                            className="field-input"
                            value={entry.slug}
                            aria-label={`${entry.meal} recipe`}
                            onChange={(event) =>
                              change(entry.id, { slug: event.target.value })
                            }
                          >
                            <option value="">Choose a recipe</option>
                            {entry.slug && !recipe && (
                              <option value={entry.slug}>
                                Recipe no longer available
                              </option>
                            )}
                            {preferred.length > 0 && (
                              <optgroup label={entry.meal}>
                                {preferred.map((recipe) => (
                                  <option key={recipe.slug} value={recipe.slug}>
                                    {recipe.title}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            {other.length > 0 && (
                              <optgroup label="Other recipes">
                                {other.map((recipe) => (
                                  <option key={recipe.slug} value={recipe.slug}>
                                    {recipe.title} ({recipe.mealType})
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </label>
                        <label className="block space-y-2 font-semibold">
                          <span>Portion multiplier</span>
                          <input
                            className="field-input"
                            type="number"
                            min="0.01"
                            max="100"
                            step="any"
                            required
                            value={entry.portions}
                            aria-label="Portion multiplier"
                            onChange={(event) =>
                              change(entry.id, {
                                portions:
                                  event.target.value === ''
                                    ? ''
                                    : Number(event.target.value),
                              })
                            }
                          />
                        </label>
                      </div>
                      {recipe && (
                        <div className="space-y-3">
                          <RecipeLink to={`/recipes/${recipe.slug}`}>
                            {recipe.title} →
                          </RecipeLink>
                          <p className="text-sm text-black/70">
                            {MACROS.map((key) => {
                              const value = meals.find(
                                (meal) => meal.id === entry.id,
                              )?.nutrition[key];
                              return `${value == null ? '—' : format(value)} ${units[key]}`;
                            }).join(' · ')}
                          </p>
                        </div>
                      )}
                      {entry.slug && !recipe && (
                        <p role="alert">
                          This recipe was deleted. Choose a replacement; its
                          nutrition is excluded from the known totals.
                        </p>
                      )}
                      <button
                        type="button"
                        className={secondaryButton}
                        onClick={() =>
                          update(entries.filter((meal) => meal.id !== entry.id))
                        }
                      >
                        Remove meal {index + 1}
                      </button>
                    </section>
                  );
                })}
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={entries.length >= 24}
                  onClick={() =>
                    update([
                      ...entries,
                      {
                        id: crypto.randomUUID(),
                        meal: 'Snack',
                        slug: '',
                        portions: 1,
                      },
                    ])
                  }
                >
                  Add another meal
                </button>
                <div className="flex flex-wrap items-center gap-3">
                  <PrimaryButton type="submit">
                    {busy ? 'Saving…' : 'Use this meal routine'}
                  </PrimaryButton>
                  {routine && (
                    <button
                      type="button"
                      className={secondaryButton}
                      onClick={() => {
                        setEntries(routine.entries);
                        setName(routine.name);
                        setNotes(routine.notes);
                        setDirty(false);
                        setError('');
                        setEditing(false);
                      }}
                    >
                      Cancel changes
                    </button>
                  )}
                  <p role="status" className="text-sm text-black/70">
                    {dirty
                      ? 'Unsaved changes'
                      : saved
                        ? 'Daily plan saved'
                        : 'Choose your meals, then save your plan.'}
                  </p>
                </div>
              </fieldset>
              {error && <p role="alert">{error}</p>}
            </form>
          )}
          {saved && !editing && (
            <p role="status">
              Meal routine saved. This is your current everyday plan.
            </p>
          )}
        </>
      )}
    </div>
  );
}
