import { useMemo, useState } from 'react';
import { NUTRIENTS } from '../nutrition/nutrients.js';
import { classifyFoodDeletion, getFoodUsage } from '../nutrition/foodReferences.js';
import { resolveCatalogFoodForIngredient, findPossibleFoodDuplicateGroups, foodNutritionConflicts, auditFoodDuplicates } from '../nutrition/foodCatalog.js';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.jsx';
import { RecipeLink, secondaryButton } from './RecipeComponents';
import { notify } from '../../lib/notifications.js';

const formatNutrient = value => Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });

export function FoodLibrary({ library, recipes, foodCatalog = [], mealPlans = [], onAdd, onEdit, onDeleteFoods, onMergeFoods }) {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [view, setView] = useState('list');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deletePlan, setDeletePlan] = useState(null);
  const [blockedFood, setBlockedFood] = useState(null);
  const [mergeGroup, setMergeGroup] = useState(null);
  const [keepId, setKeepId] = useState('');
  const [nutritionSourceId, setNutritionSourceId] = useState('');
  const [busy, setBusy] = useState(false);
  const needle = query.trim().toLocaleLowerCase();
  const catalogById = useMemo(() => new Map(foodCatalog.map(food => [food.id, food])), [foodCatalog]);
  const duplicateGroups = useMemo(() => findPossibleFoodDuplicateGroups(foodCatalog), [foodCatalog]);
  const duplicateAudit = useMemo(() => auditFoodDuplicates(foodCatalog), [foodCatalog]);
  const duplicateIds = useMemo(() => new Set(duplicateGroups.flatMap(group => group.map(food => food.id))), [duplicateGroups]);
  const enriched = useMemo(() => library.map(entry => {
    const food = catalogById.get(entry.item.foodId) || resolveCatalogFoodForIngredient(entry.item, foodCatalog);
    return { ...entry, food, usage: food ? getFoodUsage(food, { catalog: foodCatalog, recipes, mealPlans }) : null };
  }), [library, catalogById, foodCatalog, recipes, mealPlans]);
  const filtered = enriched.filter(entry => {
    const shared = Boolean(entry.food);
    const inRecipe = entry.recipeTitles.some(title => title !== 'Main food library');
    const sourceMatches = source === 'all' || (source === 'shared' && shared) || (source === 'recipes' && inRecipe) || (source === 'unused' && shared && entry.usage.canHardDelete) || (source === 'duplicates' && shared && duplicateIds.has(entry.food.id));
    return sourceMatches && [entry.item.name, ...entry.recipeTitles].some(value => value.toLocaleLowerCase().includes(needle));
  });
  const selectable = filtered.filter(entry => entry.food);
  const selected = foodCatalog.filter(food => selectedIds.has(food.id));
  function toggleSelectionMode() {
    setSelectionMode(value => {
      if (value) setSelectedIds(new Set());
      return !value;
    });
  }
  function selectVisible(checked) {
    setSelectedIds(current => {
      const visible = new Set(selectable.map(entry => entry.food.id));
      const next = new Set([...current].filter(id => !visible.has(id)));
      if (checked) visible.forEach(id => next.add(id));
      return next;
    });
  }
  function requestDelete(ids) {
    const analysis = classifyFoodDeletion(ids, { catalog: foodCatalog, recipes, mealPlans });
    if (!analysis.safe.length) {
      const food = analysis.inUse[0]?.food;
      if (food) {
        setBlockedFood({ food, usage: analysis.inUse[0].usage });
        const count = analysis.inUse[0].usage.recipes.length + analysis.inUse[0].usage.possibleRecipes.length;
        notify.warning(`${food.name} is referenced by ${count} recipe${count === 1 ? '' : 's'} and was not deleted`);
      }
      return;
    }
    setDeletePlan({ ...analysis, requested: ids.length });
  }
  function openMerge(group) {
    const ids = new Set(group.map(food => food.id));
    const preferred = group.reduce((best, food) => Object.values(food.nutrition || {}).filter(Number.isFinite).length > Object.values(best.nutrition || {}).filter(Number.isFinite).length ? food : best, group[0]);
    setMergeGroup(group); setKeepId(preferred.id); setNutritionSourceId(preferred.id);
  }
  async function confirmMerge() {
    if (!mergeGroup || busy || !keepId || !nutritionSourceId) return;
    setBusy(true);
    try {
      await onMergeFoods({ keepId, mergeIds: mergeGroup.filter(food => food.id !== keepId).map(food => food.id), nutritionSourceId });
      setMergeGroup(null);
    } catch (error) { notify.error(error.message || 'Duplicate merge failed'); }
    finally { setBusy(false); }
  }
  async function confirmDelete() {
    if (!deletePlan || busy) return;
    setBusy(true);
    try {
      await onDeleteFoods(deletePlan.safe.map(item => item.food.id));
      const deleted = new Set(deletePlan.safe.map(item => item.food.id));
      setSelectedIds(current => new Set([...current].filter(id => !deleted.has(id))));
      setDeletePlan(null);
      if (selectedIds.size === deleted.size) setSelectionMode(false);
    } catch (error) {
      notify.error(error.message || 'Could not delete selected foods');
      setDeletePlan(null);
    } finally {
      setBusy(false);
    }
  }
  const usageLabel = entry => {
    if (!entry.food) return `${entry.recipeTitles.length} recipe${entry.recipeTitles.length === 1 ? '' : 's'}`;
    if (!entry.usage.referenceCount) return 'Unused';
    const definite = entry.usage.recipes.length, possible = entry.usage.possibleRecipes.length;
    const recipeLabel = definite ? `Used in ${definite} recipe${definite === 1 ? '' : 's'}` : possible ? `Possible match in ${possible} recipe${possible === 1 ? '' : 's'}` : '';
    const planLabel = entry.usage.mealPlans.length ? `${recipeLabel ? ' + ' : ''}${entry.usage.mealPlans.length} meal plan${entry.usage.mealPlans.length === 1 ? '' : 's'}` : '';
    return `${recipeLabel}${planLabel}`;
  };
  const recipesUsing = entry => entry.usage?.recipes || (entry.recipeSlugs || []).map(slug => recipes.find(recipe => recipe.slug === slug)).filter(Boolean).map(recipe => ({ slug: recipe.slug, title: recipe.title }));
  const actions = entry => entry.food ? <details className="relative inline-block">
    <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full border-2 border-black bg-white hover:bg-[#c5ff6f]" aria-label={`Actions for ${entry.item.name}`} title="Food actions"><span aria-hidden="true" className="flex gap-0.5"><i className="h-1 w-1 rounded-full bg-black"/><i className="h-1 w-1 rounded-full bg-black"/><i className="h-1 w-1 rounded-full bg-black"/></span></summary>
    <div className="absolute right-0 top-12 z-20 grid min-w-36 gap-1 rounded-xl border-2 border-black bg-white p-2 shadow-[3px_3px_0_#111]">
      <button type="button" className="rounded-lg px-3 py-2 text-left text-sm font-bold hover:bg-[#edffd5]" onClick={event => { event.currentTarget.closest('details').open = false; onEdit(entry.food.id); }}>Edit food</button>
      <button type="button" className="rounded-lg px-3 py-2 text-left text-sm font-bold text-red-800 hover:bg-red-50" onClick={event => { event.currentTarget.closest('details').open = false; requestDelete([entry.food.id]); }}>Delete food</button>
    </div>
  </details> : <span className="text-sm text-black/60">Recipe only</span>;
  return <section className="food-library" aria-labelledby="food-library-heading">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 id="food-library-heading" className="text-3xl font-bold">All food items</h1><p>Manage reusable nutrition records and see where foods are used.</p></div>
      <button type="button" className={secondaryButton} onClick={onAdd}>Add item</button>
    </header>
    <div className="food-library-filters">
      <label>Search foods or recipes<input className="field-input" type="search" value={query} onChange={event => { setQuery(event.target.value); setSelectedIds(new Set()); }} placeholder="Search all food items" /></label>
      <label>Show<select className="field-input" value={source} onChange={event => { setSource(event.target.value); setSelectedIds(new Set()); }}><option value="all">All items</option><option value="shared">Reusable foods</option><option value="recipes">Recipe ingredients</option><option value="unused">Unused foods</option><option value="duplicates">Possible duplicates ({duplicateGroups.length})</option></select></label>
    </div>
    <div className="food-library-views" role="group" aria-label="Food items view">
      <button type="button" className={secondaryButton} aria-pressed={view === 'list'} onClick={() => setView('list')}>Detailed list</button>
      <button type="button" className={secondaryButton} aria-pressed={view === 'cards'} onClick={() => setView('cards')}>Cards</button>
    </div>
    <p role="status">{filtered.length} of {library.length} items. Diary entries and grocery foods keep nutrition snapshots, so they do not block cleanup.</p>
    {source === 'duplicates' && <div className="grid gap-3" aria-label="Possible duplicate groups">
      <p className="rounded-xl border-2 border-black bg-white p-3 text-sm">Audit of {foodCatalog.length} reusable foods: {duplicateAudit.counts.exactName} exact-name pairs, {duplicateAudit.counts.quantityOrAlias} quantity or alias pairs, {duplicateAudit.counts.fuzzySuggestion} spelling suggestions, {duplicateAudit.counts.sameBarcode} shared barcodes, {duplicateAudit.counts.sameRetailerSku} shared retailer/SKU pairs. Review each group before merging.</p>
      {!duplicateGroups.length && <p className="rounded-xl border-2 border-black bg-white p-4">No likely duplicate food groups found.</p>}
      {duplicateGroups.map((group, index) => <article key={group.map(food => food.id).join(':')} className="rounded-xl border-2 border-black bg-[#fff8dd] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold">Possible duplicate group {index + 1}</h2><p className="text-sm">{group.map(food => food.name).join(' · ')}</p></div><button type="button" className={secondaryButton} onClick={() => openMerge(group)}>Review merge</button></div>
      </article>)}
    </div>}
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-black bg-white p-3">
      <span className="text-sm text-black/70">{selectionMode ? `${selected.length} selected` : 'Select reusable foods for safe bulk cleanup.'}</span>
      <div className="flex flex-wrap gap-2">
        {!selectionMode && <button type="button" className={secondaryButton} onClick={toggleSelectionMode}>Select foods</button>}
        {selectionMode && <>
          <label className="inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-black bg-white px-3 text-sm font-bold"><input type="checkbox" className="accent-lime-500" checked={selectable.length > 0 && selectable.every(entry => selectedIds.has(entry.food.id))} onChange={event => selectVisible(event.target.checked)} />Select visible</label>
          <button type="button" className={secondaryButton} onClick={() => setSelectedIds(new Set())}>Clear</button>
          <button type="button" className={secondaryButton} onClick={toggleSelectionMode}>Done</button>
          <button type="button" className={`${secondaryButton} border-red-800 text-red-800`} disabled={!selected.length} onClick={() => requestDelete(selected.map(food => food.id))}>Delete selected{selected.length ? ` (${selected.length})` : ''}</button>
        </>}
      </div>
    </div>
    {!filtered.length && <p className="panel p-5">{library.length ? 'No matching foods. Try another search or filter.' : 'No food items yet. Add an item or save a recipe to get started.'}</p>}
    {view === 'list' && filtered.length > 0 && <div className="food-library-table-wrap" role="region" aria-label="Detailed food list" tabIndex="0">
      <table className="food-library-table">
        <caption>Nutrition is shown for each record's stated quantity. Missing values are marked Not set.</caption>
        <thead><tr>{selectionMode && <th scope="col">Select</th>}<th scope="col">Food / quantity</th>{NUTRIENTS.slice(0, 5).map(([key, label]) => <th scope="col" key={key}>{label}<small>{NUTRIENTS.find(item => item[0] === key)?.[2]}</small></th>)}<th scope="col">Usage</th><th scope="col">Actions</th></tr></thead>
        <tbody>{filtered.map(entry => {
          const item = entry.item;
          const nutrition = item.nutritionLabel || item.nutrition || {};
          const quantity = item.nutritionLabel?.quantity ?? item.amount;
          const unit = item.nutritionLabel?.unit ?? item.unit;
          const usedBy = recipesUsing(entry);
          return <tr key={entry.key}>
            {selectionMode && <td data-label="Select">{entry.food && <input aria-label={`Select ${item.name}`} type="checkbox" className="h-4 w-4 accent-lime-500" checked={selectedIds.has(entry.food.id)} onChange={event => setSelectedIds(current => { const next = new Set(current); event.target.checked ? next.add(entry.food.id) : next.delete(entry.food.id); return next; })} />}</td>}
            <th scope="row"><strong>{item.name}</strong><span className="food-library-meta">{quantity != null ? `Nutrition for ${quantity} ${unit || ''}` : 'Nutrition basis not set'}</span>{item.nutritionLabel && item.amount != null && <span className="food-library-meta">Recipe amount: {item.amount} {item.unit}</span>}</th>
            {NUTRIENTS.slice(0, 5).map(([key, label, nutrientUnit]) => <td key={key} data-label={label} className="food-library-number">{nutrition[key] == null ? <span className="food-library-missing">Not set</span> : <>{formatNutrient(nutrition[key])} <small>{nutrientUnit}</small></>}</td>)}
            <td data-label="Usage"><details><summary className="cursor-pointer">{usageLabel(entry)}</summary><div className="food-library-row-details">{usedBy.length ? <ul>{usedBy.map(recipe => <li key={recipe.slug}><RecipeLink className="food-library-recipe-link" to={`/recipes/${recipe.slug}`}>{recipe.title}</RecipeLink></li>)}</ul> : null}{entry.usage?.possibleRecipes.map(recipe => <p key={recipe.slug}>Possible legacy match: <RecipeLink className="food-library-recipe-link" to={`/recipes/${recipe.slug}`}>{recipe.title}</RecipeLink></p>)}{!usedBy.length && !entry.usage?.possibleRecipes.length && <p>No active recipe references.</p>}{entry.usage?.mealPlans.map(plan => <p key={plan.id} className="food-library-meta">Meal plan: {plan.name}</p>)}{(item.nutritionLabel?.source || item.nutrition?.source)?.provider && <p className="food-library-meta">Nutrition: {(item.nutritionLabel?.source || item.nutrition?.source).provider}</p>}</div></details></td>
            <td data-label="Actions">{actions(entry)}<details className="mt-2"><summary className="cursor-pointer">More nutrients</summary><div className="food-library-row-details"><dl className="food-library-nutrients">{NUTRIENTS.slice(5).map(([key, label, nutrientUnit]) => <div key={key}><dt>{label}</dt><dd>{nutrition[key] == null ? 'Not set' : `${formatNutrient(nutrition[key])} ${nutrientUnit}`}</dd></div>)}</dl></div></details></td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
    {view === 'cards' && <div className="food-library-grid">{filtered.map(entry => {
      const item = entry.item;
      const nutrition = item.nutritionLabel || item.nutrition || {};
      const quantity = item.nutritionLabel?.quantity ?? item.amount;
      const unit = item.nutritionLabel?.unit ?? item.unit;
      return <article className="panel p-5" key={entry.key}>
        <div className="flex items-start justify-between gap-2"><div><h2 className="text-xl font-bold">{item.name}</h2><p className="text-sm mt-2">{quantity != null ? `Nutrition for ${quantity} ${unit || ''}` : 'Nutrition basis not set'}</p></div>{actions(entry)}</div>
        {selectionMode && entry.food && <label className="mt-3 flex items-center gap-2"><input type="checkbox" className="accent-lime-500" checked={selectedIds.has(entry.food.id)} onChange={event => setSelectedIds(current => { const next = new Set(current); event.target.checked ? next.add(entry.food.id) : next.delete(entry.food.id); return next; })}/>Select for cleanup</label>}
        <p className="mt-2 text-sm font-semibold">{usageLabel(entry)}</p>
        <dl className="food-library-nutrients">{NUTRIENTS.slice(0, 5).map(([key,label,nutrientUnit]) => <div key={key}><dt>{label}</dt><dd>{nutrition[key] == null ? 'Not set' : `${formatNutrient(nutrition[key])} ${nutrientUnit}`}</dd></div>)}</dl>
        {recipesUsing(entry).length > 0 && <details className="mt-3"><summary>Used in {recipesUsing(entry).length} recipes</summary><div className="mt-2 flex flex-wrap gap-2">{recipesUsing(entry).map(recipe => <RecipeLink key={recipe.slug} to={`/recipes/${recipe.slug}`}>{recipe.title}</RecipeLink>)}</div></details>}
        <details className="mt-3"><summary>More nutrients</summary><dl className="food-library-nutrients">{NUTRIENTS.slice(5).map(([key,label,nutrientUnit]) => <div key={key}><dt>{label}</dt><dd>{nutrition[key] == null ? 'Not set' : `${formatNutrient(nutrition[key])} ${nutrientUnit}`}</dd></div>)}</dl></details>
      </article>;
    })}</div>}
    <ConfirmDialog isOpen={Boolean(deletePlan)} title={deletePlan?.safe.length === 1 ? 'Delete this food?' : `Delete ${deletePlan?.safe.length || 0} foods?`}
      message={`${deletePlan?.safe.length || 0} unused ${deletePlan?.safe.length === 1 ? 'food is' : 'foods are'} safe to delete. ${deletePlan?.inUse.length ? `${deletePlan.inUse.length} used ${deletePlan.inUse.length === 1 ? 'food will' : 'foods will'} be kept because recipes or possible legacy links reference them.` : 'No active recipe references were found.'} Diary and grocery snapshots will stay unchanged.`}
      confirmLabel={busy ? 'Deleting...' : `Delete ${deletePlan?.safe.length || 0} unused`} onCancel={() => !busy && setDeletePlan(null)} onConfirm={confirmDelete} />
    {mergeGroup && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 px-4 py-6" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="food-merge-title" className="my-auto w-full max-w-2xl rounded-[1.75rem] border-2 border-black bg-[#fffdf8] p-5 text-black shadow-[8px_8px_0_#000]">
      <span className="pill">Review merge</span><h2 id="food-merge-title" className="mt-3 text-2xl font-bold">Merge {mergeGroup.length} possible duplicates?</h2>
      <p className="mt-2">Recipe and planner links will move to the kept food. Recipe quantities and diary/grocery snapshots stay unchanged.</p>
      <label className="mt-4 block font-semibold">Canonical food to keep<select className="field-input mt-1" value={keepId} onChange={event => { setKeepId(event.target.value); if (nutritionSourceId === keepId) setNutritionSourceId(event.target.value); }}>
        {mergeGroup.map(food => <option value={food.id} key={food.id}>{food.name}</option>)}
      </select></label>
      {(() => {
        const conflicts = foodNutritionConflicts(mergeGroup);
        const recipeUsage = new Map(mergeGroup.flatMap(food => getFoodUsage(food, { catalog: foodCatalog, recipes, mealPlans }).recipes).map(recipe => [recipe.slug, recipe]));
        const planUsage = new Map(mergeGroup.flatMap(food => getFoodUsage(food, { catalog: foodCatalog, recipes, mealPlans }).mealPlans).map(plan => [plan.id, plan]));
        return <>
          <p className="mt-3"><strong>Used by:</strong> {recipeUsage.size} recipes, {planUsage.size} meal plans</p>
          {conflicts.length > 0 ? <>
            <p className="mt-3 font-semibold">Nutrition differences detected: {conflicts.join(', ')}.</p>
            <div className="food-library-table-wrap mt-2"><table className="food-library-table"><thead><tr><th>Food</th>{conflicts.slice(0, 5).map(key => <th key={key}>{key}</th>)}</tr></thead><tbody>{mergeGroup.map(food => <tr key={food.id}><th>{food.name}</th>{conflicts.slice(0, 5).map(key => <td key={key}>{food.nutrition?.[key] ?? 'Not set'}</td>)}</tr>)}</tbody></table></div>
            <label className="mt-3 block font-semibold">Nutrition to keep<select className="field-input mt-1" value={nutritionSourceId} onChange={event => setNutritionSourceId(event.target.value)}>{mergeGroup.map(food => <option key={food.id} value={food.id}>{food.name}</option>)}</select></label>
          </> : <p className="mt-3">No nutrition conflicts detected. Existing values will be preserved; missing values will be filled from duplicates.</p>}
        </>;
      })()}
      <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" className={secondaryButton} disabled={busy} onClick={() => setMergeGroup(null)}>Cancel</button><button type="button" className={`${secondaryButton} bg-[#c5ff6f]`} disabled={busy} onClick={confirmMerge}>{busy ? 'Merging...' : 'Merge foods'}</button></div>
    </section></div>}
    {blockedFood && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-6" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="food-in-use-title" className="w-full max-w-md rounded-[1.75rem] border-2 border-black bg-[#fffdf8] p-5 text-black shadow-[8px_8px_0_#000]"><span className="pill">Food in use</span><h2 id="food-in-use-title" className="mt-4 text-2xl font-bold">{blockedFood.food.name} has active or possible recipe references</h2><p className="mt-2 text-sm">Remove or replace it in these recipes before deleting the reusable food:</p><ul className="mt-3 list-inside list-disc">{[...blockedFood.usage.recipes, ...blockedFood.usage.possibleRecipes.map(recipe => ({ ...recipe, possible: true }))].map((recipe, index) => <li key={`${recipe.slug}-${index}`}>{recipe.possible ? 'Possible legacy match: ' : ''}<RecipeLink className="underline" to={`/recipes/${recipe.slug}`}>{recipe.title}</RecipeLink></li>)}</ul><button type="button" className={`${secondaryButton} mt-5`} onClick={() => setBlockedFood(null)}>Close</button></section></div>}
  </section>;
}
