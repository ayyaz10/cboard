import { useEffect, useRef, useState } from 'react';
import { NutritionLookup } from '../groceries/NutritionLookup';
import { NutritionLabelScan } from './NutritionLabelScan';
import { cleanNutrients } from './nutrients.js';
import { NUTRIENTS } from './nutrients.js';
import { validateFoodItem } from '../../../supabase/functions/_shared/foodItem.js';
import { invokeNutritionFunction } from '../../services/nutritionLookup';
import { notify } from '../../lib/notifications.js';
import '../groceries/groceries.css';

const example = { name: "McDonald's burger", quantity: 1, unit: 'pieces', nutrition: { calories: null, protein: null, carbs: null, fat: null, fiber: null } };
export function FoodItemEditor({ catalog, onSave, onClose, initial = null }) {
  const dialog = useRef(null), lock = useRef(false);
  const [mode, setMode] = useState('manual');
  const [draft, setDraft] = useState(() => initial ? structuredClone(initial) : { name: '', quantity: 1, unit: 'pieces', nutrition: {}, source: { provider: 'Manual' } });
  const [json, setJson] = useState(JSON.stringify(example, null, 2));
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [replace, setReplace] = useState(Boolean(initial));
  const existing = catalog.some(item => item.id !== initial?.id && item.name.trim().toLowerCase() === draft.name.trim().toLowerCase());
  useEffect(() => { dialog.current.showModal(); }, []);
  useEffect(() => { if (dialog.current) dialog.current.scrollTop = 0; }, [mode]);
  function useFood(food, provider) {
    setDraft({ ...(initial?.id ? { id: initial.id } : {}), ...validateFoodItem(food), source: { provider, ...food.source } });
    setMode('manual'); setReplace(false); setError('');
  }
  async function ai() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await invokeNutritionFunction('parse-recipe', { mode: 'food', recipeText: description });
      useFood(result.food, 'AI assisted (unverified)');
    } catch (err) { setError(err.message); notify.error(err.message || 'Could not prepare food values'); }
    finally { lock.current = false; setBusy(false); }
  }
  function parse(text) {
    try {
      if (new TextEncoder().encode(text).length > 256 * 1024) throw new Error('Food JSON must be smaller than 256 KB.');
      useFood(JSON.parse(text), 'JSON import');
    } catch (err) { setError(err instanceof SyntaxError ? 'Paste one valid JSON object, without Markdown fences.' : err.message); }
  }
  async function save(event) {
    event.preventDefault();
    if (lock.current || (existing && !replace)) return;
    if (initial && existing) { setError('Another food already has this name. Rename it to avoid ambiguity; foods are not merged automatically.'); return; }
    lock.current = true; setBusy(true); setError('');
    try { await onSave({ ...(initial?.id ? { id: initial.id } : {}), ...validateFoodItem(draft), source: draft.source }); onClose(); }
    catch (err) { setError(err.message); notify.error(err.message || 'Could not save food item'); }
    finally { lock.current = false; setBusy(false); }
  }
  const nutrientFields = rows => <div className="g-nutrition-grid">{rows.map(([key, label, unit]) => <label key={key}>{label} ({unit})<input type="number" min="0" step="any" value={draft.nutrition[key] ?? ''} onChange={event => setDraft({ ...draft, nutrition: { ...draft.nutrition, [key]: event.target.value === '' ? null : Number(event.target.value) } })} /></label>)}</div>;
  return <dialog ref={dialog} className="g-dialog groceries" aria-labelledby="food-item-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id="food-item-title">{initial ? 'Edit food item' : 'Add food item'}</h2>
    <p>Save a single food to your shared library. Search for it later in Food Diary, Recipes or Groceries. No recipe is created.</p>
    <div className="g-actions">{[['manual', 'Manual'], ['ai', 'AI text'], ['json', 'JSON'], ['lookup', 'Open Food Facts / barcode']].map(([key, label]) => <button type="button" key={key} disabled={busy} aria-pressed={mode === key} onClick={() => { setMode(key); setError(''); }}>{label}</button>)}</div>
    {error && <p role="alert">{error}</p>}
    {mode === 'ai' && <div>
      <label>Describe the food<textarea maxLength={2000} rows={5} value={description} disabled={busy} onChange={event => setDescription(event.target.value)} placeholder="Name, portion size, and nutrition from the label if available" /></label>
      <p>AI creates an editable draft using your daily AI allowance. Estimates are unverified; check branded foods against their label.</p>
      <button type="button" disabled={busy || !description.trim()} onClick={ai}>{busy ? 'Preparing draft...' : 'Create food draft with AI'}</button>
    </div>}
    {mode === 'json' && <div>
      <p>One item with a name, quantity, unit and nutrition object. Values describe that quantity. Use null for unknown values.</p>
      <label>Upload food JSON<input type="file" accept=".json,application/json" onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file) return;
        if (file.size > 256 * 1024) { setError('Food JSON must be smaller than 256 KB.'); return; }
        try { const text = await file.text(); setJson(text); parse(text); } catch { setError('Could not read this file.'); }
      }} /></label>
      <label>Food JSON<textarea aria-label="Food JSON" rows={10} value={json} onChange={event => setJson(event.target.value)} /></label>
      <button type="button" onClick={() => parse(json)}>Review food JSON</button>
    </div>}
    {mode === 'lookup' && <NutritionLookup currentNutrition={{...draft.nutrition,quantity:draft.quantity,unit:draft.unit,source:draft.source}} name={draft.name} visible active onSelect={label => {
      if(label.source?.provider==='Local nutrition label OCR'){setDraft({...draft,quantity:label.quantity,unit:label.unit,nutrition:cleanNutrients(label),source:label.source});setMode('manual');return;}
      try { useFood({ name: label.source?.name || draft.name, quantity: label.quantity, unit: label.unit, nutrition: Object.fromEntries(NUTRIENTS.map(([key]) => [key, label[key] ?? null])), source: label.source }, 'Food lookup'); }
    catch (err) { setError(err.message); notify.error(err.message || 'Could not save food item'); }
    }} />}
    {mode === 'manual' && <form onSubmit={save}>
      <fieldset disabled={busy}>
        <label>Food name<input required maxLength={300} value={draft.name} onChange={event => { setDraft({ ...draft, name: event.target.value }); setReplace(false); }} /></label>
        <div className="g-tools">
          <label>Reference quantity<input required type="number" min="0.0001" step="any" value={draft.quantity} onChange={event => setDraft({ ...draft, quantity: event.target.value === '' ? '' : Number(event.target.value) })} /></label>
          <label>Reference unit<select value={draft.unit} onChange={event => setDraft({ ...draft, unit: event.target.value })}>{['g', 'ml', 'pieces', 'servings'].map(unit => <option key={unit}>{unit}</option>)}</select></label>
        </div>
        <p>Every nutrient below describes this reference amount. For a per 100 g label, use 100 g. Recipe quantities remain separate. Blank nutrients stay unknown.</p>
        {draft.source?.provider && <p>Source: {draft.source.provider}</p>}
        <NutritionLabelScan disabled={busy} current={{...draft.nutrition,quantity:draft.quantity,unit:draft.unit,source:draft.source}} onApply={label=>setDraft({...draft,quantity:label.quantity,unit:label.unit,nutrition:cleanNutrients(label),source:label.source})}/>
        {nutrientFields(NUTRIENTS.slice(0, 5))}
        <details><summary>More nutrients: vitamins, minerals and other label values</summary>{nutrientFields(NUTRIENTS.slice(5))}</details>
        {existing && <label><input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)} /> Update the existing food with this name in the shared library</label>}
      </fieldset>
      <button type="submit" className="g-primary" disabled={busy || (existing && !replace)}>{busy ? 'Saving...' : 'Save food item'}</button>
    </form>}
    <button type="button" disabled={busy} onClick={onClose}>Close</button>
  </dialog>;
}
