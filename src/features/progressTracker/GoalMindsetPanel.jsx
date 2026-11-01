import { useEffect, useMemo, useState } from 'react';
import { ThemedDatePicker } from '../../components/ui/ThemedDatePicker';
import { createId, getTodayInputValue } from './progressTrackerStorage';

function sortJournalEntries(entries) {
  return [...entries].sort((leftEntry, rightEntry) => {
    const dateCompare = rightEntry.entryDate.localeCompare(leftEntry.entryDate);
    return dateCompare || rightEntry.createdAt.localeCompare(leftEntry.createdAt);
  });
}

function sortQuotes(quotes) {
  return [...quotes].sort((leftQuote, rightQuote) => {
    if (leftQuote.isPinned !== rightQuote.isPinned) {
      return leftQuote.isPinned ? -1 : 1;
    }

    return rightQuote.createdAt.localeCompare(leftQuote.createdAt);
  });
}

export function getPinnedGoalQuote(goal, quotes) {
  return quotes.find((quote) => quote.isPinned) || (
    goal?.quote
      ? {
        id: 'legacy-goal-quote',
        content: goal.quote,
        isPinned: true,
      }
      : null
  );
}

export function GoalPinnedQuote({ goal, quotes }) {
  const pinnedQuote = getPinnedGoalQuote(goal, quotes);

  if (!pinnedQuote?.content) {
    return null;
  }

  return (
    <section className="rounded-[1.75rem] border-2 border-[var(--border-default)] bg-[var(--color-warning-soft)] p-5 shadow-[5px_5px_0_#000] sm:p-6">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
        Pinned quote
      </p>
      <blockquote className="mt-3 break-words text-2xl font-bold leading-8 tracking-[-0.04em] text-[var(--color-text)] sm:text-3xl sm:leading-10">
        {pinnedQuote.content}
      </blockquote>
      <p className="mt-4 text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
        {goal.title}
      </p>
    </section>
  );
}

export function GoalVisionPanel({
  goal,
  goalQuotes,
  onSaveReflection,
  onSaveQuote,
  onPinQuote,
  onDeleteQuote,
  isSaving,
  isQuoteSaving,
}) {
  const [vision, setVision] = useState(goal?.vision ?? '');
  const [editingQuote, setEditingQuote] = useState(null);
  const [quoteContent, setQuoteContent] = useState('');
  const [pinQuote, setPinQuote] = useState(false);
  const [error, setError] = useState('');
  const [quoteError, setQuoteError] = useState('');
  const sortedQuotes = useMemo(() => sortQuotes(goalQuotes), [goalQuotes]);

  useEffect(() => {
    setVision(goal?.vision ?? '');
    setEditingQuote(null);
    setQuoteContent('');
    setPinQuote(goalQuotes.length === 0);
    setError('');
    setQuoteError('');
  }, [goal?.id, goal?.vision, goalQuotes.length]);

  const isDirty = vision !== (goal?.vision ?? '');

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    try {
      await onSaveReflection(goal.id, {
        vision: vision.trim(),
      });
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  function startEditingQuote(quote) {
    setEditingQuote(quote);
    setQuoteContent(quote.content);
    setPinQuote(Boolean(quote.isPinned));
    setQuoteError('');
  }

  function resetQuoteForm() {
    setEditingQuote(null);
    setQuoteContent('');
    setPinQuote(sortedQuotes.length === 0);
    setQuoteError('');
  }

  async function handleQuoteSubmit(event) {
    event.preventDefault();

    if (!quoteContent.trim()) {
      setQuoteError('Write a quote first.');
      return;
    }

    setQuoteError('');

    try {
      await onSaveQuote({
        id: editingQuote?.id || createId('quote'),
        goalId: goal.id,
        content: quoteContent.trim(),
        isPinned: pinQuote || sortedQuotes.length === 0,
        createdAt: editingQuote?.createdAt || new Date().toISOString(),
      });
      resetQuoteForm();
    } catch (saveError) {
      setQuoteError(saveError.message);
    }
  }

  return (
    <section className="rounded-[1.75rem] border-2 border-[var(--border-default)] bg-[var(--color-warning-soft)] p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
            Vision
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-[var(--color-text)]">
            Vision and quotes
          </h2>
        </div>
        <span className="rounded-full border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text)]">
          Per-goal
        </span>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 grid gap-4">
        <label className="block">
          <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
            Goal vision
          </span>
          <textarea
            className="field-input min-h-48 resize-y"
            value={vision}
            onChange={(event) => setVision(event.target.value)}
            placeholder="Why does this goal matter, and what does success look like?"
          />
        </label>

        {error ? (
          <p className="rounded-[1rem] border-2 border-[var(--border-default)] bg-[var(--color-danger-soft)] px-4 py-3 text-sm font-bold text-[var(--color-text)]">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!isDirty || isSaving}
          className="inline-flex w-full items-center justify-center rounded-full border-2 border-[var(--border-default)] bg-[var(--color-accent)] px-5 py-3.5 text-sm font-bold uppercase tracking-[0.12em] text-[var(--color-accent-contrast)] shadow-[4px_4px_0_#000] transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_#000] disabled:cursor-not-allowed disabled:opacity-55"
        >
          {isSaving ? 'Saving...' : isDirty ? 'Save vision' : 'Vision saved'}
        </button>
      </form>

      <div className="mt-6 border-t-2 border-black/20 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
              Quotes
            </p>
            <h3 className="mt-2 text-xl font-bold tracking-[-0.04em] text-[var(--color-text)]">
              Dashboard quote stack
            </h3>
          </div>
          <span className="rounded-full border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text)]">
            {sortedQuotes.length}
          </span>
        </div>

        <form
          onSubmit={handleQuoteSubmit}
          className="mt-4 rounded-[1.35rem] border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] p-4 shadow-[4px_4px_0_#000]"
        >
          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
              Quote or affirmation
            </span>
            <textarea
              className="field-input min-h-28 resize-y"
              value={quoteContent}
              onChange={(event) => setQuoteContent(event.target.value)}
              placeholder="Discipline beats motivation."
            />
          </label>

          <label className="mt-4 flex items-center justify-between gap-4 rounded-[1.35rem] border-2 border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
            <span>
              <span className="block text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
                Show on dashboard
              </span>
              <span className="mt-1 block text-sm font-semibold leading-6 text-[var(--color-text-secondary)]">
                Pin this quote at the top of the selected goal dashboard.
              </span>
            </span>
            <button
              type="button"
              onClick={() => setPinQuote((current) => !current)}
              className={`relative h-8 w-16 shrink-0 rounded-full border-2 border-[var(--border-default)] transition ${
                pinQuote ? 'bg-[var(--color-accent)]' : 'bg-[var(--surface-elevated)]'
              }`}
              aria-pressed={pinQuote}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full border-2 border-[var(--border-default)] bg-black transition ${
                  pinQuote ? 'left-9' : 'left-1'
                }`}
              />
            </button>
          </label>

          {quoteError ? (
            <p className="mt-4 rounded-[1rem] border-2 border-[var(--border-default)] bg-[var(--color-danger-soft)] px-4 py-3 text-sm font-bold text-[var(--color-text)]">
              {quoteError}
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={isQuoteSaving}
              className="inline-flex flex-1 items-center justify-center rounded-full border-2 border-[var(--border-default)] bg-[var(--color-accent)] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-[var(--color-accent-contrast)] shadow-[4px_4px_0_#000] transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_#000] disabled:cursor-not-allowed disabled:opacity-55"
            >
              {isQuoteSaving ? 'Saving...' : editingQuote ? 'Update quote' : 'Add quote'}
            </button>
            {editingQuote ? (
              <button
                type="button"
                onClick={resetQuoteForm}
                className="rounded-full border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-[var(--color-text)]"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>

        {sortedQuotes.length === 0 ? (
          <div className="mt-5 rounded-[1.35rem] border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] px-4 py-5 text-sm font-bold leading-6 text-[var(--color-text-secondary)]">
            No quotes yet. Add one and pin it to show it on the dashboard.
          </div>
        ) : (
          <div className="mt-5 grid gap-3">
            {sortedQuotes.map((quote) => (
              <article
                key={quote.id}
                className={`rounded-[1.35rem] border-2 border-[var(--border-default)] p-4 ${
                  quote.isPinned ? 'bg-[var(--color-accent)]' : 'bg-[var(--surface-elevated)]'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-base font-bold leading-7 tracking-[-0.03em] text-[var(--color-text)]">
                      {quote.content}
                    </p>
                    <span className="mt-3 inline-flex rounded-full border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-text)]">
                      {quote.isPinned ? 'Shown on dashboard' : 'Saved quote'}
                    </span>
                  </div>

                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    {!quote.isPinned ? (
                      <button
                        type="button"
                        onClick={() => onPinQuote(quote)}
                        className="rounded-full border-2 border-[var(--border-default)] bg-[#ffd166] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-text)]"
                      >
                        Pin
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => startEditingQuote(quote)}
                      className="rounded-full border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-text)]"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteQuote(quote.id)}
                      className="danger-action rounded-full border-2 border-[var(--border-default)] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] transition"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function GoalJournalPanel({
  goal,
  journalEntries,
  onSaveJournalEntry,
  onDeleteJournalEntry,
  isSaving,
}) {
  const [editingEntry, setEditingEntry] = useState(null);
  const [entryDate, setEntryDate] = useState(getTodayInputValue());
  const [mood, setMood] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');

  const sortedEntries = useMemo(
    () => sortJournalEntries(journalEntries),
    [journalEntries],
  );

  useEffect(() => {
    setEditingEntry(null);
    setEntryDate(getTodayInputValue());
    setMood('');
    setContent('');
    setError('');
  }, [goal.id]);

  function resetForm() {
    setEditingEntry(null);
    setEntryDate(getTodayInputValue());
    setMood('');
    setContent('');
    setError('');
  }

  function startEditing(entry) {
    setEditingEntry(entry);
    setEntryDate(entry.entryDate);
    setMood(entry.mood || '');
    setContent(entry.content || '');
    setError('');
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!content.trim()) {
      setError('Write a journal note first.');
      return;
    }

    setError('');

    try {
      await onSaveJournalEntry({
        id: editingEntry?.id || createId('journal'),
        goalId: goal.id,
        entryDate,
        mood: mood.trim(),
        content: content.trim(),
        createdAt: editingEntry?.createdAt || new Date().toISOString(),
      });
      resetForm();
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  return (
    <section className="rounded-[1.75rem] border-2 border-[var(--border-default)] bg-[#9fe3ff] p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
            Journal
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-[var(--color-text)]">
            Goal reflections
          </h2>
        </div>
        <span className="rounded-full border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text)]">
          {journalEntries.length}
        </span>
      </div>

      <form
        onSubmit={handleSubmit}
        className="mt-5 rounded-[1.35rem] border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] p-4 shadow-[4px_4px_0_#000]"
      >
        <div className="grid gap-4 md:grid-cols-[0.55fr_1fr]">
          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
              Date
            </span>
            <ThemedDatePicker
              value={entryDate}
              onChange={(event) => setEntryDate(event.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
              Mood or tag
            </span>
            <input
              className="field-input"
              value={mood}
              onChange={(event) => setMood(event.target.value)}
              placeholder="Focused, tired, proud..."
            />
          </label>
        </div>

        <label className="mt-4 block">
          <span className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
            Reflection
          </span>
          <textarea
            className="field-input min-h-36 resize-y"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="What happened with this goal today?"
          />
        </label>

        {error ? (
          <p className="mt-4 rounded-[1rem] border-2 border-[var(--border-default)] bg-[var(--color-danger-soft)] px-4 py-3 text-sm font-bold text-[var(--color-text)]">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex flex-1 items-center justify-center rounded-full border-2 border-[var(--border-default)] bg-[var(--color-accent)] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-[var(--color-accent-contrast)] shadow-[4px_4px_0_#000] transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_#000] disabled:cursor-not-allowed disabled:opacity-55"
          >
            {isSaving ? 'Saving...' : editingEntry ? 'Update journal' : 'Add journal'}
          </button>
          {editingEntry ? (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-full border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-[var(--color-text)]"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      {sortedEntries.length === 0 ? (
        <div className="mt-5 rounded-[1.35rem] border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] px-4 py-5 text-sm font-bold leading-6 text-[var(--color-text-secondary)]">
          No journal entries for this goal yet.
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          {sortedEntries.map((entry) => (
            <article
              key={entry.id}
              className="rounded-[1.35rem] border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
                    {entry.entryDate}
                  </p>
                  {entry.mood ? (
                    <span className="mt-2 inline-flex rounded-full border-2 border-[var(--border-default)] bg-[#ffd166] px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-text)]">
                      {entry.mood}
                    </span>
                  ) : null}
                </div>

                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => startEditing(entry)}
                    className="rounded-full border-2 border-[var(--border-default)] bg-[var(--color-accent)] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-accent-contrast)]"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteJournalEntry(entry.id)}
                    className="danger-action rounded-full border-2 border-[var(--border-default)] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] transition"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <p className="mt-4 whitespace-pre-wrap rounded-[1rem] border-2 border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-semibold leading-6 text-[var(--color-text-secondary)]">
                {entry.content}
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
