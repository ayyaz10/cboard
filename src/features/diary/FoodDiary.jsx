import { DiaryFoodAnalysis } from './DiaryFoodAnalysis';
import { DiaryRecipeConfirm } from './DiaryRecipeConfirm';
import { buildDiaryRecipe, buildDiaryRecipeUpdate } from './diaryRecipeUpdate.js';
import { saveRecipe, saveDiaryRecipeUpdate } from '../../services/recipeService';
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import {
  deleteFoodDiaryDay,
  getCachedFoodDiary,
  getFoodDiary,
  getFoodDiaryDays,
  saveFoodDiary,
} from "../../services/foodDiaryService";
import { loadWeightForDate } from '../../services/weightService.js';
import { DEFAULT_WEIGHT_FOOD_PAIRING, getWeightDateForFoodDiary, normalizeWeightFoodPairing, WEIGHT_FOOD_PAIRING_KEY } from '../../services/weightFoodPairing.js';
import { getPreference, setPreference } from "../../services/preferenceService";
import { readMealRoutine } from "../recipes/mealPlanData";
import { RecipeLink, secondaryButton } from "../recipes/RecipeComponents";
import { NutritionTotals } from "./DiaryNutrition";
import { DiaryMealEditor } from "./DiaryMealEditor";
import { DiaryMealSection } from "./DiaryMealSection.jsx";
import { appendCopiedMeals, moveDiaryMeal, removeDiaryFood, removeDiaryMeal } from './diaryMutations.js';
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
import { getAppHref, navigateTo } from '../../app/useRoute.js';
import {
  MEALS,
  REQUIRED_MEALS,
  canComplete,
  diaryTotals,
  emptyDay,
  localDate,
  mealMatchesSearch,
  itemNutrition,
  newMeal,
  recipeItems,
  recipeDiaryMeal,
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
  const initialDiary = useRef(undefined);
  if (initialDiary.current === undefined) initialDiary.current = getCachedFoodDiary(user.id);
  const [today, setToday] = useState(localDate);
  const [date, setDate] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('date');
    return validDate(requested) && requested <= localDate() ? requested : localDate();
  });
  const [pairingMode, setPairingMode] = useState(DEFAULT_WEIGHT_FOOD_PAIRING);
  const [pairingReady, setPairingReady] = useState(false);
  const [pairingError, setPairingError] = useState('');
  const [linkedWeight, setLinkedWeight] = useState({ date: null, entry: null, loading: false, error: '' });
  const [days, setDays] = useState(() => initialDiary.current || []);
  const [loading, setLoading] = useState(() => initialDiary.current == null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const [focusFoodId, setFocusFoodId] = useState(null);
  const [recipeQuickAdd, setRecipeQuickAdd] = useState(null);
  const recipeQuickAddConsumed = useRef(false);
  const recipeQuickAddSaving = useRef(false);
  const [pendingRecipe, setPendingRecipe] = useState(null);
  const [legacyMigration, setLegacyMigration] = useState(null);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [recipeError, setRecipeError] = useState('');
  const [copyOpen, setCopyOpen] = useState(false);
  const [removeDay, setRemoveDay] = useState(null);
  const [routine, setRoutine] = useState(null);
  const [selected, setSelected] = useState([]);
  const [pastOpen, setPastOpen] = useState(false);
  const [pastSelected, setPastSelected] = useState(null);
  const [copyingMeal, setCopyingMeal] = useState(false);
  const [expandedMeals, setExpandedMeals] = useState({});
  const [postCopyEdit, setPostCopyEdit] = useState(null);
  const mealSectionRefs = useRef({});
  const [pastSearch, setPastSearch] = useState("");
  const [month, setMonth] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(100);
  const [view, setView] = useState("day");
  const [restoreScroll, setRestoreScroll] = useState(null);
  const lock = useRef(false);
  const generation = useRef(0);
  const mutationRevision = useRef(0);
  const foodCatalogRef = useRef(foodCatalog);
  const recipesRef = useRef(recipes);
  foodCatalogRef.current = foodCatalog;
  recipesRef.current = recipes;
  const editorRef = useRef(null);
  const diaryTopRef = useRef(null);
  const mealsRef = useRef(null);
  const currentDateRef = useRef(date);
  currentDateRef.current = date;
  const day = days.find((entry) => entry.date === date) || emptyDay(date);
  const relatedWeightDate = getWeightDateForFoodDiary(date, pairingMode);
  const relatedWeight = linkedWeight.date === relatedWeightDate ? linkedWeight : { date: relatedWeightDate, entry: null, loading: pairingReady, error: '' };
  const streak = streaks(days, today);
  const foodLibrary = useMemo(() => buildSavedFoods(recipes, days, foodCatalog), [days, recipes, foodCatalog]);
  const disabled = busy || Boolean(draft) || Boolean(routine) || pastOpen;
  const allPastMeals = useMemo(() => days
    .filter((entry) => entry.date !== date)
    .flatMap((entry) => entry.meals.map((meal) => ({ entryDate: entry.date, meal })))
    .sort((left, right) => right.entryDate.localeCompare(left.entryDate)), [days, date]);
  const pastMeals = useMemo(() => allPastMeals
    .filter(({ meal }) => mealMatchesSearch(meal, pastSearch)), [allPastMeals, pastSearch]);
  const visibleHistoryDays = useMemo(() => days
    .filter(entry => (entry.meals.length || entry.skipped.length) && (!month || entry.date.startsWith(month)))
    .sort((a, b) => b.date.localeCompare(a.date)), [days, month]);
  const historyDayCount = days.filter(entry => entry.meals.length || entry.skipped.length).length;
  const goals =
    !nutritionGoals.loading && !nutritionGoals.error
      ? nutritionGoals.goals
      : null;
  async function load() {
    const id = ++generation.current;
    const historyRevision = mutationRevision.current;
    if (initialDiary.current == null) setLoading(true);
    setLoadError("");
    let currentDayReady = initialDiary.current != null;
    try {
      if (!currentDayReady) {
        const currentDate = currentDateRef.current;
        const currentRows = await getFoodDiaryDays([currentDate], user.id);
        if (id !== generation.current) return;
        setDays(previous => previous.some(entry => entry.date === currentDate)
          ? previous
          : [...previous, currentRows[0] || emptyDay(currentDate)]);
        currentDayReady = true;
        setLoading(false);
      }
      const saved = await getFoodDiary(user.id);
      if (id === generation.current) {
        const catalogForDiary = foodCatalogRef.current;
        const currentRecipes = recipesRef.current;
        const normalized = saved.map(entry => ({
          ...entry,
          meals: entry.meals.map(meal => ({
            ...meal,
            items: meal.items.map(item => {
              const recipePart = item.recipeOrigin?.slug && currentRecipes.find(recipe => recipe.slug === item.recipeOrigin.slug)?.ingredients.find(part => part.id === item.recipeOrigin.ingredientId);
              const candidates = catalogForDiary.filter(food => [food.name, ...(food.aliases || [])].some(name => normalizeFoodName(name) === normalizeFoodName(item.name)));
              const food = catalogForDiary.find(candidate => candidate.id === item.foodId) || catalogForDiary.find(candidate => candidate.id === recipePart?.foodId) || (candidates.length === 1 ? candidates[0] : null);
              return food ? { ...item, foodId: item.foodId || food.id, nutritionExcluded: food.nutritionTrackingEnabled === false, groceryTrackingEnabled: food.groceryTrackingEnabled !== false } : item;
            }),
          })),
        }));
        setDays(previous => {
          if (mutationRevision.current === historyRevision) return normalized;
          const merged = new Map(normalized.map(entry => [entry.date, entry]));
          for (const entry of previous) merged.set(entry.date, entry);
          return [...merged.values()];
        });
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
      if (id === generation.current) {
        if (!currentDayReady) setLoadError(err.message || "Could not load your diary.");
        else setError(`Could not refresh the diary. Showing saved data. ${err.message || ''}`.trim());
      }
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
    const key = 'cboard:food-diary:return-context:v1';
    const save = () => {
      try { sessionStorage.setItem(key, JSON.stringify({ date: currentDateRef.current, scrollY: window.scrollY, savedAt: Date.now() })); }
      catch { /* Scroll restoration is a convenience and must not block navigation. */ }
    };
    const onLink = event => {
      const link = event.target.closest?.('a[href]');
      if (!link || link.target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = new URL(link.href, window.location.href);
      if (target.origin === window.location.origin && (target.pathname !== window.location.pathname || target.search !== window.location.search)) save();
    };
    const onWorkspaceNavigate = event => { if (event.detail?.path) save(); };
    document.addEventListener('click', onLink, true);
    window.addEventListener('workspace:navigate', onWorkspaceNavigate);
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (saved && Date.now() - saved.savedAt < 5 * 60_000) {
        if (validDate(saved.date) && saved.date <= localDate()) setDate(saved.date);
        setRestoreScroll(Number.isFinite(saved.scrollY) ? Math.max(0, saved.scrollY) : 0);
      } else sessionStorage.removeItem(key);
    } catch { sessionStorage.removeItem(key); }
    return () => {
      document.removeEventListener('click', onLink, true);
      window.removeEventListener('workspace:navigate', onWorkspaceNavigate);
    };
  }, []);
  useEffect(() => {
    if (loading || restoreScroll == null) return undefined;
    const key = 'cboard:food-diary:return-context:v1';
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: restoreScroll, behavior: 'instant' });
      try { sessionStorage.removeItem(key); } catch { /* Optional restoration state. */ }
      setRestoreScroll(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, restoreScroll]);
  useEffect(() => {
    let active = true;
    const syncPairing = () => getPreference(WEIGHT_FOOD_PAIRING_KEY, DEFAULT_WEIGHT_FOOD_PAIRING)
      .then(value => { if (active) { setPairingMode(normalizeWeightFoodPairing(value)); setPairingError(''); } })
      .catch(() => { if (active) { setPairingMode(DEFAULT_WEIGHT_FOOD_PAIRING); setPairingError('Pairing setting could not load. Using the recommended previous-day setting.'); } })
      .finally(() => { if (active) setPairingReady(true); });
    syncPairing();
    window.addEventListener('focus', syncPairing);
    return () => { active = false; window.removeEventListener('focus', syncPairing); };
  }, [user.id]);
  useEffect(() => {
    if (!pairingReady) return undefined;
    const relatedDate = getWeightDateForFoodDiary(date, pairingMode);
    if (!relatedDate) return undefined;
    let active = true;
    const refresh = () => {
      setLinkedWeight(current => ({ ...current, date: relatedDate, loading: true, error: '' }));
      loadWeightForDate(relatedDate, user.id)
        .then(entry => { if (active) setLinkedWeight({ date: relatedDate, entry, loading: false, error: '' }); })
        .catch(err => { if (active) setLinkedWeight({ date: relatedDate, entry: null, loading: false, error: err.message || 'Related weigh-in could not load.' }); });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [date, pairingMode, pairingReady, user.id]);
  useEffect(() => {
    const timer = setInterval(() => setToday(localDate()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (loading || recipeQuickAddConsumed.current) return;
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('recipe');
    if (!slug) return;
    recipeQuickAddConsumed.current = true;
    const recipe = recipes.find(item => item.slug === slug);
    const requestedDate = params.get('date');
    const meal = params.get('meal');
    const portions = Number(params.get('servings'));
    const requestId = params.get('requestId');
    if (recipe && /^[a-f\d-]{36}$/i.test(requestId || '') && validDate(requestedDate) && requestedDate <= localDate() && MEALS.includes(meal) && Number.isFinite(portions) && portions > 0 && portions <= 100)
      setRecipeQuickAdd({ recipe, date: requestedDate, meal, portions, requestId });
  }, [loading, recipes]);
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
      if (!pendingReview.length) setView("day");
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
      setView("day");
    } catch (error) { notify.error(`Could not update the old-food review list: ${error.message || 'Please try again.'}`); }
    finally { setMigrationBusy(false); }
  }
  function dismissLegacyMigration() { setLegacyMigration(current => current ? { ...current, dismissed: true } : current); setView("day"); }
  async function persist(next, success) {
    if (lock.current) return false;
    lock.current = true;
    mutationRevision.current++;
    setBusy(true);
    setError("");
    const id = generation.current;
    const previousDay = days.find(entry => entry.date === next.date) || emptyDay(next.date);
    let stage = 'validating';
    logMealSave('start', { dayId: next.date, mealIds: next.meals.map(meal => meal.id) });
    try {
      let prepared = structuredClone(next);
      const catalogResolution = prepareDiaryCatalogItems(prepared.meals, foodCatalog);
      prepared.meals = catalogResolution.meals;
      const { newFoods, reviewFoods } = catalogResolution;
      setDays(previous => [...previous.filter(entry => entry.date !== prepared.date), { ...prepared, updatedAt: previousDay.updatedAt }]);
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
      const linkedUpdates = catalogItemsFromDiaryMeal({
        items: prepared.meals.flatMap(meal => meal.items).filter(item => item.foodId && item.source?.modified),
      });
      if (linkedUpdates.length && onFoodCatalogChange) {
        try {
          await onFoodCatalogChange(linkedUpdates);
        } catch (catalogError) {
          notify.warning(`Meal saved, but the shared food item could not be updated: ${catalogError.message || 'Please try again.'}`);
        }
      }
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
      return saved;
    } catch (err) {
      logMealSave('error', { stage, dayId: next.date, error: err?.message || 'unknown' });
      if (id === generation.current) {
        setDays(previous => [...previous.filter(entry => entry.date !== previousDay.date), previousDay]);
        setError(err.message || "Could not save. Your draft is still here.");
        notify.error(err.message || 'Could not save diary entry');
      }
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function confirmRecipeQuickAdd() {
    if (!recipeQuickAdd || busy || recipeQuickAddSaving.current) return;
    recipeQuickAddSaving.current = true;
    const target = days.find(entry => entry.date === recipeQuickAdd.date) || emptyDay(recipeQuickAdd.date);
    const id = `recipe-${recipeQuickAdd.requestId}`;
    if (target.meals.some(entry => entry.id === id)) {
      setRecipeQuickAdd(null);
      navigateTo('/food-diary', { replace: true });
      recipeQuickAddSaving.current = false;
      return;
    }
    const meal = recipeDiaryMeal(recipeQuickAdd.recipe, { meal: recipeQuickAdd.meal, portions: recipeQuickAdd.portions, requestId: recipeQuickAdd.requestId });
    const saved = await persist({ ...target, meals: [...target.meals, meal], skipped: target.skipped.filter(slot => slot !== meal.meal), complete: false }, `${recipeQuickAdd.recipe.title} added to your diary.`);
    if (saved) { setRecipeQuickAdd(null); navigateTo('/food-diary', { replace: true }); }
    recipeQuickAddSaving.current = false;
  }
  useEffect(() => { if (recipeQuickAdd) void confirmRecipeQuickAdd(); }, [recipeQuickAdd?.recipe.slug]);
  function selectDate(next, scroll = false) {
    if (validDate(next) && next <= today) {
      setDate(next);
      setExpandedMeals({});
      const url = new URL(window.location.href);
      url.searchParams.set('date', next);
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      setError("");
      setRemoveDay(null);
      setPastOpen(false);
      setPastSelected(null);
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
    mutationRevision.current++;
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
  async function saveMeal(meal) {
    if (postCopyEdit?.mealId === meal.id) {
      if (JSON.stringify(meal) === JSON.stringify(postCopyEdit.baseline)) {
        setPostCopyEdit(null); setFocusFoodId(null); setDraft(null); setError('');
        return;
      }
      const next = { ...day, meals: day.meals.map(entry => entry.id === meal.id ? meal : entry) };
      if (await persist(next, 'Copied meal updated.')) {
        setPostCopyEdit(null); setFocusFoodId(null); setDraft(null); setError('');
      }
      return;
    }
    setRecipeError('');
    setPendingRecipe({ meal: structuredClone(meal), initial: structuredClone(day.meals.find(entry => entry.id === meal.id)), diarySaved: false, savedRecipe: null });
  }
  async function closePostCopyEditor() {
    if (!postCopyEdit) { setDraft(null); return; }
    const changed = JSON.stringify(draft) !== JSON.stringify(postCopyEdit.baseline);
    if (changed && !await confirmDiscard({ title: 'Discard edits?', message: 'The copied meal is already saved. Discard only these unsaved edits?', confirmLabel: 'Discard edits' })) return;
    setPostCopyEdit(null); setFocusFoodId(null); setDraft(null); setError('');
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
    setFocusFoodId(null);
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
  async function importPastMeals(destination) {
    if (!pastSelected || !MEALS.includes(destination) || copyingMeal || lock.current) return;
    const sourceRecord = allPastMeals.find(({ entryDate, meal }) => (entryDate + ':' + meal.id) === pastSelected.key);
    if (!sourceRecord) { setError("That source meal is no longer available. Choose another meal."); return; }
    setCopyingMeal(true);
    const source = sourceRecord.meal;
    const copiedMeal = { ...source, meal: destination };
    const next = appendCopiedMeals(day, [copiedMeal]);
    const pendingCopy = next.meals[next.meals.length - 1];
    const savedDay = await persist(next, source.title + ' copied to ' + destination + '.');
    if (savedDay) {
      const copied = savedDay.meals.find(meal => meal.id === pendingCopy.id);
      if (!copied) { setError('Meal copied, but the saved entry could not be opened for editing. Refresh the diary to continue.'); setCopyingMeal(false); return; }
      setPastOpen(false); setPastSelected(null); setPastSearch('');
      setExpandedMeals(current => ({ ...current, [destination]: true }));
      setPostCopyEdit({ mealId: copied.id, baseline: structuredClone(copied) });
      setFocusFoodId(copied.items[0]?.id || null);
      setDraft(copied);
      window.requestAnimationFrame(() => {
        const section = mealSectionRefs.current[destination];
        section?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
        section?.querySelector('.diary-meal-disclosure')?.focus({ preventScroll: true });
      });
    }
    setCopyingMeal(false);
  }
  async function deleteMealOrFood(meal, food) {
    const target = food
      ? `Remove ${food.name} from ${meal.title}?`
      : `Remove ${meal.title} and its ${meal.items.length} food ${meal.items.length === 1 ? 'entry' : 'entries'} from ${date}?`;
    if (!await confirmDiscard({ title: food ? 'Delete food?' : 'Delete meal?', message: `${target} Grocery stock will be reconciled through the usual diary save.`, confirmLabel: food ? 'Delete food' : 'Delete meal' })) return;
    const next = food ? removeDiaryFood(day, meal.id, food.id) : removeDiaryMeal(day, meal.id);
    await persist(next, food ? `${food.name} removed from the diary.` : `${meal.title} deleted.`);
  }
  async function moveMeal(meal, destination) {
    if (!MEALS.includes(destination) || destination === meal.meal || lock.current) return;
    await persist(moveDiaryMeal(day, meal.id, destination), `${meal.title} moved to ${destination}.`);
  }
  if (loading) return <div className="diary-loading" role="status" aria-label="Loading food diary">
    <span className="sr-only">Loading your food diary…</span>
    <div className="diary-skeleton diary-skeleton-date" aria-hidden="true" />
    <div className="diary-skeleton diary-skeleton-summary" aria-hidden="true" />
    <div className="diary-skeleton diary-skeleton-meals" aria-hidden="true"><i /><i /><i /><i /></div>
  </div>;
  if (loadError)
    return (
      <div role="alert">
        <p>{loadError}</p>
        <button onClick={load}>Retry diary</button>
      </div>
    );
  return (
    <div className="food-diary groceries">
      {recipeQuickAdd && <div className="recipe-cook-overlay" role="presentation"><section className="recipe-add-dialog" role="dialog" aria-modal="true" aria-labelledby="diary-recipe-add-title"><h2 id="diary-recipe-add-title">{error ? 'Could not add meal' : 'Adding recipe to your diary'}</h2><p>{recipeQuickAdd.recipe.title} · {recipeQuickAdd.portions} serving{recipeQuickAdd.portions === 1 ? '' : 's'} · {recipeQuickAdd.meal} · {recipeQuickAdd.date}</p><p>{error || 'Saving through your usual Diary and inventory flow…'}</p><div className="flex justify-end gap-2">{error && <button type="button" className={secondaryButton} disabled={busy} onClick={confirmRecipeQuickAdd}>Try again</button>}</div></section></div>}
      <header className="diary-heading">
        <div>
          <span className="pill">Everyday nutrition</span>
          <h1>Food diary</h1>
        </div>
        <RecipeLink to="/recipes/planner/day">Daily Planner</RecipeLink>
      </header>
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
        {legacyMigration && !legacyMigration.dismissed && <button
          type="button"
          role="tab"
          aria-selected={view === "review"}
          disabled={view !== "review" && disabled}
          onClick={() => setView("review")}
        >
          Food review
        </button>}
      </nav>
      {view !== "review" && <div className="diary-datebar" ref={diaryTopRef}>
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
      </div>}
      {view === "review" ? (
        <section className="diary-panel diary-review-page" role="tabpanel" aria-label="Older food review">
          <div className="diary-section-heading">
            <div><span className="pill">Food library</span><h2>{legacyMigration?.completed ? 'Older foods needing review' : 'Review older diary foods'}</h2></div>
          </div>
          <div className="diary-legacy-migration" aria-label="Older food library update">
            <div><strong>{legacyMigration?.completed ? 'These foods could not be matched safely' : 'Add older foods to your library'}</strong><p>{legacyMigration?.completed ? `${legacyMigration.needsReview.length} older food${legacyMigration.needsReview.length === 1 ? '' : 's'} remain in diary history and were not added to Groceries.` : `${legacyMigration?.candidates.length || 0} can be added to All Food Items; ${legacyMigration?.needsReview.length || 0} need duplicate review. This does not affect today's meal saves. Grocery tracking will stay off for migrated foods.`}</p>
              {!!legacyMigration?.needsReview.length && <details><summary>Show foods needing review</summary><ul>{legacyMigration.needsReview.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}</ul></details>}
            </div>
            <div className="diary-actions">{legacyMigration?.completed ? <><RecipeLink to="/recipes/library/items">Go to food library</RecipeLink><button type="button" disabled={migrationBusy} onClick={acknowledgeLegacyReviews}>Mark review handled</button></> : <button type="button" className="diary-primary" disabled={migrationBusy} onClick={migrateLegacyDiaryFoods}>{migrationBusy ? 'Adding foods…' : 'Add unique foods'}</button>}<button type="button" disabled={migrationBusy} onClick={dismissLegacyMigration}>Review later</button></div>
          </div>
        </section>
      ) : view === "sources" ? (
        <DiaryFoodSources meals={day.meals} goals={goals} date={date} today={today} disabled={disabled} foodCatalog={foodCatalog} onSaveAlternativeFood={item => onFoodCatalogChange?.([item])} onApplyChanges={meals => persist({ ...day, meals, complete: day.complete && canComplete({ ...day, meals }) }, 'What-if changes applied to this day.')} />
      ) : <>
      {!draft && !routine && !pastOpen && (
        <div className="diary-actions diary-quick-actions" aria-label="Quick meal actions">
          <button
            className="diary-primary"
            type="button"
            disabled={busy}
            onClick={() => { setFocusFoodId(null); setDraft(newMeal()); setError(""); }}
          >
            + Add food
          </button>
          <button type="button" disabled={busy} aria-expanded={copyOpen} aria-controls="diary-copy-menu" onClick={() => setCopyOpen(value => !value)}>Copy</button>
        </div>
      )}
      {copyOpen && <section className="diary-copy-menu" id="diary-copy-menu" aria-label="Copy meals">
          <button type="button" onClick={() => { setCopyOpen(false); setPastOpen(true); setPastSelected(null); setPastSearch(''); setError(""); }}>Copy from history</button>
        <button type="button" disabled={busy} onClick={() => { setCopyOpen(false); void openRoutine(); }}>Copy from Planner</button>
        <button type="button" onClick={() => setCopyOpen(false)}>Cancel</button>
      </section>}
      <section className="diary-panel" aria-label="Daily nutrition totals">
        <div className="diary-section-heading">
          <h2>{date === today ? "Today’s nutrition" : "Daily nutrition"}</h2>
          <span className="pill">
            {day.complete ? "Day complete" : "Day in progress"}
          </span>
        </div>
        <NutritionTotals
          meals={day.meals}
          goals={goals}
          dense
        />
        <div className="diary-linked-weight" aria-label="Related weigh-in">
          <div><span>{pairingMode === 'previous-day' ? 'Next morning weight' : 'Same-day weight'}</span>
            <strong>{!pairingReady ? 'Loading pairing…' : relatedWeight.loading ? 'Loading weigh-in…' : relatedWeight.error ? 'Weigh-in unavailable' : relatedWeight.entry ? `${new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(Number(relatedWeight.entry.weight_kg))} kg · ${new Intl.DateTimeFormat(undefined,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(`${relatedWeight.date}T12:00:00Z`))}` : pairingMode === 'previous-day' ? 'No next-morning weight recorded' : 'No same-day weigh-in recorded'}</strong>
            {relatedWeight.error && <small role="status">{relatedWeight.error}</small>}
            {pairingError && <small role="status">{pairingError}</small>}
          </div>
          {relatedWeight.entry && relatedWeight.date && <a href={getAppHref(`/weight-progress?date=${relatedWeight.date}`)} onClick={event=>{event.preventDefault();navigateTo(`/weight-progress?date=${relatedWeight.date}`)}}>View Weight Progress</a>}
        </div>
      </section>
      {error && (
        <div className="diary-error" role="alert">
          <p>{error}</p>
          <button type="button" disabled={busy} onClick={load}>
            Reload saved diary (keep meal draft)
          </button>
        </div>
      )}
      {busy && <p className="diary-save-status" role="status">Updating your diary…</p>}
      {pastOpen && (
        <section className="diary-panel diary-copy-sheet" aria-label="Copy a meal">
          <div className="diary-section-heading"><div><h2>{pastSelected ? 'Copy ' + pastSelected.meal.title : 'Choose a source meal'}</h2><p>{pastSelected ? 'From ' + pastSelected.entryDate + ' | To ' + date : 'Choose one meal from history to copy to ' + date + '.'}</p></div></div>
          {!pastSelected && <>
            <label className="mt-4">Search meal names or foods<input type="search" value={pastSearch} onChange={event => setPastSearch(event.target.value)} placeholder="Search foods or meal names" /></label>
            <div className="diary-copy-list mt-4">
              {pastMeals.slice(0, 100).map(({ entryDate, meal }) => {
                const key = entryDate + ':' + meal.id, totals = diaryTotals([meal]);
                return <button type="button" className="diary-copy-option" key={key} disabled={busy || copyingMeal} aria-pressed={pastSelected?.key === key} onClick={() => setPastSelected({ key, entryDate, meal })}>
                  <span><strong>{meal.title}</strong><small>{entryDate} | {meal.meal} | {totals.calories.known ? format(totals.calories.value) + ' kcal' : 'calories unknown'} | {meal.items.length} {meal.items.length === 1 ? 'food' : 'foods'}</small></span>
                </button>;
              })}
              {!pastMeals.length && <p>No meals from another day match this search.</p>}
            </div>
          </>}
          {pastSelected && <div className="diary-copy-destinations" aria-label="Choose destination meal">
            {MEALS.map(slot => <button key={slot} type="button" disabled={busy || copyingMeal} onClick={() => void importPastMeals(slot)}>{copyingMeal ? 'Copying...' : slot === 'Snack' ? 'Snacks' : slot}</button>)}
          </div>}
          {error && <p role="alert">{error}</p>}
          <div className="diary-actions"><button type="button" disabled={busy || copyingMeal} onClick={() => pastSelected ? setPastSelected(null) : (setPastOpen(false), setPastSearch(''))}>{pastSelected ? 'Back' : 'Close'}</button></div>
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
        onSave={confirmMeal} onClose={() => { if (pendingRecipe.diarySaved) { setFocusFoodId(null); setDraft(null); } setPendingRecipe(null); }} />}
      {draft && (
        <div ref={editorRef}>
          <DiaryMealEditor
            postCopyMode={Boolean(postCopyEdit)}
            foodLibrary={foodLibrary}
            key={draft.id}
            initial={draft}
            recipes={recipes}
            busy={busy}
            onSave={saveMeal}
            onDraftChange={setDraft}
            startWithFoodLookup={draft.items.length === 0}
            initialFocusFoodId={focusFoodId}
            onCancel={postCopyEdit ? closePostCopyEditor : () => {
              setFocusFoodId(null);
              setDraft(null);
              setError("");
            }}
          />
        </div>
      )}
      <div className="diary-meal-sections" ref={mealsRef}>
        {MEALS.map(slot => {
          const entries = day.meals.filter(meal => meal.meal === slot);
          return <DiaryMealSection
            key={slot}
            sectionRef={element => { mealSectionRefs.current[slot] = element; }}
            expanded={Boolean(expandedMeals[slot])}
            onToggle={() => setExpandedMeals(current => ({ ...current, [slot]: !current[slot] }))}
            slot={slot}
            entries={entries}
            totals={diaryTotals(entries)}
            skipped={day.skipped.includes(slot)}
            disabled={disabled}
            recipes={recipes}
            onAdd={() => { setFocusFoodId(null); setDraft(newMeal(slot)); setError(""); }}
            onEdit={(meal, food) => { setFocusFoodId(food?.id || null); setDraft(meal); setError(""); }}
            onDelete={(meal, food) => deleteMealOrFood(meal, food)}
            onMove={(meal, destination) => void moveMeal(meal, destination)}
            onSkip={() => persist({ ...day, complete: false, skipped: day.skipped.includes(slot) ? day.skipped.filter(meal => meal !== slot) : [...day.skipped, slot] }, 'Meal status saved.')}
          />;
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
      <section className="diary-streak" aria-label="Logging streak">
        <div><strong>{streak.current}</strong><span>day streak</span></div>
        <p>Best: <b>{streak.longest} days</b></p>
      </section>
      <DiaryFoodAnalysis key={date} meals={day.meals} />
      <details className="diary-panel diary-history-panel" open={historyOpen} onToggle={event => setHistoryOpen(event.currentTarget.open)}>
        <summary><h2>Meal history</h2><span>{historyDayCount} {historyDayCount === 1 ? 'day' : 'days'}</span></summary>
        {historyOpen && <div className="diary-history-content">
        <div className="diary-fields">
          <DiaryMonthPicker
            month={month}
            today={today}
            days={days}
            target={goals?.calories}
            disabled={disabled}
            onChange={value => { setMonth(value); setHistoryLimit(100); }}
          />
        </div>
        <div className="diary-history">
          {visibleHistoryDays
            .slice(0, historyLimit)
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
                      setFocusFoodId(null);
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
        {visibleHistoryDays.length > historyLimit && <button type="button" onClick={() => setHistoryLimit(value => value + 100)}>Load 100 more days ({visibleHistoryDays.length - historyLimit} remaining)</button>}
        </div>}
      </details>
      <DiaryReports days={days} date={date} today={today} goals={goals} disabled={disabled} onSelectDate={selectDate} />
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
