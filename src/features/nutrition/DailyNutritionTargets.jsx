import { useCallback, useEffect, useRef, useState } from 'react';
import { getPreference, setPreference } from '../../services/preferenceService';
import {
  GOAL_KEY,
  GOAL_FIELDS,
  emptyGoals,
  hydrateCalculatedGoals,
  prepareGoalsForSave,
  formatMacro,
  maintenanceDifference,
} from './nutritionGoals';
import { MacroTargetCard } from './MacroTargetCard';
import './nutritionGoals.css';

const BASIC_FIELDS = GOAL_FIELDS.filter(([key]) =>
  ['calories', 'maintenanceCalories', 'fiber'].includes(key),
);

export function useNutritionGoals() {
  const [goals, setGoals] = useState(emptyGoals);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const load = useCallback(async () => {
    const id = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const stored = await getPreference(GOAL_KEY);
      if (id === generation.current) setGoals(stored == null ? emptyGoals() : hydrateCalculatedGoals(stored));
    } catch {
      if (id === generation.current) setError('Could not load your daily targets. Please retry.');
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
    return () => { generation.current++; };
  }, [load]);
  async function save(draft) {
    const next = prepareGoalsForSave(draft);
    const id = generation.current;
    await setPreference(GOAL_KEY, next);
    if (id === generation.current) setGoals(next);
  }
  return { goals, loading, error, load, save };
}

export function DailyNutritionTargets({ controller }) {
  const { goals, loading, error, load, save } = controller;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(emptyGoals);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const lock = useRef(false);
  const hasGoals = GOAL_FIELDS.some(([key]) => goals[key] != null);
  const calorieDifference = maintenanceDifference(goals);
  async function submit(event) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setSaveError('');
    try {
      await save(draft);
      setEditing(false);
      setSaved(true);
    } catch (error) {
      setSaveError(error.message || 'Could not save targets. Your changes are still here; try again.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return <section className="nutrition-targets" aria-label="Daily nutrition targets">
    <div className="nutrition-targets-heading">
      <div>
        <h2>Daily nutrition targets</h2>
        <p>Your daily goals, shared across your meal planner, recipes and groceries.</p>
      </div>
      {!loading && !error && !editing && <button type="button" onClick={() => {
        setDraft({ ...goals }); setEditing(true); setSaved(false); setSaveError('');
      }}>{hasGoals ? 'Edit targets' : 'Set targets'}</button>}
    </div>
    {loading ? <p role="status">Loading targets…</p> : error ? <p role="alert">{error} <button type="button" onClick={load}>Retry targets</button></p> : <>
      {editing ? <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <div className="nutrition-basics-grid">
            {BASIC_FIELDS.map(([key, label, unit]) => <label key={key}>
              <span>{label} ({unit}/day)</span>
              <input type="number" min={key === 'calories' ? '0.01' : '0'} max="100000" step="any" placeholder="Not set" value={draft[key] ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft((current) => ({ ...current, [key]: value }));
                }} />
            </label>)}
          </div>
          <MacroTargetCard goals={draft} editing onChange={setDraft} />
          <p>Maintenance calories are your estimated weight-maintaining intake. The meal planner compares meals with your calorie target.</p>
          <p>Maintenance calories and fibre can be left blank. A calorie target is required to calculate macros.</p>
          <div className="nutrition-targets-actions">
            <button type="submit">{busy ? 'Saving…' : 'Save targets'}</button>
            <button type="button" onClick={() => { setEditing(false); setSaveError(''); }}>Cancel</button>
          </div>
        </fieldset>
        {saveError && <p role="alert">{saveError}</p>}
      </form> : <>
        <dl className="nutrition-basics-grid">
          {BASIC_FIELDS.map(([key, label, unit]) => <div key={key}>
            <dt>{label}</dt><dd>{goals[key] == null ? 'Not set' : <>{formatMacro(goals[key])} <small>{unit}/day</small></>}</dd>
          </div>)}
        </dl>
        {goals.calories != null && <MacroTargetCard goals={goals} />}
      </>}
      {!editing && calorieDifference != null && (
        <p className="nutrition-targets-balance">
          {calorieDifference > 0
            ? `Planned deficit: ${formatMacro(calorieDifference)} kcal/day below maintenance.`
            : calorieDifference < 0
              ? `Planned surplus: ${formatMacro(Math.abs(calorieDifference))} kcal/day above maintenance.`
              : 'Your calorie target matches your maintenance calories.'}
        </p>
      )}
      <p>Fibre is an amount to aim for, not a strict upper limit. Targets are editable starting points.</p>
      {saved && <p role="status">Daily targets saved.</p>}
    </>}
  </section>;
}
