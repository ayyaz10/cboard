import { useEffect, useRef, useState } from 'react';
import { recipeUpdateRows, suggestedDiaryRecipe } from './diaryRecipeUpdate.js';

export function DiaryRecipeConfirm({ meal, recipes, busy, error, diarySaved, recipeSaved, onSave, onClose }) {
  const dialog = useRef(null);
  const [slug, setSlug] = useState(() => suggestedDiaryRecipe(meal, recipes));
  const recipe = recipes.find(recipe => recipe.slug === slug);
  const [rows, setRows] = useState(() => recipeUpdateRows(meal, recipe));
  const [share, setShare] = useState(false);
  useEffect(() => { dialog.current.showModal(); }, []);
  return <dialog ref={dialog} className="g-dialog groceries diary-recipe-confirm" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2>Update the original recipe too?</h2>
    <p>Your diary can be saved on its own. To change a recipe, choose it below and select the foods to add or update.</p>
    {diarySaved && <p role="status">Your diary meal is saved.{recipeSaved ? ' The recipe is also saved.' : ''}</p>}
    {error && <p role="alert">{error}</p>}
    <fieldset disabled={busy || Boolean(recipeSaved)}>
      <label>Recipe to update<select value={slug} onChange={event => {
        setSlug(event.target.value);
        setRows(recipeUpdateRows(meal, recipes.find(recipe => recipe.slug === event.target.value)));
      }}><option value="">Choose a recipe</option>{recipes.map(recipe => <option key={recipe.slug} value={recipe.slug}>{recipe.title}</option>)}</select></label>
      {recipe && <>
        <p>Amounts below are for the <strong>whole recipe ({recipe.servings || 'unknown'} servings)</strong>, not just the portion you ate. Unselected ingredients stay unchanged. Recipe nutrition will be recalculated from its ingredients.</p>
        {rows.map(row => <div key={row.id} className="diary-recipe-choice">
          <label><input type="checkbox" checked={row.selected} onChange={event => setRows(current => current.map(value => value.id === row.id ? { ...value, selected: event.target.checked } : value))} />
            {row.exists ? 'Update' : 'Add'} {meal.items.find(item => item.id === row.id).name}
          </label>
          {row.selected && <div className="g-tools">
            <label>Whole-recipe amount<input type="number" min="0.0001" step="any" value={row.amount ?? ''} onChange={event => setRows(current => current.map(value => value.id === row.id ? { ...value, amount: event.target.value } : value))} /></label>
            <label>Unit<input value={row.unit} onChange={event => setRows(current => current.map(value => value.id === row.id ? { ...value, unit: event.target.value } : value))} /></label>
          </div>}
        </div>)}
        {!rows.length && <p>Add or edit individual foods in the meal to update ingredients; a whole-recipe diary entry cannot be added back into itself.</p>}
        <label><input type="checkbox" checked={share} onChange={event => setShare(event.target.checked)} /> Also update shared food nutrition for selected foods</label>
        <p className="g-hint">Sharing makes these values available to matching foods in other recipes and groceries. Earlier diary entries stay unchanged.</p>
      </>}
    </fieldset>
    <div className="diary-actions">
      <button type="button" disabled={busy} onClick={() => onSave(null, [], false)}>{recipeSaved ? 'Finish without shared update' : 'Save diary only'}</button>
      <button type="button" className="g-primary" disabled={busy || !recipe || !rows.some(row => row.selected)} onClick={() => onSave(recipe, rows, share)}>{recipeSaved ? 'Retry shared food update' : 'Save diary and update recipe'}</button>
      <button type="button" disabled={busy} onClick={onClose}>{diarySaved ? 'Close' : 'Back to editing'}</button>
    </div>
  </dialog>;
}
