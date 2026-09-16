import { useMemo } from 'react';
import {
  MACRO_CALORIES_PER_GRAM,
  MACRO_KEYS,
  MACRO_PRESETS,
  calculateMacroTargets,
} from './macroTargets';
import { DEFAULT_MACRO_PERCENTAGES, preferredMacroPercentages } from './nutritionGoals';

const LABELS = {
  protein: 'Protein',
  carbs: 'Carbohydrates',
  fat: 'Fat',
};

const numberOrNaN = (value) => {
  if (value == null || value === '') return Number.NaN;
  return typeof value === 'number' ? value : Number(value);
};

function calculateDraft(goals) {
  return calculateMacroTargets({
    calories: numberOrNaN(goals.calories),
    preferredPercentages: Object.fromEntries(
      MACRO_KEYS.map((key) => [key, numberOrNaN(preferredMacroPercentages(goals)[key])]),
    ),
    locked: goals.macroLocked,
    grams: Object.fromEntries(MACRO_KEYS.map((key) => [key, numberOrNaN(goals[key])])),
  });
}

function resultMessage(result, allLocked) {
  if (!result.valid) return result.error;
  const total = Math.round(result.totalCalories);
  const difference = Math.round(Math.abs(result.targetDifference));
  if (allLocked && difference > 0) {
    return `Your macro targets equal ${total.toLocaleString()} kcal, which is ${difference.toLocaleString()} kcal ${result.targetDifference > 0 ? 'above' : 'below'} your daily calorie target.`;
  }
  if (allLocked) return `Your macro targets equal your ${total.toLocaleString()} kcal daily calorie target.`;
  return `Macro calories: ~${total.toLocaleString()} kcal`;
}

export function MacroTargetCard({ goals, editing = false, onChange }) {
  const result = useMemo(() => calculateDraft(goals), [goals]);
  const allLocked = MACRO_KEYS.every((key) => goals.macroLocked?.[key]);
  const customPercentages = goals.customMacroPercentages ?? DEFAULT_MACRO_PERCENTAGES;
  const customTotal = MACRO_KEYS.reduce(
    (total, key) => total + (Number(customPercentages[key]) || 0),
    0,
  );

  function update(patch) {
    onChange?.({ ...goals, ...patch });
  }

  function updateLock(key) {
    const nextLocked = !goals.macroLocked?.[key];
    update({
      macroLocked: { ...goals.macroLocked, [key]: nextLocked },
      ...(nextLocked && result[key] ? { [key]: Math.round(result[key].grams) } : {}),
    });
  }

  const macroValues = Object.fromEntries(MACRO_KEYS.map((key) => {
    const fallbackGrams = Math.max(0, numberOrNaN(goals[key]) || 0);
    const grams = result[key]?.grams ?? fallbackGrams;
    const calories = result[key]?.calories ?? grams * MACRO_CALORIES_PER_GRAM[key];
    const percentage = result[key]?.percentage ?? 0;
    return [key, { grams, calories, percentage }];
  }));

  return (
    <section className="macro-target-card" aria-label="Macro target calculator">
      <div className="macro-target-heading">
        <div>
          <span className="macro-target-kicker">Macros</span>
          <h3>Automatic macro targets</h3>
        </div>
        {editing && (
          <label className="macro-preset-field">
            <span>Preferred Macro Distribution</span>
            <select
              value={goals.macroPreset ?? 'balanced'}
              onChange={(event) => update({ macroPreset: event.target.value })}
            >
              {Object.entries(MACRO_PRESETS).map(([value, preset]) => (
                <option key={value} value={value}>
                  {preset.label} · {preset.percentages.carbs}% C / {preset.percentages.fat}% F / {preset.percentages.protein}% P
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </label>
        )}
      </div>

      {editing && goals.macroPreset === 'custom' && (
        <div className="macro-custom-panel">
          <div className="macro-custom-heading">
            <strong>Custom percentages</strong>
            <span className={Math.abs(customTotal - 100) < 1e-8 ? '' : 'macro-total-invalid'}>
              Total: {customTotal}%
            </span>
          </div>
          <div className="macro-custom-grid">
            {MACRO_KEYS.map((key) => (
              <label key={key}>
                <span>{LABELS[key]} (%)</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={customPercentages[key] ?? ''}
                  onChange={(event) => update({
                    customMacroPercentages: {
                      ...customPercentages,
                      [key]: event.target.value,
                    },
                  })}
                />
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="macro-target-grid">
        {MACRO_KEYS.map((key) => {
          const locked = Boolean(goals.macroLocked?.[key]);
          const macro = macroValues[key];
          return (
            <article key={key} className="macro-target-item" data-macro={key} data-mode={locked ? 'manual' : 'auto'}>
              <div className="macro-target-item-heading">
                <strong>{LABELS[key]}</strong>
                {editing ? (
                  <button
                    type="button"
                    aria-pressed={locked}
                    onClick={() => updateLock(key)}
                    title={locked ? `Use automatic ${LABELS[key].toLowerCase()} calculation` : `Enter ${LABELS[key].toLowerCase()} manually`}
                  >
                    {locked ? 'Manual' : 'Auto'}
                  </button>
                ) : (
                  <span className="macro-mode-label">{locked ? 'Manual' : 'Auto'}</span>
                )}
              </div>
              {editing ? (
                <label className="macro-grams-field">
                  <span className="sr-only">{LABELS[key]} grams</span>
                  <input
                    type="number"
                    min="0"
                    max="100000"
                    step="any"
                    readOnly={!locked}
                    value={locked ? goals[key] ?? '' : Math.round(macro.grams)}
                    onChange={(event) => update({ [key]: event.target.value })}
                  />
                  <span>g</span>
                </label>
              ) : (
                <p className="macro-grams-value">{Math.round(macro.grams)}g</p>
              )}
              <dl>
                <div><dt>Calories</dt><dd>{Math.round(macro.calories)} kcal</dd></div>
                <div><dt>Actual share</dt><dd>{Math.round(macro.percentage)}%</dd></div>
              </dl>
            </article>
          );
        })}
      </div>

      <div className="macro-distribution" aria-label="Macro calorie distribution">
        {MACRO_KEYS.map((key) => (
          <span
            key={key}
            data-macro={key}
            style={{ flexGrow: Math.max(0, macroValues[key].calories) }}
            title={`${LABELS[key]} ${Math.round(macroValues[key].percentage)}%`}
          />
        ))}
      </div>
      <div className="macro-distribution-legend">
        {MACRO_KEYS.map((key) => (
          <span key={key} data-macro={key}>{LABELS[key]} {Math.round(macroValues[key].percentage)}%</span>
        ))}
      </div>

      <p className="macro-target-result" data-valid={result.valid} role={result.valid ? 'status' : 'alert'}>
        {resultMessage(result, allLocked)}
      </p>
      {editing && <p className="macro-target-help">Manual values stay fixed. Automatic macros share the calories left over using the selected distribution.</p>}
    </section>
  );
}
