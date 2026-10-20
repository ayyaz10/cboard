import { useEffect, useRef, useState } from 'react';
import { NutritionLookup } from '../groceries/NutritionLookup';
import { NutritionLabelScan } from './NutritionLabelScan';
import { cleanNutrients, nutritionCoverage, NUTRIENTS } from './nutrients.js';
import { validateFoodItem } from '../../../supabase/functions/_shared/foodItem.js';
import { invokeNutritionFunction } from '../../services/nutritionLookup';
import { notify } from '../../lib/notifications.js';
import { findFoodMatches } from './foodCatalog.js';
import '../groceries/groceries.css';

const example = { name: "McDonald's burger", quantity: 1, unit: 'pieces', nutrition: { calories: null, protein: null, carbs: null, fat: null, fiber: null } };
export function FoodItemEditor({ catalog, onSave, onClose, initial = null, duplicate = false }) {
  const dialog = useRef(null), lock = useRef(false);
  const [mode, setMode] = useState('manual');
  const [draft, setDraft] = useState(() => initial ? structuredClone(initial) : { name: '', quantity: 1, unit: 'pieces', nutrition: {}, groceryTrackingEnabled: true, shoppingListEnabled: true, nutritionTrackingEnabled: true, source: { provider: 'Manual' } });
  const [json, setJson] = useState(JSON.stringify(example, null, 2));
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [duplicateChoice, setDuplicateChoice] = useState('');
  const matches = draft.name.trim() ? findFoodMatches(draft, catalog).filter(match => match.food.id !== initial?.id).slice(0, 3) : [];
  const reviewMatches = matches.filter(match => match.confidence === 'review' || match.confidence === 'suggestion');
  useEffect(() => { dialog.current.showModal(); }, []);
  useEffect(() => { if (dialog.current) dialog.current.scrollTop = 0; }, [mode]);
  function useFood(food, provider) {
    const cleaned = validateFoodItem(food);
    setDraft({ ...(initial?.id ? { id: initial.id } : {}), ...cleaned,
      ...(cleaned.perPiece == null && cleaned.unit === draft.unit && ['g', 'ml'].includes(cleaned.unit) && draft.perPiece > 0 ? { perPiece: draft.perPiece } : {}),
      groceryTrackingEnabled: food.groceryTrackingEnabled ?? initial?.groceryTrackingEnabled ?? true, shoppingListEnabled: food.shoppingListEnabled ?? initial?.shoppingListEnabled ?? true, nutritionTrackingEnabled: food.nutritionTrackingEnabled ?? initial?.nutritionTrackingEnabled ?? true, nutrientSources: food.nutrientSources || food.nutrition?.nutrientSources || {}, barcode: food.barcode || food.source?.barcode || food.source?.code || '', sku: food.sku || food.source?.sku || '', retailer: food.retailer || food.source?.retailer || '', brand: food.brand || food.source?.brand || '', source: { provider, ...food.source } });
    setMode('manual');
  }
  async function ai() {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const result = await invokeNutritionFunction('parse-recipe', { mode: 'food', recipeText: description });
      useFood(result.food, 'AI assisted (unverified)');
    } catch (err) { notify.error(err.message || 'Could not prepare food values'); }
    finally { lock.current = false; setBusy(false); }
  }
  function parse(text) {
    try {
      if (new TextEncoder().encode(text).length > 256 * 1024) throw new Error('Food JSON must be smaller than 256 KB.');
      useFood(JSON.parse(text), 'JSON import');
    } catch (err) { notify.error(err instanceof SyntaxError ? 'Paste one valid JSON object, without Markdown fences.' : err.message); }
  }
  async function save(event) {
    event.preventDefault();
    if (lock.current) return;
    if (!initial && reviewMatches.length && !duplicateChoice) { notify.error('Review the possible existing food, or choose Create separately.'); return; }
    lock.current = true; setBusy(true);
    try { await onSave({ ...(initial?.id ? { id: initial.id } : {}), ...validateFoodItem(draft), groceryTrackingEnabled: draft.groceryTrackingEnabled !== false, shoppingListEnabled: draft.groceryTrackingEnabled === false ? false : draft.shoppingListEnabled !== false, nutritionTrackingEnabled: draft.nutritionTrackingEnabled !== false, nutrientSources: draft.nutrientSources, barcode: draft.barcode, sku: draft.sku, retailer: draft.retailer, brand: draft.brand, source: draft.source, ...(duplicate || duplicateChoice === 'separate' ? { allowDuplicate: true } : {}) }); onClose(); }
    catch (err) { notify.error(err.message || 'Could not save food item'); }
    finally { lock.current = false; setBusy(false); }
  }
  const nutrientFields = rows => <div className="g-nutrition-grid">{rows.map(([key, label, unit]) => <label key={key}>{label} ({unit})<input type="number" min="0" step="any" value={draft.nutrition[key] ?? ''} onChange={event => setDraft({ ...draft, nutrition: { ...draft.nutrition, [key]: event.target.value === '' ? null : Number(event.target.value) }, nutrientSources: { ...draft.nutrientSources, ...(event.target.value === '' ? { [key]: undefined } : { [key]: { sourceType: 'manual', sourceId: '', sourceName: 'Manual edit', confidence: 'high', estimated: false } }) } })} />{draft.nutrientSources?.[key] && <small>{draft.nutrientSources[key].sourceName || draft.nutrientSources[key].sourceType}{draft.nutrientSources[key].estimated ? ' · reference estimate' : ''}{draft.nutrientSources[key].derived ? ' · derived' : ''}</small>}</label>)}</div>;
  return <dialog ref={dialog} className="g-dialog groceries" aria-labelledby="food-item-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target === dialog.current && !busy) onClose(); }}>
    <div className="g-between"><h2 id="food-item-title">{duplicate ? 'Duplicate food item' : initial?.id ? 'Edit food item' : 'Add food item'}</h2><button type="button" aria-label="Close popup" disabled={busy} onClick={onClose}>×</button></div>
    <p>Save a single food to your shared library. Search for it later in Food Diary, Recipes or Groceries. No recipe is created.</p>
    <div className="g-actions">{[['manual', 'Manual'], ['ai', 'AI text'], ['json', 'JSON'], ['lookup', 'Open Food Facts / barcode']].map(([key, label]) => <button type="button" key={key} disabled={busy} aria-pressed={mode === key} onClick={() => setMode(key)}>{label}</button>)}</div>
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
        if (file.size > 256 * 1024) { notify.error('Food JSON must be smaller than 256 KB.'); return; }
        try { const text = await file.text(); setJson(text); parse(text); } catch { notify.error('Could not read this file.'); }
      }} /></label>
      <label>Food JSON<textarea aria-label="Food JSON" rows={10} value={json} onChange={event => setJson(event.target.value)} /></label>
      <button type="button" onClick={() => parse(json)}>Review food JSON</button>
    </div>}
    {mode === 'lookup' && <NutritionLookup currentNutrition={{...draft.nutrition,nutrientSources:draft.nutrientSources,quantity:draft.quantity,unit:draft.unit,source:draft.source}} name={draft.name} visible active onManual={query => { setDraft(current => ({ ...current, name: query || current.name })); setMode('manual'); }} onSelect={label => {
      if(label.source?.provider==='Local nutrition label OCR'){setDraft({...draft,quantity:label.quantity,unit:label.unit,...(label.unit===draft.unit?{}:{perPiece:null}),nutrition:cleanNutrients(label),source:label.source});setMode('manual');return;}
      try { useFood({ name: label.source?.name || draft.name, quantity: label.quantity, unit: label.unit, nutrition: Object.fromEntries(NUTRIENTS.map(([key]) => [key, label[key] ?? null])), nutrientSources: label.nutrientSources, source: label.source }, 'Food lookup'); }
    catch (err) { notify.error(err.message || 'Could not save food item'); }
    }} />}
    {mode === 'manual' && <form onSubmit={save}>
      <fieldset disabled={busy}>
        <label>Food name<input required maxLength={300} value={draft.name} onChange={event => { setDraft({ ...draft, name: event.target.value }); setDuplicateChoice(''); }} /></label>
        <div className="g-tools">
          <label>Nutrition is for<input required type="number" min="0.0001" step="any" value={draft.quantity} onChange={event => setDraft({ ...draft, quantity: event.target.value === '' ? '' : Number(event.target.value) })} /></label>
          <label>Unit<select value={draft.unit} onChange={event => setDraft({ ...draft, unit: event.target.value, ...(event.target.value === draft.unit ? {} : { perPiece: null }) })}>{['g', 'ml', 'pieces', 'servings'].map(unit => <option key={unit}>{unit}</option>)}</select></label>
        </div>
        {['g', 'ml'].includes(draft.unit) && <>
          <label>{draft.unit} per piece (optional)<input type="number" min="0.001" max="1000000" step="any" value={draft.perPiece ?? ''} onChange={event => setDraft({ ...draft, perPiece: event.target.value === '' ? null : Number(event.target.value) })} placeholder={`e.g. 50 ${draft.unit}`} /></label>
          <p className="g-hint">Used when logging this food as pieces. Nutrition is scaled from the basis above. For different sizes, save separate foods such as “Medium egg” and “Large egg” with their own piece weight.</p>
        </>}
        <p>Enter the label values for this amount. For values per 100 g, enter 100 and g.</p>
        <NutritionLabelScan disabled={busy} current={{...draft.nutrition,quantity:draft.quantity,unit:draft.unit,source:draft.source}} onApply={label=>setDraft({...draft,quantity:label.quantity,unit:label.unit,...(label.unit===draft.unit?{}:{perPiece:null}),nutrition:cleanNutrients(label),source:label.source})}/>
        <p className="g-hint">Values are for {draft.quantity || 100} {draft.unit || 'g'}.</p>
        {nutrientFields(NUTRIENTS.slice(0, 5))}
        <details><summary>More nutrients</summary>{nutrientFields(NUTRIENTS.slice(5))}</details>
        <details className="g-food-advanced"><summary>More food details</summary>
          <p className="g-hint">Nutrition coverage: {nutritionCoverage(draft.nutrition).percent}% ({nutritionCoverage(draft.nutrition).known}/{nutritionCoverage(draft.nutrition).total} nutrients). <button type="button" onClick={() => setMode('lookup')}>Find missing values</button></p>
          {draft.source?.provider && <p>Source: {draft.source.provider}</p>}
          <div className="g-tools">
            <label>Brand (optional)<input maxLength={120} value={draft.brand || draft.source?.brand || ''} onChange={event => setDraft({ ...draft, brand: event.target.value, source: { ...draft.source, brand: event.target.value } })} /></label>
            <label>Barcode (optional)<input inputMode="numeric" maxLength={32} value={draft.barcode || draft.source?.barcode || ''} onChange={event => setDraft({ ...draft, barcode: event.target.value, source: { ...draft.source, barcode: event.target.value } })} /></label>
          </div>
          <div className="g-tools">
            <label>Retailer (optional)<input maxLength={120} value={draft.retailer || draft.source?.retailer || ''} onChange={event => setDraft({ ...draft, retailer: event.target.value, source: { ...draft.source, retailer: event.target.value } })} /></label>
            <label>Retailer SKU (optional)<input maxLength={120} value={draft.sku || draft.source?.sku || ''} onChange={event => setDraft({ ...draft, sku: event.target.value, source: { ...draft.source, sku: event.target.value } })} /></label>
          </div>
          <fieldset className="g-tools" aria-label="Food behavior">
            <legend><strong>Food settings</strong></legend>
            <label className="g-check"><input type="checkbox" checked={draft.nutritionTrackingEnabled !== false} onChange={event => setDraft({ ...draft, nutritionTrackingEnabled: event.target.checked })}/>Include in nutrition calculations</label>
            <label className="g-check"><input type="checkbox" checked={draft.groceryTrackingEnabled !== false} onChange={event => setDraft({ ...draft, groceryTrackingEnabled: event.target.checked, shoppingListEnabled: event.target.checked ? draft.shoppingListEnabled !== false : false })}/>Track in Grocery</label>
            <label className="g-check"><input type="checkbox" disabled={draft.groceryTrackingEnabled === false} checked={draft.groceryTrackingEnabled !== false && draft.shoppingListEnabled !== false} onChange={event => setDraft({ ...draft, shoppingListEnabled: event.target.checked })}/>Auto-add to Shopping List when needed</label>
            {draft.groceryTrackingEnabled === false && <small>Enable Grocery tracking to use shopping automation. Existing stock will be preserved when tracking is stopped.</small>}
            {draft.nutritionTrackingEnabled === false && <small>Nutrition excluded. This food remains available in recipes and the diary.</small>}
          </fieldset>
        </details>
        {!initial && reviewMatches.length > 0 && <section className="rounded-xl border-2 border-black bg-[#fff8dd] p-3" aria-label="Possible existing foods">
          <h3 className="font-bold">Possible existing food found</h3>
          {reviewMatches.map(match => <div key={match.food.id} className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-black/20 pt-2 text-sm"><p><strong>{match.food.name}</strong> · {match.reasons.join('; ')}</p><button type="button" onClick={async () => { try { await onSave({ ...match.food, reuseExisting: true }); notify.info('Existing food reused'); onClose(); } catch (err) { notify.error(err.message || 'Could not reuse this food'); } }}>Use existing</button></div>)}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setDuplicateChoice('separate')}>Create separately</button>
          </div>
        </section>}
        {initial && reviewMatches.length > 0 && <p role="status" className="rounded-xl border-2 border-black bg-[#fff8dd] p-3 text-sm">This edit may duplicate {reviewMatches.map(match => match.food.name).join(', ')}. Use All Food Items → Possible duplicates to review or merge them first.</p>}
      </fieldset>
      <button type="submit" className="g-primary" disabled={busy}>{busy ? 'Saving...' : 'Save food item'}</button>
    </form>}
    <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
  </dialog>;
}
