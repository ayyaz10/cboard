import { useEffect, useState } from 'react';
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
    <PageShell workspace>
      <section className="notes-page" aria-label="Notes workspace">
        <header className="notes-page-heading">
          <div><span className="pill">Notes</span><h1>Your notes</h1></div>
          <p>Capture, organize, find, and recover your thoughts.</p>
          {goalsError && <p role="status">Progress tracker links could not be loaded. Notes are still available.</p>}
        </header>
        <NotesLibrary key={user?.id || 'signed-out'} userId={user?.id} goals={goals} initialNoteId={noteId} />
      </section>
    </PageShell>
  );
}
