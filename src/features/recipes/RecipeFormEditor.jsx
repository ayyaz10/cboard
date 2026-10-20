import { NutritionLabelScan } from '../nutrition/NutritionLabelScan';
import { ingredientScanCurrent } from '../nutrition/nutritionScanAdapters.js';
import { NUTRIENTS } from '../nutrition/nutrients.js';
import { secondaryButton } from './RecipeComponents';
import { useEffect, useId, useRef, useState } from 'react';
import { NutritionLookup } from '../groceries/NutritionLookup';
import { initialProductAmount } from './recipeProducts.js';
import { cleanIngredientLabel, ingredientLabelAmount, ingredientLabelNutrition, recipeNutritionDisplay, ingredientRecipeTotals, prepareIngredientEditor, updateIngredientField } from './ingredientNutrition.js';
import { applyStoredIngredient, findIngredientMatches, hasStoredNutrition } from './ingredientLibrary.js';
import { normalizeRecipeIngredient } from '../../../supabase/functions/_shared/recipeIngredient.js';
import { formatScaledQuantity, recipeScaleMetadata, scaleRecipe } from './recipeScaling.js';
import { notify } from '../../lib/notifications.js';
import '../groceries/groceries.css';

export const emptyRecipe = () => ({
  title: '',
  mealType: '',
  description: '',
  nutrition: {},
  servings: 1,
  nutritionFromIngredients: true,
  ingredients: [{ id: crypto.randomUUID(), name: '', amount: null, unit: '' }],
  steps: [''],
  sauces: [],
  alternatives: {},
  tags: [],
});

function Field({ label, value, onChange, multiline = false, ...props }) {
  const Control = multiline ? 'textarea' : 'input';
  const id = useId();
  return (
    <div className="min-w-0 space-y-2 font-semibold">
      <label htmlFor={id} className="block">
        {label}
      </label>
      <Control
        id={id}
        className="field-input"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        {...props}
      />
    </div>
  );
}

function Macros({ value = {}, onChange }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 7rem), 1fr))' }}>
      {NUTRIENTS.map(([key, label, unit]) => [key, `${label} (${unit})`]).map(([key, label]) => (
        <Field
          key={key}
          label={label}
          type="number"
          min="0"
          step="any"
          value={value[key]}
          onChange={(next) =>
            onChange({ ...value, [key]: next === '' ? null : Number(next) })
          }
        />
      ))}
    </div>
  );
}

function IngredientNameField({ value, onChange, onSelect, library }) {
  const id = useId();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = findIngredientMatches(library, value);
  const show = open && matches.length > 0;
  const choose = (entry) => { onSelect(entry.item); setOpen(false); setActive(0); };
  return <div className="relative min-w-0 space-y-2 font-semibold">
    <label htmlFor={id} className="block">Name</label>
    <input
      id={id}
      className="field-input"
      value={value ?? ''}
      required
      autoComplete="off"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={show}
      aria-controls={listId}
      aria-activedescendant={show ? `${listId}-${active}` : undefined}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(0); }}
      onKeyDown={(event) => {
        if (!show && event.key === 'ArrowDown' && matches.length) { event.preventDefault(); setOpen(true); return; }
        if (!show) return;
        if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => (index + 1) % matches.length); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => (index - 1 + matches.length) % matches.length); }
        else if (event.key === 'Enter') { event.preventDefault(); choose(matches[active]); }
        else if (event.key === 'Escape') setOpen(false);
      }}
    />
    {show && <div id={listId} role="listbox" className="absolute z-20 mt-1 max-h-72 w-full min-w-64 overflow-y-auto rounded-xl border-2 border-black bg-white p-1 shadow-[4px_4px_0_#000]">
      {matches.map((entry, index) => <button
        id={`${listId}-${index}`}
        key={entry.key}
        type="button"
        role="option"
        aria-selected={active === index}
        className={`block w-full rounded-lg px-3 py-2 text-left text-black ${active === index ? 'bg-[#e8f7d8]' : 'bg-white hover:bg-black/5'}`}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setActive(index)}
        onClick={() => choose(entry)}
      >
        <span className="block font-bold">{entry.item.name}</span>
        <span className="block text-xs font-normal text-black/65">
          {[entry.item.amount, entry.item.unit, entry.item.nutritionLabel?.source?.name || (hasStoredNutrition(entry.item) ? 'saved nutrition' : ''), entry.recipeTitles.join(', ')].filter((part) => part !== '' && part != null).join(' · ')}
        </span>
      </button>)}
    </div>}
  </div>;
}

function ItemEditor({ item, onChange, groups, visible, ingredientLibrary, isIngredient = false, isAnchor = false, onSetAnchor }) {
  const [lookup, setLookup] = useState(false);
  const [nutritionOpen, setNutritionOpen] = useState(Boolean(item.nutritionLabel));
  const nutritionDetails = useRef(null);
  const set = (key, value) => {
    let next = updateIngredientField(item, key, value);
    if (key === 'name') next = normalizeRecipeIngredient(next);
    onChange(next, { calculateNutrition: ['nutrition', 'amount', 'unit'].includes(key) && Boolean(next.nutrition) });
  };
  const label = item.nutritionLabel;
  function useLabel(nutrition) {
    const needsWeight = initialProductAmount(item, nutrition.unit) === '';
    const next = { ...item, nutritionLabel: cleanIngredientLabel({ ...nutrition,
      ...(needsWeight && nutrition.portion ? { amountPerUnit: nutrition.portion.grams, recipeUnit: String(item.unit || '').trim().toLowerCase() } : {}),
    }) };
    next.nutrition = ingredientLabelNutrition(next);
    onChange(next); setLookup(false); setNutritionOpen(true);
  }
  return (
    <div className="space-y-3">
      <div className="grid min-w-0 grid-cols-2 gap-3">
        <div className="col-span-2 min-w-0">
          <IngredientNameField
            value={item.name}
            onChange={(value) => set('name', value)}
            library={ingredientLibrary}
            onSelect={(stored) => {
              const next = applyStoredIngredient(item, stored);
              onChange(next, { calculateNutrition: hasStoredNutrition(next) });
              setLookup(false);
              setNutritionOpen(hasStoredNutrition(next));
            }}
          />
        </div>
        <Field
          label="Amount"
          value={item.amount}
          readOnly={isAnchor}
          title={isAnchor ? 'Set the main ingredient amount in Recipe scaling below.' : undefined}
          placeholder="60, ½ or 5–10"
          onChange={(value) =>
            set(
              'amount',
              value === ''
                ? null
                : /^-?\d+(\.\d+)?$/.test(value)
                  ? Number(value)
                  : value,
            )
          }
        />
        <Field
          label="Unit"
          value={item.unit}
          placeholder="g, cup, medium"
          onChange={(value) => set('unit', value)}
        />
      </div>
      <Field
        label="Note"
        value={item.note}
        onChange={(value) => set('note', value)}
      />
      <Field label="Preparation" value={item.preparation} placeholder="Chopped, grated" onChange={value => onChange({ ...item, preparation: value })} />
      <Field label="Group / stage" value={item.group} placeholder="Marinade, sauce, garnish" onChange={value => onChange({ ...item, group: value })} />
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold">
        {isIngredient && <label className="flex items-center gap-2"><input type="checkbox" checked={isAnchor} onChange={event => onSetAnchor?.(event.target.checked ? item.id : '')} />Use as main ingredient</label>}
        <label className="flex items-center gap-2"><input type="checkbox" checked={item.scaleEnabled !== false} onChange={event => onChange({ ...item, scaleEnabled: event.target.checked ? undefined : false })} />Scale with recipe</label>
      </div>
      {groups && (
        <label className="block space-y-2 font-semibold">
          <span>Alternatives group</span>
          <select
            className="field-input"
            value={item.alternativeGroup ?? ''}
            onChange={(event) => {
              const next = { ...item };
              if (event.target.value)
                next.alternativeGroup = event.target.value;
              else delete next.alternativeGroup;
              onChange(next);
            }}
          >
            <option value="">None</option>
            {Object.entries(groups).map(([key, group]) => (
              <option key={key} value={key}>
                {group.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="groceries space-y-3 rounded-xl border border-black/20 p-3">
        <div className="flex flex-wrap gap-2">
        <button type="button" className={secondaryButton} aria-expanded={lookup} onClick={() => setLookup(!lookup)}>{lookup ? 'Close food lookup' : label ? 'Change nutrition food' : 'Find nutrition from food API'}</button>
        <button type="button" className={secondaryButton} onClick={() => {
          setLookup(false);
          setNutritionOpen(true);
          set('nutrition', item.nutrition || {});
          if (nutritionDetails.current) {
            nutritionDetails.current.open = true;
            nutritionDetails.current.querySelector('input')?.focus();
          }
        }}>Enter nutrition manually</button>
        </div>
        {visible && <NutritionLabelScan current={ingredientScanCurrent(item)} onApply={useLabel}/>}
        {visible && lookup && <div className="max-h-[34rem] min-w-0 overflow-y-auto overscroll-contain pr-1" aria-label="Food nutrition search results"><NutritionLookup allowLabelScan={false} name={item.name || ''} amountUnit={item.unit} portionMode="weight" active visible onSelect={useLabel} /></div>}
        {label && <>
          <p className="text-sm">{label.source.name || item.name} · {label.source.provider}. Label values per {label.quantity} {label.unit}.</p>
          {label.source.estimatedPortion && <p className="text-sm">Estimated USDA portion: {label.source.portionDescription}. Replace the weight below with your measured edible weight if available.</p>}
          {initialProductAmount(item, label.unit) === '' && <Field label={`${label.unit} in one ${item.unit || 'recipe unit'} (edible amount)`} type="number" min="0.001" step="any" value={label.recipeUnit === String(item.unit || '').trim().toLowerCase() ? label.amountPerUnit : ''} onChange={(value) => {
            const next = { ...item, nutritionLabel: { ...label, source: { ...label.source, estimatedPortion: false }, amountPerUnit: value === '' ? null : Number(value), recipeUnit: String(item.unit || '').trim().toLowerCase() } };
            next.nutrition = ingredientLabelNutrition(next); onChange(next);
          }} />}
          <p className="text-sm" role="status">{ingredientLabelAmount(item) == null ? 'Confirm the edible weight or volume of one recipe unit. The API cannot reliably infer the weight of your banana, handful or cup.' : `${ingredientLabelAmount(item)} ${label.unit} used / ${label.quantity} ${label.unit} on the label. The nutrition fields below are calculated for the amount above.`}</p>
          <p className="text-sm">Changing the amount recalculates automatically. Renaming the ingredient keeps these values; choose a different food result to replace them. Editing a nutrition number switches this ingredient to manual values.</p>
        </>}
      </div>
      <details ref={nutritionDetails} open={nutritionOpen} onToggle={(event) => setNutritionOpen(event.currentTarget.open)}>
        <summary className="font-semibold">{label ? 'Item nutrition (calculated)' : 'Item nutrition (optional)'}</summary>
        <div className="mt-4">
          {!label && <p className="mb-3 text-sm text-black/60">Manual values for the full amount above. Changing the amount scales these values automatically.</p>}
          <Macros
            value={item.nutrition}
            onChange={(value) => set('nutrition', value)}
          />
        </div>
      </details>
    </div>
  );
}

function ItemRow({ title, item, index, items, onChange, groups, ingredientLibrary, isIngredient = false, anchorId, onSetAnchor }) {
  const normalizedItem = typeof item === 'string' ? { name: item } : item;
  const [open, setOpen] = useState(!normalizedItem?.name);

  return (
    <details
      className="min-w-0 self-start rounded-xl border-2 border-black bg-white p-3"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer font-bold">
        <span className="text-black/55">{index + 1}.</span>{' '}
        {normalizedItem.name || `New ${title.toLowerCase()}`}
        {(normalizedItem.amount != null || normalizedItem.unit) && (
          <span className="ml-2 text-sm font-normal text-black/60">
            {[normalizedItem.amount, normalizedItem.unit]
              .filter((value) => value != null && value !== '')
              .join(' ')}
          </span>
        )}
      </summary>
      <div className="mt-3 space-y-3">
        <div className="flex justify-end">
          <button
            type="button"
            className={`${secondaryButton} danger-action`}
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            Remove {isIngredient ? 'ingredient' : title.slice(0, -1).toLowerCase()} #{index + 1}
          </button>
        </div>
        <ItemEditor
          item={normalizedItem}
          groups={groups}
          visible={open}
          ingredientLibrary={ingredientLibrary}
          isIngredient={isIngredient}
          isAnchor={normalizedItem.id === anchorId}
          onSetAnchor={onSetAnchor}
          onChange={(next, options) =>
            onChange(items.map((current, i) => (i === index ? next : current)), options)
          }
        />
      </div>
    </details>
  );
}

function useDesktopColumns() {
  const query = '(min-width: 1024px)';
  const [desktop, setDesktop] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return desktop;
}

function Items({ title, items, onChange, groups, ingredientLibrary, isIngredient = false, anchorId, onSetAnchor }) {
  const desktop = useDesktopColumns();
  const itemRow = (item, index) => (
    <ItemRow
      key={index}
      title={title}
      item={item}
      index={index}
      items={items}
      onChange={onChange}
      groups={groups}
      ingredientLibrary={ingredientLibrary}
      isIngredient={isIngredient}
      anchorId={anchorId}
      onSetAnchor={onSetAnchor}
    />
  );
  return (
    <section className="space-y-4">
      <h2 className="text-2xl font-bold">{title}</h2>
      {desktop ? (
        <div className="grid items-start gap-2 lg:grid-cols-2">
          <div className="min-w-0 space-y-2">{items.map((item, index) => index % 2 === 0 ? itemRow(item, index) : null)}</div>
          <div className="min-w-0 space-y-2">{items.map((item, index) => index % 2 === 1 ? itemRow(item, index) : null)}</div>
        </div>
      ) : (
        <div className="space-y-2">{items.map(itemRow)}</div>
      )}
      <button
        type="button"
        className={secondaryButton}
        onClick={() =>
          onChange([...items, { id: crypto.randomUUID(), name: '', amount: null, unit: '' }])
        }
      >
        Add {title.toLowerCase()}
      </button>
    </section>
  );
}

export function RecipeFormEditor({ recipe, onChange, editing, ingredientLibrary = [], imageEditor = null }) {
  recipe = prepareIngredientEditor(recipe);
  const nutritionDisplay = recipeNutritionDisplay(recipe);
  const [recipeScanAmount,setRecipeScanAmount]=useState('');
  const [recipeScanUnit,setRecipeScanUnit]=useState('g');
  const [scaleTarget, setScaleTarget] = useState('');
  const [scaleOthers, setScaleOthers] = useState(true);
  const [confirmScaling, setConfirmScaling] = useState(false);
  const set = (key, value, options = {}) => {
    const next = { ...recipe, [key]: value };
    if (['ingredients', 'sauces'].includes(key) && next.scaling) {
      const combined = [...(next.ingredients || []), ...(next.sauces || [])];
      if (!combined.some(item => item.id === next.scaling.anchorIngredientId)) delete next.scaling;
      else {
        const liveAnchor = combined.find(item => item.id === next.scaling.anchorIngredientId);
        const oldBase = next.scaling.baseQuantities || {};
        const baseAnchor = oldBase[liveAnchor.id]?.amount;
        const currentFactor = typeof liveAnchor.amount === 'number' && typeof baseAnchor === 'number' && baseAnchor > 0 ? liveAnchor.amount / baseAnchor : 1;
        next.scaling = { ...next.scaling, baseQuantities: Object.fromEntries(combined.map(item => [item.id, oldBase[item.id] || {
          amount: typeof item.amount === 'number' && currentFactor > 0 ? Number((item.amount / currentFactor).toPrecision(10)) : item.amount,
          unit: item.unit || '',
        }])) };
      }
    }
    if (key === 'nutrition') next.nutritionFromIngredients = false;
    else if (options.calculateNutrition || next.nutritionFromIngredients || [...(next.ingredients || []), ...(next.sauces || [])].some((item) => item.nutritionLabel)) {
      next.nutritionFromIngredients = true;
      delete next.productNutrition;
      delete next.fibreSource;
      next.nutrition = ingredientRecipeTotals(next);
    }
    onChange(next);
  };
  const groups = recipe.alternatives ?? {};
  const allIngredients = [...(recipe.ingredients || []), ...(recipe.sauces || [])];
  const anchor = allIngredients.find(item => item.id === recipe.scaling?.anchorIngredientId);
  useEffect(() => { setScaleTarget(anchor && typeof anchor.amount === 'number' ? String(anchor.amount) : ''); }, [anchor?.id]);
  let scalingPreview = null;
  let scalingError = '';
  if (anchor && scaleTarget.trim() !== '' && Number.isFinite(Number(scaleTarget)) && Number(scaleTarget) >= 0) {
    try { scalingPreview = scaleRecipe(recipe, Number(scaleTarget), { scaleOthers }); } catch (error) { scalingError = error.message; }
  }
  const setAnchor = id => {
    try {
      const scaling = id ? recipeScaleMetadata(recipe, id) : undefined;
      const next = { ...recipe };
      if (scaling) next.scaling = scaling;
      else delete next.scaling;
      onChange(next);
      const selected = allIngredients.find(item => item.id === id);
      setScaleTarget(selected && typeof selected.amount === 'number' ? String(selected.amount) : '');
      setConfirmScaling(false);
    } catch (error) { notify.error(error.message || 'Could not update the recipe scaling.'); }
  };
  const applyScaling = () => {
    if (!scalingPreview) return;
    onChange(scalingPreview.recipe);
    setScaleTarget(String(Number(scaleTarget)));
    setConfirmScaling(false);
  };
  return (
    <div className="flex flex-col gap-5">
      <section className="space-y-3 rounded-2xl border-2 border-black bg-white p-4">
        <h2 className="text-2xl font-bold">Recipe details</h2>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <Field label="Recipe title" required value={recipe.title} onChange={(value) => set('title', value)} />
          <Field label="Meal type" required value={recipe.mealType} placeholder="Breakfast, Lunch…" onChange={(value) => set('mealType', value)} />
        </div>
        <Field
          label="Description"
          multiline
          rows={3}
          value={recipe.description}
          onChange={(value) => set('description', value)}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="Prep time"
            value={recipe.prepTime}
            onChange={(value) => set('prepTime', value || null)}
          />
          <Field
            label="Cooking time"
            value={recipe.cookTime}
            onChange={(value) => set('cookTime', value || null)}
          />
          <Field
            label="Servings"
            type="number"
            min="0.01"
            step="any"
            value={recipe.servings}
            onChange={(value) =>
              set('servings', value === '' ? null : Number(value))
            }
          />
        </div>
        {editing && (
          <p className="text-sm text-black/70">
            Recipe link: {recipe.slug} (kept unchanged)
          </p>
        )}
        <Field
          label="Tags (comma separated)"
          value={(recipe.tags ?? []).join(',')}
          onChange={(value) => set('tags', value.split(','))}
        />
      </section>
      <section className="space-y-3 rounded-2xl border-2 border-black bg-white p-4">
        <h2 className="text-2xl font-bold">Recipe scaling</h2>
        {anchor ? <>
          <p className="text-sm text-black/70">Scaling uses the saved base amounts each time. Changing the main ingredient sets a new base without changing recipe quantities.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <p className="self-center"><strong>Main ingredient:</strong> {anchor.name} · Base amount {recipe.scaling.baseQuantities[anchor.id]?.amount} {recipe.scaling.baseQuantities[anchor.id]?.unit}</p>
            <Field label={`New ${anchor.name} amount (${anchor.unit || 'unit'})`} type="number" min="0" step="any" value={scaleTarget} onChange={setScaleTarget} />
          </div>
          <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={scaleOthers} onChange={event => setScaleOthers(event.target.checked)} />Scale other ingredients proportionally</label>
          {scaleTarget !== '' && !Number.isFinite(Number(scaleTarget)) && <p role="alert" className="text-sm font-semibold text-red-800">Enter a valid quantity.</p>}
          {scaleTarget !== '' && Number.isFinite(Number(scaleTarget)) && Number(scaleTarget) < 0 && <p role="alert" className="text-sm font-semibold text-red-800">Quantity cannot be negative.</p>}
          {scalingError && <p role="alert" className="text-sm font-semibold text-red-800">{scalingError}</p>}
          {scalingPreview && <>
            <div className="space-y-1 rounded-xl border border-black/20 p-3">
              <h3 className="font-bold">Scaling preview · {scalingPreview.factor === 0 ? '0×' : `${formatScaledQuantity(scalingPreview.factor)}×`}</h3>
              {allIngredients.map(item => {
                const updated = [...scalingPreview.recipe.ingredients, ...scalingPreview.recipe.sauces].find(row => row.id === item.id) || item;
                const show = value => [value.amount, value.unit].filter(part => part != null && part !== '').join(' ') || 'Not specified';
                return <p key={item.id} className="text-sm">{item.name}: {show(item)} → {show(updated)}{item.scaleEnabled === false ? ' · Keep fixed' : ''}</p>;
              })}
              <p className="pt-2 text-sm font-semibold">Nutrition {nutritionDisplay.wholeRecipe ? 'for the whole recipe' : 'per serving'}: {nutritionDisplay.nutrition.calories ?? '—'} → {recipeNutritionDisplay(scalingPreview.recipe).nutrition.calories ?? '—'} kcal</p>
              {scalingPreview.warnings.map(warning => <p key={warning} role="status" className="text-sm font-semibold text-amber-900">{warning}</p>)}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={secondaryButton} onClick={() => setConfirmScaling(true)}>Scale ingredients</button>
              <button type="button" className={secondaryButton} onClick={() => { setScaleTarget(String(anchor.amount ?? '')); setConfirmScaling(false); }}>Cancel preview</button>
              <button type="button" className={secondaryButton} onClick={() => setAnchor(anchor.id)}>Set current amounts as base recipe</button>
            </div>
          </>}
          {confirmScaling && <div role="alertdialog" aria-modal="true" aria-labelledby="scale-confirm-title" className="space-y-3 rounded-xl border-2 border-black bg-[#fffdf8] p-4">
            <h3 id="scale-confirm-title" className="text-lg font-bold">Scale recipe?</h3>
            <p>{anchor.name}: {recipe.scaling.baseQuantities[anchor.id]?.amount} {anchor.unit} → {formatScaledQuantity(Number(scaleTarget))} {anchor.unit}. {scalingPreview.scaledCount} other ingredients will be adjusted proportionally.</p>
            {Number(scaleTarget) === 0 && <p className="font-semibold">This sets scalable ingredient quantities to zero. Confirm to apply.</p>}
            <div className="flex gap-2"><button type="button" className={secondaryButton} onClick={() => setConfirmScaling(false)}>Cancel</button><button type="button" className={secondaryButton} onClick={applyScaling}>Scale ingredients</button></div>
          </div>}
        </> : <p className="text-sm text-black/70">Choose an ingredient below with “Use as main ingredient” to enable proportional scaling. Existing recipes are left unanchored until you choose.</p>}
      </section>
      <details className="rounded-2xl border-2 border-black bg-white p-4" open>
        <summary className="cursor-pointer text-xl font-bold">Recipe nutrition</summary>
        <p className="text-sm text-black/70">
          {recipe.nutritionFromIngredients ? 'Calculated from ingredient and sauce quantities. Shows the whole recipe until a serving count is set, then per serving; alternatives are not included.' : 'Enter macros manually or use food lookup inside an ingredient to calculate from ingredients. Item nutrition describes the full amount listed for that ingredient.'}
        </p>
        <details className="mt-3"><summary>Scan a label for recipe-level nutrition</summary>
          <p>For a packaged meal or a label describing this recipe. For ingredients, use the scanner inside each ingredient instead. Enter how much of the labelled product is in one recipe serving.</p>
          <div className="grid grid-cols-2 gap-2"><Field label="Labelled product per recipe serving" type="number" min="0.0001" step="any" value={recipeScanAmount} onChange={setRecipeScanAmount}/><label>Product unit<select className="field-input" value={recipeScanUnit} onChange={event=>setRecipeScanUnit(event.target.value)}>{['g','ml','pieces','servings'].map(unit=><option key={unit}>{unit}</option>)}</select></label></div>
          <NutritionLabelScan current={{...nutritionDisplay.nutrition,quantity:Number(recipeScanAmount)||null,unit:recipeScanUnit}} onApply={label=>{
            if(!(Number(recipeScanAmount)>0)||label.unit!==recipeScanUnit)throw new Error('Enter the product amount in one recipe serving, using the same unit as the label.');
            set('nutrition',Object.fromEntries(NUTRIENTS.map(([key])=>[key,label[key]==null?null:label[key]*Number(recipeScanAmount)/label.quantity])));
          }}/>
        </details>
        <div className="mt-3"><Macros value={nutritionDisplay.nutrition} onChange={(value) => set('nutrition', value)} /></div>
        {recipe.nutritionFromIngredients && nutritionDisplay.partialKeys.length > 0 && <p className="mt-3 text-sm font-semibold">Some nutrient totals are partial because they are missing from one or more ingredients.</p>}
      </details>
      <Items
        title="Ingredients"
        items={recipe.ingredients ?? []}
        groups={groups}
        ingredientLibrary={ingredientLibrary}
        isIngredient
        anchorId={anchor?.id}
        onSetAnchor={setAnchor}
        onChange={(value, options) => set('ingredients', value, options)}
      />
      <section className="space-y-3">
        <h2 className="text-2xl font-bold">Instructions</h2>
        <div className="grid gap-3 lg:grid-cols-2">
        {(recipe.steps ?? []).map((step, index) => (
          <div key={index} className="space-y-2 rounded-xl border-2 border-black bg-white p-3">
            <Field
              label={`Step ${index + 1}`}
              multiline
              required
              value={step}
              onChange={(value) =>
                set(
                  'steps',
                  recipe.steps.map((current, i) =>
                    i === index ? value : current,
                  ),
                )
              }
            />
            <button
              type="button"
              className={secondaryButton}
              onClick={() =>
                set(
                  'steps',
                  recipe.steps.filter((_, i) => i !== index),
                )
              }
            >
              Remove step {index + 1}
            </button>
          </div>
        ))}
        </div>
        <button
          type="button"
          className={secondaryButton}
          onClick={() => set('steps', [...(recipe.steps ?? []), ''])}
        >
          Add step
        </button>
      </section>
      <details className="rounded-2xl border-2 border-black bg-white p-4">
        <summary className="cursor-pointer text-xl font-bold">Sauces ({recipe.sauces?.length ?? 0})</summary>
        <div className="mt-4"><Items title="Sauces" items={recipe.sauces ?? []} onChange={(value, options) => set('sauces', value, options)} ingredientLibrary={ingredientLibrary} anchorId={anchor?.id} onSetAnchor={setAnchor} /></div>
      </details>
      {Object.keys(groups).length > 0 && (
        <details className="rounded-2xl border-2 border-black bg-white p-4">
          <summary className="cursor-pointer text-xl font-bold">Ingredient alternatives ({Object.keys(groups).length})</summary>
          <div className="mt-4 space-y-3">
          {Object.entries(groups).map(([key, group]) => (
            <details
              key={key}
              className="rounded-2xl border-2 border-black p-4"
            >
              <summary className="font-bold">{group.title}</summary>
              <div className="mt-4 space-y-4">
                <Field
                  label="Group title"
                  required
                  value={group.title}
                  onChange={(value) =>
                    set('alternatives', {
                      ...groups,
                      [key]: { ...group, title: value },
                    })
                  }
                />
                <Items
                  title="Options"
                  items={group.options}
                  ingredientLibrary={ingredientLibrary}
                  onChange={(value) =>
                    set('alternatives', {
                      ...groups,
                      [key]: { ...group, options: value },
                    })
                  }
                />
              </div>
            </details>
          ))}
          </div>
        </details>
      )}
      <details className="order-first rounded-2xl border-2 border-black bg-white p-4" open={Boolean(recipe.source)}>
        <summary className="cursor-pointer text-xl font-bold">Recipe source</summary>
        <div className="mt-4 space-y-3">
        <label className="flex items-center gap-3 font-semibold">
          <input
            type="checkbox"
            checked={Boolean(recipe.source)}
            onChange={(event) =>
              set(
                'source',
                event.target.checked
                  ? {
                      type: 'website',
                      label: 'Original recipe',
                      url: '',
                      showOnRecipeCard: false,
                    }
                  : null,
              )
            }
          />
          Include a source link
        </label>
        {recipe.source && (
          <>
            <Field
              label="Source URL"
              required
              placeholder="https://youtu.be/..."
              value={recipe.source.url}
              onChange={(value) =>
                set('source', { ...recipe.source, url: value })
              }
            />
            <Field
              label="Source label"
              value={recipe.source.label}
              onChange={(value) =>
                set('source', { ...recipe.source, label: value })
              }
            />
            <Field
              label="Source type"
              value={recipe.source.type}
              placeholder="youtube or website"
              onChange={(value) =>
                set('source', { ...recipe.source, type: value })
              }
            />
            <label className="flex items-center gap-3 font-semibold">
              <input
                type="checkbox"
                checked={recipe.source.showOnRecipeCard ?? false}
                onChange={(event) =>
                  set('source', {
                    ...recipe.source,
                    showOnRecipeCard: event.target.checked,
                  })
                }
              />
              Show source on recipe card
            </label>
          </>
        )}
        </div>
      </details>
      {imageEditor && <div className="order-first">{imageEditor}</div>}
    </div>
  );
}
