import { DiaryFoodAnalysis } from './DiaryFoodAnalysis';
import { DiaryRecipeConfirm } from './DiaryRecipeConfirm';
import { buildDiaryRecipe, buildDiaryRecipeUpdate } from './diaryRecipeUpdate.js';
import { saveRecipe, saveDiaryRecipeUpdate } from '../../services/recipeService';
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import {
  deleteFoodDiaryDay,
  getFoodDiary,
  saveFoodDiary,
} from "../../services/foodDiaryService";
import { getPreference, setPreference } from "../../services/preferenceService";
import { readMealRoutine } from "../recipes/mealPlanData";
import { RecipeLink } from "../recipes/RecipeComponents";
import { NutritionTotals } from "./DiaryNutrition";
import { DiaryMealEditor } from "./DiaryMealEditor";
import { DiaryReports } from "./DiaryReports";
import { DiaryCalendar } from "./DiaryCalendar";
import { DiaryMonthPicker } from "./DiaryMonthPicker";
import { DiaryFoodSources } from "./DiaryFoodSources";
import { buildSavedFoods } from '../nutrition/savedFoods.js';
import { catalogItemsFromDiaryMeal, normalizeFoodName, resolveRecipeFoodCandidate } from "../nutrition/foodCatalog.js";
import { prepareDiaryCatalogItems } from './diaryCatalog.js';
import { notify } from '../../lib/notifications.js';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.jsx';
import { useConfirmDialog } from '../../hooks/useConfirmDialog.js';
import { navigateTo } from '../../app/useRoute.js';
import {
  MEALS,
  REQUIRED_MEALS,
  canComplete,
  copyMealEntry,
  diaryTotals,
  emptyDay,
  localDate,
  mealMatchesSearch,
  newMeal,
  recipeItems,
  shiftDate,
  streaks,
  validDate,
} from "./diaryData";
import "../groceries/groceries.css";
import "./foodDiary.css";

const format = (n) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(n);

const LEGACY_FOOD_MIGRATION_KEY = 'food-library:legacy-diary-migration:v1';
function logMealSave(stage, details = {}) {
  if (import.meta.env.DEV) console.info('[meal-save]', { stage, ...details });
}

function missingCatalogFoods(days, catalog) {
  const knownNames = new Set(catalog.flatMap(food => [food.name, ...(food.aliases || [])]).map(normalizeFoodName));
  const candidates = new Map();
  const needsReview = new Set();
  [...days].sort((a, b) => String(b.date).localeCompare(String(a.date))).forEach(day => {
    (day.meals || []).forEach(meal => (meal.items || []).forEach(item => {
      const name = String(item.name || '').trim();
      const key = normalizeFoodName(name);
      if (!key || item.foodId && catalog.some(food => food.id === item.foodId) || knownNames.has(key) || candidates.has(key)) return;
      const candidate = {
        name,
        quantity: Number.isFinite(Number(item.basis)) && Number(item.basis) > 0 ? Number(item.basis) : 100,
        unit: ['g', 'ml', 'pieces', 'servings'].includes(item.nutritionUnit) ? item.nutritionUnit : 'g',
        nutrition: item.nutrition || {},
        nutrientSources: item.nutrientSources || {},
        source: item.source || { provider: 'Food diary', name },
      };
      const resolution = resolveRecipeFoodCandidate(candidate, catalog);
      if (resolution.status === 'review') { needsReview.add(name); return; }
      if (resolution.status !== 'none') { knownNames.add(key); return; }
      candidates.set(key, candidate);
    }));
  });
  return { candidates: [...candidates.values()], needsReview: [...needsReview] };
}

export function FoodDiary({ recipes, nutritionGoals, foodCatalog = [], onFoodCatalogChange, onDiaryRecipeUpdated }) {
  const { user } = useAuth();
  const { confirm: confirmDiscard, dialog: discardDialog } = useConfirmDialog();
  const [today, setToday] = useState(localDate);
  const [date, setDate] = useState(localDate);
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const [pendingRecipe, setPendingRecipe] = useState(null);
  const [legacyMigration, setLegacyMigration] = useState(null);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [recipeError, setRecipeError] = useState('');
  const [remove, setRemove] = useState(null);
  const [removeDay, setRemoveDay] = useState(null);
  const [routine, setRoutine] = useState(null);
  const [selected, setSelected] = useState([]);
  const [pastOpen, setPastOpen] = useState(false);
  const [pastSelected, setPastSelected] = useState([]);
  const [pastSearch, setPastSearch] = useState("");
  const [month, setMonth] = useState("");
  const [view, setView] = useState("day");
  const lock = useRef(false);
  const generation = useRef(0);
  const foodCatalogRef = useRef(foodCatalog);
  const recipesRef = useRef(recipes);
  foodCatalogRef.current = foodCatalog;
  recipesRef.current = recipes;
  const editorRef = useRef(null);
  const diaryTopRef = useRef(null);
  const mealsRef = useRef(null);
  const day = days.find((entry) => entry.date === date) || emptyDay(date);
  const streak = streaks(days, today);
  const foodLibrary = useMemo(() => buildSavedFoods(recipes, days, foodCatalog), [days, recipes, foodCatalog]);
  const disabled = busy || Boolean(draft) || Boolean(routine) || pastOpen;
  const allPastMeals = useMemo(() => days
    .filter((entry) => entry.date !== date)
    .flatMap((entry) => entry.meals.map((meal) => ({ entryDate: entry.date, meal })))
    .sort((left, right) => right.entryDate.localeCompare(left.entryDate)), [days, date]);
  const pastMeals = useMemo(() => allPastMeals
    .filter(({ meal }) => mealMatchesSearch(meal, pastSearch)), [allPastMeals, pastSearch]);
  const goals =
    !nutritionGoals.loading && !nutritionGoals.error
      ? nutritionGoals.goals
      : null;
  async function load() {
    const id = ++generation.current;
    setLoading(true);
    setLoadError("");
    try {
      const saved = await getFoodDiary(user.id);
      if (id === generation.current) {
        const catalogForDiary = foodCatalogRef.current;
        const currentRecipes = recipesRef.current;
        setDays(saved.map(entry => ({ ...entry, meals: entry.meals.map(meal => ({ ...meal, items: meal.items.map(item => {
          const recipePart = item.recipeOrigin?.slug && currentRecipes.find(recipe => recipe.slug === item.recipeOrigin.slug)?.ingredients.find(part => part.id === item.recipeOrigin.ingredientId);
          const candidates = catalogForDiary.filter(food => [food.name, ...(food.aliases || [])].some(name => normalizeFoodName(name) === normalizeFoodName(item.name)));
          const food = catalogForDiary.find(candidate => candidate.id === item.foodId) || catalogForDiary.find(candidate => candidate.id === recipePart?.foodId) || (candidates.length === 1 ? candidates[0] : null);
          return food ? { ...item, foodId: item.foodId || food.id, nutritionExcluded: food.nutritionTrackingEnabled === false, groceryTrackingEnabled: food.groceryTrackingEnabled !== false } : item;
        }) })) })));
        getPreference(LEGACY_FOOD_MIGRATION_KEY).then(migration => {
          if (id !== generation.current) return;
          if (migration?.version === 1 && migration.completedAt) setLegacyMigration(migration.pendingReview?.length ? { candidates: [], needsReview: migration.pendingReview, dismissed: false, completed: true, completedAt: migration.completedAt, migrated: migration.migrated || 0 } : null);
          else {
            const { candidates, needsReview } = missingCatalogFoods(saved, foodCatalogRef.current);
            setLegacyMigration(candidates.length || needsReview.length ? { candidates, needsReview, dismissed: false } : null);
          }
        }).catch(() => { /* Migration status must never block diary loading. */ });
      }
    } catch (err) {
      if (id === generation.current)
        setLoadError(err.message || "Could not load your diary.");
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    load();
    return () => {
      generation.current++;
    };
  }, [user.id]);
  useEffect(() => {
    const timer = setInterval(() => setToday(localDate()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (draft)
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [draft?.id]);
  useEffect(() => {
    if (!draft && !routine && !pastOpen) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const guardLink = (event) => {
      const link = event.target.closest?.("a[href]");
      if (
        !link ||
        link.target === "_blank" ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const destination = new URL(link.href, window.location.href);
      if (destination.href === window.location.href) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void confirmDiscard({ title: 'Discard unsaved changes?', message: 'Leaving now will discard your unsaved meal or planner selection.', confirmLabel: 'Discard changes' }).then(confirmed => {
        if (!confirmed) return;
        let path = destination.pathname;
        const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
        if (base && base !== '.' && path.startsWith(base)) path = path.slice(base.length) || '/';
        navigateTo(`${path}${destination.search}${destination.hash}`);
      });
    };
    const guardSwitcher = (event) => {
      if (event.detail?.confirmed) return;
      event.preventDefault();
      void confirmDiscard({ title: 'Discard unsaved changes?', message: 'Leaving now will discard your unsaved meal or planner selection.', confirmLabel: 'Discard changes' }).then(confirmed => {
        if (confirmed) window.dispatchEvent(new CustomEvent('workspace:navigate', { cancelable: true, detail: { path: event.detail?.path, confirmed: true } }));
      });
    };
    window.addEventListener("workspace:navigate", guardSwitcher);
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", guardLink, true);
    return () => {
      window.removeEventListener("workspace:navigate", guardSwitcher);
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", guardLink, true);
    };
  }, [draft, routine, pastOpen, confirmDiscard]);
  async function migrateLegacyDiaryFoods() {
    if (!legacyMigration || migrationBusy) return;
    setMigrationBusy(true);
    try {
      if (legacyMigration.candidates.length && !onFoodCatalogChange) throw new Error('Food library is unavailable. Try again later.');
      const pendingReview = [...legacyMigration.needsReview];
      let migrated = 0;
      for (const item of legacyMigration.candidates) {
        try {
          await onFoodCatalogChange([{ ...item, groceryTrackingEnabled: false, shoppingListEnabled: false }]);
          migrated++;
        } catch {
          pendingReview.push(item.name);
        }
      }
      await setPreference(LEGACY_FOOD_MIGRATION_KEY, {
        version: 1,
        completedAt: new Date().toISOString(),
        migrated,
        pendingReview: [...new Set(pendingReview)],
        groceryDecision: 'historical-foods-not-tracked',
      });
      setLegacyMigration(pendingReview.length ? { candidates: [], needsReview: [...new Set(pendingReview)], dismissed: false, completed: true, completedAt: new Date().toISOString(), migrated } : null);
      notify.success(`${migrated} older food${migrated === 1 ? '' : 's'} added to All Food Items. Grocery tracking remains off.${pendingReview.length ? ` ${new Set(pendingReview).size} food${new Set(pendingReview).size === 1 ? '' : 's'} remain in the review queue.` : ''}`);
    } catch (migrationError) {
      notify.error(`Today's diary is unaffected. The older-food migration could not be completed: ${migrationError.message || 'Please try again.'}`);
    } finally { setMigrationBusy(false); }
  }
  async function acknowledgeLegacyReviews() {
    if (!legacyMigration?.completed || migrationBusy) return;
    setMigrationBusy(true);
    try {
      await setPreference(LEGACY_FOOD_MIGRATION_KEY, {
        version: 1, completedAt: legacyMigration.completedAt, migrated: legacyMigration.migrated,
        pendingReview: [], groceryDecision: 'historical-foods-not-tracked',
      });
      setLegacyMigration(null);
    } catch (error) { notify.error(`Could not update the old-food review list: ${error.message || 'Please try again.'}`); }
    finally { setMigrationBusy(false); }
  }
  function dismissLegacyMigration() { setLegacyMigration(current => current ? { ...current, dismissed: true } : current); }
  async function persist(next, success) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    const id = generation.current;
    let stage = 'validating';
    logMealSave('start', { dayId: next.date, mealIds: next.meals.map(meal => meal.id) });
    try {
      let prepared = structuredClone(next);
      const catalogResolution = prepareDiaryCatalogItems(prepared.meals, foodCatalog);
      prepared.meals = catalogResolution.meals;
      const { newFoods, reviewFoods } = catalogResolution;
      logMealSave('validated', { dayId: prepared.date, unresolvedCurrentFoods: reviewFoods.length });
      stage = 'diary-write';
      logMealSave('diary-write:start', { dayId: prepared.date });
      const saved = await saveFoodDiary(
        { ...prepared, updatedAt: day.updatedAt },
        user.id,
      );
      logMealSave('diary-write:success', { dayId: saved.date, mealIds: saved.meals.map(meal => meal.id) });
      if (id !== generation.current) return false;
      setDays((previous) => [
        ...previous.filter((entry) => entry.date !== saved.date),
        saved,
      ]);
      notify.success(success);
      if (newFoods.length && onFoodCatalogChange) {
        const catalogItems = newFoods.map(item => ({
          ...(item.foodId || item.source?.foodId ? { id: item.foodId || item.source.foodId } : {}),
          name: item.name, quantity: item.basis || 100, unit: item.nutritionUnit || 'g',
          nutrition: item.nutrition || {}, nutrientSources: item.nutrientSources || {},
          source: item.source || { provider: 'Food Diary', name: item.name },
          groceryTrackingEnabled: false, shoppingListEnabled: false,
        }));
        Promise.resolve().then(() => onFoodCatalogChange(catalogItems)).catch(() =>
          notify.warning('Meal saved. One or more new foods need review before they can be added to All Food Items; the diary entry is safe.'));
      }
      const foodsToReview = [...new Set(reviewFoods)];
      if (foodsToReview.length) notify.warning(`Meal saved. ${foodsToReview.length} food${foodsToReview.length === 1 ? '' : 's'} in this meal may match existing foods; review them in All Food Items when convenient.`);
      if (saved.inventoryWarnings?.length) notify.warning([...new Set(saved.inventoryWarnings)].join(' '));
      logMealSave('complete', { dayId: saved.date });
      return true;
    } catch (err) {
      logMealSave('error', { stage, dayId: next.date, error: err?.message || 'unknown' });
      if (id === generation.current)
        { setError(err.message || "Could not save. Your draft is still here."); notify.error(err.message || 'Could not save diary entry'); }
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function selectDate(next, scroll = false) {
    if (validDate(next) && next <= today) {
      setDate(next);
      setError("");
      setRemove(null);
      setRemoveDay(null);
      setPastOpen(false);
      setPastSelected([]);
      if (scroll)
        window.requestAnimationFrame(() =>
          (scroll === "meals" ? mealsRef.current : diaryTopRef.current)?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          }),
        );
    }
  }
  async function deleteDay(entry) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const id = generation.current;
    try {
      await deleteFoodDiaryDay(entry, user.id);
      if (id !== generation.current) return;
      setDays((previous) => previous.filter((item) => item.date !== entry.date));
      setRemoveDay(null);
      notify.success(`${entry.date} was removed from meal history`);
    } catch (err) {
      if (id === generation.current)
        { setError(err.message || "Could not delete this diary day."); notify.error(err.message || 'Could not delete diary day'); }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function saveMeal(meal) {
    setRecipeError('');
    setPendingRecipe({ meal: structuredClone(meal), initial: structuredClone(day.meals.find(entry => entry.id === meal.id)), diarySaved: false, savedRecipe: null });
  }
  async function confirmMeal(recipe, selections, share, newRecipe) {
    if (lock.current || !pendingRecipe) return;
    const { meal } = pendingRecipe;
    let recipeWasSaved = Boolean(pendingRecipe.savedRecipe);
    logMealSave('recipe-flow:start', { mealId: meal.id, recipeSlug: recipe?.slug || null, newRecipe: Boolean(newRecipe) });
    setRecipeError('');
    let prepared;
    try {
      prepared = pendingRecipe.savedRecipe || (newRecipe ? buildDiaryRecipe(meal, recipes, newRecipe) : recipe ? buildDiaryRecipeUpdate(recipe, meal, selections, share) : null);
    } catch (err) { setRecipeError(err.message); notify.error(err.message || 'Could not prepare the recipe update'); return; }
    if (!pendingRecipe.diarySaved) {
      const exists = day.meals.some(entry => entry.id === meal.id);
      if (!await persist({ ...day,
        meals: exists ? day.meals.map(entry => entry.id === meal.id ? meal : entry) : [...day.meals, meal],
        skipped: day.skipped.filter(slot => slot !== meal.meal), complete: false,
      }, 'Meal saved.')) {
        setRecipeError("Could not save today's meal. Your draft is still here; the recipe has not changed.");
        return;
      }
      setPendingRecipe(current => ({ ...current, diarySaved: true }));
    }
    if (recipe || newRecipe) {
      lock.current = true;
      setBusy(true);
      try {
        if (!pendingRecipe.savedRecipe) {
          logMealSave('recipe-update:start', { mealId: meal.id, recipeSlug: recipe?.slug || null });
          const saved = newRecipe ? await saveRecipe(prepared, null, { expectedUserId: user.id }) : await saveDiaryRecipeUpdate(prepared, user.id);
          setPendingRecipe(current => ({ ...current, savedRecipe: saved }));
          onDiaryRecipeUpdated?.(saved);
          recipeWasSaved = true;
          logMealSave('recipe-update:success', { mealId: meal.id, recipeSlug: saved.slug });
        }
        if (share && onFoodCatalogChange) {
          const selected = new Set(selections.filter(row => row.selected).map(row => row.id));
          await onFoodCatalogChange(catalogItemsFromDiaryMeal({ items: meal.items.filter(item => selected.has(item.id)).map(item => ({ ...item, source: { ...item.source, modified: true } })) }));
        }
        notify.success(`Meal saved and ${prepared.title} ${newRecipe ? 'added to Recipes' : 'updated'}${share ? '. Shared food nutrition updated too' : ''}`);
      } catch (err) {
        logMealSave('recipe-update:error', { mealId: meal.id, recipeSlug: recipe?.slug || prepared?.slug || null, error: err?.message || 'unknown' });
        setRecipeError(recipeWasSaved ? `Your meal and recipe are saved, but shared food nutrition could not be updated: ${err.message}` : `Your diary is saved, but the recipe update failed: ${err.message}`);
        notify.error(recipeWasSaved ? `Meal and recipe saved, but shared food nutrition could not be updated: ${err.message}` : `Your diary is saved, but the recipe update failed: ${err.message}`);
        return;
      } finally { lock.current = false; setBusy(false); }
    }
    setPendingRecipe(null);
    setDraft(null);
  }
  async function openRoutine() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const id = generation.current;
    try {
      const saved = await getPreference("recipes:daily-plan:v1");
      if (id !== generation.current) return;
      if (!saved) throw new Error("Save a routine in the Daily Planner first.");
      const entries = readMealRoutine(saved).entries.filter(
        (entry) => entry.slug,
      );
      if (!entries.length) throw new Error("Your saved planner has no meals.");
      setRoutine(entries);
      setSelected(
        entries
          .filter((entry) =>
            recipes.some((recipe) => recipe.slug === entry.slug),
          )
          .map((entry) => entry.id),
      );
    } catch (err) {
      if (id === generation.current) { setError(err.message); notify.error(err.message || 'Could not open saved meal plan'); }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function importRoutine() {
    try {
      const meals = routine
        .filter((entry) => selected.includes(entry.id))
        .map((entry) => {
          const recipe = recipes.find((recipe) => recipe.slug === entry.slug);
          if (!recipe)
            throw new Error("A selected recipe is no longer available.");
          return {
            ...newMeal(entry.meal),
            title: recipe.title,
            items: recipeItems(recipe, entry.portions),
          };
        });
      if (!meals.length) throw new Error("Select at least one meal to log.");
      if (
        await persist(
          {
            ...day,
            meals: [...day.meals, ...meals],
            skipped: day.skipped.filter(
              (slot) => !meals.some((entry) => entry.meal === slot),
            ),
            complete: false,
          },
          "Selected planner meals logged. You can edit each meal below.",
        )
      )
        setRoutine(null);
    } catch (err) {
      setError(err.message);
    }
  }
  async function importPastMeals() {
    const selectedMeals = allPastMeals
      .filter(({ entryDate, meal }) => pastSelected.includes(`${entryDate}:${meal.id}`))
      .map(({ meal }) => copyMealEntry(meal));
    if (!selectedMeals.length) {
      setError("Choose at least one past meal to copy.");
      return;
    }
    if (await persist({
      ...day,
      meals: [...day.meals, ...selectedMeals],
      skipped: day.skipped.filter((slot) => !selectedMeals.some((meal) => meal.meal === slot)),
      complete: false,
    }, `${selectedMeals.length} past meal${selectedMeals.length===1?'':'s'} copied to ${date}.`)) {
      setPastOpen(false);
      setPastSelected([]);
      setPastSearch("");
    }
  }
  if (loading) return <p role="status">Loading your food diary…</p>;
  if (loadError)
    return (
      <div role="alert">
        <p>{loadError}</p>
        <button onClick={load}>Retry diary</button>
      </div>
    );
  return (
    <div className="food-diary groceries">
      <header className="diary-heading">
        <div>
          <span className="pill">Everyday nutrition</span>
          <h1>Food diary</h1>
        </div>
        <RecipeLink to="/recipes/planner/day">Daily Planner</RecipeLink>
      </header>
      {legacyMigration && !legacyMigration.dismissed && <aside className="diary-legacy-migration" aria-label="Older food library update">
        <div><strong>{legacyMigration.completed ? 'Older foods needing review' : 'Older diary foods'}</strong><p>{legacyMigration.completed ? `${legacyMigration.needsReview.length} older food${legacyMigration.needsReview.length === 1 ? '' : 's'} could not be matched safely. They remain in diary history and were not added to Groceries.` : `${legacyMigration.candidates.length} can be added to All Food Items; ${legacyMigration.needsReview.length} need duplicate review. This does not affect today's meal saves. Grocery tracking will stay off for migrated foods.`}</p>
          {legacyMigration.needsReview.length > 0 && <details><summary>Show foods needing review</summary><ul>{legacyMigration.needsReview.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}</ul></details>}
        </div>
        <div className="diary-actions">{legacyMigration.completed ? <><RecipeLink to="/recipes/library/items">Go to food library</RecipeLink><button type="button" disabled={migrationBusy} onClick={acknowledgeLegacyReviews}>Mark review handled</button></> : <button type="button" className="diary-primary" disabled={migrationBusy} onClick={migrateLegacyDiaryFoods}>{migrationBusy ? 'Adding foods…' : 'Add unique foods'}</button>}<button type="button" disabled={migrationBusy} onClick={dismissLegacyMigration}>Review later</button></div>
      </aside>}
      <nav className="diary-view-tabs" role="tablist" aria-label="Food diary views">
        <button
          type="button"
          role="tab"
          aria-selected={view === "day"}
          disabled={view !== "day" && disabled}
          onClick={() => setView("day")}
        >
          Day log
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "sources"}
          disabled={view !== "sources" && disabled}
          onClick={() => setView("sources")}
        >
          Food sources
        </button>
      </nav>
      {view === "day" && <section className="diary-streak" aria-label="Logging streak">
        <div>
          <strong>{streak.current}</strong>
          <span>day logging streak</span>
        </div>
        <p>
          Best: <b>{streak.longest} days</b> · {streak.completed} completed days
        </p>
      </section>}
      <div className="diary-datebar" ref={diaryTopRef}>
        <button
          type="button"
          disabled={disabled || date <= "2000-01-01"}
          aria-label="Previous diary day"
          onClick={() => selectDate(shiftDate(date, -1))}
        >
          ←
        </button>
        <DiaryCalendar
          date={date}
          today={today}
          days={days}
          target={goals?.calories}
          disabled={disabled}
          onSelect={selectDate}
        />
        <button
          type="button"
          disabled={disabled || date >= today}
          aria-label="Next diary day"
          onClick={() => selectDate(shiftDate(date, 1))}
        >
          →
        </button>
        <button
          type="button"
          disabled={disabled || date === today}
          onClick={() => selectDate(today)}
        >
          Today
        </button>
      </div>
      {view === "sources" ? (
        <DiaryFoodSources meals={day.meals} goals={goals} date={date} today={today} disabled={disabled} foodCatalog={foodCatalog} onSaveAlternativeFood={item => onFoodCatalogChange?.([item])} onApplyChanges={meals => persist({ ...day, meals, complete: day.complete && canComplete({ ...day, meals }) }, 'What-if changes applied to this day.')} />
      ) : <>
      <DiaryReports
        days={days}
        date={date}
        today={today}
        goals={goals}
        disabled={disabled}
        onSelectDate={selectDate}
      />
      <section className="diary-panel" aria-label="Daily nutrition totals">
        <div className="diary-section-heading">
          <h2>{date === today ? "Today’s" : date} nutrition</h2>
          <span className="pill">
            {day.complete ? "Day complete" : "Day in progress"}
          </span>
        </div>
        <DiaryFoodAnalysis key={date} meals={day.meals} />
        <NutritionTotals
          meals={day.meals}
          goals={goals}
        />
      </section>
      {error && (
        <div className="diary-error" role="alert">
          <p>{error}</p>
          <button type="button" disabled={busy} onClick={load}>
            Reload saved diary (keep meal draft)
          </button>
        </div>
      )}
      {!draft && !routine && !pastOpen && (
        <div className="diary-actions">
          <button
            className="diary-primary"
            type="button"
            disabled={busy}
            onClick={() => {
              setDraft(newMeal());
              setError("");
            }}
          >
            Log a meal
          </button>
          <button type="button" disabled={busy} onClick={openRoutine}>
            Copy meals from planner
          </button>
          <button type="button" disabled={busy} onClick={() => { setPastOpen(true); setPastSelected([]); setError(""); }}>
            Copy a past meal
          </button>
        </div>
      )}
      {pastOpen && (
        <section className="diary-panel" aria-label="Copy past meals">
          <div className="diary-section-heading"><div><h2>Copy from meal history</h2><p>Choose any old meal to add a fresh copy to {date}.</p></div><span className="pill">{pastSelected.length} selected</span></div>
          <label className="mt-4">Search meal names or foods inside them<input type="search" value={pastSearch} onChange={(event) => setPastSearch(event.target.value)} placeholder="Tea, chicken, breakfast, no sugar…" /></label>
          <div className="diary-copy-list mt-4">
            {pastMeals.slice(0,100).map(({ entryDate, meal }) => {
              const key=`${entryDate}:${meal.id}`, totals=diaryTotals([meal]);
              return <label className="diary-copy-option" key={key}>
                <input type="checkbox" disabled={busy} checked={pastSelected.includes(key)} onChange={(event)=>setPastSelected(event.target.checked?[...pastSelected,key]:pastSelected.filter((value)=>value!==key))}/>
                <span><strong>{meal.title}</strong><small>{entryDate} · {meal.meal} · {totals.calories.known?`${format(totals.calories.value)} kcal`:'calories unknown'} · {totals.protein.known?`${format(totals.protein.value)} g protein`:'protein unknown'}</small><span className="diary-copy-foods">{meal.items.map((item)=>`${format(item.quantity)} ${item.unit} ${item.name}`).join(' · ')}</span></span>
              </label>;
            })}
            {!pastMeals.length&&<p>No matching meals are available from another day yet.</p>}
          </div>
          <div className="diary-actions"><button className="diary-primary" disabled={busy||!pastSelected.length} onClick={importPastMeals}>Copy selected to {date}</button><button disabled={busy} onClick={()=>{setPastOpen(false);setPastSelected([]);setPastSearch("")}}>Cancel</button></div>
        </section>
      )}
      {routine && (
        <section className="diary-panel" aria-label="Copy planner meals">
          <h2>Choose meals you actually ate</h2>
          <p>Adds dated copies to {date}; existing entries stay in place.</p>
          {routine.map((entry) => {
            const recipe = recipes.find((recipe) => recipe.slug === entry.slug);
            return (
              <label className="diary-check" key={entry.id}>
                <input
                  type="checkbox"
                  disabled={busy || !recipe}
                  checked={selected.includes(entry.id)}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, entry.id]
                        : selected.filter((id) => id !== entry.id),
                    )
                  }
                />
                {entry.meal}: {recipe?.title || "Recipe no longer available"} ·{" "}
                {entry.portions}×
              </label>
            );
          })}
          <div className="diary-actions">
            <button
              className="diary-primary"
              disabled={busy || !selected.length}
              onClick={importRoutine}
            >
              Save selected meals to diary
            </button>
            <button disabled={busy} onClick={() => setRoutine(null)}>
              Cancel copy
            </button>
          </div>
        </section>
      )}
      {pendingRecipe && <DiaryRecipeConfirm meal={pendingRecipe.meal} initial={pendingRecipe.initial} recipes={recipes} busy={busy}
        diarySaved={pendingRecipe.diarySaved} recipeSaved={pendingRecipe.savedRecipe} error={recipeError}
        onSave={confirmMeal} onClose={() => { if (pendingRecipe.diarySaved) setDraft(null); setPendingRecipe(null); }} />}
      {draft && (
        <div ref={editorRef}>
          <DiaryMealEditor
            foodLibrary={foodLibrary}
            key={draft.id}
            initial={draft}
            recipes={recipes}
            busy={busy}
            onSave={saveMeal}
            onDraftChange={setDraft}
            onCancel={() => {
              setDraft(null);
              setError("");
            }}
          />
        </div>
      )}
      <div className="diary-meal-sections" ref={mealsRef}>
        {MEALS.map((slot) => {
          const entries = day.meals.filter((meal) => meal.meal === slot);
          return (
            <section
              className="diary-panel"
              key={slot}
              aria-label={`${slot} entries`}
            >
              <div className="diary-section-heading">
                <h2>{slot}</h2>
                <button
                  disabled={disabled}
                  onClick={() => {
                    setDraft(newMeal(slot));
                    setError("");
                  }}
                >
                  Add {slot.toLowerCase()}
                </button>
              </div>
              {!entries.length && (
                <p>
                  {day.skipped.includes(slot)
                    ? "Marked skipped"
                    : slot === "Snack"
                      ? "No snacks logged. Optional."
                      : "No meal logged yet."}
                </p>
              )}
              {!entries.length && slot !== "Snack" && (
                <button
                  disabled={disabled}
                  onClick={() =>
                    persist(
                      {
                        ...day,
                        complete: false,
                        skipped: day.skipped.includes(slot)
                          ? day.skipped.filter((meal) => meal !== slot)
                          : [...day.skipped, slot],
                      },
                      "Meal status saved.",
                    )
                  }
                >
                  {day.skipped.includes(slot)
                    ? `Undo skipped ${slot.toLowerCase()}`
                    : `Mark ${slot.toLowerCase()} skipped`}
                </button>
              )}
              {entries.map((meal) => {
                const ingredientText = (item) =>
                  `${format(item.quantity)} ${item.unit} ${item.name}`;
                const previewItems = meal.items.slice(0, 3);
                const remainingItems = meal.items.length - previewItems.length;
                return (
                  <article className="diary-entry" key={meal.id}>
                  <h3>{meal.title}</h3>
                  {remainingItems > 0 ? (
                    <details className="diary-ingredients">
                      <summary>
                        <span>
                          {previewItems.map((item) => item.name).join(" · ")} · +{remainingItems} more
                        </span>
                        <strong>View ingredients</strong>
                      </summary>
                      <ul>
                        {meal.items.map((item) => (
                          <li key={item.id}>{ingredientText(item)}</li>
                        ))}
                      </ul>
                    </details>
                  ) : (
                    <p className="diary-ingredient-list">
                      {meal.items.map(ingredientText).join(" · ")}
                    </p>
                  )}
                  {meal.notes && <p>{meal.notes}</p>}
                  <NutritionTotals meals={[meal]} compact />
                  <div className="diary-actions">
                    <button
                      className="danger-action"
                      disabled={disabled}
                      aria-label={`Edit ${meal.title}`}
                      onClick={() => {
                        setDraft(meal);
                        setError("");
                      }}
                    >
                      Edit
                    </button>
                    <button
                      disabled={disabled}
                      aria-label={`Delete ${meal.title}`}
                      onClick={() => setRemove(meal.id)}
                    >
                      Delete
                    </button>
                  </div>
                  {remove === meal.id && (
                    <div
                      className="diary-delete"
                      role="group"
                      aria-label="Confirm meal deletion"
                    >
                      <p>Remove this meal from {date}?</p>
                      <div className="diary-actions">
                        <button
                          className="danger-action"
                          disabled={disabled}
                          onClick={async () => {
                            if (
                              await persist(
                                {
                                  ...day,
                                  meals: day.meals.filter(
                                    (entry) => entry.id !== meal.id,
                                  ),
                                  complete: false,
                                },
                                "Meal deleted.",
                              )
                            )
                              setRemove(null);
                          }}
                        >
                          Confirm delete meal
                        </button>
                        <button disabled={busy} onClick={() => setRemove(null)}>
                          Keep meal
                        </button>
                      </div>
                    </div>
                  )}
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
      <section className="diary-panel diary-finish">
        <h2>{day.complete ? "Day logged ✓" : "Ready to finish this day?"}</h2>
        {!day.complete && (
          <p>{`Record ${
                REQUIRED_MEALS.filter(
                  (slot) =>
                    !day.skipped.includes(slot) &&
                    !day.meals.some((meal) => meal.meal === slot),
                )
                  .join(", ")
                  .toLowerCase() || "any snacks, if needed"
              }, then confirm you have logged everything you ate.`}</p>
        )}
        <button
          className="diary-primary"
          disabled={disabled || (!day.complete && !canComplete(day))}
          onClick={() =>
            persist(
              { ...day, complete: !day.complete },
              day.complete
                ? "Day reopened."
                : "Day complete. Your logging streak is updated.",
            )
          }
        >
          {day.complete ? "Reopen day" : "Finish day & update streak"}
        </button>
      </section>
      <section className="diary-panel" aria-label="Meal history">
        <h2>Meal history</h2>
        <div className="diary-fields">
          <DiaryMonthPicker
            month={month}
            today={today}
            days={days}
            target={goals?.calories}
            disabled={disabled}
            onChange={setMonth}
          />
        </div>
        <div className="diary-history">
          {days
            .filter(
              (entry) =>
                (entry.meals.length || entry.skipped.length) &&
                (!month || entry.date.startsWith(month)),
            )
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((entry) => {
              const totals = diaryTotals(entry.meals);
              return (
                <article
                  className="diary-history-item"
                  key={entry.date}
                  aria-current={entry.date === date ? "date" : undefined}
                >
                  <div className="diary-history-copy">
                    <strong>
                      {entry.date}
                      {entry.complete ? " ✓" : ""}
                    </strong>
                    <span>
                      {entry.meals.length} meals ·{" "}
                      {totals.calories.known
                        ? `${format(totals.calories.value)} kcal${totals.calories.missing ? " (partial)" : ""}`
                        : "Calories unknown"}{" "}
                      ·{" "}
                      {totals.protein.known
                        ? `${format(totals.protein.value)} g protein${totals.protein.missing ? " (partial)" : ""}`
                        : "Protein unknown"}
                    </span>
                  </div>
                  <div className="diary-actions">
                    <button type="button" disabled={disabled} onClick={() => selectDate(entry.date, true)}>
                      Open & edit
                    </button>
                    <button type="button" disabled={disabled} onClick={() => {
                      selectDate(entry.date);
                      setDraft(newMeal());
                    }}>
                      Add meal
                    </button>
                    <button type="button" className="danger-action" disabled={disabled} onClick={() => setRemoveDay(entry.date)}>
                      Delete day
                    </button>
                  </div>
                  {removeDay === entry.date && (
                    <div className="diary-delete" role="group" aria-label={`Confirm deletion of ${entry.date}`}>
                      <p>Delete every meal saved for {entry.date}? This cannot be undone.</p>
                      <div className="diary-actions">
                        <button type="button" className="danger-action" disabled={busy} onClick={() => deleteDay(entry)}>Confirm delete day</button>
                        <button type="button" disabled={busy} onClick={() => setRemoveDay(null)}>Keep this day</button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
        </div>
        {!days.some(
          (entry) =>
            (entry.meals.length || entry.skipped.length) &&
            (!month || entry.date.startsWith(month)),
        ) && <p>No meals recorded for this period yet.</p>}
      </section>
      <details className="diary-panel diary-guide">
        <summary>How the food diary works</summary>
        <div className="diary-guide-content">
          <p><strong>Logging a day</strong></p>
          <p>Log or skip breakfast, lunch and dinner, then finish the day. Snacks are optional.</p>
          <p><strong>Streaks</strong></p>
          <p>Finished calendar days count towards your streak, including days completed later.</p>
          <p><strong>Editing</strong></p>
          <p>Editing a finished day reopens it so you can check the updated totals and finish it again.</p>
          <p><strong>Partial nutrition</strong></p>
          <p>“Known subtotal” means one or more foods are missing nutrition data; missing values are not counted as zero.</p>
        </div>
      </details>
      </>}
      <p className="diary-hint">
        Food lookup:{" "}
        <a
          href="https://world.openfoodfacts.org"
          target="_blank"
          rel="noreferrer"
        >
          Open Food Facts
        </a>{" "}
        ·{" "}
        <a
          href="https://opendatacommons.org/licenses/odbl/1-0/"
          target="_blank"
          rel="noreferrer"
        >
          ODbL
        </a>
        . Match preparation and check the label; vitamin and mineral coverage
        varies.
      </p>
      <ConfirmDialog isOpen={Boolean(discardDialog)} {...discardDialog} />
    </div>
  );
}
