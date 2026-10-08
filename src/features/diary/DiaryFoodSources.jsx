import { useMemo, useState } from 'react';
import { nutrientContributions } from './diaryData.js';
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
  const changed = Object.values(overrides).some(Boolean) && simulation.changes.length > 0;
  const currentTotals = simulation.currentTotals;
  const simulatedTotals = simulation.simulatedTotals;

  function setAmount(entry, value) {
    if (value === '') {
      setOverrides(previous => { const next = { ...previous }; delete next[entry.key]; return next; });
      return;
    }
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 1000000) return;
    const quantity = mode === 'percent' ? entry.quantity * number / 100 : number;
    if (!Number.isFinite(quantity) || quantity > 1000000) return;
    if (quantity === entry.quantity) { resetEntry(entry.key); return; }
    setOverrides(previous => ({ ...previous, [entry.key]: { quantity } }));
  }
  function resetEntry(key) {
    setOverrides(previous => { const next = { ...previous }; delete next[key]; return next; });
  }
  function closeAdjustments() {
    setAdjusting(false); setOverrides({}); setExpandedFood(''); setConfirmApply(false); setApplyError('');
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
  function openAdjustments() { setAdjusting(true); setOverrides({}); setExpandedFood(''); setApplyError(''); }

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
          <div className="diary-simulation-actions"><Button size="sm" disabled={!changed} onClick={() => setOverrides({})}>Reset all</Button><IconButton label="Close simulation" onClick={closeAdjustments}>×</IconButton></div>
        </header>

        <div className="diary-simulation-table-wrap"><table className="diary-simulation-table"><thead><tr><th>Nutrient</th><th>Current</th><th>Simulated</th><th>Change</th></tr></thead><tbody>
          {NUTRIENTS.map(([key, label]) => <tr key={key}><th scope="row">{label}</th><td data-label="Current">{totalText(currentTotals[key], key)}</td><td data-label="Simulated">{totalText(simulatedTotals[key], key)}</td><td data-label="Change">{format(simulation.deltas[key])} {nutrientMeta.get(key).unit}</td></tr>)}
        </tbody></table></div>

        {TARGET_KEYS.filter(key => Number(goals?.[key]) > 0).length > 0 && <div className="diary-simulation-targets"><strong>Daily target impact</strong><div>{TARGET_KEYS.filter(key => Number(goals?.[key]) > 0).map(key => {
          const { label, unit } = nutrientMeta.get(key); const target = Number(goals[key]); const current = currentTotals[key].value; const next = simulatedTotals[key].value;
          return <div className="diary-simulation-target" key={key}><span>{label}</span><span>{format(current)} / {format(target)} {unit} → {format(next)} / {format(target)} {unit}</span><div className="ui-progress-track"><div className="ui-progress-fill" style={{ width: `${Math.min(100, next / target * 100)}%` }} /></div></div>;
        })}</div></div>}

        {selectedFood && <div className="diary-simulation-editor" aria-label={`Adjust ${selectedFood.name}`}>
          <div className="diary-simulation-editor-heading"><div><span>Adjusting</span><strong>{selectedFood.name}</strong></div><Button size="sm" variant="ghost" onClick={() => setExpandedFood('')}>Close</Button></div>
          <div className="diary-simulation-mode" role="group" aria-label="Adjustment mode"><Button size="sm" aria-pressed={mode === 'percent'} onClick={() => setMode('percent')}>Percent of current</Button><Button size="sm" aria-pressed={mode === 'exact'} onClick={() => setMode('exact')}>Set amount</Button></div>
          <div className="diary-simulation-entry-list">{selectedFood.entries.map(entry => {
            const override = overrides[entry.key]?.quantity;
            const originalAmountKnown = Number.isFinite(entry.quantity) && entry.quantity > 0;
            const simulatedAmount = override ?? entry.quantity;
            const inputValue = originalAmountKnown ? (mode === 'percent' ? format(simulatedAmount / entry.quantity * 100) : String(simulatedAmount)) : '';
            return <div className="diary-simulation-entry" key={entry.key}>
              <div><strong>{entry.mealTitle}</strong><span>Current: {originalAmountKnown ? `${format(entry.quantity)} ${entry.unit}` : 'Amount unknown'}</span><small>{originalAmountKnown ? `${format(entry.quantity)} ${entry.unit} → ${format(simulatedAmount)} ${entry.unit}` : 'A safe amount cannot be reconstructed, so this entry cannot be applied.'}</small></div>
              <label>{mode === 'percent' ? 'Percent of current' : `Simulated amount (${entry.unit})`}<input className="ui-control" type="number" min="0" step={mode === 'percent' ? '1' : 'any'} max={mode === 'percent' && originalAmountKnown ? Math.floor(1000000 / entry.quantity * 100) : 1000000} disabled={!originalAmountKnown || disabled} value={inputValue} onChange={event => setAmount(entry, event.target.value)} />{mode === 'percent' && <small>100% keeps the logged amount; 0% simulates removing it.</small>}</label>
              {overrides[entry.key] && <Button size="sm" onClick={() => resetEntry(entry.key)}>Reset</Button>}
            </div>;
          })}</div>
          <p>Amounts use each diary entry&apos;s existing unit. No conversion is performed. Recipe snapshots and older diary days stay unchanged.</p>
        </div>}

        {applyError && <p role="alert" className="diary-simulation-error">{applyError}</p>}
        <div className="diary-simulation-footer"><span>{changed ? `${simulation.changes.length} changed ${simulation.changes.length === 1 ? 'entry' : 'entries'} · preview only` : 'No changes to apply'}</span><Button variant="primary" disabled={!changed || disabled} onClick={() => setConfirmApply(true)}>Apply changes</Button></div>
      </Panel>}

      <div className="diary-source-grid">
        {SOURCE_CARDS.map(([key, label, description, colorToken, unit]) => {
          const nutrient = adjusting ? simulation.contributions[key] : contributions[key];
          const energy = nutrientEnergy(key, nutrient, adjusting ? simulation.contributions.calories : contributions.calories);
          const target = goals?.[key]; const targetPercent = target > 0 ? (nutrient.total / target) * 100 : null;
          return <article className="diary-source-card" key={key} style={{ '--source-color': `var(${colorToken})` }}>
            <header><div><span>{description}</span><h3>{label}</h3></div><div className="diary-source-total"><strong>{format(nutrient.total)} {unit}</strong>{target > 0 && <small>{format(targetPercent)}% of {format(target)} {unit} target</small>}</div></header>
            {energy && <div className="diary-source-energy"><strong>Estimated calories from {label.toLocaleLowerCase()}</strong><span>{energy.calories == null ? 'Unknown' : <>{format(nutrient.total)} g × {energy.factor} kcal/g = <b>{format(energy.calories)} kcal</b></>}</span>{energy.percentage != null && <small>About {format(energy.percentage)}% of {format((adjusting ? simulatedTotals.calories : contributions.calories).value)} logged kcal{energy.partial ? ' (partial data)' : ''}</small>}{key === 'carbs' && <small>Uses carbs × 4. If your food record includes fibre in carbs, this estimate overlaps with fibre calories.</small>}{key === 'fiber' && <small>Uses an average of 2 kcal/g for fibre; actual energy varies.</small>}</div>}
            {key !== 'calories' && nutrient.foods.length > 0 && <p className="diary-source-calories"><span>Calories from foods listed</span><strong>{calorieLabel(nutrient)}</strong></p>}
            {nutrient.foods.length ? <ol className="diary-source-list">{nutrient.foods.map(food => {
              const group = groups.find(item => item.key === sourceKey(food.name));
              const adjusted = group?.entries.some(entry => overrides[entry.key]?.quantity != null && overrides[entry.key].quantity !== entry.quantity);
              return <li key={food.name.toLocaleLowerCase()}><div className="diary-source-row"><strong>{food.name}{key !== 'calories' && <small className="diary-source-food-calories"> · {calorieLabel(food)}</small>}{adjusted && <Badge variant="accent">Adjusted</Badge>}</strong><span><b>{format(food.value)} {unit}</b> · {format(food.percentage)}%</span></div><div className="diary-source-track" aria-hidden="true"><span style={{ width: `${food.percentage}%` }} /></div>{adjusting && group && <Button size="sm" className="diary-source-adjust" aria-expanded={expandedFood === group.key} onClick={() => setExpandedFood(expandedFood === group.key ? '' : group.key)}>{expandedFood === group.key ? 'Editing' : 'Adjust'}</Button>}</li>;
            })}</ol> : <p className="diary-source-none">No recorded {label.toLocaleLowerCase()} from this day&apos;s foods.</p>}
            {nutrient.missing > 0 && <p className="diary-source-warning">{nutrient.missing} food {nutrient.missing === 1 ? 'is' : 'items are'} missing {label.toLocaleLowerCase()} data, so this breakdown is partial.</p>}
            {key !== 'calories' && nutrient.caloriesMissing > 0 && <p className="diary-source-warning">Calories are missing for {nutrient.caloriesMissing} contributing food {nutrient.caloriesMissing === 1 ? 'entry' : 'entries'}.</p>}
          </article>;
        })}
      </div>
    </>}
    {foodCount > 0 && <p className="diary-source-none">Nutrient energy is approximate and may not add up to label calories because of fibre definitions, sugar alcohols and rounding. <a href="https://www.legislation.gov.uk/eur/2011/1169/annex/XIV" target="_blank" rel="noreferrer">Energy conversion factors</a>.</p>}

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
