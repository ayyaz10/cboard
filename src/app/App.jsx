import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AppBoard } from '../components/pages/AppBoard';
import { AuthPage } from '../components/pages/AuthPage';
import { LandingPage } from '../components/pages/LandingPage';
import { NotFoundPage } from '../components/pages/NotFoundPage';
import { ToolLayout } from '../components/layout/ToolLayout';
import { useAuth } from '../contexts/AuthContext';
import { migrateLocalStorageData } from '../services/dataMigrationService';
import { navigateTo, useRoute } from './useRoute';
import { observeWorkspaceSetup } from './workspaceSetup';
import { CalculatorBoard } from '../features/calculators/CalculatorBoard';
import {
  calculators,
  findCalculatorByPath,
} from '../features/calculators/registry';
import { ProgressTracker } from '../features/progressTracker/ProgressTracker';
import { FocusTimerPage } from '../features/focusTimer/FocusTimerPage';
import { NotebookPage } from '../features/notebook/NotebookPage';
import { Recipes } from '../features/recipes/Recipes';
import { Groceries } from '../features/groceries/Groceries';
import { WeightProgress } from '../features/weightProgress/WeightProgress.jsx';
import { FinancePage } from '../features/finance/FinancePage.jsx';
import { ProfilePage } from '../components/pages/ProfilePage.jsx';
const ThemePreview = lazy(() => import('../components/pages/ThemePreview.jsx').then(module => ({ default: module.ThemePreview })));
const Training = lazy(() => import('../features/training/Training.jsx').then(module => ({ default: module.Training })));
const HabitImprovementHome = lazy(() => import('../features/drivingImprovement/HabitImprovementHome.jsx').then(module => ({ default: module.HabitImprovementHome })));
const HabitImprovementDetail = lazy(() => import('../features/drivingImprovement/DrivingImprovement.jsx').then(module => ({ default: module.HabitImprovementDetail })));

export default function App() {
  return <AppContent />;
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
        if ((key?.startsWith('habit-ui:') || key?.startsWith('habit-tree:')) && (user?.id ? !belongsToCurrentUser : !isLoading)) sessionStorage.removeItem(key);
      }
    } catch {}
  }, [user?.id, isLoading]);

  useEffect(() => {
    if (route === '/driving-improvement') navigateTo('/habit-improvement/driving-improvement', { replace: true });
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
    return <AuthPage key={route} route={route} returnTo={route} />;
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
    return <CalculatorBoard calculators={calculators} />;
  }

  if (route === '/progress-tracker') {
    return <ProgressTracker />;
  }

  if (route === '/notes') {
    return <NotebookPage />;
  }

  if (route === '/groceries') return <Groceries key={user.id} />;

  if (route === '/weight-progress') return <WeightProgress key={user.id} />;

  if (route === '/finance') return <FinancePage key={user.id} />;
  if (route === '/account') return <ProfilePage key={user.id} />;
  if (route === '/training') return <Suspense fallback={<main className="panel m-6 p-6" role="status">Loading Training…</main>}><Training key={user.id} /></Suspense>;
  if (route === '/driving-improvement') return <main className="panel m-6 p-6" role="status">Opening Driving Improvement...</main>;
  if (route === '/habit-improvement' || route === '/habit-improvement/backlog') return <Suspense fallback={<main className="panel m-6 p-6" role="status">Loading Habit Improvement...</main>}><HabitImprovementHome key={user.id} userId={user.id} view={route.endsWith('/backlog') ? 'backlog' : 'active'} /></Suspense>;
  if (route.startsWith('/habit-improvement/')) {
    const [habitSlug, nodeId = ''] = route.slice('/habit-improvement/'.length).split('/').map(part => decodeURIComponent(part));
    return <Suspense fallback={<main className="panel m-6 p-6" role="status">Loading improvement area...</main>}><HabitImprovementDetail key={`${user.id}:${habitSlug}`} userId={user.id} habitSlug={habitSlug} nodeId={nodeId} /></Suspense>;
  }

  if (route === '/food-diary') {
    return <Recipes key={user.id} route="/recipes/diary/day" navigationPath="/food-diary" />;
  }

  if (route === '/recipes' || route.startsWith('/recipes/')) {
    return <Recipes key={user.id} route={route} />;
  }

  if (route === '/focus-timer') {
    return <FocusTimerPage />;
  }

  const activeCalculator = findCalculatorByPath(route);

  if (!activeCalculator) {
    return <NotFoundPage />;
  }

  const ActiveCalculatorComponent = activeCalculator.component;

  return (
    <ToolLayout
      activeCalculator={activeCalculator}
      calculators={calculators}
    >
      <ActiveCalculatorComponent />
    </ToolLayout>
  );
}
