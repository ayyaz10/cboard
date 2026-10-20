import { NutritionLabelScan } from '../nutrition/NutritionLabelScan';
import { ingredientScanCurrent } from '../nutrition/nutritionScanAdapters.js';
import { normalizeRecipeIngredient } from '../../../supabase/functions/_shared/recipeIngredient.js';
import { cleanIngredientLabel, ingredientLabelNutrition, ingredientLabelAmount } from './ingredientNutrition.js';
import { NUTRIENTS } from '../nutrition/nutrients.js';
import { updateIngredientField } from './ingredientNutrition.js';
import { RecipeHealthReview } from './RecipeHealthReview';
import { useEffect, useState } from 'react';
import { getAppHref, navigateTo } from '../../app/useRoute';
import { formatIngredient } from './recipeData';
import { RecipeSource } from './RecipeSource';
import { RecipeGroceries } from '../groceries/RecipeGroceries';
import { RecipeMasonryGrid, useRecipeCardGrid } from './RecipeCardView';
import { RecipeFavouriteButton } from './RecipeFavouriteButton';
import { initialProductAmount } from './recipeProducts.js';
import { recipeNutritionDisplay, prepareIngredientEditor } from './ingredientNutrition.js';
import { removeRecipeIngredient, saveRecipeIngredientNutrition } from '../../services/recipeService.js';
import { findRecipeFoodMatches, resolveRecipeFoodCandidate } from '../nutrition/foodCatalog.js';
import { NutritionLookup } from '../groceries/NutritionLookup.jsx';
import { notify } from '../../lib/notifications.js';

export const secondaryButton =
  'inline-flex items-center justify-center rounded-full border-2 border-black bg-white px-4 py-2 text-sm font-bold text-black transition hover:-translate-y-px focus-visible:outline-offset-4 disabled:opacity-50';

export function RecipeLink({ to, children, className = secondaryButton }) {
  return (
    <a
      href={getAppHref(to)}
      className={className}
      onClick={(event) => {
        if (
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault();
          navigateTo(to);
          window.scrollTo(0, 0);
        }
      }}
    >
      {children}
    </a>
  );
}

export function RecipeImage({ image, title, large = false }) {
  return image ? (
    <img
      src={image}
      alt={title}
      loading={large ? 'eager' : 'lazy'}
      className={`w-full rounded-[1.35rem] object-cover ${large ? 'max-h-[22rem] aspect-[4/3]' : 'aspect-[4/3]'}`}
    />
  ) : (
    <div
      className={`recipe-image-placeholder flex items-center justify-center rounded-[1.35rem] border-2 border-black bg-white px-2 text-center text-sm font-semibold leading-5 text-black/55 ${large ? 'min-h-28 h-full' : 'aspect-[4/3]'}`}
    >
      No recipe image yet
    </div>
  );
}

export function RecipeNutrition({ nutrition = {}, fibreSource }) {
  const values = NUTRIENTS.map(([key, label, unit]) => [key, `${unit} ${label.toLowerCase()}`]).filter(([key]) => nutrition[key] != null);
  return values.length ? (
    <dl className="flex flex-wrap gap-3">
      {values.map(([key, unit]) => (
        <div
          key={key}
          className="rounded-2xl border-2 border-black bg-white px-4 py-3 text-black"
        >
          <dt className="text-xs capitalize text-black/70">{key === 'fiber' ? 'fibre' : key}</dt>
          <dd className="font-bold">
            {nutrition[key]} {unit}
            {key === 'fiber' && fibreSource && <small className="block font-normal">Estimated ? {fibreSource.type === 'ai' ? 'AI assisted' : 'grocery labels'} ? {fibreSource.basis === 'serving' ? 'per serving' : 'whole recipe'}</small>}
          </dd>
        </div>
      ))}
    </dl>
  ) : (
    <p className="text-sm text-black/55">Nutrition not provided.</p>
  );
}

function RecipeNutritionStatus({ recipe, preview = false }) {
  if (preview)
    return <p className="text-sm" role="status">Unsaved nutrition preview · per serving. Complete the ingredient amounts, then save products & nutrition.</p>;
  const display = recipeNutritionDisplay(recipe);
  if (!display.calculated) return null;
  const partialNames = NUTRIENTS.filter(([key]) => display.partialKeys.includes(key)).map(([, label]) => label.toLowerCase());
  return <p className="text-sm">
    Ingredient nutrition · {display.wholeRecipe ? 'whole recipe (serving count not set)' : 'per serving'}
    {partialNames.length > 0 && <> · <strong>Known subtotals</strong> for {partialNames.join(', ')}; some ingredients are missing these values.</>}
  </p>;
}

function RecipeCardNutrition({ recipe }) {
  const { nutrition, wholeRecipe, partialKeys } = recipeNutritionDisplay(recipe);
  const values = [
    nutrition?.calories != null && `${nutrition.calories} kcal`,
    nutrition?.protein != null && `${nutrition.protein} g protein`,
    nutrition?.fiber != null && `${nutrition.fiber} g fibre`,
  ].filter(Boolean);
  if (!values.length) return null;
  const partial = ['calories', 'protein', 'fiber'].some(key => partialKeys.includes(key));
  return <p className="recipe-card-nutrition text-sm font-semibold text-black/70">
    {values.join(' · ')}{wholeRecipe && <span className="font-normal"> · whole recipe</span>}{partial && <span className="font-normal"> · partial</span>}
  </p>;
}

export function RecipeAlternatives({ group }) {
  const cardGrid = useRecipeCardGrid();
  return (
    <section className="space-y-4">
      <h2 className="text-2xl font-bold">{group.title}</h2>
      <RecipeMasonryGrid as="ul" className={cardGrid}>
        {group.options.map((option, index) => (
          <li
            key={index}
            className="recipe-card rounded-2xl border-2 border-black bg-white p-4"
          >
            <p className="font-bold">{formatIngredient(option)}</p>
            {option.note && <p className="mt-2 text-black/70">{option.note}</p>}
            {Object.values(option.nutrition ?? {}).some(
              (value) => value != null,
            ) && (
              <div className="mt-3">
                <RecipeNutrition nutrition={option.nutrition} />
              </div>
            )}
          </li>
        ))}
      </RecipeMasonryGrid>
    </section>
  );
}

const ingredientNutrients = NUTRIENTS;

function ingredientNutritionSummary(item) {
  const values = ingredientNutrients
    .filter(([key]) => item.nutrition?.[key] != null)
    .map(([key, label, unit]) => `${label} ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(item.nutrition[key])} ${unit}`);
  return values.length ? values.join(' · ') : 'Nutrition not calculated yet';
}

function IngredientNutritionRow({ item, index, recipe, preview, onSaved }) {
  item = prepareIngredientEditor(recipe).ingredients[index] || item;
  const editableAmount = initialProductAmount({ amount: item.amount, unit: 'pieces' }, 'pieces');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [values, setValues] = useState(item.nutrition || {});
  const [nutritionLabel,setNutritionLabel] = useState(item.nutritionLabel || null);
  const [amount, setAmount] = useState(editableAmount);
  const [unit, setUnit] = useState(item.unit);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [removeConfirmation, setRemoveConfirmation] = useState(false);
  function changeIngredientName(value) {
    const normalized = normalizeRecipeIngredient({ name: value, amount: amount === '' ? null : Number(amount), unit });
    setName(normalized.name);
    setDirty(true);
    if (amount === '' && normalized.amount != null) setAmount(String(normalized.amount));
    if (!unit && normalized.unit) setUnit(normalized.unit);
  }
  function useFoodNutrition(label) {
    const nextLabel = cleanIngredientLabel(label);
    if (!nextLabel) {
      setError('This food result does not include nutrition in a supported unit.');
      return;
    }
    const selectedName = String(label.source?.foodName || label.source?.name || name).trim().slice(0, 200);
    setName(selectedName || name);
    setNutritionLabel(nextLabel);
    setValues(ingredientLabelNutrition({ amount: Number(amount), unit, nutritionLabel: nextLabel }));
    setDirty(true);
    setLookupOpen(false);
    setError('');
  }
  async function save() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const saved = await saveRecipeIngredientNutrition(recipe, index, values, { name, amount: Number(amount), unit, ...(nutritionLabel?{nutritionLabel}: {}) });
      if (onSaved) await onSaved(saved, { source: 'ingredient' });
      else notify.success('Ingredient changes saved');
      setDirty(false);
      setEditing(false);
    } catch (saveError) {
      setError(saveError.message || 'Could not save ingredient nutrition. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  function toggleEditor() {
    if (!editing) {
      setName(item.name);
      setValues(item.nutrition || {});
      setNutritionLabel(item.nutritionLabel || null);
      setAmount(editableAmount);
      setUnit(item.unit);
      setError('');
      setDirty(false);
      setEditing(true);
      return;
    }
    if (dirty) save();
    else setEditing(false);
  }
  async function removeIngredient() {
    setBusy(true);
    setError('');
    try {
      const updated = await removeRecipeIngredient(recipe, index);
      onSaved?.(updated);
      setEditing(false);
    } catch (removeError) {
      setError(removeError.message || 'Could not remove this ingredient. Please try again.');
    } finally {
      setBusy(false);
      setRemoveConfirmation(false);
    }
  }
  return <li className="min-w-0 self-start rounded-xl border-2 border-black bg-white px-3 py-2.5">
    <div className="flex min-w-0 items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{formatIngredient(item)}</p>
        {(item.group || item.preparation) && <p className="text-xs text-black/60">{[item.group, item.preparation].filter(Boolean).join(' · ')}</p>}
        {item.nutritionTrackingEnabled === false && <p className="text-xs text-black/60">Nutrition excluded</p>}
        {item.foodId && (item.nutritionLabel?.source?.foodName || item.nutritionLabel?.source?.name) && <p className="text-xs text-black/60">Food: {item.nutritionLabel.source.foodName || item.nutritionLabel.source.name}</p>}
        {preview ? (
          <p className="mt-0.5 text-xs leading-5 text-black/65">{ingredientNutritionSummary(item)}</p>
        ) : (
          <button
            type="button"
            disabled={busy}
            className="group mt-0.5 flex min-h-9 max-w-full items-center gap-1.5 text-left text-xs leading-5 text-black/65 transition hover:text-black focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2"
            aria-label={`${editing ? 'Close' : 'Edit'} ingredient ${formatIngredient(item)}`}
            aria-expanded={editing}
            title="Edit ingredient name and nutrition"
            onClick={toggleEditor}
          >
            <span>{ingredientNutritionSummary(item)}</span>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 transition-transform group-hover:scale-110">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
            </svg>
          </button>
        )}
      </div>
      {item.alternativeGroup && (preview ? (
        <a className="text-sm font-bold underline underline-offset-4" href={`#preview-${item.alternativeGroup}`}>Alternatives →</a>
      ) : (
        <RecipeLink to={`/recipes/${recipe.slug}/alternatives/${item.alternativeGroup}`}>Alternatives →</RecipeLink>
      ))}
    </div>
    {editing && <fieldset disabled={busy} className="mt-3 space-y-3 border-t-2 border-black/15 pt-3">
      <legend className="sr-only">Edit ingredient name and nutrition for {formatIngredient(item)}</legend>
      <div className="flex justify-end">
        <button type="button" className={`${secondaryButton} danger-action`} disabled={busy || recipe.ingredients.length <= 1} onClick={() => setRemoveConfirmation(true)}>
          Remove ingredient
        </button>
      </div>
      {recipe.ingredients.length <= 1 && <p className="text-xs text-black/60">A recipe must keep at least one ingredient.</p>}
      {removeConfirmation && <div role="alertdialog" aria-label="Confirm ingredient removal" className="space-y-2 rounded-xl border-2 border-black/20 p-3">
        <p>Remove {formatIngredient(item)} from this recipe?</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={secondaryButton} onClick={() => setRemoveConfirmation(false)}>Cancel</button>
          <button type="button" className={`${secondaryButton} danger-action`} onClick={removeIngredient}>Confirm remove</button>
        </div>
      </div>}
      <label>Food / ingredient name<input className="field-input" type="text" maxLength={200} required value={name} onChange={event => changeIngredientName(event.target.value)} placeholder="Enter food name" /></label>
      <button type="button" className={secondaryButton} aria-expanded={lookupOpen} onClick={() => setLookupOpen(open => !open)}>
        {lookupOpen ? 'Close food search' : 'Find food & replace nutrition'}
      </button>
      {lookupOpen && <div className="max-h-[30rem] min-w-0 overflow-y-auto overscroll-contain rounded-xl border border-black/20 p-2" aria-label="Food search to replace ingredient nutrition">
        <NutritionLookup
          name={name}
          amountUnit={unit}
          portionMode="weight"
          allowLabelScan={false}
          active
          visible
          onClose={() => setLookupOpen(false)}
          onSelect={useFoodNutrition}
        />
      </div>}
      <div className="grid grid-cols-2 gap-2"><label>Amount<input className="field-input" type="number" min="0.0001" step="any" value={amount ?? ''} onChange={event => {
        const next = updateIngredientField({ amount, unit, nutrition: values, nutritionLabel }, 'amount', event.target.value);
        setAmount(event.target.value); setValues(next.nutrition); setDirty(true);
      }} /></label><label>Unit<input className="field-input" value={unit} onChange={event => { const next = updateIngredientField({ amount, unit, nutrition: values, nutritionLabel }, 'unit', event.target.value); setUnit(event.target.value); setValues(next.nutrition); setDirty(true); }} /></label></div>
      <NutritionLabelScan disabled={busy} current={ingredientScanCurrent({amount,unit,nutrition:values,nutritionLabel})} onApply={label=>{
        const next=cleanIngredientLabel(label);setNutritionLabel(next);setValues(ingredientLabelNutrition({amount:Number(amount),unit,nutritionLabel:next}));setDirty(true);
      }}/>
      {nutritionLabel && <p className="text-xs">Label: per {nutritionLabel.quantity} {nutritionLabel.unit}. Values below are calculated for the recipe amount.</p>}
      {nutritionLabel && initialProductAmount({amount,unit},nutritionLabel.unit)==='' && <label>{nutritionLabel.unit} per recipe unit<input className="field-input" type="number" min="0.0001" step="any" value={nutritionLabel.amountPerUnit??''} onChange={event=>{
        const next={...nutritionLabel,amountPerUnit:Number(event.target.value)||null,recipeUnit:String(unit).trim().toLowerCase()};setNutritionLabel(next);setValues(ingredientLabelNutrition({amount:Number(amount),unit,nutritionLabel:next}));setDirty(true);
      }}/></label>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {ingredientNutrients.map(([key, label, unit]) => <label key={key} className="space-y-1 text-xs font-semibold">
          <span className="block">{label} ({unit})</span>
          <input className="field-input" type="number" min="0" step="any" value={values[key] ?? ''} onChange={(event) => {setNutritionLabel(null);setValues((current) => ({ ...current, [key]: event.target.value === '' ? null : Number(event.target.value) }));setDirty(true);}} />
        </label>)}
      </div>
      <p className="text-xs text-black/60">Values are for the full ingredient amount shown above.</p>
      {error && <p role="alert" className="text-sm font-semibold">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={secondaryButton} disabled={busy || !name.trim()} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
        <button type="button" className={secondaryButton} disabled={busy} onClick={() => { setError(''); setDirty(false); setEditing(false); }}>Cancel</button>
      </div>
    </fieldset>}
  </li>;
}

function useIngredientColumns() {
  const query = '(min-width: 768px)';
  const [columns, setColumns] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setColumns(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return columns;
}

export function IngredientList({ recipe, preview = false, onRecipeUpdated }) {
  const columns = useIngredientColumns();
  const row = (item, index) => <IngredientNutritionRow key={index} item={item} index={index} recipe={recipe} preview={preview} onSaved={onRecipeUpdated} />;
  return (
    <section>
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-2xl font-bold">Ingredients</h2>
        <span className="text-right text-sm text-black/60">
          {recipe.ingredients.length} items{!preview && <> · Tap the pencil to edit names or nutrition</>}
        </span>
      </div>
      {columns ? <div className="mt-3 grid items-start gap-2 md:grid-cols-2">
        <ul className="min-w-0 space-y-2">{recipe.ingredients.map((item, index) => index % 2 === 0 ? row(item, index) : null)}</ul>
        <ul className="min-w-0 space-y-2">{recipe.ingredients.map((item, index) => index % 2 === 1 ? row(item, index) : null)}</ul>
      </div> : <ul className="mt-3 space-y-2">{recipe.ingredients.map(row)}</ul>}
    </section>
  );
}

export function RecipeSteps({ steps }) {
  return (
    <section>
      <h2 className="text-2xl font-bold">How to make it</h2>
      <ol className="mt-3 grid gap-x-6 gap-y-3 lg:grid-cols-2">
        {steps.map((step, index) => (
          <li key={index} className="flex gap-3 text-sm leading-6">
            <span className="pill h-fit shrink-0" aria-hidden="true">
              {index + 1}
            </span>
            <span>
              <span className="sr-only">Step {index + 1}. </span>
              {step}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function RecipePage({ recipe, preview = false, onRecipeUpdated, onMatchExistingFoods, onUseFood, onKeepSeparate, foodCatalog = [], favourite = false, favouritePending = false, onToggleFavourite }) {
  const possibleMatches = !preview ? recipe.ingredients.flatMap((item, index) => {
    if (item.foodId) return [];
    const resolution = resolveRecipeFoodCandidate(item, foodCatalog);
    if (resolution.status !== 'review') return [];
    return [{ item, index, matches: findRecipeFoodMatches(item, foodCatalog) }];
  }) : [];
  return (
    <article className="space-y-5 break-words text-black">
      <section className="grid gap-5 lg:grid-cols-[minmax(15rem,0.75fr)_minmax(0,1.25fr)] lg:items-stretch">
        <RecipeImage image={recipe.image} title={recipe.title} large />
        <div className="space-y-4 rounded-[1.35rem] border-2 border-black bg-white p-5">
          <header className="space-y-2">
            <div className="flex items-center justify-between gap-3"><span className="pill">{recipe.mealType}</span>{!preview && <RecipeFavouriteButton recipe={recipe} favourite={favourite} pending={favouritePending} onToggle={onToggleFavourite}/>}</div>
            <h1 className="text-3xl font-bold tracking-[-0.04em] sm:text-4xl">
              {recipe.title}
            </h1>
            {recipe.description && <p className="text-sm leading-6 text-black/70">{recipe.description}</p>}
          </header>
          <RecipeNutrition nutrition={recipeNutritionDisplay(recipe).nutrition} fibreSource={recipe.fibreSource} />
          <RecipeNutritionStatus recipe={recipe} />
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            {[
              ['Prep time', recipe.prepTime],
              ['Cooking time', recipe.cookTime],
              ['Servings', recipe.servings],
            ].filter(([, value]) => value != null && value !== '').map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-black/60">{label}</dt>
                <dd className="text-sm font-bold">{value}</dd>
              </div>
            ))}
          </dl>
          <RecipeSource source={recipe.source} linkClassName={secondaryButton} />
        </div>
      </section>
      {(recipe.healthReview || recipe.tags?.includes('AI imported')) && (
        <details className="rounded-2xl border-2 border-black bg-white p-4">
          <summary className="cursor-pointer font-bold">Ingredient health report</summary>
          <div className="mt-4"><RecipeHealthReview recipe={recipe} /></div>
        </details>
      )}
      {!preview && onMatchExistingFoods && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-black bg-white p-3"><p className="text-sm">Find existing reusable foods for unlinked recipe ingredients.</p><button type="button" className={secondaryButton} onClick={() => onMatchExistingFoods(recipe)}>Match existing foods</button></div>}
      {possibleMatches.length > 0 && <section className="space-y-3 rounded-xl border-2 border-black bg-white p-4"><h2 className="font-bold">Possible existing foods</h2>{possibleMatches.map(({ item, index, matches }) => <div key={item.id || index} className="space-y-2 border-t border-black/15 pt-3"><p className="text-sm"><strong>{formatIngredient(item)}</strong> · choose a food to use its nutrition.</p><div className="flex flex-wrap gap-2">{matches.map(({ food }) => <button key={food.id} type="button" className={secondaryButton} onClick={() => onUseFood?.(recipe, index, food)}>{food.name} · {food.nutrition?.calories == null ? 'nutrition not set' : `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(food.nutrition.calories)} kcal / ${food.quantity} ${food.unit}`}</button>)}<button type="button" className={secondaryButton} onClick={() => onKeepSeparate?.(recipe, index, matches)}>Keep separate</button></div></div>)}</section>}
      <IngredientList recipe={recipe} preview={preview} onRecipeUpdated={onRecipeUpdated} />
      <RecipeSteps steps={recipe.steps} />
      {!preview && (
        <details className="rounded-2xl border-2 border-black bg-white p-4">
          <summary className="cursor-pointer font-bold">Kitchen stock, shopping and fibre tools</summary>
          <div className="mt-4"><RecipeGroceries key={recipe.slug} recipe={recipe} foodCatalog={foodCatalog} onRecipeUpdated={onRecipeUpdated} /></div>
        </details>
      )}
      {recipe.sauces.length > 0 && (
        <section>
          <h2 className="text-2xl font-bold">Sauces</h2>
          <ul className="mt-3 list-inside list-disc space-y-2">
            {recipe.sauces.map((sauce, index) => (
              <li key={index}>
                {formatIngredient(sauce)}
                {sauce.note && (
                  <span className="text-black/70"> — {sauce.note}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {preview &&
        Object.entries(recipe.alternatives).map(([key, group]) => (
          <div id={`preview-${key}`} key={key}>
            <RecipeAlternatives group={group} />
          </div>
        ))}
      {recipe.tags.length > 0 && (
        <ul aria-label="Tags" className="flex flex-wrap gap-2">
          {recipe.tags.map((tag, index) => (
            <li className="pill" key={index}>
              {tag}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function RecipeCard({ recipe, favourite = false, favouritePending = false, onToggleFavourite, onDelete, onEdit, onDuplicate, bulkSelection = false, selected = false, onToggleSelected }) {
  return (
    <article className="recipe-card recipe-clickable-card panel relative flex min-w-0 flex-col gap-4 border-black p-5 text-black">
      {(onDelete || onEdit || onDuplicate || (bulkSelection && onToggleSelected)) && <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        {bulkSelection && onToggleSelected && <label className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-2 border-black bg-white" title={`Select ${recipe.title}`}>
          <input type="checkbox" className="h-4 w-4 accent-lime-500" checked={selected} onChange={event => onToggleSelected(recipe.slug, event.target.checked)} aria-label={`Select ${recipe.title}`} />
        </label>}
        <details className="group relative">
          <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full border-2 border-black bg-white text-xl font-bold leading-none hover:bg-[#c5ff6f] focus-visible:outline-2 focus-visible:outline-offset-2" aria-label={`Actions for ${recipe.title}`} title="Recipe actions">⋯</summary>
          <div className="absolute right-0 top-12 z-20 grid min-w-36 gap-1 rounded-xl border-2 border-black bg-white p-2 shadow-[3px_3px_0_#111]">
            {onEdit && <button type="button" className="rounded-lg px-3 py-2 text-left text-sm font-bold hover:bg-[#edffd5]" onClick={event => { event.currentTarget.closest('details').open = false; onEdit(recipe); }}>Edit recipe</button>}
            {onDuplicate && <button type="button" className="rounded-lg px-3 py-2 text-left text-sm font-bold hover:bg-[#edffd5]" onClick={event => { event.currentTarget.closest('details').open = false; onDuplicate(recipe); }}>Duplicate recipe</button>}
            {onDelete && <button type="button" className="rounded-lg px-3 py-2 text-left text-sm font-bold text-red-800 hover:bg-red-50" onClick={event => { event.currentTarget.closest('details').open = false; onDelete(recipe); }}>Delete recipe</button>}
          </div>
        </details>
      </div>}
      <RecipeImage image={recipe.image} title={recipe.title} />
      <div>
        <div className="flex items-center justify-between gap-3"><span className="pill">{recipe.mealType}</span><RecipeFavouriteButton recipe={recipe} favourite={favourite} pending={favouritePending} onToggle={onToggleFavourite}/></div>
        <h2 className="mt-3 break-words text-2xl font-bold"><RecipeLink to={`/recipes/${recipe.slug}`} className="recipe-card-main-link">{recipe.title}</RecipeLink></h2>
      </div>
      {recipe.description && (
        <p className="line-clamp-2 text-sm leading-6 text-black/70">
          {recipe.description}
        </p>
      )}
      <RecipeCardNutrition recipe={recipe} />
      {(recipe.prepTime || recipe.cookTime) && <p className="text-sm text-black/70">
        {[
          recipe.prepTime && `Prep: ${recipe.prepTime}`,
          recipe.cookTime && `Cook: ${recipe.cookTime}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>}
    </article>
  );
}
