import { useEffect, useMemo, useRef, useState } from 'react';
import { createId } from '../progressTracker/progressTrackerStorage';
import { getTextFromHtml, sanitizeNoteHtml, sortNotes } from './noteContent';

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

function NoteEditor({
  value,
  onChange,
  media,
  onMediaChange,
  onError,
}) {
  const editorRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || '';
    }
  }, [value]);

  function syncContent() {
    onChange(sanitizeNoteHtml(editorRef.current?.innerHTML || ''));
  }

  function runCommand(command, commandValue = null) {
    editorRef.current?.focus();
    document.execCommand(command, false, commandValue);
    syncContent();
  }

  async function handleFiles(files) {
    const nextFiles = [...files];
    const nextMedia = [];

    for (const file of nextFiles) {
      if (file.size > 12 * 1024 * 1024) {
        onError(`${file.name} is larger than 12 MB.`);
        continue;
      }

      const dataUrl = await fileToDataUrl(file);
      const attachment = {
        id: createId('media'),
        name: file.name,
        type: file.type || 'application/octet-stream',
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
    runCommand('insertHTML', html ? sanitizeNoteHtml(html) : text);
  }

  return (
    <div className="rounded-[1.35rem] border-2 border-black bg-[#fffdf8] p-3 shadow-[4px_4px_0_#000]">
      <div className="flex flex-wrap gap-2 border-b-2 border-black/15 pb-3">
        <select
          className="field-input w-auto min-w-36 px-3 py-2 text-sm shadow-none"
          defaultValue="p"
          onChange={(event) => runCommand('formatBlock', event.target.value)}
          title="Text style"
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
                onClick={() => runCommand(item.command, item.value)}
                title={item.title}
                className="h-10 min-w-10 rounded-full border-2 border-black bg-white px-3 text-xs font-bold uppercase text-black transition hover:bg-[#c5ff6f]"
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}

        <label
          className="flex h-10 items-center gap-2 rounded-full border-2 border-black bg-white px-3 text-xs font-bold uppercase text-black"
          title="Text color"
        >
          Text
          <input
            type="color"
            className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
            onChange={(event) => runCommand('foreColor', event.target.value)}
          />
        </label>

        <label
          className="flex h-10 items-center gap-2 rounded-full border-2 border-black bg-white px-3 text-xs font-bold uppercase text-black"
          title="Highlight"
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
          onClick={() => {
            const href = window.prompt('Paste a link');
            if (href) {
              runCommand('createLink', href);
            }
          }}
          className="h-10 rounded-full border-2 border-black bg-white px-3 text-xs font-bold uppercase text-black transition hover:bg-[#c5ff6f]"
        >
          Link
        </button>

        <button
          type="button"
          onClick={() => runCommand('removeFormat')}
          className="h-10 rounded-full border-2 border-black bg-white px-3 text-xs font-bold uppercase text-black transition hover:bg-[#ffe0de]"
        >
          Clear
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="h-10 rounded-full border-2 border-black bg-[#9fe3ff] px-3 text-xs font-bold uppercase text-black transition hover:bg-white"
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
        suppressContentEditableWarning
        onInput={syncContent}
        onBlur={syncContent}
        onPaste={handlePaste}
        className="note-editor mt-4 min-h-80 rounded-[1rem] border-2 border-black bg-white px-4 py-3 text-base font-medium leading-7 text-black outline-none focus:shadow-[4px_4px_0_#000]"
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
}) {
  const [selectedNoteId, setSelectedNoteId] = useState('');
  const [draft, setDraft] = useState(null);
  const [title, setTitle] = useState('');
  const [contentHtml, setContentHtml] = useState('');
  const [linkedGoalId, setLinkedGoalId] = useState(activeGoal?.id || '');
  const [tagText, setTagText] = useState('');
  const [media, setMedia] = useState([]);
  const [error, setError] = useState('');

  const sortedNotes = useMemo(() => sortNotes(notes), [notes]);
  const selectedNote = draft || sortedNotes.find((note) => note.id === selectedNoteId) || null;
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
      setTitle('');
      setContentHtml('');
      setLinkedGoalId(activeGoal?.id || '');
      setTagText('');
      setMedia([]);
      return;
    }

    setTitle(selectedNote.title || '');
    setContentHtml(selectedNote.contentHtml || '');
    setLinkedGoalId(isGoalLocked ? activeGoal.id : selectedNote.linkedGoalId || '');
    setTagText((selectedNote.tags || []).join(', '));
    setMedia(selectedNote.media || []);
    setError('');
  }, [activeGoal?.id, isGoalLocked, selectedNote?.id, selectedNote?.updatedAt]);

  function startNewNote() {
    const nextDraft = getEmptyDraft(activeGoal?.id || '');
    setDraft(nextDraft);
    setSelectedNoteId(nextDraft.id);
  }

  async function handleSave(event) {
    event.preventDefault();

    const nextContentHtml = sanitizeNoteHtml(contentHtml);
    const contentText = getTextFromHtml(nextContentHtml);
    const nextTitle = title.trim() || contentText.slice(0, 54) || 'Untitled note';

    if (!contentText && media.length === 0) {
      setError('Write a note or attach media first.');
      return;
    }

    setError('');

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
      });

      setDraft(null);
      setSelectedNoteId(savedNote?.id || selectedNote?.id || '');
    } catch (saveError) {
      setError(saveError.message);
    }
  }

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
    <div className="grid items-start gap-5 xl:grid-cols-[0.78fr_1.22fr]">
      <aside className="rounded-[1.75rem] border-2 border-black bg-[#9fe3ff] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">
              Saved notes
            </p>
              <h2 className="mt-2 text-2xl font-bold text-black">
              {isGoalLocked ? activeGoal.title : 'Notebook'}
            </h2>
          </div>
          <button
            type="button"
            onClick={startNewNote}
            className="rounded-full border-2 border-black bg-[#c5ff6f] px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-black shadow-[3px_3px_0_#000]"
          >
            New
          </button>
        </div>

        <div className="mt-5 grid gap-3">
          {draft ? (
            <button
              type="button"
              className="rounded-[1.15rem] border-2 border-black bg-[#c5ff6f] p-4 text-left shadow-[4px_4px_0_#000]"
            >
              <span className="block text-xs font-bold uppercase tracking-[0.14em] text-black/55">
                Draft
              </span>
              <span className="mt-2 block text-lg font-bold text-black">
                Unsaved note
              </span>
            </button>
          ) : null}

          {sortedNotes.length === 0 && !draft ? (
            <div className="rounded-[1.15rem] border-2 border-black bg-white px-4 py-5 text-sm font-bold leading-6 text-black/70">
              No notes yet.
            </div>
          ) : null}

          {sortedNotes.map((note) => {
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
                className={`rounded-[1.15rem] border-2 border-black p-4 text-left transition ${
                  isActive
                    ? 'bg-[#c5ff6f] shadow-[4px_4px_0_#000]'
                    : 'bg-[#fffdf8] hover:bg-white'
                }`}
              >
                <span className="block text-xs font-bold uppercase tracking-[0.14em] text-black/55">
                  {formatDate(note.updatedAt || note.createdAt)}
                </span>
                <span className="mt-2 block break-words text-lg font-bold text-black">
                  {note.title}
                </span>
                <span className="mt-2 line-clamp-2 block text-sm font-semibold leading-6 text-black/65">
                  {note.contentText || `${note.media.length} media attachment${note.media.length === 1 ? '' : 's'}`}
                </span>
                {linkedGoal ? (
                  <span className="mt-3 inline-flex rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-black">
                    {linkedGoal.title}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </aside>

      <section className="rounded-[1.75rem] border-2 border-black bg-[#fff0b8] p-4 sm:p-5">
        {selectedNote ? (
          <form onSubmit={handleSave} className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-[1fr_0.65fr]">
              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-black/70">
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
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-black/70">
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
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-black/70">
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
              <div className="grid gap-2 rounded-[1.15rem] border-2 border-black bg-[#fffdf8] p-3">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-black/60">
                  Attachments
                </p>
                <div className="flex flex-wrap gap-2">
                  {media.map((item) => (
                    <span
                      key={item.id}
                      className="inline-flex items-center gap-2 rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-bold text-black"
                    >
                      <a
                        href={item.dataUrl}
                        download={item.name}
                        className="max-w-44 truncate underline"
                        title={item.name}
                      >
                        {item.name}
                      </a>
                      <button
                        type="button"
                        onClick={() => setMedia((current) => current.filter((mediaItem) => mediaItem.id !== item.id))}
                        className="font-bold text-black/60"
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
              <p className="rounded-[1rem] border-2 border-black bg-[#ffe0de] px-4 py-3 text-sm font-bold text-black">
                {error}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex flex-1 items-center justify-center rounded-full border-2 border-black bg-[#c5ff6f] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-black shadow-[4px_4px_0_#000] transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_#000] disabled:cursor-not-allowed disabled:opacity-55"
              >
                {isSaving ? 'Saving...' : 'Save note'}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="rounded-full border-2 border-black bg-[#ffe0de] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-black shadow-[4px_4px_0_#000]"
              >
                {selectedNote.isDraft ? 'Discard' : 'Delete'}
              </button>
            </div>
          </form>
        ) : (
          <div className="rounded-[1.35rem] border-2 border-black bg-[#fffdf8] px-4 py-8 text-center">
            <p className="text-lg font-bold text-black">Select or create a note.</p>
          </div>
        )}
      </section>
    </div>
  );
}
