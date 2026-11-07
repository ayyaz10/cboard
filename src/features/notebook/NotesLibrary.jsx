import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowLeft, Check, Copy, FilePlus2, Pin, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { getAppHref, navigateTo } from '../../app/useRoute';
import { notify } from '../../lib/notifications';
import {
  archiveNote, createNote, emptyNotesTrash, getNoteById, getNoteLibrary,
  permanentlyDeleteNote, restoreNote, setNotePinned, subscribeToNotes, trashNote, unarchiveNote, updateNote,
} from '../../services/noteService';
import { createId } from '../progressTracker/progressTrackerStorage';
import { getTextFromHtml, isSafeNoteMedia } from './noteContent';
import { getNotesLoadMessage, readNotesCache, reportNotesFailure, shouldShowNotesEmpty, writeNotesCache } from './notesLoadState';
import { NoteEditor } from './NotesPanel';
import './notesLibrary.css';

const PAGE_SIZE = 40;
const views = [
  { id: 'active', label: 'All notes' },
  { id: 'pinned', label: 'Pinned' },
  { id: 'archived', label: 'Archive' },
  { id: 'trash', label: 'Trash' },
];

function emptyNote() {
  return {
    id: createId('note'), title: '', contentHtml: '', contentText: '', linkedGoalId: '',
    tags: [], media: [], lifecycleState: 'active', stateBeforeTrash: 'active', pinnedAt: null,
    createdAt: new Date().toISOString(), isDraft: true,
  };
}

function dateLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function tagsToText(tags) {
  const source = Array.isArray(tags) ? tags.join(', ') : String(tags || '');
  return source.split(',').map((tag) => tag.trim()).filter(Boolean).join(', ');
}

function readLibraryState(userId) {
  if (!userId || typeof window === 'undefined') return {};
  try { return JSON.parse(sessionStorage.getItem(`cboard:notes-ui:${userId}`) || '{}'); }
  catch { return {}; }
}

function getEditorSignature(note) {
  return JSON.stringify({
    title: note?.title || '', contentHtml: note?.contentHtml || '', linkedGoalId: note?.linkedGoalId || '',
    tags: tagsToText(note?.tags), media: note?.media || [],
  });
}

function renderSnippet(value) {
  const pieces = String(value || '').split(/(<<MATCH>>[^]*?<<END>>)/g).filter(Boolean);
  return pieces.map((piece, index) => piece.startsWith('<<MATCH>>') && piece.endsWith('<<END>>')
    ? <mark key={index}>{piece.slice(9, -7)}</mark>
    : <span key={index}>{piece}</span>);
}

export function NotesLibrary({ userId, goals = [], initialNoteId = '' }) {
  const { confirm, dialog } = useConfirmDialog();
  const [initialUiState] = useState(() => readLibraryState(userId));
  const initialView = views.some((item) => item.id === initialUiState.view) ? initialUiState.view : 'active';
  const initialQuery = typeof initialUiState.query === 'string' ? initialUiState.query.slice(0, 160) : '';
  const initialSortBy = ['updated', 'created', 'title'].includes(initialUiState.sortBy) ? initialUiState.sortBy : 'updated';
  const [view, setView] = useState(initialView);
  const [query, setQuery] = useState(initialQuery);
  const [sortBy, setSortBy] = useState(initialSortBy);
  const [initialCachedList] = useState(() => readNotesCache(userId, { view: initialView, query: initialQuery, sortBy: initialSortBy }));
  const [notes, setNotes] = useState(initialCachedList?.notes || []);
  const [hasMore, setHasMore] = useState(Boolean(initialCachedList?.hasMore));
  const [isLifecycleAvailable, setIsLifecycleAvailable] = useState(false);
  const [isCompatibilityMode, setIsCompatibilityMode] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [lastSelectedId, setLastSelectedId] = useState(initialNoteId || initialUiState.selectedId || '');
  const [workingNote, setWorkingNote] = useState(null);
  const [tagText, setTagText] = useState('');
  const [isNewNote, setIsNewNote] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveState, setSaveState] = useState('saved');
  const [error, setError] = useState('');
  const [errorType, setErrorType] = useState('');
  const [recovered, setRecovered] = useState(false);
  const [isValidatingRecovered, setIsValidatingRecovered] = useState(false);
  const [draftStorageError, setDraftStorageError] = useState(false);
  const workingRef = useRef(null);
  const tagTextRef = useRef('');
  const savedSignature = useRef('');
  const saveLock = useRef(false);
  const recoveredOnce = useRef(false);
  const recoveredDraftId = useRef('');
  const recoveryNeedsValidation = useRef(false);
  const recoveredBaseUpdatedAt = useRef('');
  const listRequest = useRef(0);
  const notesRef = useRef(initialCachedList?.notes || []);
  const loadLibraryRef = useRef(null);
  const titleInputRef = useRef(null);
  const listRef = useRef(null);
  const restoredScroll = useRef(false);
  const detailRequest = useRef(0);

  const updateWorkingNote = useCallback((next) => {
    const value = typeof next === 'function' ? next(workingRef.current) : next;
    workingRef.current = value;
    setWorkingNote(value);
  }, []);

  async function validateRecoveredDraft() {
    const noteId = recoveredDraftId.current;
    if (!noteId || !recoveryNeedsValidation.current) return true;
    setIsValidatingRecovered(true);
    setError('');
    setErrorType('');
    const startedAt = performance.now();
    try {
      const serverNote = await getNoteById(noteId);
      if (!serverNote) {
        setError('This note is no longer available on the server. Your recovered edits remain on this device.');
        return false;
      }
      if (!recoveredBaseUpdatedAt.current || serverNote.updatedAt !== recoveredBaseUpdatedAt.current) {
        setErrorType('CONFLICT');
        setError('This note changed on the server. Your recovered edits remain on this device and were not saved over it.');
        return false;
      }
      recoveryNeedsValidation.current = false;
      updateWorkingNote((current) => current?.id === noteId ? { ...current, updatedAt: serverNote.updatedAt } : current);
      setSaveState('pending');
      return true;
    } catch (loadError) {
      const diagnostic = reportNotesFailure('draft-validation', loadError, startedAt);
      setErrorType(diagnostic.errorType);
      setError(getNotesLoadMessage(diagnostic.errorType));
      return false;
    } finally {
      setIsValidatingRecovered(false);
    }
  }

  const loadLibrary = useCallback(async ({ append = false, retry = false } = {}) => {
    const requestId = ++listRequest.current;
    if (!userId) {
      setIsLoading(false);
      setErrorType('AUTH_ERROR');
      setError(getNotesLoadMessage('AUTH_ERROR'));
      return;
    }
    if (!append) setIsLoading(true);
    else setIsLoadingMore(true);
    setIsRetrying(retry);
    setError('');
    setErrorType('');
    const startedAt = performance.now();
    try {
      const result = await getNoteLibrary({ view, query, sortBy, limit: PAGE_SIZE, offset: append ? notesRef.current.length : 0 });
      if (requestId !== listRequest.current) return;
      setIsLifecycleAvailable(result.lifecycleAvailable !== false);
      setIsCompatibilityMode(Boolean(result.compatibilityMode));
      if (result.lifecycleAvailable === false && view !== 'active') {
        setView('active');
        return;
      }
      const nextNotes = append ? [...notesRef.current, ...result.notes] : result.notes;
      notesRef.current = nextNotes;
      setNotes(nextNotes);
      setHasMore(result.hasMore);
      if (!append) writeNotesCache(userId, { view, query, sortBy }, { notes: nextNotes, hasMore: result.hasMore });
    } catch (loadError) {
      if (requestId === listRequest.current) {
        setIsLifecycleAvailable(false);
        setIsCompatibilityMode(false);
        if (view !== 'active') setView('active');
        const diagnostic = reportNotesFailure('list', loadError, startedAt);
        setErrorType(diagnostic.errorType);
        setError(getNotesLoadMessage(diagnostic.errorType));
      }
    } finally {
      if (requestId === listRequest.current) setIsLoading(false);
      if (requestId === listRequest.current) setIsLoadingMore(false);
      if (requestId === listRequest.current) setIsRetrying(false);
    }
  }, [query, sortBy, userId, view]);
  loadLibraryRef.current = loadLibrary;

  useEffect(() => {
    const cached = readNotesCache(userId, { view, query, sortBy });
    notesRef.current = cached?.notes || [];
    setNotes(cached?.notes || []);
    setHasMore(Boolean(cached?.hasMore));
    const timer = window.setTimeout(() => loadLibrary(), query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [loadLibrary, query, sortBy, userId, view]);

  useEffect(() => {
    if (!userId) return;
    try {
      sessionStorage.setItem(`cboard:notes-ui:${userId}`, JSON.stringify({
        view, query, sortBy, selectedId: lastSelectedId,
        scrollTop: listRef.current?.scrollTop || initialUiState.scrollTop || 0,
      }));
    } catch { /* UI state can fall back to defaults if browser storage is unavailable. */ }
  }, [userId, view, query, sortBy, lastSelectedId, initialUiState.scrollTop]);

  useEffect(() => {
    if (isLoading || restoredScroll.current || !listRef.current) return;
    listRef.current.scrollTop = Number(initialUiState.scrollTop) || 0;
    restoredScroll.current = true;
  }, [isLoading, notes.length, initialUiState.scrollTop]);

  useEffect(() => {
    if (!userId) return undefined;
    const refresh = (event) => {
      if (event?.detail?.noteId && event.detail.noteId === workingRef.current?.id) return;
      loadLibraryRef.current?.();
    };
    const subscription = subscribeToNotes(userId, refresh);
    window.addEventListener('notes-changed', refresh);
    return () => {
      subscription.unsubscribe();
      window.removeEventListener('notes-changed', refresh);
    };
  }, [userId]);

  useEffect(() => {
    if (recoveredOnce.current || !userId || typeof window === 'undefined') return;
    recoveredOnce.current = true;
    const prefix = `cboard:note-draft:${userId}:`;
    const snapshots = [];
    try {
      for (let index = 0; index < sessionStorage.length; index += 1) {
        const key = sessionStorage.key(index);
        if (!key?.startsWith(prefix)) continue;
        const value = JSON.parse(sessionStorage.getItem(key) || 'null');
        if (value?.note?.id && value?.savedAt) snapshots.push(value);
      }
    } catch {
      setDraftStorageError(true);
    }
    snapshots.sort((left, right) => right.savedAt - left.savedAt);
    const snapshot = snapshots[0];
    if (!snapshot) return;
    const note = { ...snapshot.note, isDraft: Boolean(snapshot.isNewNote) };
    recoveredDraftId.current = note.id;
    recoveredBaseUpdatedAt.current = snapshot.baseUpdatedAt || note.updatedAt || '';
    recoveryNeedsValidation.current = !snapshot.isNewNote;
    updateWorkingNote(note);
    tagTextRef.current = tagsToText(note.tags);
    setTagText(tagTextRef.current);
    setSelectedId(note.id);
    setIsNewNote(Boolean(snapshot.isNewNote));
    setView(note.lifecycleState === 'trashed' ? 'trash' : note.lifecycleState === 'archived' ? 'archived' : note.pinnedAt ? 'pinned' : 'active');
    savedSignature.current = snapshot.baseSignature || '';
    setSaveState(snapshot.isNewNote ? 'pending' : 'saved');
    setRecovered(true);
    if (!snapshot.isNewNote) void validateRecoveredDraft();
  }, [initialNoteId, updateWorkingNote, userId]);

  const orderedNotes = useMemo(() => notes, [notes]);

  function preserveCurrentDraft() {
    const note = workingRef.current;
    if (!note || !userId || getEditorSignature({ ...note, tags: tagText }) === savedSignature.current) return;
    try {
      sessionStorage.setItem(`cboard:note-draft:${userId}:${note.id}`, JSON.stringify({
        note: { ...note, tags: tagText }, isNewNote, savedAt: Date.now(), baseSignature: savedSignature.current, baseUpdatedAt: note.updatedAt || '',
      }));
    } catch { setDraftStorageError(true); }
  }

  useEffect(() => {
    const preserve = () => preserveCurrentDraft();
    window.addEventListener('pagehide', preserve);
    return () => window.removeEventListener('pagehide', preserve);
  }, [userId, tagText, isNewNote]);

  async function openNote(noteId) {
    const requestId = ++detailRequest.current;
    setSelectedId(noteId);
    setLastSelectedId(noteId);
    const notePath = getAppHref(`/notes/${encodeURIComponent(noteId)}`);
    if (window.location.pathname !== notePath) navigateTo(`/notes/${encodeURIComponent(noteId)}`);
    setWorkingNote(null);
    workingRef.current = null;
    setIsLoadingDetail(true);
    setError('');
    setErrorType('');
    const startedAt = performance.now();
    try {
      const note = await getNoteById(noteId);
      if (requestId !== detailRequest.current) return;
      if (!note) {
        setSelectedId('');
        setLastSelectedId('');
        if (initialNoteId) navigateTo('/notes');
        setError('This note is no longer available.');
        return;
      }
      updateWorkingNote(note);
      tagTextRef.current = tagsToText(note.tags);
      setTagText(tagTextRef.current);
      setIsNewNote(false);
      setView(note.lifecycleState === 'trashed' ? 'trash' : note.lifecycleState === 'archived' ? 'archived' : note.pinnedAt ? 'pinned' : 'active');
      savedSignature.current = getEditorSignature(note);
      setSaveState('saved');
    } catch (loadError) {
      if (requestId !== detailRequest.current) return;
      const diagnostic = reportNotesFailure('detail', loadError, startedAt);
      setErrorType(diagnostic.errorType);
      setError(diagnostic.errorType === 'QUERY_ERROR'
        ? getNotesLoadMessage(diagnostic.errorType)
        : 'Could not open this note. Your changes have not been saved. Retry by selecting it again.');
    } finally {
      if (requestId === detailRequest.current) setIsLoadingDetail(false);
    }
  }

  useEffect(() => {
    if (initialNoteId && (workingNote?.id === initialNoteId || recoveredDraftId.current === initialNoteId)) setSelectedId(initialNoteId);
    else if (initialNoteId && initialNoteId !== selectedId) openNote(initialNoteId);
    else if (!initialNoteId && selectedId && !isNewNote) { detailRequest.current += 1; setSelectedId(''); }
  }, [initialNoteId]);

  async function startNewNote() {
    if (workingNote && getEditorSignature({ ...workingNote, tags: tagText }) !== savedSignature.current) {
      preserveCurrentDraft();
      if (!await saveNote()) return;
    }
    preserveCurrentDraft();
    if (initialNoteId) navigateTo('/notes');
    const note = emptyNote();
    updateWorkingNote(note);
    tagTextRef.current = '';
    setTagText('');
    setSelectedId(note.id);
    setIsNewNote(true);
    savedSignature.current = getEditorSignature(note);
    setSaveState('saved');
    setError('');
    setRecovered(false);
    window.requestAnimationFrame(() => titleInputRef.current?.focus());
  }

  async function chooseNote(noteId) {
    if (workingNote && getEditorSignature({ ...workingNote, tags: tagText }) !== savedSignature.current) {
      preserveCurrentDraft();
      if (!await saveNote()) return;
    }
    openNote(noteId);
  }

  async function chooseView(nextView) {
    if (workingNote && getEditorSignature({ ...workingNote, tags: tagText }) !== savedSignature.current) {
      preserveCurrentDraft();
      if (!await saveNote()) return;
    }
    setView(nextView);
    setSelectedId('');
    updateWorkingNote(null);
  }

  async function saveNote() {
    const note = workingRef.current;
    if (!note) return true;
    if (recoveryNeedsValidation.current) {
      setError('Your recovered edits are waiting for the original note to load. They remain saved on this device.');
      setSaveState('error');
      return false;
    }
    if (saveLock.current) return false;
    const currentTags = tagTextRef.current;
    if (!isNewNote && getEditorSignature({ ...note, tags: currentTags }) === savedSignature.current) return true;
    const contentText = getTextFromHtml(note.contentHtml || '');
    if (!contentText && !(note.media || []).length && !note.title.trim()) {
      setError('Add a title, write something, or attach a file before saving.');
      return false;
    }
    saveLock.current = true;
    setIsSaving(true);
    setSaveState('saving');
    setError('');
    const wasNewNote = isNewNote;
    const snapshot = { ...note, contentText, title: note.title.trim(), tags: currentTags };
    const signature = getEditorSignature(snapshot);
    try {
      const saved = isNewNote
        ? await createNote(snapshot)
        : await updateNote(snapshot.id, { ...snapshot, updatedAt: note.updatedAt });
      setIsNewNote(false);
      const latest = workingRef.current;
      const latestSignature = getEditorSignature({ ...latest, tags: tagTextRef.current });
      updateWorkingNote(latestSignature === signature ? saved : { ...latest, id: saved.id, updatedAt: saved.updatedAt });
      setSelectedId(saved.id);
      setLastSelectedId(saved.id);
      savedSignature.current = signature;
      setSaveState('saved');
      setRecovered(false);
      try {
        sessionStorage.removeItem(`cboard:note-draft:${userId}:${note.id}`);
        sessionStorage.removeItem(`cboard:note-draft:${userId}:${saved.id}`);
      } catch { setDraftStorageError(true); }
      if (wasNewNote) navigateTo(`/notes/${encodeURIComponent(saved.id)}`);
      setNotes((current) => {
        const next = current.some((item) => item.id === saved.id)
          ? current.map((item) => item.id === saved.id ? { ...item, ...saved, contentPreview: saved.contentText.slice(0, 240) } : item)
          : [{ ...saved, contentPreview: saved.contentText.slice(0, 240) }, ...current];
        notesRef.current = next;
        return next;
      });
      return true;
    } catch (saveError) {
      setError(saveError.message?.includes('changed elsewhere')
        ? 'This note changed elsewhere. Your edits are preserved here; copy them before reloading.'
        : /240 characters|too large|12 tags|24 attachments|32 MB|12 MB/i.test(saveError.message || '')
          ? saveError.message
          : 'Could not save changes. Your text is still here. Try again.');
      setSaveState('error');
      return false;
    } finally {
      setIsSaving(false);
      saveLock.current = false;
    }
  }

  const workingSignature = workingNote ? getEditorSignature({ ...workingNote, tags: tagText }) : '';
  useEffect(() => {
    if (!workingNote || !selectedId || workingSignature === savedSignature.current || saveState === 'error') return undefined;
    setSaveState('pending');
    const draftValue = {
      note: { ...workingNote, tags: tagText }, isNewNote,
      savedAt: Date.now(), baseSignature: savedSignature.current,
    };
    const key = `cboard:note-draft:${userId}:${workingNote.id}`;
    const persistTimeout = window.setTimeout(() => {
      try { sessionStorage.setItem(key, JSON.stringify(draftValue)); setDraftStorageError(false); }
      catch { setDraftStorageError(true); }
    }, 180);
    const saveTimeout = window.setTimeout(saveNote, 850);
    return () => { window.clearTimeout(persistTimeout); window.clearTimeout(saveTimeout); };
  }, [workingSignature, selectedId, userId, isNewNote, isSaving, saveState]);

  async function runLifecycle(action, note = workingNote) {
    if (!note || !isLifecycleAvailable) return;
    setError('');
    const startedAt = performance.now();
    try {
      if (workingNote && workingSignature !== savedSignature.current && !await saveNote()) return;
      const current = workingRef.current || note;
      if (action === 'trash') {
        await trashNote(current.id);
        notify.info('Moved to Trash', { action: { label: 'Undo', onClick: () => restoreNote(current.id).then(() => loadLibrary()).catch(() => notify.error('Could not restore this note.')) } });
      }
      if (action === 'archive') { await archiveNote(current.id); notify.success('Note archived'); }
      if (action === 'unarchive') { await unarchiveNote(current.id); notify.success('Note restored from Archive'); }
      if (action === 'restore') { await restoreNote(current.id); notify.success('Note restored'); }
      if (action === 'pin') {
        const changedNote = await setNotePinned(current.id, !current.pinnedAt);
        if (changedNote) updateWorkingNote(changedNote);
        await loadLibrary();
        return;
      }
      if (action === 'permanent') {
        const accepted = await confirm({ title: 'Delete permanently?', message: 'This note and its attachments will be deleted and cannot be restored.', confirmLabel: 'Delete permanently' });
        if (!accepted) return;
        await permanentlyDeleteNote(current.id);
      }
      updateWorkingNote(null);
      setSelectedId('');
      await loadLibrary();
    } catch (lifecycleError) {
      const errorType = reportNotesFailure('lifecycle', lifecycleError, startedAt).errorType;
      if (errorType === 'QUERY_ERROR') setIsLifecycleAvailable(false);
      setErrorType(errorType);
      setError('Could not update this note. Refresh the library and try again.');
    }
  }

  async function duplicateCurrentNote() {
    if (workingNote && workingSignature !== savedSignature.current && !await saveNote()) return;
    const source = workingRef.current;
    if (!source) return;
    try {
      const copy = await createNote({
        ...source,
        id: createId('note'),
        title: `Copy of ${source.title.trim() || 'Untitled note'}`,
        lifecycleState: 'active', stateBeforeTrash: 'active', pinnedAt: null,
        createdAt: new Date().toISOString(), updatedAt: undefined,
      }, userId);
      setView('active');
      setQuery('');
      await openNote(copy.id);
      notify.success('Note duplicated');
    } catch {
      setError('Could not duplicate this note. Your original is unchanged.');
    }
  }

  async function handleEmptyTrash() {
    const accepted = await confirm({ title: 'Empty Trash?', message: 'Every note in Trash will be permanently deleted. This cannot be undone.', confirmLabel: 'Empty Trash' });
    if (!accepted) return;
    try { await emptyNotesTrash(); updateWorkingNote(null); setSelectedId(''); }
    catch { setError('Could not empty Trash. Try again.'); }
  }

  const isMobileDetail = Boolean(selectedId);
  const activeViewLabel = views.find((item) => item.id === view)?.label || 'Notes';

  return (
    <section className="notes-library" aria-label="Notes library">
      <div className={`notes-library-list${isMobileDetail ? ' notes-mobile-hidden' : ''}`}>
        <header className="notes-library-header">
          <div className="notes-library-heading">
            <div><span className="notes-eyebrow">Your workspace</span><h2>{activeViewLabel}</h2></div>
            <button type="button" className="notes-primary-button" onClick={startNewNote}><FilePlus2 size={17} aria-hidden="true" /> New note</button>
          </div>
          <label className="notes-search"><Search size={17} aria-hidden="true" /><span className="sr-only">Search notes</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, text, or tags" /></label>
          <nav className="notes-views" aria-label="Note views">
            {views.filter((item) => isLifecycleAvailable || item.id === 'active').map((item) => <button key={item.id} type="button" aria-pressed={view === item.id} onClick={() => chooseView(item.id)}>{item.label}</button>)}
          </nav>
          {isCompatibilityMode && <p className="notes-compatibility-notice" role="status">Your existing notes are available in read and edit mode. This database needs its Notes update; search currently matches titles, and Pin, Archive, and Trash are unavailable until then.</p>}
          <div className="notes-list-tools"><span role="status" aria-live="polite">{isLoading ? isRetrying ? 'Retrying...' : 'Loading notes...' : error && !notes.length ? 'Notes unavailable' : `${notes.length}${hasMore ? '+' : ''} notes`}</span><label>Sort<select value={sortBy} onChange={(event) => { preserveCurrentDraft(); setSortBy(event.target.value); }}><option value="updated">Recently updated</option><option value="created">Recently created</option><option value="title">Title</option></select></label></div>
        </header>
        <div className="notes-list" ref={listRef} onScroll={() => {
          if (!userId) return;
          try {
            sessionStorage.setItem(`cboard:notes-ui:${userId}`, JSON.stringify({
              view, query, sortBy, selectedId: lastSelectedId, scrollTop: listRef.current?.scrollTop || 0,
            }));
          } catch { /* UI state only; note contents remain outside this storage entry. */ }
        }}>
          {isLoading && !orderedNotes.length && <div className="notes-skeleton-list" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <div className="notes-skeleton-row" key={index}><span className="notes-skeleton notes-skeleton-title" /><span className="notes-skeleton notes-skeleton-preview" /><span className="notes-skeleton notes-skeleton-date" /></div>)}</div>}
          {error && <div className="notes-inline-error" role="alert" data-error-type={errorType}><span>{error}{orderedNotes.length > 0 ? ' Showing the last successfully loaded list.' : ''}</span><button type="button" onClick={() => loadLibrary({ retry: true })} className="underline" disabled={isLoading}>{isLoading ? 'Retrying...' : 'Retry'}</button></div>}
          {shouldShowNotesEmpty({ isLoading, error, notes: orderedNotes }) && <div className="notes-empty"><strong>{query ? 'No notes match this search' : view === 'trash' ? 'Trash is empty' : view === 'archived' ? 'No archived notes' : view === 'pinned' ? 'No pinned notes' : 'No notes yet'}</strong><span>{query ? 'Try another search.' : view === 'active' ? 'Capture ideas, plans, and anything you want to remember.' : ''}</span>{query ? <button type="button" className="notes-secondary-button" onClick={() => setQuery('')}>Clear search</button> : view === 'active' ? <button type="button" className="notes-primary-button" onClick={startNewNote}><FilePlus2 size={16} aria-hidden="true" /> New note</button> : null}</div>}
          {orderedNotes.map((note) => <button key={note.id} type="button" className="notes-list-item" aria-current={(selectedId || lastSelectedId) === note.id ? 'true' : undefined} onClick={() => chooseNote(note.id)}>
            <span className="notes-list-item-top"><strong>{note.title || 'Untitled'}</strong><span>{note.pinnedAt && <Pin size={14} aria-label="Pinned" />}{dateLabel(note.updatedAt || note.createdAt)}</span></span>
            <span className="notes-preview">{note.contentSnippet ? renderSnippet(note.contentSnippet) : 'No text preview'}</span>
            {note.tags?.length > 0 && <span className="notes-tags">{note.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</span>}
          </button>)}
          {hasMore && <button className="notes-secondary-button notes-load-more" type="button" onClick={() => loadLibrary({ append: true })} disabled={isLoading || isLoadingMore}>{isLoadingMore ? 'Loading...' : 'Load more'}</button>}
          {view === 'trash' && orderedNotes.length > 0 && <button className="notes-danger-button notes-empty-trash" type="button" onClick={handleEmptyTrash}>Empty Trash</button>}
        </div>
      </div>

      <div className={`notes-library-editor${!isMobileDetail ? ' notes-mobile-hidden' : ''}`}>
        {!selectedId && <div className="notes-editor-placeholder"><FilePlus2 size={25} aria-hidden="true" /><strong>Select a note or create one</strong><span>Your notes save automatically as you write.</span></div>}
      {selectedId && <>
          <div className="notes-editor-topbar"><button type="button" className="notes-back-button" onClick={() => { detailRequest.current += 1; if (initialNoteId) navigateTo('/notes'); else setSelectedId(''); }}><ArrowLeft size={17} aria-hidden="true" /><span>Notes</span></button>
            {workingNote && <div className="notes-actions">
              {isLifecycleAvailable && (view === 'active' || view === 'pinned') ? <><button type="button" aria-label={workingNote.pinnedAt ? 'Unpin note' : 'Pin note'} onClick={() => runLifecycle('pin')}><Pin size={17} aria-hidden="true" /></button><button type="button" aria-label="Duplicate note" onClick={duplicateCurrentNote}><Copy size={17} aria-hidden="true" /></button><button type="button" aria-label="Archive note" onClick={() => runLifecycle('archive')}><Archive size={17} aria-hidden="true" /></button><button type="button" aria-label="Move note to Trash" onClick={() => runLifecycle('trash')}><Trash2 size={17} aria-hidden="true" /></button></> : null}
              {isLifecycleAvailable && view === 'archived' && <><button type="button" aria-label="Restore from Archive" onClick={() => runLifecycle('unarchive')}><RotateCcw size={17} aria-hidden="true" /></button><button type="button" aria-label="Move note to Trash" onClick={() => runLifecycle('trash')}><Trash2 size={17} aria-hidden="true" /></button></>}
              {isLifecycleAvailable && view === 'trash' && <><button type="button" aria-label="Restore note" onClick={() => runLifecycle('restore')}><RotateCcw size={17} aria-hidden="true" /></button><button type="button" aria-label="Delete note permanently" onClick={() => runLifecycle('permanent')}><X size={17} aria-hidden="true" /></button></>}
            </div>}
          </div>
          {isLoadingDetail && <div className="notes-detail-loading" role="status">Opening note...</div>}
          {error && !workingNote && !isLoadingDetail && <p className="notes-inline-error" role="alert">{error}<button type="button" className="underline" onClick={() => openNote(selectedId)}>Retry</button></p>}
          {workingNote && <form className="notes-writing-surface" onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveNote(); } }} onSubmit={(event) => { event.preventDefault(); saveNote(); }}>
            {recovered && <p className="notes-recovered" role="status"><RotateCcw size={15} aria-hidden="true" /> Recovered an unsaved draft from this tab.</p>}
            {draftStorageError && <p className="notes-inline-error" role="status">Browser storage is full. The note remains here, but reload recovery is unavailable until storage is freed.</p>}
            <div className="notes-save-status" role="status" aria-live="polite">{saveState === 'saving' || isSaving ? 'Saving...' : saveState === 'error' ? 'Could not save. Your changes are still here.' : saveState === 'pending' ? 'Unsaved changes' : <><Check size={14} aria-hidden="true" /> Saved</>}</div>
            <input ref={titleInputRef} className="notes-title-input" aria-label="Note title" maxLength={240} placeholder="Untitled" value={workingNote.title || ''} onChange={(event) => updateWorkingNote((current) => ({ ...current, title: event.target.value }))} />
            {goals.length > 0 && <label className="notes-tag-field"><span>Progress tracker link</span><select value={workingNote.linkedGoalId || ''} onChange={(event) => updateWorkingNote((current) => ({ ...current, linkedGoalId: event.target.value }))}><option value="">No tracker</option>{goals.map((goal) => <option value={goal.id} key={goal.id}>{goal.title}</option>)}</select></label>}
            <label className="notes-tag-field"><span>Tags</span><input value={tagText} maxLength={1547} onChange={(event) => { tagTextRef.current = event.target.value; setTagText(event.target.value); }} placeholder="Add tags, separated by commas" /></label>
            <NoteEditor value={workingNote.contentHtml || ''} onChange={(contentHtml) => updateWorkingNote((current) => ({ ...current, contentHtml, contentText: getTextFromHtml(contentHtml) }))} media={workingNote.media || []} onMediaChange={(media) => updateWorkingNote((current) => ({ ...current, media }))} onError={setError} ariaLabel="Note content" />
            {workingNote.media?.length > 0 && <div className="notes-attachments"><strong>Attachments</strong>{workingNote.media.map((item) => <span key={item.id || item.name}>{isSafeNoteMedia(item) ? <a href={item.dataUrl} download={item.name}>{item.name}</a> : <span title='This legacy file type cannot be downloaded safely.'>{item.name} (unsupported)</span>}<button type='button' aria-label={'Remove ' + item.name} onClick={() => updateWorkingNote((current) => ({ ...current, media: current.media.filter((mediaItem) => mediaItem.id !== item.id) }))}><X size={13} aria-hidden='true' /></button></span>)}</div>}
            {error && <p className="notes-inline-error" role="alert">{error}{recoveryNeedsValidation.current && <button type="button" className="underline" onClick={() => validateRecoveredDraft()} disabled={isValidatingRecovered}>{isValidatingRecovered ? 'Retrying...' : 'Retry load'}</button>}</p>}
            <div className="notes-editor-footer"><span>Updated {dateLabel(workingNote.updatedAt || workingNote.createdAt)}</span><button type="submit" className="notes-secondary-button" disabled={isSaving}>{saveState === 'error' ? 'Retry save' : 'Save now'}</button></div>
          </form>}
        </>}
      </div>
      <ConfirmDialog isOpen={Boolean(dialog)} {...dialog} />
    </section>
  );
}
