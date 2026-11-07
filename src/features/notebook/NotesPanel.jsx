import { useEffect, useMemo, useRef, useState } from 'react';
import { createId } from '../progressTracker/progressTrackerStorage';
import { getTextFromHtml, isSafeNoteMedia, isSafeNoteMediaType, matchesNoteSearch, sanitizeNoteHtml, sortNotes } from './noteContent';

const toolbarGroups = [
  [
    { label: 'B', title: 'Bold', command: 'bold' },
    { label: 'I', title: 'Italic', command: 'italic' },
    { label: 'U', title: 'Underline', command: 'underline' },
    { label: 'S', title: 'Strikethrough', command: 'strikeThrough' },
  ],
  [
    { label: 'UL', title: 'Bullet list', command: 'insertUnorderedList' },
    { label: 'OL', title: 'Numbered list', command: 'insertOrderedList' },
    { label: '+', title: 'Indent', command: 'indent' },
    { label: '-', title: 'Outdent', command: 'outdent' },
    { label: '"', title: 'Quote', command: 'formatBlock', value: 'blockquote' },
  ],
  [
    { label: '<', title: 'Align left', command: 'justifyLeft' },
    { label: '=', title: 'Align center', command: 'justifyCenter' },
    { label: '>', title: 'Align right', command: 'justifyRight' },
  ],
  [
    { label: 'Undo', title: 'Undo', command: 'undo' },
    { label: 'Redo', title: 'Redo', command: 'redo' },
  ],
];

const blockOptions = [
  { label: 'Paragraph', value: 'p' },
  { label: 'Heading 1', value: 'h1' },
  { label: 'Heading 2', value: 'h2' },
  { label: 'Heading 3', value: 'h3' },
  { label: 'Code block', value: 'pre' },
];

const fontSizeOptions = [
  { label: 'Small', value: '2' },
  { label: 'Normal', value: '3' },
  { label: 'Large', value: '5' },
  { label: 'Huge', value: '7' },
];

const fontFamilyOptions = [
  { label: 'Sans', value: 'Instrument Sans' },
  { label: 'Serif', value: 'Georgia' },
  { label: 'Mono', value: 'Consolas' },
  { label: 'Classic', value: 'Times New Roman' },
];

function formatDate(value) {
  if (!value) {
    return 'Draft';
  }

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function getEmptyDraft(linkedGoalId = '') {
  return {
    id: createId('note'),
    title: '',
    contentHtml: '',
    contentText: '',
    linkedGoalId,
    tags: [],
    media: [],
    createdAt: new Date().toISOString(),
    isDraft: true,
  };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function NoteEditor({
  value,
  onChange,
  media = [],
  onMediaChange = () => {},
  onError = () => {},
  compact = false,
  ariaLabel = 'Note content',
}) {
  const editorRef = useRef(null);
  const fileInputRef = useRef(null);
  const [formatState, setFormatState] = useState({});

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = sanitizeNoteHtml(value || '');
    }
  }, [value]);

  useEffect(() => {
    function updateFormatState() {
      if (!editorRef.current?.contains(document.activeElement)) {
        setFormatState({});
        return;
      }
      setFormatState({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strikeThrough: document.queryCommandState('strikeThrough'),
        insertUnorderedList: document.queryCommandState('insertUnorderedList'),
        insertOrderedList: document.queryCommandState('insertOrderedList'),
      });
    }
    document.addEventListener('selectionchange', updateFormatState);
    return () => document.removeEventListener('selectionchange', updateFormatState);
  }, []);

  function syncContent() {
    onChange(sanitizeNoteHtml(editorRef.current?.innerHTML || ''));
  }

  function runCommand(command, commandValue = null) {
    editorRef.current?.focus();
    document.execCommand(command, false, commandValue);
    syncContent();
  }

  function handleEditorKeyDown(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const commands = { b: 'bold', i: 'italic', u: 'underline' };
    if (commands[key]) {
      event.preventDefault();
      runCommand(commands[key]);
    } else if (key === 'k') {
      event.preventDefault();
      const href = window.prompt('Paste a link');
      if (href) runCommand('createLink', href);
    }
  }

  async function handleFiles(files) {
    const nextFiles = [...files];
    const nextMedia = [];
    let addedBytes = 0;

    for (const file of nextFiles) {
      if (media.length + nextMedia.length >= 24) {
        onError('A note can have up to 24 attachments.');
        continue;
      }
      if (file.size > 12 * 1024 * 1024) {
        onError(`${file.name} is larger than 12 MB.`);
        continue;
      }
      const attachmentType = file.type || 'application/octet-stream';
      if (!isSafeNoteMediaType(attachmentType)) {
        onError(`${file.name} uses a file type that Notes cannot attach safely.`);
        continue;
      }
      if (media.reduce((total, item) => total + (Number(item.size) || 0), 0) + addedBytes + file.size > 32 * 1024 * 1024) {
        onError('Attachments in a note can total up to 32 MB.');
        continue;
      }
      addedBytes += file.size;

      const dataUrl = await fileToDataUrl(file);
      const attachment = {
        id: createId('media'),
        name: file.name,
        type: attachmentType,
        size: file.size,
        dataUrl,
        createdAt: new Date().toISOString(),
      };

      nextMedia.push(attachment);

      if (file.type.startsWith('image/')) {
        runCommand(
          'insertHTML',
          `<img src="${dataUrl}" alt="${file.name}" class="note-media-block" />`,
        );
      } else if (file.type.startsWith('video/')) {
        runCommand(
          'insertHTML',
          `<video src="${dataUrl}" controls class="note-media-block"></video>`,
        );
      }
    }

    if (nextMedia.length > 0) {
      onMediaChange([...media, ...nextMedia]);
    }
  }

  function handlePaste(event) {
    const html = event.clipboardData.getData('text/html');
    const text = event.clipboardData.getData('text/plain');

    if (!html && !text) {
      return;
    }

    event.preventDefault();
    if (html) runCommand('insertHTML', sanitizeNoteHtml(html));
    else {
      editorRef.current?.focus();
      document.execCommand('insertText', false, text);
      syncContent();
    }
  }

  return (
    <div className={`min-w-0 rounded-[1.35rem] border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] p-3 ${compact ? 'habit-rich-editor' : ''}`}>
      <div className="flex flex-wrap gap-2 border-b border-[var(--border-subtle)] pb-3" role="toolbar" aria-label="Text formatting">
        <select
          className="field-input w-auto min-w-36 px-3 py-2 text-sm shadow-none"
          defaultValue="p"
          onChange={(event) => runCommand('formatBlock', event.target.value)}
          title="Text style"
          aria-label="Text style"
        >
          {blockOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>

        <select
          className="field-input w-auto min-w-28 px-3 py-2 text-sm shadow-none"
          defaultValue="3"
          onChange={(event) => runCommand('fontSize', event.target.value)}
          title="Font size"
          aria-label="Font size"
        >
          {fontSizeOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>

        <select
          className="field-input w-auto min-w-28 px-3 py-2 text-sm shadow-none"
          defaultValue="Instrument Sans"
          onChange={(event) => runCommand('fontName', event.target.value)}
          title="Font family"
          aria-label="Font family"
        >
          {fontFamilyOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>

        {toolbarGroups.map((group, groupIndex) => (
          <div key={groupIndex} className="flex gap-1">
            {group.map((item) => (
              <button
                key={item.title}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runCommand(item.command, item.value)}
                title={item.title}
                aria-label={item.title}
                aria-pressed={['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'].includes(item.command) ? Boolean(formatState[item.command]) : undefined}
                className={`min-h-11 min-w-11 rounded-full border border-[var(--border-default)] px-3 text-xs font-bold uppercase text-[var(--color-text)] transition hover:bg-[var(--surface-selected)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)] ${formatState[item.command] ? 'bg-[var(--surface-selected)]' : 'bg-[var(--surface-elevated)]'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}

        <label
          className="flex h-10 items-center gap-2 rounded-full border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-xs font-bold uppercase text-[var(--color-text)]"
          title="Text color"
          aria-label="Text color"
        >
          Text
          <input
            type="color"
            className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
            onChange={(event) => runCommand('foreColor', event.target.value)}
          />
        </label>

        <label
          className="flex h-10 items-center gap-2 rounded-full border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-xs font-bold uppercase text-[var(--color-text)]"
          title="Highlight"
          aria-label="Highlight color"
        >
          Mark
          <input
            type="color"
            className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
            defaultValue="#c5ff6f"
            onChange={(event) => runCommand('hiliteColor', event.target.value)}
          />
        </label>

        <button
          type="button"
          aria-label="Insert or edit link"
          title="Insert or edit link"
          onClick={() => {
            const href = window.prompt('Paste a link');
            if (href) {
              runCommand('createLink', href);
            }
          }}
          className="h-10 rounded-full border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-xs font-bold uppercase text-[var(--color-text)] transition hover:bg-[var(--color-accent-hover)]"
        >
          Link
        </button>

        <button
          type="button"
          aria-label="Clear formatting"
          title="Clear formatting"
          onClick={() => runCommand('removeFormat')}
          className="h-10 rounded-full border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-xs font-bold uppercase text-[var(--color-text)] transition hover:bg-[var(--color-danger-soft)]"
        >
          Clear
        </button>

        <button
          type="button"
          aria-label="Attach media or file"
          title="Attach media or file"
          onClick={() => fileInputRef.current?.click()}
          className="min-h-11 rounded-full border-2 border-[var(--border-default)] bg-[var(--surface-selected)] px-3 text-xs font-bold uppercase text-[var(--color-text)] transition hover:bg-[var(--surface-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
        >
          Media
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/*,.pdf,.txt,.md,.doc,.docx"
          className="hidden"
          onChange={(event) => {
            handleFiles(event.target.files || []).catch((fileError) => {
              onError(fileError.message || 'Could not attach this file.');
            });
            event.target.value = '';
          }}
        />
      </div>

      <div
        ref={editorRef}
        contentEditable
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline="true"
        suppressContentEditableWarning
        onInput={syncContent}
        onBlur={syncContent}
        onPaste={handlePaste}
          onKeyDown={handleEditorKeyDown}
        className={`note-editor mt-4 ${compact ? 'min-h-24' : 'min-h-80'} rounded-[1rem] border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] px-4 py-3 text-base font-medium leading-7 text-[var(--color-text)] caret-[var(--color-text)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]`}
        data-placeholder="Start writing..."
      />
    </div>
  );
}

export function NotesPanel({
  notes,
  goals = [],
  activeGoal = null,
  onSaveNote,
  onDeleteNote,
  isSaving = false,
  autoSave = false,
}) {
  const loadedNote = useRef(null);
  const [selectedNoteId, setSelectedNoteId] = useState('');
  const [draft, setDraft] = useState(null);
  const [title, setTitle] = useState('');
  const [contentHtml, setContentHtml] = useState('');
  const [linkedGoalId, setLinkedGoalId] = useState(activeGoal?.id || '');
  const [tagText, setTagText] = useState('');
  const [media, setMedia] = useState([]);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [saveState, setSaveState] = useState('saved');
  const savedSignature = useRef('');
  const saveInFlight = useRef(false);

  const sortedNotes = useMemo(() => sortNotes(notes), [notes]);
  const visibleNotes = useMemo(() => {
    return sortedNotes.filter((note) => matchesNoteSearch(note, searchQuery));
  }, [searchQuery, sortedNotes]);
  const selectedNote = draft || sortedNotes.find((note) => note.id === selectedNoteId) || null;
  const editorSignature = JSON.stringify({ title, contentHtml, linkedGoalId, tagText, media });
  const isGoalLocked = Boolean(activeGoal?.id);

  useEffect(() => {
    if (draft) {
      return;
    }

    if (sortedNotes.length === 0) {
      setSelectedNoteId('');
      return;
    }

    if (!selectedNoteId || !sortedNotes.some((note) => note.id === selectedNoteId)) {
      setSelectedNoteId(sortedNotes[0].id);
    }
  }, [draft, selectedNoteId, sortedNotes]);

  useEffect(() => {
    if (!selectedNote) {
      loadedNote.current = null;
      setTitle('');
      setContentHtml('');
      setLinkedGoalId(activeGoal?.id || '');
      setTagText('');
      setMedia([]);
      return;
    }

    const previous = loadedNote.current;
    if (previous?.id === selectedNote.id && previous.updatedAt !== selectedNote.updatedAt &&
      (title !== (previous.title || '') || contentHtml !== (previous.contentHtml || '') ||
       tagText !== (previous.tags || []).join(', ') || linkedGoalId !== (isGoalLocked ? activeGoal.id : previous.linkedGoalId || '') || JSON.stringify(media) !== JSON.stringify(previous.media || []))) {
      setError('This note changed elsewhere. Your draft is preserved. Reopen the saved note before applying these edits.');
      return;
    }
    loadedNote.current = selectedNote;
    setTitle(selectedNote.title || '');
    setContentHtml(selectedNote.contentHtml || '');
    setLinkedGoalId(isGoalLocked ? activeGoal.id : selectedNote.linkedGoalId || '');
    setTagText((selectedNote.tags || []).join(', '));
    setMedia(selectedNote.media || []);
    savedSignature.current = JSON.stringify({
      title: selectedNote.title || '',
      contentHtml: selectedNote.contentHtml || '',
      linkedGoalId: isGoalLocked ? activeGoal.id : selectedNote.linkedGoalId || '',
      tagText: (selectedNote.tags || []).join(', '),
      media: selectedNote.media || [],
    });
    setSaveState('saved');
    setError('');
  }, [activeGoal?.id, isGoalLocked, selectedNote?.id, selectedNote?.updatedAt]);

  function startNewNote() {
    const nextDraft = getEmptyDraft(activeGoal?.id || '');
    setDraft(nextDraft);
    setSelectedNoteId(nextDraft.id);
    savedSignature.current = JSON.stringify({ title: '', contentHtml: '', linkedGoalId: activeGoal?.id || '', tagText: '', media: [] });
    setSaveState('saved');
  }

  async function handleSave(event) {
    event?.preventDefault();

    if (!selectedNote || isSaving || saveInFlight.current) return;

    const nextContentHtml = sanitizeNoteHtml(contentHtml);
    const contentText = getTextFromHtml(nextContentHtml);
    const nextTitle = title.trim() || 'Untitled note';

    if (!contentText && media.length === 0) {
      setError('Write a note or attach media first.');
      return;
    }

    setError('');
    setSaveState('saving');
    const signatureAtSave = editorSignature;
    saveInFlight.current = true;

    try {
      const savedNote = await onSaveNote({
        id: selectedNote?.id || createId('note'),
        title: nextTitle,
        contentHtml: nextContentHtml,
        contentText,
        linkedGoalId: isGoalLocked ? activeGoal.id : linkedGoalId,
        tags: tagText,
        media,
        createdAt: selectedNote?.createdAt || new Date().toISOString(),
        updatedAt: loadedNote.current?.updatedAt,
      });

      loadedNote.current = savedNote;
      savedSignature.current = signatureAtSave;
      setSaveState('saved');
      setError('');
      setDraft(null);
      setSelectedNoteId(savedNote?.id || selectedNote?.id || '');
    } catch (saveError) {
      setError(saveError.message?.includes('changed elsewhere')
        ? saveError.message
        : 'Could not save changes. Your text is still here. Try again.');
      setSaveState('error');
    } finally {
      saveInFlight.current = false;
    }
  }

  useEffect(() => {
    if (!autoSave || !selectedNote || editorSignature === savedSignature.current) return undefined;
    if (!getTextFromHtml(contentHtml) && !title.trim() && media.length === 0) return undefined;

    setSaveState('pending');
    const timeout = window.setTimeout(() => handleSave(), 850);
    return () => window.clearTimeout(timeout);
  }, [autoSave, selectedNote?.id, editorSignature]);

  async function handleDelete() {
    if (!selectedNote) {
      return;
    }

    if (selectedNote.isDraft) {
      setDraft(null);
      setSelectedNoteId(sortedNotes[0]?.id || '');
      return;
    }

    try {
      const didDelete = await onDeleteNote(selectedNote);

      if (didDelete === false) {
        return;
      }

      setSelectedNoteId(sortedNotes.find((note) => note.id !== selectedNote.id)?.id || '');
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  return (
    <div className="notes-workspace grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(18rem,0.78fr)_minmax(0,1.22fr)]">
      <aside className="notes-sidebar min-w-0 rounded-[1.25rem] border-2 border-[var(--border-default)] bg-[var(--surface-secondary)] p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
              Saved notes
            </p>
              <h2 className="mt-2 text-2xl font-bold text-[var(--color-text)]">
              {isGoalLocked ? activeGoal.title : 'Notebook'}
            </h2>
          </div>
          <button
            type="button"
            onClick={startNewNote}
            className="rounded-full border-2 border-[var(--border-default)] bg-[var(--color-accent)] px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-accent-contrast)] shadow-[3px_3px_0_#000]"
          >
            New
          </button>
        </div>

        <label className="mt-5 block">
          <span className="sr-only">Search notes</span>
          <input
            className="field-input"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search notes"
            aria-label="Search notes"
          />
        </label>

        <div className="mt-3 grid gap-3">
          {draft ? (
            <button
              type="button"
              className="rounded-[1.15rem] border-2 border-[var(--border-default)] bg-[var(--color-accent)] p-4 text-left shadow-[4px_4px_0_#000]"
            >
              <span className="block text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
                Draft
              </span>
              <span className="mt-2 block text-lg font-bold text-[var(--color-text)]">
                Unsaved note
              </span>
            </button>
          ) : null}

          {visibleNotes.length === 0 && !draft ? (
            <div className="rounded-[1.15rem] border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] px-4 py-5 text-sm font-bold leading-6 text-[var(--color-text-secondary)]">
              {searchQuery ? 'No notes match this search.' : 'No notes yet.'}
            </div>
          ) : null}

          {visibleNotes.map((note) => {
            const isActive = note.id === selectedNoteId && !draft;
            const linkedGoal = goals.find((goal) => goal.id === note.linkedGoalId);

            return (
              <button
                key={note.id}
                type="button"
                onClick={() => {
                  setDraft(null);
                  setSelectedNoteId(note.id);
                }}
                className={`rounded-[1.15rem] border-2 border-[var(--border-default)] p-4 text-left transition ${
                  isActive
                    ? 'bg-[var(--color-accent)] shadow-[4px_4px_0_#000]'
                    : 'bg-[var(--surface-elevated)] hover:bg-[var(--surface-elevated)]'
                }`}
                data-active={isActive ? 'true' : undefined}
              >
                <span className="block text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
                  {formatDate(note.updatedAt || note.createdAt)}
                </span>
                <span className="mt-2 block break-words text-base font-bold text-[var(--color-text)]">
                  {note.title || 'Untitled'}
                </span>
                <span className="mt-2 line-clamp-2 block text-sm font-semibold leading-6 text-[var(--color-text-secondary)]">
                  {note.contentText || `${note.media.length} media attachment${note.media.length === 1 ? '' : 's'}`}
                </span>
                {linkedGoal ? (
                  <span className="mt-3 inline-flex rounded-full border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-text)]">
                    {linkedGoal.title}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </aside>

      <section className="notes-editor-panel min-w-0 rounded-[1.25rem] border-2 border-[var(--border-default)] bg-[var(--surface-secondary)] p-3 sm:p-4">
        {selectedNote ? (
          <form onSubmit={handleSave} className="grid gap-4">
            {autoSave ? (
              <p className="text-xs font-semibold text-[var(--color-text-muted)]" role="status" aria-live="polite">
                {saveState === 'saving' || isSaving ? 'Saving…' : saveState === 'pending' ? 'Unsaved changes' : saveState === 'error' ? 'Couldn’t save changes. Your text is still here.' : 'Saved'}
              </p>
            ) : null}
            <div className="grid gap-4 md:grid-cols-[1fr_0.65fr]">
              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
                  Title
                </span>
                <input
                  className="field-input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Untitled note"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
                  Tracker link
                </span>
                <select
                  className="field-input"
                  value={linkedGoalId}
                  onChange={(event) => setLinkedGoalId(event.target.value)}
                  disabled={isGoalLocked}
                >
                  <option value="">No tracker</option>
                  {goals.map((goal) => (
                    <option key={goal.id} value={goal.id}>{goal.title}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
                Tags
              </span>
              <input
                className="field-input"
                value={tagText}
                onChange={(event) => setTagText(event.target.value)}
                placeholder="ideas, planning, learning"
              />
            </label>

            <NoteEditor
              value={contentHtml}
              onChange={setContentHtml}
              media={media}
              onMediaChange={setMedia}
              onError={setError}
            />

            {media.length > 0 ? (
              <div className="grid gap-2 rounded-[1.15rem] border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] p-3">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
                  Attachments
                </p>
                <div className="flex flex-wrap gap-2">
                  {media.map((item) => (
                    <span
                      key={item.id}
                      className="inline-flex items-center gap-2 rounded-full border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1 text-xs font-bold text-[var(--color-text)]"
                    >
                      {isSafeNoteMedia(item)
                        ? <a href={item.dataUrl} download={item.name} className="max-w-44 truncate underline" title={item.name}>{item.name}</a>
                        : <span className="max-w-44 truncate" title="This legacy file type cannot be downloaded safely.">{item.name} (unsupported)</span>}
                      <button
                        type="button"
                        onClick={() => setMedia((current) => current.filter((mediaItem) => mediaItem.id !== item.id))}
                        className="font-bold text-[var(--color-text-muted)]"
                        title="Remove attachment"
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {error ? (
              <p className="rounded-[1rem] border-2 border-[var(--border-default)] bg-[var(--color-danger-soft)] px-4 py-3 text-sm font-bold text-[var(--color-text)]">
                {error}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex flex-1 items-center justify-center rounded-full border-2 border-[var(--border-default)] bg-[var(--color-accent)] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-[var(--color-accent-contrast)] shadow-[4px_4px_0_#000] transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_#000] disabled:cursor-not-allowed disabled:opacity-55"
              >
                {isSaving ? 'Saving…' : saveState === 'error' ? 'Retry save' : 'Save note'}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="danger-action rounded-full border-2 border-[var(--border-default)] bg-[var(--color-danger-soft)] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-[var(--color-text)] shadow-[4px_4px_0_#000]"
              >
                {selectedNote.isDraft ? 'Discard' : 'Delete'}
              </button>
            </div>
          </form>
        ) : (
          <div className="rounded-[1.35rem] border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] px-4 py-8 text-center">
            <p className="text-lg font-bold text-[var(--color-text)]">Select or create a note.</p>
          </div>
        )}
      </section>
    </div>
  );
}
