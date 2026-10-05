import { FoodLibrary } from './FoodLibrary';
import { DailyNutritionTargets, useNutritionGoals } from '../nutrition/DailyNutritionTargets';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { navigateTo, getAppHref } from '../../app/useRoute';
import { PageShell } from '../../components/layout/PageShell';
import { AppNavigation } from '../../components/layout/AppNavigation';
import { useAdaptiveNavigation } from '../../hooks/useAdaptiveNavigation.js';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import {
  getRecipes,
  saveRecipe,
  saveRecipeBatch,
  deleteRecipe,
  deleteRecipes,
  getRecipeFavourites,
  setRecipeFavourite,
} from '../../services/recipeService';
import {
  RecipeCard,
  RecipePage,
  RecipeLink,
  RecipeAlternatives,
  secondaryButton,
} from './RecipeComponents';
import { RecipeImporter } from './RecipeImporter';
import { FoodItemEditor } from '../nutrition/FoodItemEditor';
import { buildIngredientLibrary } from './ingredientLibrary';
import { applyFoodCatalogToRecipes, catalogItemsFromRecipe } from '../nutrition/foodCatalog.js';
import { deleteFoodCatalogItems, getFoodCatalog, upsertFoodCatalogItems } from '../../services/foodCatalogService.js';
import { classifyFoodDeletion, getOrphanFoodsAfterRecipesDelete } from '../nutrition/foodReferences.js';
import { notify } from '../../lib/notifications.js';
import { getMealPlanFoodReferences } from '../../services/foodReferenceService.js';
import { formatIngredient } from './recipeData';
import { DailyMealPlanner } from './DailyMealPlanner';
import { FoodDiary } from '../diary/FoodDiary';
import {
  RecipeCardViewProvider,
  RecipeCardViewControl,
  RecipeMasonryGrid,
  useRecipeCardGrid,
} from './RecipeCardView';
import './recipesLayout.css';

export function Recipes({ route, navigationPath = '/recipes' }) {
  return (
    <RecipeCardViewProvider>
      <RecipesContent route={route} navigationPath={navigationPath} />
    </RecipeCardViewProvider>
  );
}

function RecipesContent({ route, navigationPath }) {
  const { user } = useAuth();
  const cardGrid = useRecipeCardGrid();
  const nutritionGoals = useNutritionGoals();
  const [recipes, setRecipes] = useState([]);
  const [foodCatalog, setFoodCatalog] = useState([]);
  const [mealPlanRefs, setMealPlanRefs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [favourites, setFavourites] = useState(new Set());
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [favouritePending, setFavouritePending] = useState(new Set());
  const [favouriteError, setFavouriteError] = useState('');
  const [favouriteNotice, setFavouriteNotice] = useState('');
  const favouriteLocks = useRef(new Set());
  const [draft, setDraft] = useState(null);
  const [addingFood, setAddingFood] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [selectedRecipeSlugs, setSelectedRecipeSlugs] = useState(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [recipeCleanup, setRecipeCleanup] = useState(null);
  const [busy, setBusy] = useState(false);
  const ingredientLibrary = useMemo(() => buildIngredientLibrary(recipes, foodCatalog), [recipes, foodCatalog]);
  const dialog = useRef(null);
  const deleteLock = useRef(false);
  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const [loadedRecipes, loadedFavourites, loadedFoodCatalog, loadedMealPlanRefs] = await Promise.all([getRecipes(), getRecipeFavourites(), getFoodCatalog(user.id), getMealPlanFoodReferences()]);
      setFoodCatalog(loadedFoodCatalog);
      setMealPlanRefs(loadedMealPlanRefs);
      setRecipes(applyFoodCatalogToRecipes(loadedRecipes, loadedFoodCatalog));
      setFavourites(new Set(loadedFavourites));
    } catch (error) {
      setError(error.message || 'Could not load recipes. Please try again.');
    } finally {
      setLoading(false);
    }
  }
  async function saveMainFoodItems(items) {
    if (!items.length) return foodCatalog;
    const saved = await upsertFoodCatalogItems(items, user.id);
    setFoodCatalog(saved);
    setRecipes(current => applyFoodCatalogToRecipes(current, saved));
    return saved;
  }
  function recipeUpdated(updated) {
    setRecipes(current => current.map(item => item.slug === updated.slug ? updated : item));
    const catalogItems = catalogItemsFromRecipe(updated);
    notify.success('Recipe updated');
    if (catalogItems.length) saveMainFoodItems(catalogItems).catch(error => notify.error(error.message || 'Recipe saved, but the food library could not be updated.'));
  }
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    if ((removing || confirmBulkDelete || recipeCleanup) && !dialog.current?.open) dialog.current?.showModal();
  }, [removing, confirmBulkDelete, recipeCleanup]);
  async function toggleFavourite(item) {
    if (favouriteLocks.current.has(item.slug)) return;
    favouriteLocks.current.add(item.slug);
    const next = !favourites.has(item.slug);
    const update = (values, selected) => { const copy = new Set(values); if (selected) copy.add(item.slug); else copy.delete(item.slug); return copy; };
    setFavouritePending(values => update(values, true));
    setFavourites(values => update(values, next));
    setFavouriteError('');
    setFavouriteNotice('');
    try {
      await setRecipeFavourite(item.slug, next, user.id);
      setFavouriteNotice(`${item.title} ${next ? 'added to' : 'removed from'} favourites.`);
    } catch (error) {
      setFavourites(values => update(values, !next));
      setFavouriteError(error.message || 'Could not save your favourite. Tap the heart to try again.');
      notify.error(error.message || 'Could not save favourite');
    } finally {
      favouriteLocks.current.delete(item.slug);
      setFavouritePending(values => update(values, false));
    }
  }
  const parts = route.replace(/\/$/, '').split('/').filter(Boolean);
  const foods = parts.length === 3 && parts[1] === 'library' && parts[2] === 'items';
  const manage = parts.length === 2 && parts[1] === 'manage';
  const importing = parts.length === 2 && parts[1] === 'import';
  const recipe = recipes.find((item) => item.slug === parts[1]);
  const group =
    parts.length === 4 &&
    parts[2] === 'alternatives' &&
    recipe &&
    Object.hasOwn(recipe.alternatives, parts[3])
      ? recipe.alternatives[parts[3]]
      : null;
  const home = parts.length === 1;
  const planning =
    parts.length === 3 && parts[1] === 'planner' && parts[2] === 'day';
  const diary = parts.length === 3 && parts[1] === 'diary' && parts[2] === 'day';
  const recipeSection = foods ? 'foods' : importing ? 'add' : planning ? 'planner' : diary ? 'diary' : manage ? 'manage' : 'home';
  const shortcutOrder = useAdaptiveNavigation(
    'recipe-sections',
    ['home', 'foods', 'add', 'planner', 'diary', 'manage'],
    recipeSection,
  );
  function startImport(initial = null, editing = false) {
    setDraft({ initial, editing, key: crypto.randomUUID() });
    navigateTo('/recipes/import');
  }
  async function save(data, image, edit) {
    let saved;
    try { saved = await saveRecipe(data, image, { edit }); }
    catch (error) { notify.error(error.message || 'Could not save recipe'); throw error; }
    setRecipes((current) => [
      ...current.filter((item) => item.slug !== saved.slug),
      saved,
    ]);
    setDraft(null);
    const catalogItems = catalogItemsFromRecipe(saved);
    if (catalogItems.length) {
      try { await saveMainFoodItems(catalogItems); }
      catch (error) { notify.error(error.message || 'Recipe saved, but food nutrition could not be updated'); }
    }
    notify.success(edit ? 'Recipe updated' : 'Recipe saved');
    navigateTo(`/recipes/${saved.slug}`);
  }
  async function remove() {
    if (deleteLock.current) return;
    deleteLock.current = true;
    setBusy(true);
    setError('');
    const deleting = confirmBulkDelete
      ? recipes.filter(item => selectedRecipeSlugs.has(item.slug))
      : removing ? [removing] : [];
    const orphanCandidates = getOrphanFoodsAfterRecipesDelete(deleting, foodCatalog, recipes, mealPlanRefs);
    try {
      if (confirmBulkDelete) await deleteRecipes(deleting.map(item => item.slug));
      else await deleteRecipe(removing.slug);
      const deletedSlugs = new Set(deleting.map(item => item.slug));
      setRecipes(current => current.filter(item => !deletedSlugs.has(item.slug)));
      setFavourites(current => { const next = new Set(current); deletedSlugs.forEach(slug => next.delete(slug)); return next; });
      setSelectedRecipeSlugs(current => new Set([...current].filter(slug => !deletedSlugs.has(slug))));
      setRemoving(null);
      setConfirmBulkDelete(false);
      if (orphanCandidates.length) setRecipeCleanup({ recipes: deleting, foods: orphanCandidates });
      else notify.success(`${deleting.length} recipe${deleting.length === 1 ? '' : 's'} deleted`);
      if (!confirmBulkDelete && !manage) {
        navigateTo('/recipes');
      }
      return orphanCandidates.length > 0;
    } catch (error) {
      setError(error.message || 'Could not delete recipe. Please try again.');
      notify.error(error.message || 'Could not delete recipe');
      setRemoving(null);
      setConfirmBulkDelete(false);
      return false;
    } finally {
      deleteLock.current = false;
      setBusy(false);
    }
  }
  async function finishRecipeCleanup(deleteUnused) {
    if (!recipeCleanup || busy) return;
    if (!deleteUnused) {
      notify.success(`${recipeCleanup.recipes.length} recipe${recipeCleanup.recipes.length === 1 ? '' : 's'} deleted · ${recipeCleanup.foods.length} unused food${recipeCleanup.foods.length === 1 ? '' : 's'} kept`);
      setRecipeCleanup(null);
      dialog.current?.close();
      return;
    }
    setBusy(true);
    try {
      const deletedSlugs = new Set(recipeCleanup.recipes.map(item => item.slug));
      const remainingRecipes = (await getRecipes()).filter(item => !deletedSlugs.has(item.slug));
      const latestMealPlanRefs = await getMealPlanFoodReferences();
      const analysis = classifyFoodDeletion(recipeCleanup.foods.map(item => item.id), { catalog: foodCatalog, recipes: remainingRecipes, mealPlans: latestMealPlanRefs });
      const safeIds = analysis.safe.map(item => item.food.id);
      if (safeIds.length) {
        await deleteFoodCatalogItems(safeIds, user.id);
        const remainingFoods = foodCatalog.filter(item => !safeIds.includes(item.id));
        setFoodCatalog(remainingFoods);
        setRecipes(applyFoodCatalogToRecipes(remainingRecipes, remainingFoods));
      }
      notify.success(`${recipeCleanup.recipes.length} recipe${recipeCleanup.recipes.length === 1 ? '' : 's'} deleted · ${safeIds.length} unused food${safeIds.length === 1 ? '' : 's'} deleted`);
      setRecipeCleanup(null);
      dialog.current?.close();
    } catch (error) {
      notify.error(error.message || 'Recipe was deleted, but unused foods could not be cleaned up');
    } finally {
      setBusy(false);
    }
  }
  async function deleteFoods(ids) {
    const [latestRecipes, latestMealPlanRefs] = await Promise.all([getRecipes(), getMealPlanFoodReferences()]);
    const analysis = classifyFoodDeletion(ids, { catalog: foodCatalog, recipes: latestRecipes, mealPlans: latestMealPlanRefs });
    if (analysis.inUse.length) throw new Error('One or more selected foods are now used by a recipe. Reload the food list and try again.');
    const count = await deleteFoodCatalogItems(analysis.safe.map(item => item.food.id), user.id);
    const removedIds = new Set(analysis.safe.map(item => item.food.id));
    const remainingFoods = foodCatalog.filter(item => !removedIds.has(item.id));
    setFoodCatalog(remainingFoods);
    setRecipes(applyFoodCatalogToRecipes(latestRecipes, remainingFoods));
    notify.success(`${count} food${count === 1 ? '' : 's'} deleted`);
  }
  async function saveBatch(entries) {
    let saved;
    try { saved = await saveRecipeBatch(entries); }
    catch (error) { notify.error(error.message || 'Could not import recipes'); throw error; }
    setRecipes((current) => [...current, ...saved]);
    const catalogItems = saved.flatMap(catalogItemsFromRecipe);
    if (catalogItems.length) await saveMainFoodItems(catalogItems);
    setDraft(null);
    setSearch('');
    setCategory('All');
    setFavouritesOnly(false);
    navigateTo('/recipes');
    window.scrollTo(0, 0);
    notify.success(`${saved.length} recipe${saved.length === 1 ? '' : 's'} imported`);
  }
  const categories = [
    ...new Set([
      'Breakfast',
      'Lunch',
      'Dinner',
      'Snack',
      ...recipes.map((item) => item.mealType),
    ]),
  ];
  const query = search.trim().toLowerCase();
  const filtered = recipes.filter(
    (item) =>
      (category === 'All' || item.mealType === category) &&
      (!favouritesOnly || favourites.has(item.slug)) &&
      [
        item.title,
        ...item.ingredients.map((ingredient) => ingredient.name),
        ...item.tags,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query),
  );
  function setRecipeSelected(slug, checked) {
    setError('');
    setSelectedRecipeSlugs(current => {
      const next = new Set(current);
      if (checked && !next.has(slug) && next.size >= 50) { setError('You can bulk delete up to 50 recipes at a time.'); return current; }
      if (checked) next.add(slug); else next.delete(slug);
      return next;
    });
  }
  function setVisibleSelected(checked) {
    setError('');
    setSelectedRecipeSlugs(current => {
      const visibleSlugs = new Set(filtered.map(item => item.slug));
      const next = new Set([...current].filter(slug => !visibleSlugs.has(slug)));
      if (checked) filtered.forEach(item => next.add(item.slug));
      if (next.size > 50) { setError('Select 50 or fewer recipes at a time. Narrow the list with search or filters, then select this page again.'); return current; }
      return next;
    });
  }
  function toggleSelectionMode() {
    setSelectionMode(current => {
      if (current) setSelectedRecipeSlugs(new Set());
      return !current;
    });
  }
  const bulkDeleteItems = recipes.filter(item => selectedRecipeSlugs.has(item.slug));
  const deletingInDialog = confirmBulkDelete ? bulkDeleteItems : removing ? [removing] : [];
  return (
    <PageShell>
      <section className="recipe-page-shell panel space-y-7 border-black p-5 text-black sm:p-8 lg:p-10">
        <AppNavigation activePath={navigationPath} />
        <DailyNutritionTargets controller={nutritionGoals} />
        <nav className="recipe-shortcuts mobile-section-nav flex flex-wrap gap-2" aria-label="Recipe shortcuts">
          <button type="button" className={secondaryButton} disabled={loading} onClick={() => setAddingFood(true)}>Add item</button>
          {shortcutOrder.map((item) => {
            if (item === 'foods') return <RecipeLink key={item} to="/recipes/library/items">All food items</RecipeLink>;
            if (item === 'home') return !home && !(recipe && parts.length === 2) ? <RecipeLink key={item} to="/recipes">Back to recipes</RecipeLink> : null;
            if (item === 'add') return !importing ? <PrimaryButton key={item} onClick={() => startImport()}>Add recipe</PrimaryButton> : null;
            if (item === 'planner') return !planning ? <RecipeLink key={item} to="/recipes/planner/day">Meal planner</RecipeLink> : null;
            if (item === 'diary') return !diary ? <RecipeLink key={item} to="/food-diary">Food diary</RecipeLink> : null;
            return !manage ? <RecipeLink key={item} to="/recipes/manage">Manage recipes</RecipeLink> : null;
          })}
        </nav>
        {addingFood && <FoodItemEditor initial={typeof addingFood==='object'?addingFood:null} catalog={foodCatalog} onClose={() => setAddingFood(false)} onSave={async item => {
          const editing = foodCatalog.some(food => food.id === item.id || food.name.trim().toLocaleLowerCase() === item.name.trim().toLocaleLowerCase());
          await saveMainFoodItems([item]);
          notify.success(editing ? 'Food updated' : 'Food added to your library');
        }} />}
        {favouriteError && <p role="alert" className="rounded-xl border-2 border-black bg-[#ffe0de] p-3 text-sm font-semibold">{favouriteError}</p>}
        <p role="status" className="sr-only">{favouriteNotice}</p>
        {loading ? (
          <p role="status" className="py-12 text-center font-bold">
            Loading recipes…
          </p>
        ) : (
          <>
            {error && (
              <div role="alert" className="space-y-3">
                <p>{error}</p>
                <button className={secondaryButton} onClick={refresh}>
                  Retry loading
                </button>
              </div>
            )}
            {!error && importing ? (
              <RecipeImporter
                key={draft?.key ?? 'new'}
                initial={draft?.initial}
                editing={draft?.editing}
                ingredientLibrary={ingredientLibrary}
                onAddItem={() => setAddingFood(true)}
                onSave={save}
                onSaveBatch={saveBatch}
                onCancel={() => {
                  setDraft(null);
                  navigateTo('/recipes');
                }}
                getSlugs={async () =>
                  (await getRecipes()).map((item) => item.slug)
                }
                onAiCreated={(created, imageWarning = '') => {
                  setRecipes((current) => [
                    ...current.filter((item) => item.slug !== created.slug),
                    created,
                  ]);
                  notify.success(imageWarning ? `Recipe saved without an AI image: ${imageWarning}` : 'Recipe and AI image saved.');
                  setDraft(null);
                  navigateTo(`/recipes/${created.slug}`);
                }}
              />
            ) : null}
            {!error && foods && <FoodLibrary library={ingredientLibrary} recipes={recipes} foodCatalog={foodCatalog} mealPlans={mealPlanRefs} onAdd={() => setAddingFood(true)} onEdit={id=>setAddingFood(foodCatalog.find(item=>item.id===id)||true)} onDeleteFoods={deleteFoods} />}
            {!error && planning && <DailyMealPlanner recipes={recipes} nutritionGoals={nutritionGoals} />}
            {!error && diary && <FoodDiary recipes={recipes} nutritionGoals={nutritionGoals} foodCatalog={foodCatalog} onFoodCatalogChange={saveMainFoodItems} onDiaryRecipeUpdated={updated => setRecipes(current => [updated, ...current.filter(item => item.slug !== updated.slug)])} />}
            {!error && (home || manage) && (
              <>
                <header className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <span className="pill">Meal library</span>
                    <h1 className="mt-4 text-4xl font-bold tracking-[-0.05em] sm:text-5xl">
                      {manage ? 'Manage Recipes' : 'Recipes'}
                    </h1>
                    <p className="mt-3 text-black/70">
                      Your meals, ingredients, and alternatives in one place.
                    </p>
                  </div>
                </header>
                {recipes.length > 0 ? (
                  <>
                    <div className="space-y-5">
                      <label className="block space-y-2 font-bold">
                        <span>Search recipes</span>
                        <input
                          type="search"
                          className="field-input"
                          placeholder="Name, ingredient or tag"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                        />
                      </label>
                      <div className="flex flex-wrap items-center gap-3" aria-label="Recipe filters and view">
                        <button type="button" className={`${secondaryButton.replace('bg-white', '')} min-h-11 ${!favouritesOnly ? 'bg-[#c5ff6f]' : 'bg-white'}`} aria-pressed={!favouritesOnly} onClick={() => setFavouritesOnly(false)}>All recipes</button>
                        <button type="button" className={`${secondaryButton.replace('bg-white', '')} min-h-11 ${favouritesOnly ? 'bg-[#c5ff6f]' : 'bg-white'}`} aria-pressed={favouritesOnly} onClick={() => setFavouritesOnly(true)}><span aria-hidden="true" className="mr-2">♥</span>Favourites ({recipes.filter(item => favourites.has(item.slug)).length})</button>
                        <label className="recipe-meal-filter inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-black bg-white px-3 text-sm font-bold">
                          <span>Meal type</span>
                          <select
                            className="min-w-0 bg-transparent font-bold outline-none"
                            value={category}
                            onChange={(event) => setCategory(event.target.value)}
                          >
                            <option value="All">All meals</option>
                            {categories.map((value) => (
                              <option key={value} value={value}>{value}</option>
                            ))}
                          </select>
                        </label>
                        <p role="status" className="text-sm text-black/70">{filtered.length} recipe{filtered.length === 1 ? '' : 's'}</p>
                        <RecipeCardViewControl />
                        {!manage && <RecipeLink to="/recipes/manage">Manage recipes</RecipeLink>}
                      </div>
                    </div>
                    {manage && <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-black bg-white p-3" aria-label="Bulk recipe actions">
                      <div className="flex flex-wrap items-center gap-3">
                        {!selectionMode && <button type="button" className={secondaryButton} onClick={toggleSelectionMode}>Select recipes</button>}
                        {selectionMode && <label className="flex items-center gap-2 text-sm font-bold">
                          <input type="checkbox" className="h-4 w-4 accent-lime-500" checked={filtered.length > 0 && filtered.every(item => selectedRecipeSlugs.has(item.slug))} onChange={event => setVisibleSelected(event.target.checked)} aria-label={`Select all ${filtered.length} shown recipes`} />
                          Select all shown
                        </label>}
                        {selectionMode && <span className="text-sm text-black/65">{bulkDeleteItems.length} selected <span className="hidden sm:inline">· up to 50 at a time</span></span>}
                        {selectionMode && selectedRecipeSlugs.size > 0 && <button type="button" className={secondaryButton} onClick={() => setSelectedRecipeSlugs(new Set())}>Clear</button>}
                      </div>
                      {selectionMode && <div className="flex gap-2">
                        <button type="button" className={secondaryButton} onClick={toggleSelectionMode}>Done</button>
                        <button type="button" className={`${secondaryButton} border-red-800 text-red-800`} disabled={!bulkDeleteItems.length || busy} onClick={() => setConfirmBulkDelete(true)}>Delete {bulkDeleteItems.length ? `(${bulkDeleteItems.length})` : 'selected'}</button>
                      </div>}
                    </section>}
                    <RecipeMasonryGrid className={cardGrid}>
                      {filtered.map((item) => (
                        <div
                          key={item.slug}
                          className="flex min-w-0 flex-col gap-3"
                        >
                          <RecipeCard
                            recipe={item}
                            favourite={favourites.has(item.slug)}
                            favouritePending={favouritePending.has(item.slug)}
                            onToggleFavourite={toggleFavourite}
                            onDelete={manage ? setRemoving : undefined}
                            onEdit={manage ? recipe => startImport(recipe, true) : undefined}
                            onDuplicate={manage ? recipe => startImport({ ...recipe, title: `${recipe.title} (copy)` }) : undefined}
                            bulkSelection={manage && selectionMode}
                            selected={selectedRecipeSlugs.has(item.slug)}
                            onToggleSelected={setRecipeSelected}
                          />
                        </div>
                      ))}
                    </RecipeMasonryGrid>
                    {!filtered.length && (
                      <p className="py-8 text-center">
                        {favouritesOnly ? 'No favourites match this view. Tap a recipe’s heart in All recipes to save it here, or clear your search and meal type.' : 'No matching recipes. Try another search or meal type.'}
                      </p>
                    )}
                  </>
                ) : (
                  <div className="rounded-2xl border-2 border-black bg-white p-6">
                    <h2 className="text-2xl font-bold">No recipes yet.</h2>
                    <p className="mt-2 leading-7">
                      Import your first recipe to start building your meal
                      library.
                    </p>
                    <p className="mt-4 text-sm leading-7">
                      Start with the details you supplied:{' '}
                      <a
                        className="font-bold underline"
                        download
                        href={getAppHref('/recipes/greek-yogurt-oats.json')}
                      >
                        Greek Yogurt Oats JSON
                      </a>{' '}
                      or{' '}
                      <a
                        className="font-bold underline"
                        download
                        href={getAppHref('/recipes/egg-fried-rice.json')}
                      >
                        Egg Fried Rice JSON
                      </a>
                      . Upload the downloaded file with Add Recipe, review it,
                      and save. Unknown nutrition is left blank.
                    </p>
                  </div>
                )}
              </>
            )}
            {!error && group && (
              <>
                <RecipeLink to={`/recipes/${recipe.slug}`}>
                  ← {recipe.title}
                </RecipeLink>
                <h1 className="text-3xl font-bold">Ingredient alternatives</h1>
                <section className="rounded-2xl border-2 border-black bg-white p-5">
                  <h2 className="text-sm font-bold uppercase tracking-wider">
                    Original ingredient
                  </h2>
                  {recipe.ingredients
                    .filter((item) => item.alternativeGroup === parts[3])
                    .map((item, index) => (
                      <p key={index} className="mt-3 text-xl font-bold">
                        {formatIngredient(item)}
                      </p>
                    ))}
                </section>
                <RecipeAlternatives group={group} />
              </>
            )}
            {!error && recipe && parts.length === 2 && (
              <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                  <RecipeLink to="/recipes">Back to recipes</RecipeLink>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={secondaryButton} onClick={() => startImport(recipe, true)}>Edit Recipe</button>
                      <button type="button" className={secondaryButton} aria-label={`Delete ${recipe.title}`} onClick={() => setRemoving(recipe)}>Delete recipe</button>
                    </div>
                </div>
                <RecipePage key={recipe.slug} recipe={recipe} favourite={favourites.has(recipe.slug)} favouritePending={favouritePending.has(recipe.slug)} onToggleFavourite={toggleFavourite} onRecipeUpdated={recipeUpdated} />
              </div>
            )}
            {!error &&
              !home &&
              !foods &&
              !manage &&
              !importing &&
              !planning &&
              !diary &&
              !(recipe && parts.length === 2) &&
              !group && (
                <>
                  <h1 className="text-3xl font-bold">
                    Recipe or alternatives not found
                  </h1>
                  <p>
                    The recipe may have been deleted or this link is incomplete.
                  </p>
                </>
              )}
          </>
        )}
        {!importing && <button type="button" className="recipe-mobile-add" onClick={() => startImport()}>＋ Add recipe</button>}
        <dialog
          ref={dialog}
          onCancel={(event) => {
            if (busy || recipeCleanup) event.preventDefault();
            else { setRemoving(null); setConfirmBulkDelete(false); }
          }}
          onClose={() => {
            if (!busy) { setRemoving(null); setConfirmBulkDelete(false); setRecipeCleanup(null); }
          }}
          className="panel fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md border-black p-6 text-black backdrop:bg-black/35"
          aria-labelledby="recipe-delete-title"
        >
          <h2 id="recipe-delete-title" className="text-2xl font-bold">
            {recipeCleanup ? 'Recipe deleted' : confirmBulkDelete ? `Delete ${deletingInDialog.length} selected recipe${deletingInDialog.length === 1 ? '' : 's'}?` : `Delete “${removing?.title}”?`}
          </h2>
          <p className="mt-3 text-black/70">
            {recipeCleanup ? `${recipeCleanup.foods.length} reusable food${recipeCleanup.foods.length === 1 ? ' is' : 's are'} no longer used by any recipe. They will stay in your library unless you choose to delete them.` : confirmBulkDelete ? 'This removes the selected recipes and their saved favourites from your library.' : 'This removes the recipe and its uploaded image from your library.'}
          </p>
          {recipeCleanup && <ul className="mt-3 max-h-36 list-inside list-disc overflow-auto text-sm">{recipeCleanup.foods.slice(0, 8).map(item => <li key={item.id}>{item.name}</li>)}{recipeCleanup.foods.length > 8 && <li>and {recipeCleanup.foods.length - 8} more</li>}</ul>}
          {!recipeCleanup && confirmBulkDelete && deletingInDialog.length > 0 && <ul className="mt-3 max-h-32 list-inside list-disc overflow-auto text-sm">{deletingInDialog.slice(0, 5).map(item => <li key={item.slug}>{item.title}</li>)}{deletingInDialog.length > 5 && <li>and {deletingInDialog.length - 5} more</li>}</ul>}
          <div className="mt-6 flex flex-wrap gap-3">
            {recipeCleanup ? <>
            <button autoFocus className={secondaryButton} disabled={busy} onClick={() => finishRecipeCleanup(false)}>Keep foods</button>
            <button className={`${secondaryButton} border-red-800 text-red-800`} disabled={busy} onClick={() => finishRecipeCleanup(true)}>{busy ? 'Deleting…' : `Delete ${recipeCleanup.foods.length} unused food${recipeCleanup.foods.length === 1 ? '' : 's'}`}</button>
            </> : <>
            <button
              autoFocus
              className={secondaryButton}
              disabled={busy}
              onClick={() => {
                dialog.current.close();
                setRemoving(null);
                setConfirmBulkDelete(false);
              }}
            >
              Cancel
            </button>
            <button
              className={secondaryButton}
              disabled={busy}
              onClick={async () => {
                const cleanupNeeded = await remove();
                if (!cleanupNeeded) dialog.current?.close();
              }}
            >
              {busy ? 'Deleting…' : confirmBulkDelete ? `Delete ${deletingInDialog.length} recipes` : 'Delete'}
            </button>
            </>}
          </div>
        </dialog>
      </section>
    </PageShell>
  );
}
