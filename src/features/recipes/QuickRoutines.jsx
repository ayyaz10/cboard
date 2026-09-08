import { useEffect, useRef, useState } from 'react';
import { getPreference, setPreference } from '../../services/preferenceService';
import { secondaryButton } from './RecipeComponents';
import { calculateMealPlan, MACROS } from './mealPlanData';
import { readRoutinePresets, saveRoutinePreset } from './routinePresets';

const KEY = 'recipes:routine-presets:v1';
const units = {
  calories: 'kcal',
  protein: 'g protein',
  carbs: 'g carbs',
  fat: 'g fat',
};

export function QuickRoutines({
  draft,
  recipes,
  onUse,
  onEdit,
  disabled,
  dirty,
  editing,
}) {
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState(null);
  const [pending, setPending] = useState(null);
  const lock = useRef(false);
  async function load() {
    setLoading(true);
    setLoadError('');
    try {
      setPresets(readRoutinePresets(await getPreference(KEY, [])));
    } catch (error) {
      setLoadError(error.message || 'Could not load presets.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!editing) setEditId(null);
  }, [editing]);
  async function persist(next, notice) {
    await setPreference(KEY, next);
    setPresets(next);
    setMessage(notice);
    setPending(null);
  }
  async function run(action) {
    if (lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (error) {
      setError(error.message || 'Could not save presets. Please try again.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function save(asUpdate) {
    await run(async () => {
      const id = asUpdate ? editId : crypto.randomUUID();
      await persist(
        saveRoutinePreset(presets, draft, id),
        asUpdate
          ? 'Preset updated.'
          : 'Preset saved. Choose Use routine whenever you want this combination.',
      );
      setEditId(null);
    });
  }
  const blocked = busy || disabled;
  return (
    <section
      className="space-y-4 rounded-2xl border-2 border-black p-5"
      aria-label="Quick routines"
    >
      <h2 className="text-2xl font-bold">Quick routines</h2>
      <p className="text-sm text-black/70">
        Save different meal combinations here, then use one whenever you need
        it. Presets keep recipe choices and portions; totals use the latest
        recipe macros.
      </p>
      {loading ? (
        <p role="status">Loading presets…</p>
      ) : loadError ? (
        <div role="alert">
          <p>{loadError}</p>
          <button className={secondaryButton} onClick={load}>
            Retry presets
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <button
              className={secondaryButton}
              disabled={blocked}
              onClick={() => save(false)}
            >
              Save current combination as preset
            </button>
            {editId && (
              <button
                className={secondaryButton}
                disabled={blocked}
                onClick={() => save(true)}
              >
                Update selected preset
              </button>
            )}
          </div>
          {!presets.length && (
            <p className="text-sm text-black/70">
              No presets yet. Choose your meals below, give the routine a name,
              then save the combination here.
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {presets.map((preset) => {
              const { meals, totals } = calculateMealPlan(
                preset.entries,
                recipes,
              );
              return (
                <article
                  className="min-w-0 space-y-3 rounded-2xl border-2 border-black bg-white p-4"
                  key={preset.id}
                >
                  <ul
                    className="flex flex-wrap gap-2"
                    aria-label="Recipes in this preset"
                  >
                    {meals.map((meal) => (
                      <li
                        key={meal.id}
                        className="h-12 w-12 shrink-0"
                        title={`${meal.meal}: ${meal.recipe?.title ?? 'Recipe no longer available'}`}
                      >
                        {meal.recipe?.image ? (
                          <img
                            src={meal.recipe.image}
                            alt={meal.recipe.title}
                            loading="lazy"
                            className="h-full w-full rounded-lg border border-black object-cover"
                          />
                        ) : (
                          <span
                            role="img"
                            aria-label={`${meal.recipe?.title ?? 'Recipe no longer available'}: no photo`}
                            className="flex h-full w-full items-center justify-center rounded-lg border border-black bg-white p-1 text-center text-[10px] leading-tight text-black/70"
                          >
                            No photo
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <h3 className="break-words text-xl font-bold">
                    {preset.name}
                  </h3>
                  {editId === preset.id && (
                    <p className="text-sm font-bold">
                      Editing this preset below
                    </p>
                  )}
                  <ul className="space-y-1 text-sm text-black/70">
                    {meals.map((meal) => (
                      <li key={meal.id}>
                        {meal.meal}:{' '}
                        {meal.recipe?.title ?? 'Recipe no longer available'} (
                        {meal.portions}×)
                      </li>
                    ))}
                  </ul>
                  <p className="text-sm font-semibold">
                    {MACROS.map(
                      (key) =>
                        `${totals[key].known ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(totals[key].value) : '—'} ${units[key]}${totals[key].missing ? ' (incomplete)' : ''}`,
                    ).join(' · ')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={secondaryButton}
                      disabled={blocked}
                      onClick={() => {
                        if (dirty) setPending({ type: 'use', preset });
                        else {
                          setEditId(null);
                          onUse(preset);
                        }
                      }}
                    >
                      Use routine
                    </button>
                    <button
                      className={secondaryButton}
                      disabled={blocked}
                      onClick={() => {
                        if (dirty) setPending({ type: 'edit', preset });
                        else {
                          setEditId(preset.id);
                          onEdit(preset);
                        }
                      }}
                    >
                      Edit preset
                    </button>
                    <button
                      className={secondaryButton}
                      disabled={blocked}
                      onClick={() => setPending({ type: 'delete', preset })}
                    >
                      Delete preset
                    </button>
                  </div>
                  {pending?.preset.id === preset.id && (
                    <div className="space-y-3 border-t border-black pt-3">
                      <p>
                        {pending.type === 'delete'
                          ? `Delete preset “${preset.name}”? Your current routine will stay unchanged.`
                          : 'Replace your unsaved meal selections with this preset?'}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          className={secondaryButton}
                          disabled={blocked}
                          onClick={() => setPending(null)}
                        >
                          Cancel
                        </button>
                        <button
                          className={secondaryButton}
                          disabled={blocked}
                          onClick={() => {
                            const action = pending.type;
                            if (action === 'delete')
                              run(async () => {
                                await persist(
                                  presets.filter(
                                    (item) => item.id !== preset.id,
                                  ),
                                  'Preset deleted.',
                                );
                                if (editId === preset.id) setEditId(null);
                              });
                            else {
                              setPending(null);
                              if (action === 'edit') {
                                setEditId(preset.id);
                                onEdit(preset);
                              } else {
                                setEditId(null);
                                onUse(preset);
                              }
                            }
                          }}
                        >
                          {pending.type === 'delete'
                            ? 'Confirm delete'
                            : 'Replace selections'}
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
