import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AppBoard } from '../components/pages/AppBoard';
import { AuthPage } from '../components/pages/AuthPage';
import { LandingPage } from '../components/pages/LandingPage';
import { NotFoundPage } from '../components/pages/NotFoundPage';
import { ToolLayout } from '../components/layout/ToolLayout';
import { useAuth } from '../contexts/AuthContext';
import { migrateLocalStorageData } from '../services/dataMigrationService';
import { getCurrentPathWithSearch, getRouteBoundaryKey, navigateTo, useRoute } from './useRoute';
import { observeWorkspaceSetup } from './workspaceSetup';
import { RouteErrorBoundary } from './RouteErrorBoundary.jsx';
const CalculatorBoard = lazy(() => import('../features/calculators/CalculatorBoard').then(module => ({ default: module.CalculatorBoard })));
import {
  calculators,
  findCalculatorByPath,
} from '../features/calculators/registry';
const ProgressTracker = lazy(() => import('../features/progressTracker/ProgressTracker').then(module => ({ default: module.ProgressTracker })));
const FocusTimerPage = lazy(() => import('../features/focusTimer/FocusTimerPage').then(module => ({ default: module.FocusTimerPage })));
const NotebookPage = lazy(() => import('../features/notebook/NotebookPage').then(module => ({ default: module.NotebookPage })));
const Recipes = lazy(() => import('../features/recipes/Recipes').then(module => ({ default: module.Recipes })));
const Groceries = lazy(() => import('../features/groceries/Groceries').then(module => ({ default: module.Groceries })));
const WeightProgress = lazy(() => import('../features/weightProgress/WeightProgress.jsx').then(module => ({ default: module.WeightProgress })));
const FinancePage = lazy(() => import('../features/finance/FinancePage.jsx').then(module => ({ default: module.FinancePage })));
const ProfilePage = lazy(() => import('../components/pages/ProfilePage.jsx').then(module => ({ default: module.ProfilePage })));
const ThemePreview = lazy(() => import('../components/pages/ThemePreview.jsx').then(module => ({ default: module.ThemePreview })));
const Training = lazy(() => import('../features/training/Training.jsx').then(module => ({ default: module.Training })));
const HabitImprovementHome = lazy(() => import('../features/drivingImprovement/HabitImprovementHome.jsx').then(module => ({ default: module.HabitImprovementHome })));
const HabitImprovementDetail = lazy(() => import('../features/drivingImprovement/DrivingImprovement.jsx').then(module => ({ default: module.HabitImprovementDetail })));

export default function App() {
  const route = useRoute();
  const boundaryKey = getRouteBoundaryKey(route);
  return <RouteErrorBoundary key={boundaryKey}><AppContent /></RouteErrorBoundary>;
}

function AppContent() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const route = useRoute();
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationError, setMigrationError] = useState('');
  const workspaceSetupRef = useRef(null);
  const cachedUserIdRef = useRef(null);

  useEffect(() => {
    const accountChanged = cachedUserIdRef.current && cachedUserIdRef.current !== user?.id;
    cachedUserIdRef.current = user?.id || null;
    if (accountChanged) import('../services/drivingImprovementService.js').then(({ clearDrivingWorkspaceCache }) => clearDrivingWorkspaceCache());
    try {
      for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = sessionStorage.key(index);
        const belongsToCurrentUser = user?.id && (key?.startsWith(`habit-ui:${user.id}:`) || key?.startsWith(`habit-tree:${user.id}:`));
        const isHabitFocusState = key === 'cboard:habit-focus-launch' || key === 'cboard:habit-focus-return';
        let focusStateBelongsToCurrentUser = false;
        if (isHabitFocusState && user?.id) { try { focusStateBelongsToCurrentUser = JSON.parse(sessionStorage.getItem(key) || 'null')?.userId === user.id; } catch {} }
        if (((key?.startsWith('habit-ui:') || key?.startsWith('habit-tree:')) && (user?.id ? !belongsToCurrentUser : !isLoading)) || (isHabitFocusState && (accountChanged || (user?.id ? !focusStateBelongsToCurrentUser : !isLoading)))) sessionStorage.removeItem(key);
      }
    } catch {}
  }, [user?.id, isLoading]);

  useEffect(() => {
    if (route === '/driving-improvement') navigateTo('/habit-improvement', { replace: true });
  }, [route]);

  useEffect(() => {
    if (!user?.id) {
      workspaceSetupRef.current = null;
      setIsMigrating(false);
      setMigrationError('');
      return undefined;
    }

    setIsMigrating(true);
    setMigrationError('');

    return observeWorkspaceSetup(
      workspaceSetupRef,
      user.id,
      migrateLocalStorageData,
      () => setIsMigrating(false),
      (error) => {
        setMigrationError(error?.message || 'Could not set up your workspace. Please refresh to try again.');
        setIsMigrating(false);
      },
    );
  }, [user?.id]);

  useEffect(() => {
    if (
      route === '/login'
      && !isLoading
      && isAuthenticated
      && !isMigrating
      && !migrationError
    ) {
      navigateTo('/board', { replace: true });
    }
  }, [isAuthenticated, isLoading, isMigrating, migrationError, route]);

  if (route === '/') {
    return <LandingPage isAuthenticated={!isLoading && isAuthenticated} />;
  }

  if (isLoading) {
    return (
      <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
        <section className="panel mx-auto mt-12 max-w-xl p-6 text-center text-lg font-bold text-[var(--color-text)]">
          Loading C Board...
        </section>
      </main>
    );
  }

  if (import.meta.env.DEV && route === '/design-system') {
    return <Suspense fallback={<main className="p-6" role="status">Loading theme preview…</main>}><ThemePreview /></Suspense>;
  }

  if (route === '/login' || route === '/forgot-password' || route === '/reset-password') {
    return <AuthPage key={route} route={route} returnTo="/board" />;
  }

  if (!isAuthenticated) {
    return <AuthPage key={route} route={route} returnTo={getCurrentPathWithSearch()} />;
  }

  if (isMigrating) {
    return (
      <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
        <section className="panel mx-auto mt-12 max-w-xl p-6 text-center text-lg font-bold text-[var(--color-text)]">
          Setting up your workspace...
        </section>
      </main>
    );
  }

  if (migrationError) {
    return (
      <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
        <section className="panel mx-auto mt-12 max-w-xl p-6">
          <span className="pill">Migration</span>
          <h1 className="mt-5 text-3xl font-bold tracking-[-0.05em] text-[var(--color-text)]">
            Could not migrate local data
          </h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-[var(--color-text-secondary)]">
            {migrationError}
          </p>
        </section>
      </main>
    );
  }

  if (route === '/login') {
    return (
      <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
        <section className="panel mx-auto mt-12 max-w-xl p-6 text-center text-lg font-bold text-[var(--color-text)]">
          Opening your dashboard...
        </section>
      </main>
    );
  }

  if (route === '/board') {
    return <AppBoard calculators={calculators} />;
  }

  if (route === '/calculators') {
    return <Suspense fallback={<RouteLoading label="Loading Calculator Tools..." />}><CalculatorBoard calculators={calculators} /></Suspense>;
  }

  if (route === '/progress-tracker') {
    return <Suspense fallback={<RouteLoading label="Loading Progress Tracker..." />}><ProgressTracker /></Suspense>;
  }

  if (route === '/notes' || route.startsWith('/notes/')) {
    const noteId = route.startsWith('/notes/') ? safeDecodePathSegment(route.slice('/notes/'.length)) : '';
    if (noteId === null || noteId.includes('/')) return <NotFoundPage />;
    return <Suspense fallback={<RouteLoading label="Loading Notes..." />}><NotebookPage noteId={noteId} /></Suspense>;
  }

  if (route === '/groceries') return <Suspense fallback={<RouteLoading label="Loading Groceries..." />}><Groceries key={user.id} /></Suspense>;

  if (route === '/weight-progress') return <Suspense fallback={<RouteLoading label="Loading Weight Progress..." />}><WeightProgress key={user.id} /></Suspense>;

  if (route === '/finance' || route.startsWith('/finance/debt/')) return <Suspense fallback={<RouteLoading label="Loading Finance..." />}><FinancePage key={user.id} userId={user.id} /></Suspense>;
  if (route === '/account') return <Suspense fallback={<RouteLoading label="Loading Profile..." />}><ProfilePage key={user.id} /></Suspense>;
  if (route === '/training') return <Suspense fallback={<main className="panel m-6 p-6" role="status">Loading Training…</main>}><Training key={user.id} /></Suspense>;
  if (route === '/driving-improvement') return <main className="panel m-6 p-6" role="status">Opening Driving Improvement...</main>;
  if (route === '/habit-improvement' || route === '/habit-improvement/backlog') return <Suspense fallback={<main className="panel m-6 p-6" role="status">Loading Habit Improvement...</main>}><HabitImprovementHome key={user.id} userId={user.id} view={route.endsWith('/backlog') ? 'backlog' : 'active'} /></Suspense>;
  if (route.startsWith('/habit-improvement/')) {
    const decoded = route.slice('/habit-improvement/'.length).split('/').map(safeDecodePathSegment);
    if (decoded.some(part => part === null) || decoded.length > 2) return <NotFoundPage />;
    const [habitSlug, nodeId = ''] = decoded;
    return <Suspense fallback={<main className="panel m-6 p-6" role="status">Loading improvement area...</main>}><HabitImprovementDetail key={`${user.id}:${habitSlug}`} userId={user.id} habitSlug={habitSlug} nodeId={nodeId} /></Suspense>;
  }

  if (route === '/food-diary') {
    return <Suspense fallback={<RouteLoading label="Loading Food Diary..." />}><Recipes key={user.id} route="/recipes/diary/day" navigationPath="/food-diary" /></Suspense>;
  }

  if (route === '/recipes' || route.startsWith('/recipes/')) {
    return <Suspense fallback={<RouteLoading label="Loading Recipes..." />}><Recipes key={user.id} route={route} /></Suspense>;
  }

  if (route === '/focus-timer') {
    return <Suspense fallback={<RouteLoading label="Loading Focus Timer..." />}><FocusTimerPage /></Suspense>;
  }

  const activeCalculator = findCalculatorByPath(route);

  if (!activeCalculator) {
    return <NotFoundPage />;
  }

  const ActiveCalculatorComponent = activeCalculator.component;

  return (
    <Suspense fallback={<RouteLoading label="Loading calculator..." />}>
    <ToolLayout
      activeCalculator={activeCalculator}
      calculators={calculators}
    >
      <ActiveCalculatorComponent />
    </ToolLayout>
    </Suspense>
  );
}

function safeDecodePathSegment(value) {
  try { return decodeURIComponent(value); } catch { return null; }
}

function RouteLoading({ label }) {
  return <main className="panel m-6 p-6" role="status">{label}</main>;
}
