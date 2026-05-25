import { useEffect, useMemo, useState } from 'react';
import { AppNavigation } from '../../components/layout/AppNavigation';
import { PageShell } from '../../components/layout/PageShell';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { getGoals } from '../../services/goalService';
import {
  createNote,
  deleteNote,
  getNotes,
  subscribeToNotes,
  updateNote,
} from '../../services/noteService';
import { NotesPanel } from './NotesPanel';

export function NotebookPage() {
  const { user } = useAuth();
  const { confirm, dialog } = useConfirmDialog();
  const [notes, setNotes] = useState([]);
  const [goals, setGoals] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  async function loadNotebookData() {
    setError('');

    try {
      const [savedNotes, savedGoals] = await Promise.all([
        getNotes(),
        getGoals(),
      ]);

      setNotes(savedNotes);
      setGoals(savedGoals);
    } catch (loadError) {
      setError(loadError.message || 'Could not load notes.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadNotebookData();
  }, []);

  useEffect(() => {
    if (!user?.id) {
      return undefined;
    }

    const notesChannel = subscribeToNotes(user.id, () => {
      getNotes()
        .then(setNotes)
        .catch((noteError) => setError(noteError.message || 'Could not refresh notes.'));
    });

    return () => {
      notesChannel.unsubscribe();
    };
  }, [user?.id]);

  const linkedNoteCount = useMemo(
    () => notes.filter((note) => note.linkedGoalId).length,
    [notes],
  );

  async function handleSaveNote(note) {
    setIsSaving(true);
    setError('');

    try {
      const savedNote = notes.some((currentNote) => currentNote.id === note.id)
        ? await updateNote(note.id, note)
        : await createNote(note);

      setNotes((current) => [
        savedNote,
        ...current.filter((currentNote) => currentNote.id !== savedNote.id),
      ]);
      return savedNote;
    } catch (saveError) {
      setError(saveError.message || 'Could not save this note.');
      throw saveError;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteNote(note) {
    const confirmed = await confirm({
      title: 'Delete note?',
      message: `This removes "${note.title || 'this note'}" from your notebook.`,
      confirmLabel: 'Delete',
    });

    if (!confirmed) {
      return false;
    }

    setError('');

    try {
      await deleteNote(note.id);
      setNotes((current) => current.filter((currentNote) => currentNote.id !== note.id));
      return true;
    } catch (deleteError) {
      setError(deleteError.message || 'Could not delete this note.');
      throw deleteError;
    }
  }

  return (
    <PageShell>
      <section className="panel p-6 sm:p-8 lg:p-10">
        <AppNavigation activePath="/notes" />

        <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
          <span className="pill">Notebook</span>
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">
            {notes.length} saved / {linkedNoteCount} tracker linked
          </span>
        </div>

        <h1 className="mt-6 max-w-3xl text-4xl font-bold text-black sm:text-5xl lg:text-6xl">
          Notes that stay connected
        </h1>

        <p className="mt-3 max-w-2xl text-base font-medium leading-7 text-black/70 sm:text-lg">
          Write rich notes, attach media, and link any note back to a progress tracker.
        </p>

        {error ? (
          <p className="mt-5 rounded-[1rem] border-2 border-black bg-[#ffe0de] px-4 py-3 text-sm font-bold text-black">
            {error}
          </p>
        ) : null}

        {isLoading ? (
          <div className="mt-8 rounded-[1.75rem] border-2 border-black bg-[#fffdf8] p-6 text-lg font-bold text-black">
            Loading notebook...
          </div>
        ) : (
          <div className="mt-8">
            <NotesPanel
              notes={notes}
              goals={goals}
              onSaveNote={handleSaveNote}
              onDeleteNote={handleDeleteNote}
              isSaving={isSaving}
            />
          </div>
        )}
      </section>
      <ConfirmDialog isOpen={Boolean(dialog)} {...dialog} />
    </PageShell>
  );
}
