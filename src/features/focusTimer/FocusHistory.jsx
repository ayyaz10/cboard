import {
  calculateFocusScore,
  formatSessionDate,
  getSessionBreakTaskSummary,
} from './focusTimerHelpers';

function formatResult(result) {
  if (!result) {
    return 'Not reflected';
  }

  return result === 'yes'
    ? 'Completed'
    : result === 'partially'
    ? 'Partially'
    : 'No';
}

function notePreview(note) {
  if (!note) {
    return 'No note yet';
  }

  return note.length > 96 ? `${note.slice(0, 96)}...` : note;
}

export function FocusHistoryItem({
  session,
  breakTasks,
  isOpen,
  onToggleOpen,
  onEditReflection,
  onDeleteSession,
}) {
  const taskSummary = getSessionBreakTaskSummary(breakTasks);
  const score = Number.isFinite(session.focusScore)
    ? Math.round(session.focusScore)
    : calculateFocusScore(session, breakTasks);

  return (
    <article className="ui-card p-4">
      <button
        type="button"
        onClick={onToggleOpen}
        className="w-full text-left"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
              {formatSessionDate(session.startedAt || session.createdAt)}
            </p>
            <h3 className="mt-2 text-xl font-bold tracking-[-0.04em] text-[var(--color-text)]">
              {session.title}
            </h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-[var(--color-text-secondary)]">
              {notePreview(session.reflectionNote)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="ui-badge ui-badge--accent text-xs uppercase tracking-[0.12em]">
              {session.status}
            </span>
            <span className="ui-badge text-xs uppercase tracking-[0.12em]">
              {score} score
            </span>
          </div>
        </div>
      </button>

      {isOpen ? (
        <div className="mt-4 border-t-2 border-[var(--color-border)] pt-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="ui-card p-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
                Duration
              </p>
              <p className="mt-2 text-sm font-bold text-[var(--color-text)]">
                {session.focusMinutes} min focus / {session.breakMinutes} min break
              </p>
            </div>
            <div className="ui-card p-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
                Intention result
              </p>
              <p className="mt-2 text-sm font-bold text-[var(--color-text)]">
                {formatResult(session.reflectionResult)}
              </p>
            </div>
            <div className="ui-card p-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
                Distraction
              </p>
              <p className="mt-2 text-sm font-bold text-[var(--color-text)]">
                {Number.isFinite(session.distractionLevel) ? session.distractionLevel : '--'}
              </p>
            </div>
          </div>

          {session.intention ? (
            <p className="ui-card mt-3 px-3 py-2 text-sm font-semibold leading-6">
              <strong className="text-[var(--color-text)]">Intention:</strong> {session.intention}
            </p>
          ) : null}

          {session.taskDetails ? (
            <p className="ui-card mt-3 px-3 py-2 text-sm font-semibold leading-6">
              <strong className="text-[var(--color-text)]">Notebook:</strong> {session.taskDetails}
            </p>
          ) : null}

          <div className="ui-card mt-3 px-3 py-2 text-sm font-semibold leading-6">
            Break tasks: {taskSummary.completed}/{taskSummary.total}
          </div>

          {session.reflectionNote ? (
            <p className="ui-card mt-3 px-3 py-2 text-sm font-semibold leading-6">
              {session.reflectionNote}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onEditReflection}
              className="ui-button ui-button--sm text-xs uppercase tracking-[0.12em]"
            >
              Edit note
            </button>
            <button
              type="button"
              onClick={onDeleteSession}
              className="ui-button ui-button--danger ui-button--sm text-xs uppercase tracking-[0.12em]"
            >
              Delete
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function FocusHistory({
  sessions,
  breakTasksBySessionId,
  openSessionId,
  onToggleOpen,
  onEditReflection,
  onDeleteSession,
}) {
  return (
    <section className="ui-panel p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
            History
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-[var(--color-text)]">
            Focus sessions
          </h2>
        </div>
        <span className="ui-badge text-xs uppercase tracking-[0.14em]">
          Details collapsed
        </span>
      </div>

      {sessions.length === 0 ? (
        <div className="ui-card mt-5 px-4 py-5 text-sm font-bold leading-6">
          No focus sessions yet. Start your first focus session.
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          {sessions.map((session) => (
            <FocusHistoryItem
              key={session.id}
              session={session}
              breakTasks={breakTasksBySessionId[session.id] || []}
              isOpen={openSessionId === session.id}
              onToggleOpen={() => onToggleOpen(session.id)}
              onEditReflection={() => onEditReflection(session)}
              onDeleteSession={() => onDeleteSession(session)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
