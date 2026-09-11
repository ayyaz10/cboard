import { useEffect, useRef, useState } from 'react';
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
import { FinancePage } from '../features/finance/FinancePage.jsx';

export default function App() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const route = useRoute();
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationError, setMigrationError] = useState('');
  const workspaceSetupRef = useRef(null);

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
        <section className="panel mx-auto mt-12 max-w-xl p-6 text-center text-lg font-bold text-black">
          Loading C Board...
        </section>
      </main>
    );
  }

  if (!isAuthenticated) {
    return <AuthPage />;
  }

  if (isMigrating) {
    return (
      <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
        <section className="panel mx-auto mt-12 max-w-xl p-6 text-center text-lg font-bold text-black">
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
          <h1 className="mt-5 text-3xl font-bold tracking-[-0.05em] text-black">
            Could not migrate local data
          </h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-black/70">
            {migrationError}
          </p>
        </section>
      </main>
    );
  }

  if (route === '/login') {
    return (
      <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
        <section className="panel mx-auto mt-12 max-w-xl p-6 text-center text-lg font-bold text-black">
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

  if (route === '/finance') return <FinancePage key={user.id} />;

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
