import { DailyNutritionTargets, useNutritionGoals } from '../nutrition/DailyNutritionTargets';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { navigateTo, getAppHref } from '../../app/useRoute';
import { PageShell } from '../../components/layout/PageShell';
import { AppNavigation } from '../../components/layout/AppNavigation';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import {
  getRecipes,
  saveRecipe,
  saveRecipeBatch,
  deleteRecipe,
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
import { formatIngredient } from './recipeData';
import { DailyMealPlanner } from './DailyMealPlanner';
import { FoodDiary } from '../diary/FoodDiary';
import {
  RecipeCardViewProvider,
  RecipeCardViewControl,
  useRecipeCardGrid,
} from './RecipeCardView';

export function Recipes({ route }) {
  return (
    <RecipeCardViewProvider>
      <RecipesContent route={route} />
    </RecipeCardViewProvider>
  );
}

function RecipesContent({ route }) {
  const { user } = useAuth();
  const cardGrid = useRecipeCardGrid();
  const nutritionGoals = useNutritionGoals();
  const [recipes, setRecipes] = useState([]);
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
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const dialog = useRef(null);
  const deleteLock = useRef(false);
  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const [loadedRecipes, loadedFavourites] = await Promise.all([getRecipes(), getRecipeFavourites()]);
      setRecipes(loadedRecipes);
      setFavourites(new Set(loadedFavourites));
    } catch (error) {
      setError(error.message || 'Could not load recipes. Please try again.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    if (removing) dialog.current?.showModal();
  }, [removing]);
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
    } finally {
      favouriteLocks.current.delete(item.slug);
      setFavouritePending(values => update(values, false));
    }
  }
  const parts = route.replace(/\/$/, '').split('/').filter(Boolean);
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
  function startImport(initial = null, editing = false) {
    setDraft({ initial, editing, key: crypto.randomUUID() });
    navigateTo('/recipes/import');
  }
  async function save(data, image, edit) {
    const saved = await saveRecipe(data, image, { edit });
    setRecipes((current) => [
      ...current.filter((item) => item.slug !== saved.slug),
      saved,
    ]);
    setDraft(null);
    navigateTo(`/recipes/${saved.slug}`);
  }
  async function remove() {
    if (deleteLock.current) return;
    deleteLock.current = true;
    setBusy(true);
    setError('');
    try {
      await deleteRecipe(removing.slug);
      setRecipes((current) =>
        current.filter((item) => item.slug !== removing.slug),
      );
      setRemoving(null);
      setFavourites(current => { const next = new Set(current); next.delete(removing.slug); return next; });
    } catch (error) {
      setError(error.message || 'Could not delete recipe. Please try again.');
      setRemoving(null);
    } finally {
      deleteLock.current = false;
      setBusy(false);
    }
  }
  async function saveBatch(entries) {
    const saved = await saveRecipeBatch(entries);
    setRecipes((current) => [...current, ...saved]);
    setDraft(null);
    setSearch('');
    setCategory('All');
    setFavouritesOnly(false);
    navigateTo('/recipes');
    window.scrollTo(0, 0);
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
  return (
    <PageShell>
      <section className="panel space-y-7 border-black p-5 text-black sm:p-8 lg:p-10">
        <AppNavigation activePath="/recipes" />
        <DailyNutritionTargets controller={nutritionGoals} />
        <nav className="flex flex-wrap gap-2" aria-label="Recipe shortcuts">
          {!home && !(recipe && parts.length === 2) && <RecipeLink to="/recipes">Back to recipes</RecipeLink>}
          {!importing && <PrimaryButton onClick={() => startImport()}>Add recipe</PrimaryButton>}
          {!planning && <RecipeLink to="/recipes/planner/day">Meal planner</RecipeLink>}
          {!diary && <RecipeLink to="/recipes/diary/day">Food diary</RecipeLink>}
          {!manage && <RecipeLink to="/recipes/manage">Manage recipes</RecipeLink>}
        </nav>
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
                onSave={save}
                onSaveBatch={saveBatch}
                onCancel={() => {
                  setDraft(null);
                  navigateTo('/recipes');
                }}
                getSlugs={async () =>
                  (await getRecipes()).map((item) => item.slug)
                }
                onAiCreated={(created) => {
                  setRecipes((current) => [
                    ...current.filter((item) => item.slug !== created.slug),
                    created,
                  ]);
                  setDraft(null);
                  navigateTo(`/recipes/${created.slug}`);
                }}
              />
            ) : null}
            {!error && planning && <DailyMealPlanner recipes={recipes} nutritionGoals={nutritionGoals} />}
            {!error && diary && <FoodDiary recipes={recipes} nutritionGoals={nutritionGoals} />}
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
                      </div>
                    </div>
                    <div className={cardGrid}>
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
                            onDelete={setRemoving}
                          />
                          {manage && (
                            <div className="flex flex-wrap gap-2">
                              <button
                                className={secondaryButton}
                                onClick={() => startImport(item, true)}
                              >
                                Edit
                              </button>
                              <button
                                className={secondaryButton}
                                onClick={() =>
                                  startImport({
                                    ...item,
                                    title: `${item.title} (copy)`,
                                  })
                                }
                              >
                                Duplicate
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
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
                  <button className={secondaryButton} onClick={() => startImport(recipe, true)}>Edit Recipe</button>
                </div>
                <RecipePage key={recipe.slug} recipe={recipe} favourite={favourites.has(recipe.slug)} favouritePending={favouritePending.has(recipe.slug)} onToggleFavourite={toggleFavourite} onRecipeUpdated={(updated) => setRecipes((current) => current.map((item) => item.slug === updated.slug ? updated : item))} />
              </div>
            )}
            {!error &&
              !home &&
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
        <dialog
          ref={dialog}
          onCancel={(event) => {
            if (busy) event.preventDefault();
            else setRemoving(null);
          }}
          onClose={() => {
            if (!busy) setRemoving(null);
          }}
          className="panel fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md border-black p-6 text-black backdrop:bg-black/35"
          aria-labelledby="recipe-delete-title"
        >
          <h2 id="recipe-delete-title" className="text-2xl font-bold">
            Delete “{removing?.title}”?
          </h2>
          <p className="mt-3 text-black/70">
            This removes the recipe and its uploaded image from your library.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              autoFocus
              className={secondaryButton}
              disabled={busy}
              onClick={() => {
                dialog.current.close();
                setRemoving(null);
              }}
            >
              Cancel
            </button>
            <button
              className={secondaryButton}
              disabled={busy}
              onClick={async () => {
                await remove();
                dialog.current?.close();
              }}
            >
              {busy ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </dialog>
      </section>
    </PageShell>
  );
}
