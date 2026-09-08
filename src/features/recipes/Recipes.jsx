import { useEffect, useRef, useState } from 'react';
import { navigateTo, getAppHref } from '../../app/useRoute';
import { PageShell } from '../../components/layout/PageShell';
import { AppNavigation } from '../../components/layout/AppNavigation';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import {
  getRecipes,
  saveRecipe,
  saveRecipeBatch,
  deleteRecipe,
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
  const cardGrid = useRecipeCardGrid();
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [draft, setDraft] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const dialog = useRef(null);
  const deleteLock = useRef(false);
  async function refresh() {
    setLoading(true);
    setError('');
    try {
      setRecipes(await getRecipes());
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
        <RecipeCardViewControl />
        {!home && !importing && (
          <RecipeLink to="/recipes">← Recipes</RecipeLink>
        )}
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
              />
            ) : null}
            {!error && planning && <DailyMealPlanner recipes={recipes} />}
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
                  <div className="flex flex-wrap gap-3">
                    <PrimaryButton onClick={() => startImport()}>
                      Add Recipe
                    </PrimaryButton>
                    <RecipeLink to="/recipes/planner/day">
                      Daily Meal Planner
                    </RecipeLink>
                    {home && (
                      <RecipeLink to="/recipes/manage">
                        Manage Recipes
                      </RecipeLink>
                    )}
                  </div>
                </header>
                {recipes.length > 0 ? (
                  <>
                    <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
                      <label className="space-y-2 font-bold">
                        <span>Search recipes</span>
                        <input
                          type="search"
                          className="field-input"
                          placeholder="Name, ingredient or tag"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                        />
                      </label>
                      <label className="space-y-2 font-bold">
                        <span>Meal type</span>
                        <select
                          className="field-input"
                          value={category}
                          onChange={(event) => setCategory(event.target.value)}
                        >
                          <option>All</option>
                          {categories.map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <p role="status" className="text-sm text-black/70">
                      {filtered.length} recipe{filtered.length === 1 ? '' : 's'}
                    </p>
                    <div className={cardGrid}>
                      {filtered.map((item) => (
                        <div
                          key={item.slug}
                          className="flex min-w-0 flex-col gap-3"
                        >
                          <RecipeCard recipe={item} />
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
                              <button
                                className={secondaryButton}
                                onClick={() => setRemoving(item)}
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {!filtered.length && (
                      <p className="py-8 text-center">
                        No matching recipes. Try another search or meal type.
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
              <>
                <RecipePage recipe={recipe} />
                <button
                  className={secondaryButton}
                  onClick={() => startImport(recipe, true)}
                >
                  Edit Recipe
                </button>
              </>
            )}
            {!error &&
              !home &&
              !manage &&
              !importing &&
              !planning &&
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
