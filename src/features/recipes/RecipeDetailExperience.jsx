import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IngredientList, RecipeImage, RecipeNutrition, RecipeLink, RecipeSteps, RecipeNutritionStatus, secondaryButton } from './RecipeComponents.jsx';
import { RecipeGroceries } from '../groceries/RecipeGroceries.jsx';
import { RecipeFavouriteButton } from './RecipeFavouriteButton.jsx';
import { RecipeHealthReview } from './RecipeHealthReview.jsx';
import { RecipeSource } from './RecipeSource.jsx';
import { formatIngredient } from './recipeData.js';
import { recipeNutritionDisplay } from './ingredientNutrition.js';
import { recipeScaleMetadata, scaleRecipe } from './recipeScaling.js';
import { findRecipeFoodMatches, resolveRecipeFoodCandidate } from '../nutrition/foodCatalog.js';

const number = value => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);

function CookMode({ recipe, onClose }) {
  const [step, setStep] = useState(0);
  const dialogRef = useRef(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const close = event => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const controls = [...(dialogRef.current?.querySelectorAll('button:not(:disabled),summary') || [])];
      if (!controls.length) return;
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialogRef.current?.querySelector('button')?.focus();
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('keydown', close); document.body.style.overflow = previousOverflow; };
  }, [onClose]);
  return <div className="recipe-cook-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="recipe-cook-dialog" role="dialog" aria-modal="true" aria-labelledby="cook-mode-title">
      <header><div><p className="pill">Cook mode · Step {step + 1} of {recipe.steps.length}</p><h2 id="cook-mode-title">{recipe.title}</h2></div><button type="button" className={secondaryButton} onClick={onClose} aria-label="Close cook mode">Close</button></header>
      <div className="recipe-cook-progress" role="progressbar" aria-label="Cooking progress" aria-valuemin={1} aria-valuemax={recipe.steps.length} aria-valuenow={step + 1}><span style={{ width: `${((step + 1) / recipe.steps.length) * 100}%` }} /></div>
      <p className="recipe-cook-step"><span aria-hidden="true">{step + 1}</span>{recipe.steps[step]}</p>
      <details><summary>Ingredients for {recipe.servings || 1} servings</summary><IngredientList recipe={recipe} readOnly /></details>
      <footer><button type="button" className={secondaryButton} disabled={step === 0} onClick={() => setStep(current => current - 1)}>Previous step</button><button type="button" className={secondaryButton} onClick={() => step === recipe.steps.length - 1 ? onClose() : setStep(current => current + 1)}>{step === recipe.steps.length - 1 ? 'Finish cooking' : 'Next step'}</button></footer>
    </section>
  </div>;
}

export function RecipeDetailExperience({ recipe, foodCatalog, favourite, favouritePending, onToggleFavourite, onRecipeUpdated, onMatchExistingFoods, onUseFood, onKeepSeparate, onEdit, onDuplicate, onArchive, onAddToDiary, onAddToPlanner }) {
  const baseServings = Number(recipe.servings) > 0 ? Number(recipe.servings) : 1;
  const [servings, setServings] = useState(baseServings);
  const [cookMode, setCookMode] = useState(false);
  const cookButton = useRef(null);
  const [addTarget, setAddTarget] = useState(null);
  const usageDialog = useRef(null);
  const groceriesPanel = useRef(null);
  const closeCookMode = useCallback(() => setCookMode(false), []);
  const [meal, setMeal] = useState(recipe.mealType === 'Other' ? 'Lunch' : recipe.mealType);
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const scale = useMemo(() => {
    const anchor = recipe.ingredients.find(item => typeof item.amount === 'number' && item.amount > 0);
    if (!anchor || servings === baseServings) return { recipe, scalable: Boolean(anchor) };
    try {
      const based = { ...recipe, scaling: recipe.scaling || recipeScaleMetadata(recipe, anchor.id) };
      return { recipe: { ...scaleRecipe(based, Number((based.scaling.baseQuantities[anchor.id].amount * servings / baseServings).toPrecision(10))).recipe, servings }, scalable: true };
    } catch { return { recipe: { ...recipe, servings }, scalable: false }; }
  }, [recipe, servings, baseServings]);
  const view = scale.recipe;
  const nutritionView = recipeNutritionDisplay(view);
  const macro = nutritionView.nutrition || {};
  const plannerPortions = servings / baseServings;
  const callAdd = async () => {
    const saved = await (addTarget === 'diary' ? onAddToDiary?.({ date, meal, portions: servings }) : onAddToPlanner?.({ date, meal, portions: plannerPortions }));
    if (saved !== false) setAddTarget(null);
  };
  const showGroceries = () => { if (groceriesPanel.current) { groceriesPanel.current.open = true; groceriesPanel.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); } };
  const closeOverflow = event => { const menu = event.currentTarget.closest('details'); if (menu) menu.open = false; };
  useEffect(() => { if (!cookMode) cookButton.current?.focus(); }, [cookMode]);
  useEffect(() => {
    if (!addTarget) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    usageDialog.current?.querySelector('input,select,button')?.focus();
    const handleKeys = event => {
      if (event.key === 'Escape') setAddTarget(null);
      if (event.key !== 'Tab') return;
      const controls = [...(usageDialog.current?.querySelectorAll('button:not(:disabled),input,select') || [])];
      if (!controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
    };
    document.addEventListener('keydown', handleKeys);
    return () => { document.removeEventListener('keydown', handleKeys); document.body.style.overflow = previousOverflow; };
  }, [addTarget]);
  return <article className="recipe-detail space-y-6 break-words text-[var(--color-text)]">
    <section className="recipe-detail-hero">
      <RecipeImage image={recipe.image} title={recipe.title} large />
      <div className="recipe-detail-summary">
        <div className="flex items-center justify-between gap-3"><span className="pill">{recipe.mealType}</span><RecipeFavouriteButton recipe={recipe} favourite={favourite} pending={favouritePending} onToggle={onToggleFavourite} /></div>
        <h1>{recipe.title}</h1>{recipe.description && <p className="text-[var(--color-text-secondary)]">{recipe.description}</p>}
        <div className="recipe-detail-facts"><span>Prep <b>{recipe.prepTime || '—'}</b></span><span>Cook <b>{recipe.cookTime || '—'}</b></span><span>Saved serves <b>{baseServings}</b></span></div>
        <section className="recipe-serving-control" aria-label="Serving size preview"><div><h2>Scale servings</h2><p>{scale.scalable ? 'Ingredient quantities update as a preview.' : 'Ingredients stay at their saved quantities.'}</p></div><div className="recipe-serving-stepper"><button type="button" aria-label="Decrease servings" onClick={() => setServings(value => Math.max(.5, Number((value - .5).toFixed(1))))}>−</button><label><span className="sr-only">Servings</span><input type="number" min="0.5" max="100" step="0.5" value={servings} onChange={event => { const v = Number(event.target.value); if (Number.isFinite(v)) setServings(Math.max(.5, Math.min(100, v))); }} /></label><button type="button" aria-label="Increase servings" onClick={() => setServings(value => Math.min(100, Number((value + .5).toFixed(1))))}>+</button></div></section>
        <div className="recipe-primary-actions"><button type="button" className={secondaryButton} onClick={() => setAddTarget('diary')}>Add to Diary</button><button type="button" className={secondaryButton} onClick={() => setAddTarget('planner')}>Add to Planner</button><button ref={cookButton} type="button" className={secondaryButton} onClick={() => setCookMode(true)}>Cook mode</button><details className="recipe-detail-overflow"><summary aria-label="More recipe actions" title="More recipe actions">•••</summary><nav aria-label="More recipe actions"><button type="button" onClick={event => { closeOverflow(event); setAddTarget('planner'); }}>Add to Planner</button><button type="button" onClick={event => { closeOverflow(event); setCookMode(true); }}>Start cook mode</button><button type="button" onClick={event => { closeOverflow(event); showGroceries(); }}>Add ingredients to Groceries</button>{onEdit && <button type="button" onClick={event => { closeOverflow(event); onEdit(recipe); }}>Edit recipe</button>}{onDuplicate && <button type="button" onClick={event => { closeOverflow(event); onDuplicate(recipe); }}>Duplicate recipe</button>}{onArchive && <button type="button" onClick={event => { closeOverflow(event); onArchive(recipe); }}>Archive recipe</button>}</nav></details></div>
        <p className="recipe-nutrition-basis">{nutritionView.wholeRecipe ? 'Nutrition for whole recipe' : 'Nutrition per serving'}</p><div className="recipe-macro-strip" aria-label={nutritionView.wholeRecipe ? 'Nutrition for whole recipe' : 'Nutrition per serving'}>{[['calories','kcal'],['protein','g protein'],['carbs','g carbs'],['fat','g fat'],['fiber','g fibre']].filter(([key]) => macro[key] != null).map(([key, unit]) => <div key={key}><b>{number(macro[key])}</b><span>{unit}</span></div>)}</div>
        <RecipeNutritionStatus recipe={view} />
      </div>
    </section>
    <IngredientList recipe={view} originalRecipe={recipe} readOnly />
    <section><RecipeSteps steps={recipe.steps} /></section>
    {recipe.sauces.length > 0 && <section><h2 className="text-2xl font-bold">Sauces</h2><ul className="mt-3 list-inside list-disc space-y-2">{recipe.sauces.map((sauce, index) => <li key={index}>{formatIngredient(sauce)}{sauce.note && <span> — {sauce.note}</span>}</li>)}</ul></section>}
    <details ref={groceriesPanel} id="recipe-tools" className="recipe-detail-advanced"><summary>More nutrients and shopping</summary><div className="mt-4 space-y-5"><RecipeNutrition nutrition={recipeNutritionDisplay(view).nutrition} fibreSource={recipe.fibreSource} /><RecipeGroceries key={recipe.slug} recipe={view} foodCatalog={foodCatalog} onRecipeUpdated={onRecipeUpdated} />{recipe.healthReview && <RecipeHealthReview recipe={recipe} />}</div></details>
    <details className="recipe-detail-advanced"><summary>Notes, source and food matching</summary><div className="mt-4 space-y-4"><RecipeSource source={recipe.source} linkClassName={secondaryButton} />{onMatchExistingFoods && <button type="button" className={secondaryButton} onClick={() => onMatchExistingFoods(recipe)}>Match existing foods</button>}{recipe.ingredients.map((item, index) => { if (item.foodId) return null; const matches = findRecipeFoodMatches(item, foodCatalog); if (resolveRecipeFoodCandidate(item, foodCatalog).status !== 'review') return null; return <section key={item.id || index} className="space-y-2"><h3>{formatIngredient(item)} · possible food links</h3><div className="flex flex-wrap gap-2">{matches.map(({ food }) => <button key={food.id} type="button" className={secondaryButton} onClick={() => onUseFood?.(recipe, index, food)}>{food.name}</button>)}<button type="button" className={secondaryButton} onClick={() => onKeepSeparate?.(recipe, index, matches)}>Keep separate</button></div></section>;})}</div></details>
    <details className="recipe-detail-advanced"><summary>Manage this recipe</summary><div className="mt-3 flex flex-wrap gap-2">{onEdit && <button className={secondaryButton} type="button" onClick={() => onEdit(recipe)}>Edit recipe</button>}{onDuplicate && <button className={secondaryButton} type="button" onClick={() => onDuplicate(recipe)}>Duplicate recipe</button>}{onArchive && <button className={secondaryButton} type="button" onClick={() => onArchive(recipe)}>Archive recipe</button>}<RecipeLink to="/recipes">Back to recipes</RecipeLink></div></details>
    {cookMode && <CookMode recipe={view} onClose={closeCookMode} />}
    {addTarget && <div className="recipe-cook-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setAddTarget(null); }}><section ref={usageDialog} className="recipe-add-dialog" role="dialog" aria-modal="true" aria-labelledby="recipe-add-title"><h2 id="recipe-add-title">Add {recipe.title} to {addTarget === 'diary' ? 'Diary' : 'Planner'}</h2><label>Date<input type="date" max={addTarget === 'diary' ? new Date().toLocaleDateString('en-CA') : undefined} value={date} onChange={event => setDate(event.target.value)} /></label><label>Meal<select value={meal} onChange={event => setMeal(event.target.value)}>{['Breakfast','Lunch','Dinner','Snack'].map(item => <option key={item}>{item}</option>)}</select></label><label>Servings<input type="number" min="0.5" max="100" step="0.5" value={servings} onChange={event => { const v=Number(event.target.value); if(Number.isFinite(v)) setServings(Math.max(.5,Math.min(100,v))); }} /></label><p>{addTarget === 'diary' ? `This adds ${number(servings)} servings.` : `This schedules ${number(plannerPortions)} recipe portions.`}</p><div className="flex justify-end gap-2"><button type="button" className={secondaryButton} onClick={() => setAddTarget(null)}>Cancel</button><button type="button" className={secondaryButton} onClick={callAdd}>Add meal</button></div></section></div>}
  </article>;
}
