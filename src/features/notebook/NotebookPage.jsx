import { useEffect, useState } from 'react';
import { AppNavigation } from '../../components/layout/AppNavigation';
import { PageShell } from '../../components/layout/PageShell';
import { useAuth } from '../../contexts/AuthContext';
import { getGoals } from '../../services/goalService';
import { NotesLibrary } from './NotesLibrary';

export function NotebookPage({ noteId = '' }) {
  const { user } = useAuth();
  const [goals, setGoals] = useState([]);
  const [goalsError, setGoalsError] = useState(false);

  useEffect(() => {
    let active = true;
    getGoals().then((savedGoals) => { if (active) { setGoals(savedGoals); setGoalsError(false); } }).catch(() => { if (active) setGoalsError(true); });
    return () => { active = false; };
  }, [user?.id]);

  return (
    <PageShell>
      <section className="panel p-4 sm:p-6 lg:p-8">
        <AppNavigation activePath="/notes" />
        <div className="mt-5 mb-5">
          <span className="pill">Notes</span>
          <h1 className="mt-3 text-3xl font-bold tracking-[-0.04em] text-[var(--color-text)] sm:text-4xl">Your notes</h1>
          <p className="mt-1 max-w-2xl text-sm font-medium leading-6 text-[var(--color-text-secondary)]">Capture, organize, find, and recover your thoughts.</p>
        </div>
        {goalsError && <p className="mb-4 rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--color-warning-soft)] px-3 py-2 text-sm font-semibold text-[var(--color-text)]" role="status">Progress tracker links could not be loaded. Notes are still available.</p>}
        <NotesLibrary key={user?.id || 'signed-out'} userId={user?.id} goals={goals} initialNoteId={noteId} />
      </section>
    </PageShell>
  );
}
