import { useEffect, useRef, useState } from 'react';
import { invokeNutritionFunction } from '../../services/nutritionLookup';
import { saveRecipeFibre } from '../../services/recipeService';
import { fibreBasis, fibreIngredients, fibreTotal, groceryFibre } from './recipeFibre';

export function RecipeFibre({ recipe, groceries, onSaved }) {
  const [servings, setServings] = useState('');
  const [basis, setBasis] = useState('');
  const [estimated, setEstimated] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const job = useRef(0), lock = useRef(false);
  useEffect(() => () => { job.current++; }, []);
  useEffect(() => {
    job.current++; lock.current = false;
    setEstimated(null); setConfirmed(false); setBusy(false);
  }, [groceries]);
  const calculated = groceryFibre(recipe, groceries);
  const rows = estimated || calculated;
  const total = fibreTotal(rows, Number(servings), basis);
  const validBasis = Number(servings) > 0 && Number(servings) <= 100 && ['serving', 'recipe'].includes(basis);
  const missing = rows.filter((row) => row.fiberGrams == null);
  const originalMissing = calculated.some((row) => row.fiberGrams == null);
  const reset = () => { setEstimated(null); setConfirmed(false); setError(''); };
  async function estimate() {
    if (lock.current || !validBasis) return;
    lock.current = true; setBusy(true); setError(''); setConfirmed(false);
    const id = ++job.current;
    try {
      const result = await invokeNutritionFunction('estimate-recipe-fibre', {
        servings: Number(servings),
        ingredients: fibreIngredients(recipe).map((item, index) => ({
          name: item.name, amount: item.amount ?? null, unit: item.unit || '',
          note: `${item.note || ''}${item.alternativeGroup ? ' Alternative choice not confirmed.' : ''}`,
          knownFiber: calculated[index].fiberGrams,
        })),
      });
      if (!Array.isArray(result.rows) || result.rows.length !== calculated.length) throw new Error('The estimate is incomplete. Try again.');
      if (id === job.current) setEstimated(result.rows);
    } catch (error) { if (id === job.current) setError(error.message || 'Could not estimate fibre.'); }
    finally { if (id === job.current) { lock.current = false; setBusy(false); } }
  }
  async function save() {
    if (lock.current || total == null || !confirmed) return;
    lock.current = true; setBusy(true); setError('');
    const id = ++job.current;
    try {
      const updated = await saveRecipeFibre(recipe, {
        type: rows.some((row) => row.source === 'ai') ? 'ai' : 'groceries',
        value: total, basis, servings: Number(servings), ingredients: fibreBasis(recipe),
      });
      if (id === job.current) onSaved(updated);
    } catch (error) { if (id === job.current) setError(error.message || 'Could not save fibre. Your review is still here.'); }
    finally { if (id === job.current) { lock.current = false; setBusy(false); } }
  }
  return <details className="g-nutrition-fields">
    <summary>{recipe.nutrition.fiber == null ? 'Fill missing recipe fibre' : 'Review or replace recipe fibre'}</summary>
    <p>Start with matching grocery labels. If anything is missing, AI can estimate typical values. Nothing is saved until you review it.</p>
    <fieldset disabled={busy}>
      <div className="g-tools">
        <label>How many servings does the whole recipe make?
          <input type="number" min="0.01" max="100" step="any" placeholder="Confirm servings" value={servings} onChange={(event) => { setServings(event.target.value); reset(); }} />
        </label>
        <label>The recipe’s other macros are listed for
          <select value={basis} onChange={(event) => { setBasis(event.target.value); reset(); }}>
            <option value="">Choose the same basis</option><option value="serving">One serving</option><option value="recipe">The whole recipe</option>
          </select>
        </label>
      </div>
      <p className="g-hint">The planner’s 1× uses the recipe’s listed nutrition. Use the same basis as its calories, protein, carbs and fat. Ingredient quantities must describe the whole recipe. Edit ambiguous quantities or alternatives before estimating.</p>
      <ul>{rows.map((row) => <li key={row.index}><span><strong>{row.ingredient}</strong><small className="block">{row.quantityUsed || 'Amount unknown'} · {row.note}</small></span><span>{row.fiberGrams == null ? 'Unknown' : `${row.fiberGrams.toFixed(1)} g`}{row.fiberGrams != null && <small className="block">{row.source === 'ai' ? 'AI estimate' : 'Grocery label'}</small>}</span></li>)}</ul>
      {originalMissing && <button type="button" disabled={!validBasis} onClick={estimate}>{busy ? 'Working…' : estimated ? 'Retry AI estimate' : 'Estimate missing fibre with AI'}</button>}
      {missing.length > 0 && <p>Missing fibre for {missing.length} ingredient{missing.length === 1 ? '' : 's'}. A partial total cannot be saved.</p>}
      {total != null && <>
        <p><strong>Estimated fibre: {total} g {basis === 'serving' ? 'per serving' : 'for the whole recipe'}</strong></p>
        <label className="g-tools"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I checked the ingredients, estimated amounts and nutrition basis.</label>
        <button type="button" disabled={!confirmed} onClick={save}>{busy ? 'Saving…' : recipe.nutrition.fiber == null ? 'Save fibre to recipe' : 'Replace saved fibre'}</button>
      </>}
    </fieldset>
    {error && <p role="alert">{error}</p>}
  </details>;
}
