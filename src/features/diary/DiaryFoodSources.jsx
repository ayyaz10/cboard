import { useEffect, useMemo, useState } from 'react';
import { itemNutrition, nutrientContributions } from './diaryData.js';
import { nutrientEnergy } from './nutrientEnergy.js';
import { simulateDiaryChanges, simulationKey } from './diarySimulation.js';
import { NUTRIENTS } from '../nutrition/nutrients.js';
import { Button } from '../../components/ui/Button.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Panel } from '../../components/ui/Card.jsx';
import { Dialog } from '../../components/ui/Dialog.jsx';
import { IconButton } from '../../components/ui/IconButton.jsx';

const SOURCE_CARDS = [
  ['calories', 'Calories', 'Energy from your food', '--chart-primary', 'kcal'],
  ['protein', 'Protein', 'Build & repair', '--chart-positive', 'g'],
  ['carbs', 'Carbs', 'Energy', '--chart-secondary', 'g'],
  ['fat', 'Fat', 'Energy & hormones', '--chart-tertiary', 'g'],
  ['fiber', 'Fibre', 'Digestion & fullness', '--chart-axis', 'g'],
];
const TARGET_KEYS = ['calories', 'protein', 'carbs', 'fat', 'fiber'];
const EDITOR_NUTRIENTS = [
  ['calories', 'Calories', 'kcal'],
  ['protein', 'Protein', 'g'],
  ['carbs', 'Carbs', 'g'],
  ['fat', 'Fat', 'g'],
  ['fiber', 'Fibre', 'g'],
];
const SOURCE_VISIBILITY_STORAGE_KEY = 'cboard:food-diary:source-visibility:v1';
function defaultSourceVisibility() {
  return Object.fromEntries(SOURCE_CARDS.map(([key]) => [key, true]));
}
function readSourceVisibility() {
  try {
    const saved = JSON.parse(localStorage.getItem(SOURCE_VISIBILITY_STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      return Object.fromEntries(SOURCE_CARDS.map(([key]) => [key, typeof saved[key] === 'boolean' ? saved[key] : true]));
    }
  } catch { /* Use the default card set when browser storage is unavailable. */ }
  return defaultSourceVisibility();
}
const format = value => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
const calorieLabel = value => value.caloriesKnown ? `${format(value.calories)} kcal${value.caloriesMissing ? ' (known subtotal)' : ''}` : 'Calories unknown';
const dateLabel = (date, today) => date === today ? 'today' : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
const sourceKey = name => String(name || '').trim().toLocaleLowerCase();
const nutrientMeta = new Map(NUTRIENTS.map(([key, label, unit]) => [key, { label, unit }]));

function totalText(total, key) {
  const { unit } = nutrientMeta.get(key);
  return `${format(total.value)} ${unit}${total.missing ? ' · known subtotal' : ''}`;
}

export function DiaryFoodSources({ meals, goals, date, today, disabled = false, onApplyChanges }) {
  const [adjusting, setAdjusting] = useState(false);
  const [mode, setMode] = useState('percent');
  const [overrides, setOverrides] = useState({});
  const [expandedFood, setExpandedFood] = useState('');
  const [selectedNutrient, setSelectedNutrient] = useState('calories');
  const [amountDrafts, setAmountDrafts] = useState({});
  const [visibleSources, setVisibleSources] = useState(readSourceVisibility);
  const [confirmApply, setConfirmApply] = useState(false);
  const [applyError, setApplyError] = useState('');
  const contributions = useMemo(() => nutrientContributions(meals), [meals]);
  const simulation = useMemo(() => simulateDiaryChanges(meals, overrides), [meals, overrides]);
  const foodCount = meals.reduce((count, meal) => count + meal.items.length, 0);
  const groups = useMemo(() => {
    const grouped = new Map();
    for (const meal of meals) for (const item of meal.items) {
      const key = sourceKey(item.name);
      if (!grouped.has(key)) grouped.set(key, { key, name: item.name || 'Food', entries: [] });
      grouped.get(key).entries.push({ ...item, mealId: meal.id, mealTitle: meal.title || meal.meal, key: simulationKey(meal.id, item.id) });
    }
    return [...grouped.values()];
  }, [meals]);
  const selectedFood = groups.find(food => food.key === expandedFood);
  const selectedFoodImpact = selectedFood ? EDITOR_NUTRIENTS.map(([key, label, unit]) => {
    let current = 0;
    let preview = 0;
    let currentMissing = 0;
    let previewMissing = 0;
    for (const entry of selectedFood.entries) {
      const currentValue = itemNutrition(entry)[key];
      if (currentValue == null) currentMissing += 1;
      else current += currentValue;
      const quantity = overrides[entry.key]?.quantity ?? entry.quantity;
      const previewValue = quantity <= 0 ? 0 : itemNutrition({ ...entry, quantity })[key];
      if (previewValue == null) previewMissing += 1;
      else preview += previewValue;
    }
    return { key, label, unit, current, preview, currentMissing, previewMissing };
  }) : [];
  const changed = Object.values(overrides).some(Boolean) && simulation.changes.length > 0;
  const currentTotals = simulation.currentTotals;
  const simulatedTotals = simulation.simulatedTotals;

  useEffect(() => {
    try { localStorage.setItem(SOURCE_VISIBILITY_STORAGE_KEY, JSON.stringify(visibleSources)); }
    catch { /* Card visibility still works for this visit when storage is unavailable. */ }
  }, [visibleSources]);

  function toggleSource(key) {
    setVisibleSources(previous => ({ ...previous, [key]: !previous[key] }));
  }

  function applyAmount(entry, number) {
    const quantity = mode === 'percent' ? entry.quantity * number / 100 : number;
    if (!Number.isFinite(quantity) || quantity > 1000000) return;
    if (quantity === entry.quantity) {
      setOverrides(previous => { const next = { ...previous }; delete next[entry.key]; return next; });
      return;
    }
    setOverrides(previous => ({ ...previous, [entry.key]: { quantity } }));
  }
  function setAmount(entry, value) {
    setAmountDrafts(previous => ({ ...previous, [entry.key]: value }));
    if (value === '') {
      setOverrides(previous => { const next = { ...previous }; delete next[entry.key]; return next; });
      return;
    }
    const normalized = value.replace(',', '.');
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return;
    const number = Number(normalized);
    if (!Number.isFinite(number) || number < 0 || number > 1000000) return;
    applyAmount(entry, number);
  }
  function resetEntry(key) {
    setOverrides(previous => { const next = { ...previous }; delete next[key]; return next; });
    setAmountDrafts(previous => { const next = { ...previous }; delete next[key]; return next; });
  }
  function chooseMode(nextMode) {
    setMode(nextMode);
    setAmountDrafts({});
  }
  function usePercentPreset(percent) {
    if (!selectedFood) return;
    const nextOverrides = { ...overrides };
    for (const entry of selectedFood.entries) {
      if (!Number.isFinite(entry.quantity) || entry.quantity <= 0) continue;
      const quantity = entry.quantity * percent / 100;
      if (quantity === entry.quantity) delete nextOverrides[entry.key];
      else nextOverrides[entry.key] = { quantity };
    }
    setOverrides(nextOverrides);
    setAmountDrafts({});
  }
  function closeAdjustments() {
    setAdjusting(false); setOverrides({}); setAmountDrafts({}); setExpandedFood(''); setConfirmApply(false); setApplyError('');
  }
  async function applyChanges() {
    if (!changed || disabled) return;
    setApplyError('');
    try {
      const saved = await onApplyChanges?.(simulation.meals);
      if (saved) closeAdjustments();
      else setApplyError('Could not apply these changes. Your diary is unchanged; try again.');
    } catch (error) { setApplyError(error.message || 'Could not save these diary changes.'); }
  }
  function openAdjustments() { setAdjusting(true); setOverrides({}); setAmountDrafts({}); setExpandedFood(''); setApplyError(''); }

  return <section className="diary-sources" aria-labelledby="food-sources-heading">
    <div className="diary-sources-intro">
      <div>
        <span className="pill">Calories &amp; macro breakdown</span>
        <h2 id="food-sources-heading">What your food is giving you</h2>
        <p>Each food-row percentage is that food&apos;s share of the nutrient you logged for {dateLabel(date, today)}. Calories beside food names are for the whole logged portion. Each macro card also estimates calories from that nutrient. The “foods listed” totals overlap across cards—do not add them together.</p>
      </div>
      <div className="diary-sources-actions"><Badge>{foodCount} food {foodCount === 1 ? 'entry' : 'entries'}</Badge>{foodCount > 0 && !adjusting && <Button size="sm" disabled={disabled} onClick={openAdjustments}>What-if</Button>}</div>
    </div>

    {!foodCount ? <Panel className="diary-sources-empty"><strong>No foods logged for this day yet.</strong><p>Open the Day log tab and add a meal to see where your calories, macros and fibre come from.</p></Panel> : <>
      {adjusting && <Panel className="diary-simulation-panel" aria-label="Food quantity simulation">
        <header className="diary-simulation-heading">
          <div><Badge variant="accent">Preview only</Badge><h3>{date === today ? 'Today' : dateLabel(date, today)} — what if?</h3><p>Try amounts without changing your diary. Each entry keeps its logged unit and nutrition snapshot.</p></div>
          <div className="diary-simulation-actions"><Button size="sm" disabled={!changed} onClick={() => { setOverrides({}); setAmountDrafts({}); }}>Reset all</Button><IconButton label="Close simulation" onClick={closeAdjustments}>×</IconButton></div>
        </header>

        <div className="diary-simulation-quick-summary" aria-label="Simulated daily totals">{TARGET_KEYS.map(key => <div key={key}><span>{nutrientMeta.get(key).label}</span><strong>{key === 'calories' ? `${format(simulatedTotals[key].value)} kcal` : `${format(simulatedTotals[key].value)} g`}</strong><small>{format(simulation.deltas[key])}{key === 'calories' ? ' kcal' : ' g'} change</small></div>)}</div>

        <details className="diary-simulation-details"><summary>All nutrient totals ({NUTRIENTS.length})</summary><div className="diary-simulation-table-wrap"><table className="diary-simulation-table"><thead><tr><th>Nutrient</th><th>Current</th><th>Simulated</th><th>Change</th></tr></thead><tbody>
          {NUTRIENTS.map(([key, label]) => <tr key={key}><th scope="row">{label}</th><td data-label="Current">{totalText(currentTotals[key], key)}</td><td data-label="Simulated">{totalText(simulatedTotals[key], key)}</td><td data-label="Change">{format(simulation.deltas[key])} {nutrientMeta.get(key).unit}</td></tr>)}
        </tbody></table></div></details>

        {TARGET_KEYS.filter(key => Number(goals?.[key]) > 0).length > 0 && <details className="diary-simulation-target-details"><summary>Daily target impact</summary><div className="diary-simulation-targets"><div>{TARGET_KEYS.filter(key => Number(goals?.[key]) > 0).map(key => {
          const { label, unit } = nutrientMeta.get(key); const target = Number(goals[key]); const current = currentTotals[key].value; const next = simulatedTotals[key].value;
          return <div className="diary-simulation-target" key={key}><span>{label}</span><span>{format(current)} / {format(target)} {unit} → {format(next)} / {format(target)} {unit}</span><div className="ui-progress-track"><div className="ui-progress-fill" style={{ width: `${Math.min(100, next / target * 100)}%` }} /></div></div>;
        })}</div></div></details>}

        <div className="diary-simulation-footer"><span>{changed ? `${simulation.changes.length} changed ${simulation.changes.length === 1 ? 'entry' : 'entries'} · preview only` : 'No changes to apply'}</span><Button variant="primary" disabled={!changed || disabled} onClick={() => setConfirmApply(true)}>Review &amp; apply</Button></div>
      </Panel>}

      <div className="diary-source-visibility">
        <div className="diary-source-visibility-heading"><strong>Food source cards</strong><span>Choose which nutrients to show</span></div>
        <div className="diary-source-visibility-controls" role="group" aria-label="Show or hide nutrient cards">
          {SOURCE_CARDS.map(([key, label]) => <Button key={key} size="sm" className="diary-source-visibility-toggle" aria-pressed={visibleSources[key]} onClick={() => toggleSource(key)}><span aria-hidden="true">{visibleSources[key] ? '✓' : '+'}</span>{label}</Button>)}
          {SOURCE_CARDS.some(([key]) => !visibleSources[key]) && <Button size="sm" variant="ghost" onClick={() => setVisibleSources(defaultSourceVisibility())}>Show all</Button>}
        </div>
      </div>

      {SOURCE_CARDS.some(([key]) => visibleSources[key]) ? <div className="diary-source-grid">
        {SOURCE_CARDS.filter(([key]) => visibleSources[key]).map(([key, label, description, colorToken, unit]) => {
          const nutrient = adjusting ? simulation.contributions[key] : contributions[key];
          const calorieContributions = adjusting ? simulation.contributions.calories : contributions.calories;
          const energy = nutrientEnergy(key, nutrient, calorieContributions);
          const target = goals?.[key]; const targetPercent = target > 0 ? (nutrient.total / target) * 100 : null;
          return <article className={`diary-source-card${selectedFood && key === selectedNutrient ? ' is-editing' : ''}`} key={key} style={{ '--source-color': `var(${colorToken})` }}>
            <header><div><span>{description}</span><h3>{label}</h3></div><div className="diary-source-total"><strong>{format(nutrient.total)} {unit}</strong>{target > 0 && <small>{format(targetPercent)}% of {format(target)} {unit} target</small>}</div></header>
            {energy && <div className="diary-source-energy"><strong>Estimated calories from {label.toLocaleLowerCase()}</strong><span>{energy.calories == null ? 'Unknown' : <>{format(nutrient.total)} g × {energy.factor} kcal/g = <b>{format(energy.calories)} kcal</b></>}</span>{energy.percentage != null && <small>About {format(energy.percentage)}% of {format(calorieContributions.total)} logged kcal{energy.partial ? ' (partial data)' : ''}</small>}{key === 'carbs' && <small>Uses carbs × 4. If your food record includes fibre in carbs, this estimate overlaps with fibre calories.</small>}{key === 'fiber' && <small>Uses an average of 2 kcal/g for fibre; actual energy varies.</small>}</div>}
            {key !== 'calories' && nutrient.foods.length > 0 && <p className="diary-source-calories"><span>Calories from foods listed</span><strong>{calorieLabel(nutrient)}</strong></p>}
            {nutrient.foods.length ? <ol className="diary-source-list">{nutrient.foods.map(food => {
              const group = groups.find(item => item.key === sourceKey(food.name));
              const adjusted = group?.entries.some(entry => overrides[entry.key]?.quantity != null && overrides[entry.key].quantity !== entry.quantity);
              return <li key={food.name.toLocaleLowerCase()}><div className="diary-source-row"><strong>{food.name}{key !== 'calories' && <small className="diary-source-food-calories"> · {calorieLabel(food)}</small>}{adjusted && <Badge variant="accent">Adjusted</Badge>}</strong><span><b>{format(food.value)} {unit}</b> · {format(food.percentage)}%</span></div><div className="diary-source-track" aria-hidden="true"><span style={{ width: `${food.percentage}%` }} /></div>{adjusting && group && <Button size="sm" className="diary-source-adjust" aria-haspopup="dialog" onClick={() => { setExpandedFood(group.key); setSelectedNutrient(key); setAmountDrafts({}); }}>{group.entries.some(entry => overrides[entry.key]?.quantity != null) ? 'Adjust again' : 'Adjust'}</Button>}</li>;
            })}</ol> : <p className="diary-source-none">No recorded {label.toLocaleLowerCase()} from this day&apos;s foods.</p>}
            {nutrient.missing > 0 && <p className="diary-source-warning">{nutrient.missing} food {nutrient.missing === 1 ? 'is' : 'items are'} missing {label.toLocaleLowerCase()} data, so this breakdown is partial.</p>}
            {key !== 'calories' && nutrient.caloriesMissing > 0 && <p className="diary-source-warning">Calories are missing for {nutrient.caloriesMissing} contributing food {nutrient.caloriesMissing === 1 ? 'entry' : 'entries'}.</p>}
          </article>;
        })}
      </div> : <p className="diary-source-hidden-empty">All nutrient cards are hidden. Choose a nutrient above to show it again.</p>}
    </>}
    {foodCount > 0 && <p className="diary-source-none">Nutrient energy is approximate and may not add up to label calories because of fibre definitions, sugar alcohols and rounding. <a href="https://www.legislation.gov.uk/eur/2011/1169/annex/XIV" target="_blank" rel="noreferrer">Energy conversion factors</a>.</p>}

    <Dialog open={Boolean(selectedFood)} onClose={() => setExpandedFood('')} labelledBy="diary-simulation-editor-title" className="diary-simulation-editor-dialog">
      {selectedFood && <div className="diary-simulation-editor" aria-label={`Adjust ${selectedFood.name}`}>
          <div className="diary-simulation-editor-heading"><div><span>Adjusting {nutrientMeta.get(selectedNutrient)?.label?.toLocaleLowerCase() || 'food'}</span><strong id="diary-simulation-editor-title">{selectedFood.name}</strong></div><Button size="sm" variant="ghost" onClick={() => setExpandedFood('')}>Close</Button></div>
          <section className="diary-simulation-daily-impact" aria-label="Overall daily nutrition totals">
            <div className="diary-simulation-impact-heading"><strong>Overall daily totals</strong><span>{date === today ? 'Today' : dateLabel(date, today)}</span></div>
            <div className="diary-simulation-impact-grid">{EDITOR_NUTRIENTS.map(([key, label, unit]) => {
              const current = currentTotals[key];
              const preview = simulatedTotals[key];
              const currentText = current.known ? `${format(current.value)} ${unit}${current.missing ? '*' : ''}` : 'Unknown';
              const previewText = preview.known ? `${format(preview.value)} ${unit}${preview.missing ? '*' : ''}` : 'Unknown';
              const changeText = !current.known && !preview.known
                ? 'Change unavailable'
                : `${simulation.deltas[key] > 0 ? '+' : ''}${format(simulation.deltas[key])} ${unit}${current.missing || preview.missing ? ' · partial' : ''}`;
              return <div className={`diary-simulation-impact-item${key === selectedNutrient ? ' is-active' : ''}`} key={key}><span>{label}</span><strong>{currentText} <span aria-hidden="true">→</span> {previewText}</strong><small>{changeText}</small></div>;
            })}</div>
            {EDITOR_NUTRIENTS.some(([key]) => currentTotals[key].missing || simulatedTotals[key].missing) && <small className="diary-simulation-impact-note">* Known subtotal; some foods have no data for that nutrient.</small>}
          </section>
          <section className="diary-simulation-food-impact" aria-label={`Nutrition impact for ${selectedFood.name}`}>
            <div className="diary-simulation-impact-heading"><strong>This food</strong><span>Across {selectedFood.entries.length} logged {selectedFood.entries.length === 1 ? 'entry' : 'entries'}</span></div>
            <div className="diary-simulation-impact-grid">{selectedFoodImpact.map(({ key, label, unit, current, preview, currentMissing, previewMissing }) => {
              const currentText = currentMissing === selectedFood.entries.length ? 'Unknown' : `${format(current)} ${unit}${currentMissing ? '*' : ''}`;
              const previewText = previewMissing === selectedFood.entries.length ? 'Unknown' : `${format(preview)} ${unit}${previewMissing ? '*' : ''}`;
              const difference = preview - current;
              const changeText = currentMissing === selectedFood.entries.length && previewMissing === selectedFood.entries.length
                ? 'No nutrition data'
                : `${difference > 0 ? '+' : ''}${format(difference)} ${unit}${currentMissing || previewMissing ? ' · partial' : ''}`;
              return <div className={`diary-simulation-impact-item${key === selectedNutrient ? ' is-active' : ''}`} key={key}><span>{label}</span><strong>{currentText} <span aria-hidden="true">→</span> {previewText}</strong><small>{changeText}</small></div>;
            })}</div>
            {selectedFoodImpact.some(item => item.currentMissing || item.previewMissing) && <small className="diary-simulation-impact-note">Partial values use the nutrition data available for these entries.</small>}
          </section>
          <div className="diary-simulation-mode" role="group" aria-label="Adjustment mode"><Button size="sm" aria-pressed={mode === 'percent'} onClick={() => chooseMode('percent')}>% of logged</Button><Button size="sm" aria-pressed={mode === 'exact'} onClick={() => chooseMode('exact')}>Exact amount</Button></div>
          {mode === 'percent' && <div className="diary-simulation-presets" role="group" aria-label="Quick percentage amounts">{[50, 75, 100, 125, 150].map(percent => <Button key={percent} size="sm" aria-pressed={selectedFood.entries.every(entry => !Number.isFinite(entry.quantity) || entry.quantity <= 0 || Math.abs((overrides[entry.key]?.quantity ?? entry.quantity) / entry.quantity * 100 - percent) < .05)} onClick={() => usePercentPreset(percent)}>{percent}%</Button>)}</div>}
          <div className="diary-simulation-entry-list">{selectedFood.entries.map(entry => {
            const override = overrides[entry.key]?.quantity;
            const originalAmountKnown = Number.isFinite(entry.quantity) && entry.quantity > 0;
            const simulatedAmount = override ?? entry.quantity;
            const inputValue = amountDrafts[entry.key] ?? (originalAmountKnown ? String(mode === 'percent' ? Math.round(simulatedAmount / entry.quantity * 1000) / 10 : simulatedAmount) : '');
            return <div className="diary-simulation-entry" key={entry.key}>
              <div><strong>{entry.mealTitle}</strong><span>Logged: {originalAmountKnown ? `${format(entry.quantity)} ${entry.unit}` : 'Amount unknown'}</span><small>{originalAmountKnown ? `Preview: ${format(simulatedAmount)} ${entry.unit}` : 'A safe amount cannot be reconstructed, so this entry cannot be adjusted.'}</small></div>
              <label>{mode === 'percent' ? 'Percent of logged amount' : `Amount (${entry.unit})`}<input className="ui-control" type="text" inputMode="decimal" autoComplete="off" spellCheck="false" aria-label={`${mode === 'percent' ? 'Percent of logged amount' : `Amount in ${entry.unit}`} for ${entry.mealTitle}`} disabled={!originalAmountKnown || disabled} value={inputValue} onChange={event => setAmount(entry, event.target.value)} onBlur={() => setAmountDrafts(previous => { const next = { ...previous }; delete next[entry.key]; return next; })} /></label>
              {overrides[entry.key] && <Button size="sm" onClick={() => resetEntry(entry.key)}>Reset</Button>}
            </div>;
          })}</div>
          <p>Clear the field to restore the logged amount; enter 0 to simulate removing it. Amounts use each entry&apos;s current unit.</p>
        </div>}
    </Dialog>

    <Dialog open={confirmApply} onClose={() => setConfirmApply(false)} labelledBy="diary-simulation-confirm-title" className="diary-simulation-confirm">
      <div className="diary-simulation-confirm-heading"><Badge variant="warning">Review changes</Badge><IconButton label="Cancel apply" onClick={() => setConfirmApply(false)}>×</IconButton></div>
      <h3 id="diary-simulation-confirm-title">Apply these changes to {date}?</h3>
      <p>Only the selected day&apos;s logged meal entries will change. Recipe records and other days stay as they are. Grocery stock will reconcile through the normal diary save.</p>
      <ul>{simulation.changes.map(change => <li key={change.key}><strong>{change.name}</strong><span>{format(change.before)} {change.unit} → {change.after === 0 ? 'remove' : `${format(change.after)} ${change.unit}`}</span></li>)}</ul>
      <div className="diary-simulation-confirm-totals">{['calories', 'protein', 'carbs', 'fat', 'fiber'].map(key => <p key={key}><span>{nutrientMeta.get(key).label}</span><strong>{totalText(currentTotals[key], key)} → {totalText(simulatedTotals[key], key)}</strong></p>)}</div>
      {applyError && <p role="alert" className="diary-simulation-error">{applyError}</p>}
      <div className="diary-simulation-confirm-actions"><Button onClick={() => setConfirmApply(false)}>Cancel</Button><Button variant="primary" disabled={disabled || !changed} onClick={() => void applyChanges()}>Apply to this day</Button></div>
    </Dialog>
  </section>;
}
